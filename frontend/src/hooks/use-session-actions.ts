"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { API, queryKeys } from "@/lib/constants";
import { api } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import { stopStream } from "@/lib/session-stream-registry";
import {
  useDeleteSession,
  useRenameSession,
  usePinSession,
  useArchiveSession,
  useUnarchiveSession,
} from "@/hooks/use-sessions";
import { useActiveSessionId } from "@/hooks/use-active-session-id";
import { useSessionExport } from "@/hooks/use-session-export";
import { getChatRoute } from "@/lib/routes";
import type { SessionResponse } from "@/types/session";

/**
 * Shared session row actions (delete-with-undo, rename, pin, archive-with-undo,
 * inline-edit state, PDF/Markdown export) used by both the chat `SessionList`
 * and the Codata sidebar's recent-analyses list, so a `SessionItem` behaves
 * identically in either place.
 *
 * Delete/archive optimistically mutate the shared `queryKeys.sessions.all`
 * cache, so both lists react regardless of which one triggered the action.
 */
export function useSessionActions() {
  const { t } = useTranslation("common");
  const router = useRouter();
  const activeSessionId = useActiveSessionId();
  const queryClient = useQueryClient();

  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const pinSession = usePinSession();
  const archiveSession = useArchiveSession();
  const unarchiveSession = useUnarchiveSession();
  const { exportPdf, exportMarkdown } = useSessionExport();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  // Soft delete with undo — refs for delayed deletion
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedSessionRef = useRef<{
    id: string;
    data: InfiniteData<SessionResponse[]>;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleDeleteRequest = useCallback((id: string, title: string) => {
    setDeleteTarget({ id, title });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;

    // If the session being deleted has active generation, abort it first.
    const chatState = useChatStore.getState();
    const bucket = chatState.sessions[id];
    if (bucket && (bucket.isGenerating || bucket.isCompacting) && bucket.streamId) {
      api.post(API.CHAT.ABORT, { stream_id: bucket.streamId }).catch(() => {});
      stopStream(id);
      chatState.finishGeneration(id);
    }
    chatState.removeSession(id);

    // Save the current cache so we can restore on undo
    const previousData = queryClient.getQueryData<InfiniteData<SessionResponse[]>>(
      queryKeys.sessions.all,
    );

    if (previousData) {
      deletedSessionRef.current = { id, data: previousData };
      queryClient.setQueryData<InfiniteData<SessionResponse[]>>(queryKeys.sessions.all, {
        ...previousData,
        pages: previousData.pages.map((page) => page.filter((s) => s.id !== id)),
      });
    }

    if (activeSessionId === id) {
      router.push(getChatRoute());
    }

    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      deletedSessionRef.current = null;
      deleteSession.mutate(id);
    }, 5000);

    toast(t("conversationDeleted"), {
      action: {
        label: t("undo"),
        onClick: () => {
          if (deleteTimerRef.current) {
            clearTimeout(deleteTimerRef.current);
            deleteTimerRef.current = null;
          }
          if (deletedSessionRef.current && deletedSessionRef.current.id === id) {
            queryClient.setQueryData<InfiniteData<SessionResponse[]>>(
              queryKeys.sessions.all,
              deletedSessionRef.current.data,
            );
            deletedSessionRef.current = null;
          }
        },
      },
      duration: 5000,
    });

    setDeleteTarget(null);
  }, [deleteTarget, deleteSession, activeSessionId, router, t, queryClient]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleRename = useCallback(
    (id: string, newTitle: string) => {
      renameSession.mutate({ id, title: newTitle });
    },
    [renameSession],
  );

  const handleTogglePin = useCallback(
    (id: string, is_pinned: boolean) => {
      pinSession.mutate({ id, is_pinned });
    },
    [pinSession],
  );

  const handleArchive = useCallback(
    (id: string) => {
      if (activeSessionId === id) {
        router.push(getChatRoute());
      }
      const chatState = useChatStore.getState();
      const bucket = chatState.sessions[id];
      if (bucket && (bucket.isGenerating || bucket.isCompacting) && bucket.streamId) {
        api.post(API.CHAT.ABORT, { stream_id: bucket.streamId }).catch(() => {});
        stopStream(id);
        chatState.finishGeneration(id);
      }
      chatState.removeSession(id);
      archiveSession.mutate(
        { id },
        {
          onSuccess: () => {
            toast.success(t("conversationArchived"), {
              action: {
                label: t("undo"),
                onClick: () => {
                  unarchiveSession.mutate(
                    { id },
                    {
                      onSuccess: () => toast.success(t("conversationRestored")),
                      onError: () => toast.error(t("restoreFailed")),
                    },
                  );
                },
              },
            });
          },
          onError: () => toast.error(t("archiveFailed")),
        },
      );
    },
    [activeSessionId, archiveSession, router, t, unarchiveSession],
  );

  const handleEditStart = useCallback((id: string) => setEditingId(id), []);
  const handleEditEnd = useCallback(() => setEditingId(null), []);

  return {
    editingId,
    deleteTarget,
    handleDeleteRequest,
    handleDeleteConfirm,
    handleDeleteCancel,
    handleRename,
    handleTogglePin,
    handleArchive,
    handleEditStart,
    handleEditEnd,
    exportPdf,
    exportMarkdown,
  };
}
