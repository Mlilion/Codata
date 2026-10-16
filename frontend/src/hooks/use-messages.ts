"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchOlderMessages, messageQueryOptions } from "@/lib/message-query";
import { compareMessagesChronologically } from "@/lib/message-cache";
import type { PaginatedMessages } from "@/types/message";

/**
 * Hook to fetch messages with reverse infinite scroll.
 *
 * Initial load fetches the latest page (offset=-1).
 * `fetchPreviousPage()` loads older messages.
 * Pages are stored oldest-first: pages[0] = oldest loaded, pages[last] = newest.
 */
export function useMessages(sessionId: string | undefined) {
  const client = useQueryClient();
  const query = useQuery({
    ...messageQueryOptions(client, sessionId ?? ""),
    enabled: !!sessionId,
  });
  const history = useMutation({
    mutationFn: () => fetchOlderMessages(client, sessionId!),
    onError: (error) => {
      console.error("Failed to load older messages:", error);
      toast.error(error.message);
    },
  });

  // Flatten pages into a single chronological array. Reverse infinite scroll
  // can briefly overlap the latest page with older pages after refetches.
  const messages = useMemo(() => {
    const byId = new Map<string, PaginatedMessages["messages"][number]>();
    for (const message of query.data?.pages.flatMap((p) => p.messages) ?? []) {
      // Keep the freshest copy if an overlapped page contains the same id.
      byId.set(message.id, message);
    }
    return [...byId.values()].sort(compareMessagesChronologically);
  }, [query.data]);

  const total = query.data?.pages.at(-1)?.total ?? 0;

  return {
    ...query,
    messages,
    total,
    hasPreviousPage: (query.data?.pages[0]?.offset ?? 0) > 0,
    isFetchingPreviousPage: history.isPending,
    fetchPreviousPage: history.mutate,
  };
}
