"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import {
  activeSessionIdsFromJobs,
  type ActiveChatJob,
} from "@/lib/active-chat-jobs";

export function useActiveChatSessionIds(): Set<string> {
  const { data } = useQuery({
    queryKey: queryKeys.chat.active,
    queryFn: () => api.get<ActiveChatJob[]>(API.CHAT.ACTIVE),
    refetchInterval: 3_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  return useMemo(() => activeSessionIdsFromJobs(data), [data]);
}
