"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { getChatRoute } from "@/lib/routes";
import { useChatStore } from "@/stores/chat-store";
import { startStream, isStreamActive } from "@/lib/session-stream-registry";
import { NAVIGATE_TO_SESSION_EVENT, type NavigateToSessionDetail } from "@/lib/background-notify";

export function StreamRegistryHydration() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const jobs = await api.get<Array<{ stream_id: string; session_id: string; needs_input?: boolean }>>(
          API.CHAT.ACTIVE,
        );
        if (cancelled) return;
        const chatState = useChatStore.getState();
        for (const job of jobs) {
          if (isStreamActive(job.session_id)) continue;
          chatState.startGeneration(job.session_id, job.stream_id);
          void startStream(job.session_id, job.stream_id);
        }
      } catch {
        // Backend readiness and offline handling are covered elsewhere.
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NavigateToSessionDetail>).detail;
      if (!detail?.sessionId) return;
      router.push(getChatRoute(detail.sessionId));
    };
    window.addEventListener(NAVIGATE_TO_SESSION_EVENT, handler);
    return () => window.removeEventListener(NAVIGATE_TO_SESSION_EVENT, handler);
  }, [router]);

  return null;
}
