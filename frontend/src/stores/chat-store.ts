"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type { CompactionPart, CompactionPhase, CompactionPhaseStatus, FilePart, PartData, ToolPart } from "@/types/message";
import type { PermissionRequest, QuestionRequest, PlanReviewRequest } from "@/types/streaming";
import type { FileAttachment } from "@/types/chat";

/**
 * Cumulative usage for a chat session (across multiple generations).
 * Reset only on `resetSession()`; preserved across `finishGeneration`.
 */
export interface LiveSessionUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number | null;
}

const EMPTY_SESSION_USAGE: LiveSessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: null,
};

const SEEN_STEP_FINISH_IDS = new Map<string, Set<number>>();
const SEEN_STEP_FINISH_LIMIT = 256;

function rememberStepFinishId(sessionId: string, id: number | null | undefined): boolean {
  if (id === null || id === undefined) return false;
  let seen = SEEN_STEP_FINISH_IDS.get(sessionId);
  if (!seen) {
    seen = new Set<number>();
    SEEN_STEP_FINISH_IDS.set(sessionId, seen);
  }
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > SEEN_STEP_FINISH_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return false;
}

function clearSeenStepFinishIds(sessionId: string): void {
  SEEN_STEP_FINISH_IDS.delete(sessionId);
}

const DRAFT_KEY = "__draft__";

export interface ChatSessionState {
  streamId: string | null;
  isGenerating: boolean;
  isCompacting: boolean;
  isModelLoading: boolean;

  pendingUserText: string | null;
  pendingAttachments: FileAttachment[] | null;

  streamingParts: PartData[];
  streamingText: string;
  streamingReasoning: string;

  pendingPermission: PermissionRequest | null;
  pendingQuestion: QuestionRequest | null;
  pendingPlanReview: PlanReviewRequest | null;

  sessionUsage: LiveSessionUsage;
}

export const EMPTY_SESSION_STATE: ChatSessionState = {
  streamId: null,
  isGenerating: false,
  isCompacting: false,
  isModelLoading: false,
  pendingUserText: null,
  pendingAttachments: null,
  streamingParts: [],
  streamingText: "",
  streamingReasoning: "",
  pendingPermission: null,
  pendingQuestion: null,
  pendingPlanReview: null,
  sessionUsage: EMPTY_SESSION_USAGE,
};

interface ChatStore {
  sessions: Record<string, ChatSessionState>;
  draftSession: ChatSessionState | null;
  focusedSessionId: string | null;

  ensureSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  resetSession: (sessionId: string | null) => void;
  setFocusedSession: (sessionId: string | null) => void;
  resetAll: () => void;

  beginSending: (sessionId: string | null, text: string, attachments?: FileAttachment[]) => void;
  startGeneration: (sessionId: string, streamId: string) => void;
  primeStreamingParts: (sessionId: string | null, parts: PartData[]) => void;
  startCompactionStream: (sessionId: string, streamId: string) => void;
  appendTextDelta: (sessionId: string | null, text: string) => void;
  appendReasoningDelta: (sessionId: string | null, text: string) => void;
  addToolStart: (sessionId: string | null, tool: string, callId: string, args: Record<string, unknown>, title?: string | null) => void;
  updateToolProgress: (sessionId: string | null, callId: string, title?: string | null, metadata?: Record<string, unknown> | null, output?: string | null) => void;
  setToolResult: (sessionId: string | null, callId: string, output: string, title?: string | null, metadata?: Record<string, unknown> | null) => void;
  setToolError: (sessionId: string | null, callId: string, output: string, title?: string | null, metadata?: Record<string, unknown> | null) => void;
  addFileParts: (sessionId: string | null, files: Array<Partial<FilePart> & { path: string; name?: string }>) => void;
  addStepStart: (sessionId: string | null, step: number, snapshot?: Record<string, unknown> | null) => void;
  addStepFinish: (
    sessionId: string | null,
    reason: string,
    tokens: Record<string, number>,
    cost: number,
    totalCost: number | null,
    eventId?: number | null,
    snapshot?: Record<string, unknown> | null,
  ) => void;
  addCompaction: (sessionId: string | null, auto: boolean) => void;
  startCompaction: (sessionId: string | null, phases: string[]) => void;
  updateCompactionPhase: (sessionId: string | null, phase: string, status: string) => void;
  updateCompactionProgress: (sessionId: string | null, phase: string, chars: number) => void;
  addSubtask: (sessionId: string | null, subtaskSessionId: string, title: string, description: string) => void;
  setPermissionRequest: (sessionId: string | null, req: PermissionRequest) => void;
  clearPermissionRequest: (sessionId: string | null) => void;
  setQuestion: (sessionId: string | null, req: QuestionRequest) => void;
  clearQuestion: (sessionId: string | null) => void;
  setPlanReview: (sessionId: string | null, req: PlanReviewRequest) => void;
  clearPlanReview: (sessionId: string | null) => void;
  setModelLoading: (sessionId: string | null, loading: boolean) => void;
  setCompacting: (sessionId: string | null, compacting: boolean) => void;
  clearStreamingContent: (sessionId: string | null) => void;
  finishGeneration: (sessionId: string | null) => void;
}

function flushBuffers(
  parts: PartData[],
  text: string,
  reasoning: string,
): { parts: PartData[]; text: string; reasoning: string } {
  const flushed = [...parts];
  if (reasoning) flushed.push({ type: "reasoning", text: reasoning });
  if (text) flushed.push({ type: "text", text });
  return { parts: flushed, text: "", reasoning: "" };
}

function mutateBucket(
  state: ChatStore,
  sessionId: string | null,
  mutate: (prev: ChatSessionState) => ChatSessionState,
): Pick<ChatStore, "sessions" | "draftSession"> {
  if (sessionId === null) {
    const prev = state.draftSession ?? EMPTY_SESSION_STATE;
    return { sessions: state.sessions, draftSession: mutate(prev) };
  }
  const prev = state.sessions[sessionId] ?? EMPTY_SESSION_STATE;
  return {
    sessions: { ...state.sessions, [sessionId]: mutate(prev) },
    draftSession: state.draftSession,
  };
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {},
  draftSession: null,
  focusedSessionId: null,

  ensureSession: (sessionId) =>
    set((s) => {
      if (s.sessions[sessionId]) return s;
      return { sessions: { ...s.sessions, [sessionId]: EMPTY_SESSION_STATE } };
    }),

  setFocusedSession: (sessionId) => set({ focusedSessionId: sessionId }),

  removeSession: (sessionId) => {
    clearSeenStepFinishIds(sessionId);
    set((s) => {
      if (!s.sessions[sessionId]) return s;
      const next = { ...s.sessions };
      delete next[sessionId];
      return { sessions: next };
    });
  },

  resetSession: (sessionId) => {
    if (sessionId !== null) clearSeenStepFinishIds(sessionId);
    set((s) => mutateBucket(s, sessionId, () => EMPTY_SESSION_STATE));
  },

  resetAll: () => {
    SEEN_STEP_FINISH_IDS.clear();
    set({ sessions: {}, draftSession: null, focusedSessionId: null });
  },

  beginSending: (sessionId, text, attachments) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        isGenerating: true,
        isCompacting: false,
        isModelLoading: false,
        pendingUserText: text,
        pendingAttachments: attachments?.length ? attachments : null,
        streamingParts: [],
        streamingText: "",
        streamingReasoning: "",
        pendingPermission: null,
        pendingQuestion: null,
        pendingPlanReview: null,
      })),
    ),

  startGeneration: (sessionId, streamId) =>
    set((s) => {
      const draft = s.draftSession;
      const existing = s.sessions[sessionId];
      const base: ChatSessionState = draft ?? existing ?? EMPTY_SESSION_STATE;
      const next: ChatSessionState = {
        ...base,
        streamId,
        isGenerating: true,
        isCompacting: false,
        isModelLoading: false,
        streamingParts: [],
        streamingText: "",
        streamingReasoning: "",
        pendingPermission: null,
        pendingQuestion: null,
        pendingPlanReview: null,
      };
      return { sessions: { ...s.sessions, [sessionId]: next } };
    }),

  primeStreamingParts: (sessionId, parts) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingParts: parts,
        streamingText: "",
        streamingReasoning: "",
      })),
    ),

  startCompactionStream: (sessionId, streamId) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const { parts, text, reasoning } = flushBuffers(
          prev.streamingParts,
          prev.streamingText,
          prev.streamingReasoning,
        );
        return {
          ...prev,
          streamId,
          isGenerating: false,
          isCompacting: true,
          isModelLoading: false,
          pendingUserText: null,
          pendingAttachments: null,
          streamingParts: parts,
          streamingText: text,
          streamingReasoning: reasoning,
          pendingPermission: null,
          pendingQuestion: null,
          pendingPlanReview: null,
        };
      }),
    ),

  appendTextDelta: (sessionId, text) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingText: prev.streamingText + text,
      })),
    ),

  appendReasoningDelta: (sessionId, text) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingReasoning: prev.streamingReasoning + text,
      })),
    ),

  addToolStart: (sessionId, tool, callId, args, title) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const { parts, text, reasoning } = flushBuffers(
          prev.streamingParts,
          prev.streamingText,
          prev.streamingReasoning,
        );
        const toolPart: ToolPart = {
          type: "tool",
          tool,
          call_id: callId,
          state: {
            status: "running",
            input: args,
            output: null,
            metadata: null,
            title: title ?? null,
            time_start: new Date().toISOString(),
            time_end: null,
            time_compacted: null,
          },
        };
        const existingIndex = parts.findIndex((p) => p.type === "tool" && p.call_id === callId);
        const nextParts =
          existingIndex >= 0
            ? parts.map((p, index) => (index === existingIndex ? toolPart : p))
            : [...parts, toolPart];
        return {
          ...prev,
          streamingParts: nextParts,
          streamingText: text,
          streamingReasoning: reasoning,
        };
      }),
    ),

  updateToolProgress: (sessionId, callId, title, metadata, output) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingParts: prev.streamingParts.map((p) =>
          p.type === "tool" && p.call_id === callId
            ? {
                ...p,
                state: {
                  ...p.state,
                  status: "running" as const,
                  output: output ?? p.state.output,
                  title: title ?? p.state.title,
                  metadata: metadata ? { ...(p.state.metadata ?? {}), ...metadata } : p.state.metadata,
                  time_end: null,
                },
              }
            : p,
        ),
      })),
    ),

  setToolResult: (sessionId, callId, output, title, metadata) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingParts: prev.streamingParts.map((p) =>
          p.type === "tool" && p.call_id === callId
            ? {
                ...p,
                state: {
                  ...p.state,
                  status: "completed" as const,
                  output,
                  title: title ?? p.state.title,
                  metadata: metadata ?? p.state.metadata,
                  time_end: new Date().toISOString(),
                },
              }
            : p,
        ),
      })),
    ),

  setToolError: (sessionId, callId, output, title, metadata) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingParts: prev.streamingParts.map((p) =>
          p.type === "tool" && p.call_id === callId
            ? {
                ...p,
                state: {
                  ...p.state,
                  status: "error" as const,
                  output,
                  title: title ?? p.state.title,
                  metadata: metadata ? { ...(p.state.metadata ?? {}), ...metadata } : p.state.metadata,
                  time_end: new Date().toISOString(),
                },
              }
            : p,
        ),
      })),
    ),

  addFileParts: (sessionId, files) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const existingPaths = new Set(
          prev.streamingParts
            .filter((part): part is FilePart => part.type === "file")
            .map((part) => part.path),
        );
        const nextFiles = files
          .filter((file) => file.path && !existingPaths.has(file.path))
          .map((file, index): FilePart => ({
            type: "file",
            file_id: file.file_id || `generated-${file.path}-${index}`,
            name: file.name || file.path.split(/[\\/]/).pop() || "File",
            path: file.path,
            size: typeof file.size === "number" ? file.size : 0,
            mime_type: file.mime_type || "application/octet-stream",
            source: file.source || "referenced",
            content_hash: file.content_hash,
            relative_path: file.relative_path,
          }));
        if (nextFiles.length === 0) return prev;
        return {
          ...prev,
          streamingParts: [...prev.streamingParts, ...nextFiles],
        };
      }),
    ),

  addStepStart: (sessionId, step, snapshot) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const { parts, text, reasoning } = flushBuffers(
          prev.streamingParts,
          prev.streamingText,
          prev.streamingReasoning,
        );
        return {
          ...prev,
          streamingParts: [
            ...parts,
            { type: "step-start", snapshot: { step, ...(snapshot ?? {}) } } as PartData,
          ],
          streamingText: text,
          streamingReasoning: reasoning,
        };
      }),
    ),

  addStepFinish: (sessionId, reason, tokens, cost, totalCost, eventId, snapshot) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const { parts, text, reasoning } = flushBuffers(
          prev.streamingParts,
          prev.streamingText,
          prev.streamingReasoning,
        );
        const baseNext: ChatSessionState = {
          ...prev,
          streamingParts: [
            ...parts,
            { type: "step-finish", reason, tokens, cost, snapshot: snapshot ?? null } as PartData,
          ],
          streamingText: text,
          streamingReasoning: reasoning,
        };

        const dedupKey = sessionId ?? DRAFT_KEY;
        if (eventId && rememberStepFinishId(dedupKey, eventId)) {
          return baseNext;
        }

        const prevUsage = prev.sessionUsage;
        const inputDelta = tokens?.input ?? 0;
        const outputDelta = tokens?.output ?? 0;
        const reasoningDelta = tokens?.reasoning ?? 0;
        const cacheReadDelta = tokens?.cache_read ?? 0;
        const cacheWriteDelta = tokens?.cache_write ?? 0;
        const tokenDelta =
          inputDelta + outputDelta + reasoningDelta + cacheReadDelta + cacheWriteDelta;

        let nextCost: number | null;
        if (totalCost !== null && totalCost > 0) {
          nextCost = totalCost;
        } else if (cost > 0) {
          nextCost = (prevUsage.cost ?? 0) + cost;
        } else {
          nextCost = prevUsage.cost;
        }

        if (tokenDelta === 0 && nextCost === prevUsage.cost) {
          return baseNext;
        }

        const nextUsage: LiveSessionUsage = {
          inputTokens: prevUsage.inputTokens + inputDelta,
          outputTokens: prevUsage.outputTokens + outputDelta,
          reasoningTokens: prevUsage.reasoningTokens + reasoningDelta,
          cacheReadTokens: prevUsage.cacheReadTokens + cacheReadDelta,
          cacheWriteTokens: prevUsage.cacheWriteTokens + cacheWriteDelta,
          cost: nextCost,
        };
        return { ...baseNext, sessionUsage: nextUsage };
      }),
    ),

  addCompaction: (sessionId, auto) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const parts = [...prev.streamingParts];
        let found = false;
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (
            p.type === "compaction" &&
            (p as CompactionPart).compactionStatus === "in_progress"
          ) {
            parts[i] = { ...(p as CompactionPart), compactionStatus: "completed" };
            found = true;
            break;
          }
        }
        if (!found) parts.push({ type: "compaction", auto });
        return { ...prev, streamingParts: parts };
      }),
    ),

  startCompaction: (sessionId, phases) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const hasExisting = prev.streamingParts.some(
          (p) => p.type === "compaction" && (p as CompactionPart).compactionStatus === "in_progress",
        );
        if (hasExisting) return prev;
        const { parts, text, reasoning } = flushBuffers(
          prev.streamingParts,
          prev.streamingText,
          prev.streamingReasoning,
        );
        const compactionPart: CompactionPart = {
          type: "compaction",
          auto: true,
          compactionStatus: "in_progress",
          phases: phases.map((p) => ({
            phase: p as CompactionPhase,
            status: "pending" as CompactionPhaseStatus,
          })),
        };
        return {
          ...prev,
          isCompacting: true,
          streamingParts: [...parts, compactionPart],
          streamingText: text,
          streamingReasoning: reasoning,
        };
      }),
    ),

  updateCompactionPhase: (sessionId, phase, status) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const parts = [...prev.streamingParts];
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (p.type === "compaction" && (p as CompactionPart).phases) {
            const cp = { ...(p as CompactionPart) };
            cp.phases = cp.phases!.map((ph) =>
              ph.phase === phase ? { ...ph, status: status as CompactionPhaseStatus } : ph,
            );
            parts[i] = cp;
            break;
          }
        }
        return { ...prev, streamingParts: parts };
      }),
    ),

  updateCompactionProgress: (sessionId, phase, chars) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const parts = [...prev.streamingParts];
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (p.type === "compaction" && (p as CompactionPart).phases) {
            const cp = { ...(p as CompactionPart) };
            cp.phases = cp.phases!.map((ph) =>
              ph.phase === phase ? { ...ph, chars } : ph,
            );
            parts[i] = cp;
            break;
          }
        }
        return { ...prev, streamingParts: parts };
      }),
    ),

  addSubtask: (sessionId, subtaskSessionId, title, description) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingParts: [
          ...prev.streamingParts,
          { type: "subtask", session_id: subtaskSessionId, title, description },
        ],
      })),
    ),

  setPermissionRequest: (sessionId, req) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, pendingPermission: req }))),
  clearPermissionRequest: (sessionId) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, pendingPermission: null }))),

  setQuestion: (sessionId, req) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, pendingQuestion: req }))),
  clearQuestion: (sessionId) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, pendingQuestion: null }))),

  setPlanReview: (sessionId, req) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, pendingPlanReview: req }))),
  clearPlanReview: (sessionId) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, pendingPlanReview: null }))),

  setModelLoading: (sessionId, loading) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, isModelLoading: loading }))),

  setCompacting: (sessionId, compacting) =>
    set((s) => mutateBucket(s, sessionId, (prev) => ({ ...prev, isCompacting: compacting }))),

  clearStreamingContent: (sessionId) =>
    set((s) =>
      mutateBucket(s, sessionId, (prev) => ({
        ...prev,
        streamingParts: [],
        streamingText: "",
        streamingReasoning: "",
      })),
    ),

  finishGeneration: (sessionId) => {
    if (sessionId !== null) clearSeenStepFinishIds(sessionId);
    set((s) =>
      mutateBucket(s, sessionId, (prev) => {
        const { parts } = flushBuffers(
          prev.streamingParts,
          prev.streamingText,
          prev.streamingReasoning,
        );
        return {
          ...prev,
          streamId: null,
          isGenerating: false,
          isCompacting: false,
          isModelLoading: false,
          pendingUserText: null,
          pendingAttachments: null,
          pendingPermission: null,
          pendingQuestion: null,
          pendingPlanReview: null,
          streamingParts: parts,
          streamingText: "",
          streamingReasoning: "",
        };
      }),
    );
  },
}));

export function useChatSession(sessionId: string | null): ChatSessionState {
  const bucket = useChatStore((s) =>
    sessionId === null
      ? s.draftSession
      : (s.sessions[sessionId] ?? null),
  );
  return useMemo(() => bucket ?? EMPTY_SESSION_STATE, [bucket]);
}

export function useAnySessionGenerating(): boolean {
  return useChatStore((s) => {
    if (s.draftSession?.isGenerating) return true;
    return Object.values(s.sessions).some((bucket) => bucket.isGenerating || bucket.isCompacting);
  });
}
