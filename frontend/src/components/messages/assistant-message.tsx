"use client";

import { useState, useMemo, memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { MessageContent } from "./message-content";
import { MessageActions } from "./message-actions";
import { CompactionPart } from "@/components/parts/compaction-part";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { startStream } from "@/lib/session-stream-registry";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatSession, useChatStore } from "@/stores/chat-store";
import { useActivityStore } from "@/stores/activity-store";
import { extractTextFromParts, visibleMessageParts } from "@/lib/utils";
import type { PromptResponse } from "@/types/chat";
import type { MessageResponse, PartData, ToolPart, StepStartPart, StepFinishPart, CompactionPart as CompactionPartType } from "@/types/message";
import { computeDuration, type ActivityData, type ChainItem } from "@/stores/activity-store";

interface AssistantMessageProps {
  message: MessageResponse;
  /** Pre-combined parts from grouped consecutive assistant messages. */
  combinedParts?: PartData[];
  onRegenerate?: () => void;
  /** Whether this message just arrived (animate) or was loaded from history (skip animation). */
  isNew?: boolean;
  /** Whether this is the last message in the thread (newest data card starts expanded). */
  isLastMessage?: boolean;
}

export function AssistantMessage({ message, combinedParts, onRegenerate, isNew = true, isLastMessage = false }: AssistantMessageProps) {
  const [hovered, setHovered] = useState(false);
  const refreshForMessage = useActivityStore((s) => s.refreshForMessage);
  const parts = combinedParts ?? message.parts.map((p) => p.data as PartData);
  const mainParts = useMemo(
    () => visibleMessageParts(parts),
    [parts],
  );
  const compactionParts = useMemo(
    () => parts.filter((part): part is CompactionPartType => part.type === "compaction"),
    [parts],
  );
  const activityKey = useMemo(
    () =>
      mainParts.some((part) => part.type === "step-start" && part.snapshot?.mode === "expert-team")
        ? `expert:${message.session_id}`
        : message.id,
    [mainParts, message.id, message.session_id],
  );

  // Extract text content for copy
  const textContent = extractTextFromParts(mainParts);
  const resumeInfo = useMemo(() => expertResumeInfo(mainParts, message.session_id), [mainParts, message.session_id]);
  const handleResumeExpert = useMemo(() => {
    if (!resumeInfo) return undefined;
    return async () => {
      const settings = useSettingsStore.getState();
      const chat = useChatStore.getState();
      try {
        chat.beginSending(message.session_id, `从 ${resumeInfo.taskId} 继续专家团`, []);
        const res = await api.post<PromptResponse>(
          API.EXPERT_TEAMS.RESUME(resumeInfo.teamId, message.session_id),
          {
            from_task_id: resumeInfo.taskId,
            model: settings.selectedModel,
            provider_id: settings.selectedProviderId,
            workspace: settings.workspaceDirectory,
            reasoning: settings.reasoningEnabled,
          },
          { timeoutMs: 30_000 },
        );
        chat.startGeneration(res.session_id, res.stream_id);
        void startStream(res.session_id, res.stream_id);
      } catch (error) {
        console.error("Failed to resume expert team:", error);
        chat.resetSession(message.session_id);
      }
    };
  }, [message.session_id, resumeInfo]);

  // Build activity data from parts
  const activityData = useMemo<ActivityData | null>(() => {
    const reasoningTexts = mainParts
      .filter((p): p is PartData & { type: "reasoning" } => p.type === "reasoning")
      .map((p) => p.text);
    const toolParts = mainParts.filter((p): p is ToolPart => p.type === "tool");
    const stepParts = mainParts.filter(
      (p): p is StepStartPart | StepFinishPart =>
        p.type === "step-start" || p.type === "step-finish",
    );
    const hasExpertSteps = stepParts.some((part) => part.snapshot?.mode === "expert-team");

    if (reasoningTexts.length === 0 && toolParts.length === 0 && !hasExpertSteps) return null;

    const chain: ChainItem[] = [];
    for (const p of mainParts) {
      if (p.type === "reasoning") chain.push({ type: "reasoning", text: (p as PartData & { type: "reasoning" }).text });
      else if (p.type === "tool") chain.push({ type: "tool", data: p as ToolPart });
    }

    const data: ActivityData = {
      sourceKey: activityKey,
      mode: hasExpertSteps ? "expert-team" : "default",
      parts: mainParts,
      reasoningTexts,
      toolParts,
      stepParts,
      hasVisibleOutput: mainParts.some((p) =>
        p.type === "text" || p.type === "file" || p.type === "subtask",
      ),
      chain,
    };
    data.thinkingDuration = computeDuration(data);
    return data;
  }, [activityKey, mainParts]);

  useEffect(() => {
    if (activityData) {
      refreshForMessage(activityKey, activityData);
    }
  }, [activityData, activityKey, refreshForMessage]);

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <motion.div
          initial={isNew ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
            opacity: { duration: 0.2 },
          }}
        >
          <MessageContent
            parts={mainParts}
            activityKey={activityKey}
            expandLatestDataCard={isLastMessage}
          />
        </motion.div>

        {/* Action bar — always in DOM to avoid layout shift, opacity-only toggle */}
        <div
          className={`transition-opacity duration-150 ${hovered ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <MessageActions
            content={textContent}
            onRegenerate={onRegenerate}
            activityData={activityData}
            activityKey={activityKey}
            onResumeExpert={handleResumeExpert}
          />
        </div>
      </div>

      {compactionParts.length > 0 && (
        <div className="mt-4 space-y-2">
          {compactionParts.map((part, index) => (
            <CompactionPart key={`${activityKey}-compaction-${index}`} data={part} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Streaming assistant message — renders live parts being accumulated.
 */
interface StreamingMessageProps {
  sessionId?: string | null;
  parts: PartData[];
  streamingText: string;
  streamingReasoning: string;
}

export const StreamingMessage = memo(function StreamingMessage({ sessionId = null, parts, streamingText, streamingReasoning }: StreamingMessageProps) {
  const { t } = useTranslation("chat");
  const isModelLoading = useChatSession(sessionId).isModelLoading;
  const refreshForMessage = useActivityStore((s) => s.refreshForMessage);
  const openForMessage = useActivityStore((s) => s.openForMessage);
  const autoOpenedExpertPanelRef = useRef(false);

  // Track whether this component mounted with no existing stream content.
  // If it did, the fade-in is a genuine "new response appearing" cue. If the
  // store already had parts/text/reasoning at mount time, this is a remount
  // mid-stream (e.g. route swap from /c/new → /c/[id] after session creation)
  // and the fade would flash the whole chat area like a page refresh.
  const freshMountRef = useRef(
    parts.length === 0 && !streamingText && !streamingReasoning,
  );

  // Stabilize liveParts reference — without useMemo, a new array is created
  // on every render, breaking downstream useMemo dependencies in MessageContent.
  const liveParts = useMemo(() => {
    const result: PartData[] = [...parts];
    if (streamingReasoning) result.push({ type: "reasoning", text: streamingReasoning });
    if (streamingText) result.push({ type: "text", text: streamingText });
    return result;
  }, [parts, streamingReasoning, streamingText]);

  const streamingActivityData = useMemo<ActivityData | null>(() => {
    const stepParts = liveParts.filter(
      (p): p is StepStartPart | StepFinishPart =>
        p.type === "step-start" || p.type === "step-finish",
    );
    const hasExpertSteps = stepParts.some((part) => part.snapshot?.mode === "expert-team");
    if (!hasExpertSteps || !sessionId) return null;

    const reasoningTexts = liveParts
      .filter((p): p is PartData & { type: "reasoning" } => p.type === "reasoning")
      .map((p) => p.text);
    const toolParts = liveParts.filter((p): p is ToolPart => p.type === "tool");
    const chain: ChainItem[] = [];
    for (const p of liveParts) {
      if (p.type === "reasoning") chain.push({ type: "reasoning", text: p.text });
      else if (p.type === "tool") chain.push({ type: "tool", data: p });
    }
    const data: ActivityData = {
      sourceKey: `expert:${sessionId}`,
      mode: "expert-team",
      parts: liveParts,
      reasoningTexts,
      toolParts,
      stepParts,
      hasVisibleOutput: liveParts.some((p) =>
        p.type === "text" || p.type === "file" || p.type === "subtask",
      ),
      chain,
    };
    data.thinkingDuration = computeDuration(data);
    return data;
  }, [liveParts, sessionId]);

  useEffect(() => {
    if (!streamingActivityData?.sourceKey) return;
    if (!autoOpenedExpertPanelRef.current) {
      openForMessage(streamingActivityData.sourceKey, streamingActivityData);
      autoOpenedExpertPanelRef.current = true;
    } else {
      refreshForMessage(streamingActivityData.sourceKey, streamingActivityData);
    }
  }, [openForMessage, refreshForMessage, streamingActivityData]);

  // No content yet — show blinking cursor to indicate "about to type"
  if (liveParts.length === 0) {
    return (
      <div className={freshMountRef.current ? "animate-fade-in" : undefined}>
        <StreamingStage label={t("stageThinking")} />
        <StreamingIndicator />
      </div>
    );
  }

  // Check if there's active text/reasoning streaming.
  // If not, the agent is in a "quiet" phase (e.g., executing tool after
  // permission, waiting between steps) — show a trailing indicator.
  const isActivelyStreaming = !!streamingText || !!streamingReasoning;
  const hasAnyTool = liveParts.some((p) => p.type === "tool");
  const hasAnyActivity = liveParts.some((p) => p.type === "reasoning" || p.type === "tool");
  // Also check if the last tool is still running
  const lastPart = liveParts[liveParts.length - 1];
  const hasRunningTool =
    lastPart?.type === "tool" && lastPart.state?.status === "running";
  // Check if the last step finished with a terminal reason (LLM is done,
  // just waiting for DONE event — e.g. during title generation).
  const lastStepFinish = [...liveParts].reverse().find((p) => p.type === "step-finish") as
    | (PartData & { type: "step-finish"; reason?: string }) | undefined;
  const isGenerationDone = !!lastStepFinish && lastStepFinish.reason !== "tool_use";
  const showTail = !isActivelyStreaming && !hasRunningTool && !isGenerationDone;

  let stageLabel = t("stageThinking");
  if (hasRunningTool) stageLabel = t("stageWorkingWithTools");
  else if (!isActivelyStreaming && hasAnyTool) stageLabel = t("stageFinalizing");

  return (
    <div className={freshMountRef.current ? "animate-fade-in" : undefined}>
      {!hasAnyActivity && <StreamingStage label={isModelLoading ? t("stageThinking") : stageLabel} />}
      <MessageContent parts={liveParts} isStreaming />
      {showTail && (
        <div className="mt-2">
          <StreamingIndicator label={stageLabel} />
        </div>
      )}
    </div>
  );
});

function expertResumeInfo(parts: PartData[], sessionId: string): { teamId: string; taskId: string } | null {
  if (!sessionId) return null;
  let teamId = "";
  let failedTaskId: string | null = null;
  const completedTasks = new Set<string>();

  for (const part of parts) {
    if (part.type === "step-start") {
      continue;
    }

    if (part.type !== "step-finish") continue;
    const snapshot = part.snapshot ?? {};
    if (snapshot.mode !== "expert-team") continue;
    if (typeof snapshot.expert_team === "string") teamId = snapshot.expert_team;
    const taskId = typeof snapshot.task_id === "string" ? snapshot.task_id : "";
    if (!taskId || taskId === "final") continue;
    if (snapshot.status === "completed") {
      completedTasks.add(taskId);
      if (failedTaskId === taskId) failedTaskId = null;
      continue;
    }
    if (snapshot.status === "failed" && !completedTasks.has(taskId)) {
      failedTaskId = taskId;
    }
  }
  if (!teamId || !failedTaskId || completedTasks.has(failedTaskId)) return null;
  return { teamId, taskId: failedTaskId };
}

function StreamingStage({ label }: { label: string }) {
  return (
    <div
      className="mb-2 flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)] animate-[pulse-dot_1.4s_ease-in-out_infinite]"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}

/** Animated dots — shown while waiting for or between output (Claude.ai style). */
function StreamingIndicator({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex items-center gap-1 py-3" role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)] animate-[pulse-dot_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.2}s` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
