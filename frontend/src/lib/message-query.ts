import { queryOptions, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { API, queryKeys } from "./constants";
import { mergeLatestMessagePage } from "./message-cache";
import { MESSAGE_PAGE_SIZE } from "./message-pagination";
import type { PaginatedMessages } from "@/types/message";

export type MessagePages = InfiniteData<PaginatedMessages>;

/**
 * The cache retains oldest-first pages, but automatic refreshes fetch the tail,
 * not InfiniteQuery's first (oldest) page. All observers and prefetchers must
 * use this query so polling, focus, reconnect and invalidation behave alike.
 */
export function messageQueryOptions(client: QueryClient, sessionId: string) {
  const queryKey = queryKeys.messages.list(sessionId);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<MessagePages> => {
      const previous = client.getQueryData<MessagePages>(queryKey);
      const previousTotal = previous?.pages.at(-1)?.total;
      const latest = await api.get<PaginatedMessages>(
        API.MESSAGES.LIST(sessionId, MESSAGE_PAGE_SIZE, -1),
        { signal },
      );

      // Edits can truncate history. Old offsets are no longer meaningful.
      if (previousTotal !== undefined && latest.total < previousTotal) {
        return { pages: [latest], pageParams: [-1] };
      }

      const missing: PaginatedMessages[] = [];
      if (previousTotal !== undefined) {
        for (let offset = previousTotal; offset < latest.offset;) {
          const limit = Math.min(MESSAGE_PAGE_SIZE, latest.offset - offset);
          const page = await api.get<PaginatedMessages>(
            API.MESSAGES.LIST(sessionId, limit, offset),
            { signal },
          );
          if (page.offset !== offset || page.messages.length !== limit) {
            throw new Error("Message history changed while filling a pagination gap. Please retry.");
          }
          missing.push(page);
          offset += page.messages.length;
        }
      }

      // A history request may have prepended a page while the tail was in flight.
      let merged = client.getQueryData<MessagePages>(queryKey);
      for (const page of missing) merged = mergeLatestMessagePage(merged, page);
      return mergeLatestMessagePage(merged, latest);
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export async function refreshMessages(client: QueryClient, sessionId: string): Promise<MessagePages> {
  // A pre-completion poll may still contain an unfinished reply. Do not reuse
  // that request for an authoritative stream handoff, or revert history that
  // was loaded while it was in flight.
  await client.cancelQueries(
    { queryKey: queryKeys.messages.list(sessionId), exact: true },
    { revert: false },
  );
  return client.fetchQuery({ ...messageQueryOptions(client, sessionId), staleTime: 0 });
}

const historyRequests = new WeakMap<QueryClient, Map<string, Promise<void>>>();

export function fetchOlderMessages(client: QueryClient, sessionId: string): Promise<void> {
  let requests = historyRequests.get(client);
  if (!requests) {
    requests = new Map();
    historyRequests.set(client, requests);
  }
  const existing = requests.get(sessionId);
  if (existing) return existing;

  const queryKey = queryKeys.messages.list(sessionId);
  const cached = client.getQueryData<MessagePages>(queryKey);
  const oldestOffset = cached?.pages[0]?.offset ?? 0;
  if (oldestOffset <= 0) return Promise.resolve();

  const offset = Math.max(0, oldestOffset - MESSAGE_PAGE_SIZE);
  const request = (async () => {
    try {
      const page = await api.get<PaginatedMessages>(
        API.MESSAGES.LIST(sessionId, oldestOffset - offset, offset),
      );
      client.setQueryData<MessagePages>(queryKey, (current) => {
        if (!current) return current;
        const total = current.pages.at(-1)!.total;
        // A concurrent edit/refresh has reset the history window.
        if (total < (cached?.pages.at(-1)?.total ?? 0)) return current;
        const ids = new Set(current.pages.flatMap((entry) => entry.messages.map((message) => message.id)));
        const messages = page.messages.filter((message) => !ids.has(message.id));
        if (messages.length === 0) return current;
        return {
          pages: [{ ...page, total, messages }, ...current.pages],
          pageParams: [offset, ...current.pageParams],
        };
      });
    } finally {
      requests.delete(sessionId);
    }
  })();
  requests.set(sessionId, request);
  return request;
}
