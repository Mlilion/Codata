"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import {
  EXPERT_TEAM_CREATION_ACCESS_MESSAGE,
  expertTeamAccessRedirectFromError,
} from "@/lib/expert-team-access";
import { getChatRoute } from "@/lib/routes";
import { useChatStore, useChatSession } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useActivityStore } from "@/stores/activity-store";
import { useRightSidebarStore } from "@/stores/right-sidebar-store";
import { DRAFT_EXPERT_SESSION_ID, useExpertSessionStore } from "@/stores/expert-session-store";
import { startStream, stopStream } from "@/lib/session-stream-registry";
import { useRemoteGenerationSync } from "./use-remote-generation-sync";
import type { InfiniteData } from "@tanstack/react-query";
import type { FileAttachment, PromptResponse, RespondRequest } from "@/types/chat";
import type { PaginatedMessages } from "@/types/message";
import type { SessionResponse } from "@/types/session";

export interface SendMessageOptions {
  skills?: string[];
  mode?: "expert_team_creation" | string;
}

export function buildPermissionRequestState() {
  const settingsState = useSettingsStore.getState();
  const presets = settingsState.permissionPresets;
  const permissionPresets = {
    file_changes: presets.fileChanges,
    run_commands: presets.runCommands,
  };
  const hasActivePresets = Object.values(permissionPresets).some(Boolean);
  const permissionRules = settingsState.savedPermissions.map((rule) => ({
    action: rule.allow ? "allow" as const : "deny" as const,
    permission: rule.tool,
    pattern: "*",
  }));
  return {
    settingsState,
    permissionPresets: hasActivePresets ? permissionPresets : null,
    permissionRules: permissionRules.length > 0 ? permissionRules : null,
  };
}

function closeResponsePanels() {
  useRightSidebarStore.getState().close();
  useActivityStore.getState().clear();
  try {
    const { useArtifactStore } = require("@/stores/artifact-store");
    useArtifactStore.getState().close();
  } catch {}
  try {
    const { usePlanReviewStore } = require("@/stores/plan-review-store");
    usePlanReviewStore.getState().close();
  } catch {}
}

function handleExpertTeamCreationAccessError(err: unknown, router: ReturnType<typeof useRouter>): boolean {
  const redirect = expertTeamAccessRedirectFromError(err);
  if (!redirect) return false;
  toast.warning(EXPERT_TEAM_CREATION_ACCESS_MESSAGE, { duration: 6000 });
  router.push(redirect);
  return true;
}

function optimisticSession({
  id,
  title,
  directory,
}: {
  id: string;
  title: string;
  directory: string | null;
}): SessionResponse {
  return {
    id,
    project_id: null,
    parent_id: null,
    slug: null,
    directory,
    title: title.slice(0, 60),
    version: 0,
    summary_additions: 0,
    summary_deletions: 0,
    summary_files: 0,
    summary_diffs: [],
    is_pinned: false,
    permission: {},
    time_created: new Date().toISOString(),
    time_updated: new Date().toISOString(),
    time_compacting: null,
    time_archived: null,
  };
}

export function useChat(currentSessionId?: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useChatSession(currentSessionId ?? null);

  useRemoteGenerationSync(currentSessionId);

  const addOptimisticSession = useCallback(
    (sessionResponse: SessionResponse) => {
      queryClient.setQueryData<InfiniteData<SessionResponse[]>>(
        queryKeys.sessions.all,
        (old) => {
          if (!old) return { pages: [[sessionResponse]], pageParams: [0] };
          return {
            ...old,
            pages: [[sessionResponse, ...old.pages[0]], ...old.pages.slice(1)],
          };
        },
      );
    },
    [queryClient],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      attachments?: FileAttachment[],
      options?: SendMessageOptions,
    ): Promise<boolean> => {
      const chatState = useChatStore.getState();
      const settingsState = useSettingsStore.getState();
      const targetSessionId = currentSessionId ?? null;
      const currentBucket = targetSessionId === null
        ? chatState.draftSession
        : chatState.sessions[targetSessionId];

      if (currentBucket?.isGenerating || currentBucket?.isCompacting || (!text.trim() && (!attachments || attachments.length === 0))) return false;

      if (!currentSessionId) {
        chatState.resetSession(null);
      }

      closeResponsePanels();
      chatState.beginSending(targetSessionId, text.trim(), attachments);

      try {
        const { permissionPresets, permissionRules } = buildPermissionRequestState();
        const expertStore = useExpertSessionStore.getState();
        const selectedExpertTeam = expertStore.getSelectedExpertTeam(currentSessionId);
        const expertCreationMode = expertStore.getExpertTeamCreationMode(currentSessionId);
        const expertCreationModel = expertCreationMode?.model ?? settingsState.selectedModel;
        const expertCreationProviderId = expertCreationMode?.providerId ?? settingsState.selectedProviderId;

        const res = selectedExpertTeam
          ? await api.post<PromptResponse>(
              API.EXPERT_TEAMS.SUMMON(selectedExpertTeam.id),
              {
                input: text.trim(),
                session_id: currentSessionId ?? null,
                attachments: attachments ?? [],
                model: settingsState.selectedModel,
                provider_id: settingsState.selectedProviderId,
                workspace: settingsState.workspaceDirectory,
                permission_presets: permissionPresets,
                permission_rules: permissionRules,
                reasoning: settingsState.reasoningEnabled,
              },
              { timeoutMs: 30_000 },
            )
          : await api.post<PromptResponse>(API.CHAT.PROMPT, {
              text: text.trim(),
              session_id: currentSessionId ?? null,
              model: expertCreationMode ? expertCreationModel : settingsState.selectedModel,
              provider_id: expertCreationMode ? expertCreationProviderId : settingsState.selectedProviderId,
              agent: settingsState.selectedAgent,
              attachments: attachments ?? [],
              skills: options?.skills ?? [],
              mode: options?.mode ?? (expertCreationMode ? "expert_team_creation" : null),
              permission_presets: permissionPresets,
              permission_rules: permissionRules,
              reasoning: settingsState.reasoningEnabled,
              workspace: settingsState.workspaceDirectory,
            });

        chatState.startGeneration(res.session_id, res.stream_id);
        if (selectedExpertTeam && !currentSessionId) {
          const expertStore = useExpertSessionStore.getState();
          expertStore.setSelectedExpertTeam(res.session_id, selectedExpertTeam);
          expertStore.clearSelectedExpertTeam(DRAFT_EXPERT_SESSION_ID);
        }
        void startStream(res.session_id, res.stream_id);

        if (!currentSessionId) {
          addOptimisticSession(optimisticSession({
            id: res.session_id,
            directory: settingsState.workspaceDirectory || null,
            title: text.trim(),
          }));
          router.push(getChatRoute(res.session_id));
        }
        return true;
      } catch (err) {
        console.error("Failed to start generation:", err);
        chatState.resetSession(targetSessionId);
        if (handleExpertTeamCreationAccessError(err, router)) return false;
        if (err instanceof ApiError) {
          toast.error(err.message, { duration: 8000 });
          return false;
        }
        toast.error("Failed to send message", { duration: 8000 });
        return false;
      }
    },
    [addOptimisticSession, currentSessionId, router],
  );

  const stopGeneration = useCallback(async () => {
    const chatState = useChatStore.getState();
    const targetSessionId = currentSessionId ?? null;
    const bucket = targetSessionId === null
      ? chatState.draftSession
      : chatState.sessions[targetSessionId];
    const streamId = bucket?.streamId;
    if (!streamId) return;
    try {
      await api.post(API.CHAT.ABORT, { stream_id: streamId });
    } catch (err) {
      console.error("Failed to abort — backend may still be generating:", err);
    }
    if (targetSessionId !== null) stopStream(targetSessionId);
    chatState.finishGeneration(targetSessionId);

    const ws = useWorkspaceStore.getState();
    if (ws.todos.some((t) => t.status === "in_progress")) {
      ws.setTodos(
        ws.todos.map((t) =>
          t.status === "in_progress" ? { ...t, status: "pending" as const, activeForm: undefined } : t,
        ),
      );
    }
    if (targetSessionId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(targetSessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(targetSessionId) });
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
  }, [currentSessionId, queryClient]);

  const respondToPermission = useCallback(
    async (allow: boolean, remember = false) => {
      const chatState = useChatStore.getState();
      const targetSessionId = currentSessionId ?? null;
      const bucket = targetSessionId === null
        ? chatState.draftSession
        : chatState.sessions[targetSessionId];
      const perm = bucket?.pendingPermission;
      const streamId = bucket?.streamId;
      if (!perm || !streamId) return;

      const req: RespondRequest = {
        stream_id: streamId,
        call_id: perm.callId,
        response: {
          allowed: allow,
          remember,
          permission: perm.tool || perm.permission,
          pattern: perm.patterns[0] ?? "*",
        },
      };

      try {
        chatState.clearPermissionRequest(targetSessionId);
        await api.post(API.CHAT.RESPOND, req);
      } catch (err) {
        chatState.setPermissionRequest(targetSessionId, perm);
        console.error("Failed to respond to permission:", err);
        toast.error("Failed to respond");
      }
    },
    [currentSessionId],
  );

  const editAndResend = useCallback(
    async (messageId: string, newText: string, attachments?: FileAttachment[]): Promise<boolean> => {
      const chatState = useChatStore.getState();
      const settingsState = useSettingsStore.getState();
      const bucket = currentSessionId ? chatState.sessions[currentSessionId] : null;

      if (bucket?.isGenerating || bucket?.isCompacting || (!newText.trim() && (!attachments || attachments.length === 0)) || !currentSessionId) return false;

      closeResponsePanels();
      chatState.beginSending(currentSessionId, newText.trim(), attachments);

      try {
        const { permissionPresets, permissionRules } = buildPermissionRequestState();
        const expertCreationMode = useExpertSessionStore.getState().getExpertTeamCreationMode(currentSessionId);
        const expertCreationModel = expertCreationMode?.model ?? settingsState.selectedModel;
        const expertCreationProviderId = expertCreationMode?.providerId ?? settingsState.selectedProviderId;

        const res = await api.post<PromptResponse>(API.CHAT.EDIT, {
          session_id: currentSessionId,
          message_id: messageId,
          text: newText.trim(),
          model: expertCreationMode ? expertCreationModel : settingsState.selectedModel,
          provider_id: expertCreationMode ? expertCreationProviderId : settingsState.selectedProviderId,
          agent: settingsState.selectedAgent,
          attachments: attachments ?? [],
          skills: expertCreationMode ? [expertCreationMode.skill] : [],
          mode: expertCreationMode ? "expert_team_creation" : null,
          permission_presets: permissionPresets,
          permission_rules: permissionRules,
          reasoning: settingsState.reasoningEnabled,
          workspace: settingsState.workspaceDirectory,
        });

        chatState.startGeneration(res.session_id, res.stream_id);
        void startStream(res.session_id, res.stream_id);

        useWorkspaceStore.getState().setTodos([]);
        useWorkspaceStore.getState().setWorkspaceFiles([]);

        const trimmed = newText.trim();
        queryClient.setQueryData<InfiniteData<PaginatedMessages>>(
          queryKeys.messages.list(currentSessionId),
          (old) => {
            if (!old) return old;
            const newPages = old.pages.map((page) => {
              const idx = page.messages.findIndex((m) => m.id === messageId);
              if (idx === -1) return page;
              return {
                ...page,
                messages: page.messages.slice(0, idx + 1).map((m, i) => {
                  if (i !== idx) return m;
                  return {
                    ...m,
                    parts: m.parts.map((p) =>
                      p.data.type === "text"
                        ? { ...p, data: { ...p.data, text: trimmed } }
                        : p,
                    ),
                  };
                }),
              };
            });
            const pageIdx = newPages.findIndex((p) =>
              p.messages.some((m) => m.id === messageId),
            );
            return {
              ...old,
              pages: pageIdx >= 0 ? newPages.slice(0, pageIdx + 1) : newPages,
              pageParams: pageIdx >= 0 ? old.pageParams.slice(0, pageIdx + 1) : old.pageParams,
            };
          },
        );
        useChatStore.setState((s) => {
          const cur = s.sessions[currentSessionId];
          if (!cur) return s;
          return {
            sessions: {
              ...s.sessions,
              [currentSessionId]: { ...cur, pendingUserText: null, pendingAttachments: null },
            },
          };
        });

        return true;
      } catch (err) {
        console.error("Failed to edit and resend:", err);
        chatState.resetSession(currentSessionId);
        if (handleExpertTeamCreationAccessError(err, router)) return false;
        if (err instanceof ApiError) {
          toast.error(err.message);
          return false;
        }
        toast.error("Failed to edit message");
        return false;
      }
    },
    [currentSessionId, queryClient, router],
  );

  const respondToQuestion = useCallback(
    async (answer: string | Record<string, string>) => {
      const chatState = useChatStore.getState();
      const targetSessionId = currentSessionId ?? null;
      const bucket = targetSessionId === null
        ? chatState.draftSession
        : chatState.sessions[targetSessionId];
      const question = bucket?.pendingQuestion;
      const streamId = bucket?.streamId;
      if (!question || !streamId) return;

      const response =
        typeof answer === "string" ? answer.trim() : JSON.stringify(answer);
      if (!response) return;

      const req: RespondRequest = {
        stream_id: streamId,
        call_id: question.callId,
        response,
      };

      try {
        await api.post(API.CHAT.RESPOND, req);
        chatState.clearQuestion(targetSessionId);
      } catch (err) {
        console.error("Failed to respond to question:", err);
        toast.error("Failed to respond");
      }
    },
    [currentSessionId],
  );

  const respondToPlanReview = useCallback(
    async (action: "accept" | "revise" | "stop", options?: { mode?: "auto" | "ask"; feedback?: string }) => {
      const chatState = useChatStore.getState();
      const targetSessionId = currentSessionId ?? null;
      const bucket = targetSessionId === null
        ? chatState.draftSession
        : chatState.sessions[targetSessionId];
      const review = bucket?.pendingPlanReview;
      const streamId = bucket?.streamId;
      if (!review || !streamId) return;

      let response: Record<string, string>;
      if (action === "accept") {
        response = { action: "accept", mode: options?.mode ?? "auto" };
      } else if (action === "stop") {
        response = { action: "stop" };
      } else {
        response = { action: "revise", feedback: options?.feedback ?? "" };
      }

      const req: RespondRequest = {
        stream_id: streamId,
        call_id: review.callId,
        response: JSON.stringify(response),
      };

      try {
        await api.post(API.CHAT.RESPOND, req);
        chatState.clearPlanReview(targetSessionId);

        if (action === "accept") {
          try {
            const { usePlanReviewStore } = require("@/stores/plan-review-store");
            usePlanReviewStore.getState().close();
          } catch {}
          useSettingsStore.getState().setWorkMode(options?.mode ?? "auto");
        }
      } catch (err) {
        console.error("Failed to respond to plan review:", err);
        toast.error("Failed to respond");
      }
    },
    [currentSessionId],
  );

  return {
    sendMessage,
    editAndResend,
    stopGeneration,
    respondToPermission,
    respondToQuestion,
    respondToPlanReview,
    isGenerating: session.isGenerating,
    isCompacting: session.isCompacting,
    streamId: session.streamId,
    pendingUserText: session.pendingUserText,
    pendingAttachments: session.pendingAttachments,
    streamingParts: session.streamingParts,
    streamingText: session.streamingText,
    streamingReasoning: session.streamingReasoning,
    pendingPermission: session.pendingPermission,
    pendingQuestion: session.pendingQuestion,
    pendingPlanReview: session.pendingPlanReview,
  };
}
