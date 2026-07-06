"use client";

import { useState, useEffect } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type { SessionResponse, SessionCreate, SessionSearchResult } from "@/types/session";

const PAGE_SIZE = 50;

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useSessions(appMode?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.sessions.list(appMode),
    queryFn: ({ pageParam = 0 }) =>
      api.get<SessionResponse[]>(API.SESSIONS.LIST(PAGE_SIZE, pageParam, appMode)),
    initialPageParam: 0,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    // Poll every 10s to catch channel messages.
    refetchInterval: 10_000,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sessions.detail(id!),
    queryFn: () => api.get<SessionResponse>(API.SESSIONS.DETAIL(id!)),
    enabled: !!id,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SessionCreate) =>
      api.post<SessionResponse>(API.SESSIONS.BASE, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API.SESSIONS.DETAIL(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

// Optimistic helpers that patch EVERY session-list cache (unscoped + per-mode
// scoped, e.g. ["sessions","mode","chat"]) via a prefix match, so edits reflect
// instantly regardless of which filtered list is on screen.
type SessionPages = InfiniteData<SessionResponse[]>;
type SessionsSnapshot = Array<[readonly unknown[], SessionPages | undefined]>;

function mapAllSessionCaches(
  qc: ReturnType<typeof useQueryClient>,
  fn: (s: SessionResponse) => SessionResponse,
): SessionsSnapshot {
  const prev = qc.getQueriesData<SessionPages>({ queryKey: queryKeys.sessions.all });
  qc.setQueriesData<SessionPages>({ queryKey: queryKeys.sessions.all }, (old) => {
    if (!old?.pages) return old;
    return { ...old, pages: old.pages.map((page) => page.map(fn)) };
  });
  return prev;
}

function restoreSessionCaches(
  qc: ReturnType<typeof useQueryClient>,
  snapshot?: SessionsSnapshot,
) {
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));
}

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation<SessionResponse, unknown, { id: string; title: string }, { previous?: SessionsSnapshot }>({
    mutationFn: ({ id, title }) =>
      api.patch<SessionResponse>(API.SESSIONS.DETAIL(id), { title }),
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: queryKeys.sessions.all });
      const previous = mapAllSessionCaches(qc, (s) => (s.id === id ? { ...s, title } : s));
      return { previous };
    },
    onError: (_err, _vars, context) => restoreSessionCaches(qc, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function usePinSession() {
  const qc = useQueryClient();
  return useMutation<SessionResponse, unknown, { id: string; is_pinned: boolean }, { previous?: SessionsSnapshot }>({
    mutationFn: ({ id, is_pinned }) =>
      api.patch<SessionResponse>(API.SESSIONS.DETAIL(id), { is_pinned }),
    onMutate: async ({ id, is_pinned }) => {
      await qc.cancelQueries({ queryKey: queryKeys.sessions.all });
      const previous = mapAllSessionCaches(qc, (s) => (s.id === id ? { ...s, is_pinned } : s));
      return { previous };
    },
    onError: (_err, _vars, context) => restoreSessionCaches(qc, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function useArchiveSession() {
  const qc = useQueryClient();
  return useMutation<SessionResponse, unknown, { id: string }, { previous?: SessionsSnapshot }>({
    mutationFn: ({ id }) =>
      api.patch<SessionResponse>(API.SESSIONS.DETAIL(id), {
        time_archived: new Date().toISOString(),
      }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: queryKeys.sessions.all });
      const previous = qc.getQueriesData<SessionPages>({ queryKey: queryKeys.sessions.all });
      qc.setQueriesData<SessionPages>({ queryKey: queryKeys.sessions.all }, (old) => {
        if (!old?.pages) return old;
        return { ...old, pages: old.pages.map((page) => page.filter((s) => s.id !== id)) };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => restoreSessionCaches(qc, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function useUnarchiveSession() {
  const qc = useQueryClient();
  return useMutation<SessionResponse, unknown, { id: string }>({
    mutationFn: ({ id }) =>
      api.patch<SessionResponse>(API.SESSIONS.DETAIL(id), {
        time_archived: null,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function useSearchSessions(query: string) {
  const debouncedQuery = useDebouncedValue(query, 300);
  return useQuery({
    queryKey: queryKeys.sessions.search(debouncedQuery),
    queryFn: () =>
      api.get<SessionSearchResult[]>(API.SESSIONS.SEARCH(debouncedQuery)),
    enabled: debouncedQuery.trim().length >= 2,
  });
}
