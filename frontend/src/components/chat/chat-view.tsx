"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useChat } from "@/hooks/use-chat";
import { useMessages } from "@/hooks/use-messages";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useChatStore } from "@/stores/chat-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useActivityStore } from "@/stores/activity-store";
import { useWorkspaceStore, type WorkspaceTodo, type WorkspaceFile } from "@/stores/workspace-store";
import { useRightSidebarStore } from "@/stores/right-sidebar-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import { ChatHeader } from "./chat-header";
import { ChatForm } from "./chat-form";
import { MessageList } from "@/components/messages/message-list";
import { PermissionDialog } from "@/components/interactive/permission-dialog";
import { QuestionPrompt } from "@/components/interactive/question-prompt";
import { PlanAcceptPrompt } from "@/components/interactive/plan-accept-prompt";
import { OfflineOverlay } from "@/components/layout/offline-overlay";
import type { SessionResponse } from "@/types/session";

interface ChatViewProps {
  sessionId: string;
}

type SessionWorkspaceFile = {
  name: string;
  path: string;
  type: string;
  tool?: string;
  visibility?: WorkspaceFile["visibility"];
  relative_path?: string;
};

function normalizeWorkspaceFile(file: SessionWorkspaceFile): WorkspaceFile {
  return {
    name: file.name,
    path: file.path,
    type: file.type as WorkspaceFile["type"],
    tool: file.tool,
    visibility: file.visibility,
    relative_path: file.relative_path,
  };
}

export function ChatView({ sessionId }: ChatViewProps) {
  const {
    sendMessage,
    editAndResend,
    stopGeneration,
    respondToPermission,
    respondToQuestion,
    respondToPlanReview,
    isGenerating,
    isCompacting,
    streamId,
    pendingUserText,
    pendingAttachments,
    streamingParts,
    streamingText,
    streamingReasoning,
    pendingPermission,
    pendingQuestion,
    pendingPlanReview,
  } = useChat(sessionId);

  const { messages, isLoading, hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage } = useMessages(sessionId);

  const { data: session } = useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: () => api.get<SessionResponse>(API.SESSIONS.DETAIL(sessionId)),
    staleTime: 30_000,
  });
  const setAppMode = useSidebarStore((s) => s.setAppMode);
  const sessionAppMode = session
    ? session.app_mode === "codata" ? "codata" : "chat"
    : null;

  useEffect(() => {
    if (!sessionAppMode) return;
    setAppMode(sessionAppMode);
  }, [sessionAppMode, setAppMode]);

  // Auto-fix sessions with default title — set to first user message
  const qc = useQueryClient();
  useEffect(() => {
    if (!session || !messages || messages.length === 0) return;
    if (session.title && session.title !== "New Session") return;
    const firstUser = messages.find((m) => m.data?.role === "user" && !m.data.system);
    if (!firstUser) return;
    const textPart = firstUser.parts.find((p) => p.data?.type === "text");
    const text = textPart?.data?.type === "text" ? (textPart.data as { type: "text"; text: string }).text : undefined;
    if (!text) return;
    const title = text.trim().slice(0, 60);
    if (!title) return;
    api.patch(API.SESSIONS.DETAIL(sessionId), { title }).then(() => {
      qc.invalidateQueries({ queryKey: queryKeys.sessions.all });
      qc.setQueryData<SessionResponse>(
        queryKeys.sessions.detail(sessionId),
        (old) => (old ? { ...old, title } : old),
      );
    }).catch((e) => console.warn("[chat-view] Failed to auto-set title:", e));
  }, [session, messages, sessionId, qc]);

  // Entering a session should hydrate panels, but it should not abort streams
  // from other sessions. The registry keeps those running in the background.
  useEffect(() => {
    // Clear any lingering draft-session busy state from a previous /c/new -> /c/[id]
    // transition so opening a fresh chat does not inherit the prior session's
    // generating state or disabled composer.
    useChatStore.getState().resetSession(null);
    useChatStore.getState().ensureSession(sessionId);
    useChatStore.getState().setFocusedSession(sessionId);
    useRightSidebarStore.getState().close();
    useArtifactStore.getState().clearAll();
    useActivityStore.getState().clear();
    useWorkspaceStore.getState().resetForSession();

    // Sync workspace directory for MemoryBlock
    api.get<SessionResponse>(API.SESSIONS.DETAIL(sessionId)).then((s) => {
      if (s.directory) {
        useWorkspaceStore.getState().setActiveWorkspacePath(s.directory);
      }
    }).catch(() => {});

    // Load persisted todos and workspace files for this session
    api.get<{ todos: Array<{ content: string; status: string; activeForm?: string }> }>(
      API.SESSIONS.TODOS(sessionId),
    ).then((res) => {
      if (res.todos && res.todos.length > 0) {
        useWorkspaceStore.getState().setTodos(res.todos as WorkspaceTodo[]);
      }
    }).catch(() => {
      // Non-critical — todos may not exist yet
    });

    api.get<{ files: SessionWorkspaceFile[] }>(
      API.SESSIONS.FILES(sessionId),
    ).then((res) => {
      if (res.files && res.files.length > 0) {
        useWorkspaceStore.getState().setWorkspaceFiles(
          res.files.map(normalizeWorkspaceFile),
        );
      }
    }).catch(() => {
      // Non-critical — files may not exist yet
    });

    return () => {
      const cur = useChatStore.getState().focusedSessionId;
      if (cur === sessionId) {
        useChatStore.getState().setFocusedSession(null);
      }
    };
  }, [sessionId]);

  // Copy last assistant message to clipboard
  const handleCopyLast = useCallback(() => {
    if (!messages || messages.length === 0) return;

    // Find last assistant message
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((msg) => (msg.data as { role: string }).role === "assistant");

    if (!lastAssistantMessage) {
      toast.error("No assistant message found");
      return;
    }

    // Extract text content
    const textContent = lastAssistantMessage.parts
      .filter((p) => p.data.type === "text")
      .map((p) => (p.data as { type: "text"; text: string }).text)
      .join("\n");

    if (!textContent) {
      toast.error("No text content to copy");
      return;
    }

    navigator.clipboard.writeText(textContent);
    toast.success("Copied to clipboard");
  }, [messages]);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onStop: stopGeneration,
    onCopyLast: handleCopyLast,
  });

  return (
    <div className="relative flex flex-1 flex-col h-full overflow-hidden bg-[var(--surface-chat)]">
      <OfflineOverlay />
      <ChatHeader sessionId={sessionId} />

      {/* Message list */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isGenerating={isGenerating}
        streamId={streamId}
        pendingUserText={pendingUserText}
        pendingAttachments={pendingAttachments}
        streamingParts={streamingParts}
        streamingText={streamingText}
        streamingReasoning={streamingReasoning}
        onEditAndResend={editAndResend}
        directory={session?.directory}
        sessionId={sessionId}
        hasPreviousPage={hasPreviousPage}
        isFetchingPreviousPage={isFetchingPreviousPage}
        fetchPreviousPage={fetchPreviousPage}
      />

      {/* Interactive prompts */}
      {pendingPermission && (
        <PermissionDialog
          permission={pendingPermission}
          onRespond={respondToPermission}
        />
      )}

      {pendingQuestion && (
        <QuestionPrompt
          question={pendingQuestion}
          onRespond={respondToQuestion}
        />
      )}

      {/* Input — replaced by plan accept prompt when a plan review is pending */}
      {pendingPlanReview ? (
        <PlanAcceptPrompt onRespond={respondToPlanReview} />
      ) : (
        <ChatForm
          isGenerating={isGenerating}
          isCompacting={isCompacting || !!session?.time_compacting}
          onSend={sendMessage}
          onStop={stopGeneration}
          sessionId={sessionId}
          directory={session?.directory}
        />
      )}
    </div>
  );
}
