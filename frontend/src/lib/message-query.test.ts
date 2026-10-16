import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { queryKeys } from "./constants";
import { fetchOlderMessages, messageQueryOptions, refreshMessages, type MessagePages } from "./message-query";
import type { MessageResponse, PaginatedMessages } from "@/types/message";

vi.mock("./api", () => ({ api: { get: vi.fn() } }));

const sessionId = "long-session";
const key = queryKeys.messages.list(sessionId);
let client: QueryClient;
let messages: MessageResponse[];

function makeMessages(count: number): MessageResponse[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    session_id: sessionId,
    time_created: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    data: { role: index % 2 === 0 ? "user" : "assistant" },
    parts: [],
  }));
}

function serverPage(url: string): PaginatedMessages {
  const params = new URL(url, "http://localhost").searchParams;
  const limit = Number(params.get("limit"));
  const requested = Number(params.get("offset"));
  const offset = requested < 0 ? Math.max(0, messages.length - limit) : requested;
  return { total: messages.length, offset, messages: messages.slice(offset, offset + limit) };
}

function cachedIds(): string[] {
  return client.getQueryData<MessagePages>(key)!.pages.flatMap((page) => page.messages.map((message) => message.id));
}

function refresh() {
  return client.fetchQuery({ ...messageQueryOptions(client, sessionId), staleTime: 0 });
}

async function loadHistory() {
  await refresh();
  await fetchOlderMessages(client, sessionId);
  await fetchOlderMessages(client, sessionId);
}

describe("long conversation message queries", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.mount();
    messages = makeMessages(350);
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation(async (url) => serverPage(url));
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("keeps three loaded pages and new replies after refetch and invalidation", async () => {
    await loadHistory();
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
    const observer = new QueryObserver(client, messageQueryOptions(client, sessionId));
    cleanups.push(observer.subscribe(() => {}));

    messages = makeMessages(352);
    await observer.refetch();
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
    messages = makeMessages(354);
    await client.invalidateQueries({ queryKey: key });
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
    expect(vi.mocked(api.get).mock.calls.slice(-2).every(([url]) => url.endsWith("offset=-1"))).toBe(true);
  });

  it("retains the tail across multiple polling intervals", async () => {
    await loadHistory();
    const observer = new QueryObserver(client, messageQueryOptions(client, sessionId));
    cleanups.push(observer.subscribe(() => {}));
    for (const count of [352, 356, 360]) {
      messages = makeMessages(count);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
    }
  });

  it("uses the same tail refresh on focus, reconnect, and remount", async () => {
    await loadHistory();
    const observer = new QueryObserver(client, messageQueryOptions(client, sessionId));
    const unsubscribe = observer.subscribe(() => {});
    cleanups.push(unsubscribe);
    messages = makeMessages(352);
    await vi.advanceTimersByTimeAsync(5_001);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));

    messages = makeMessages(354);
    await vi.advanceTimersByTimeAsync(5_001);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));

    unsubscribe();
    messages = makeMessages(356);
    await vi.advanceTimersByTimeAsync(5_001);
    const remounted = new QueryObserver(client, messageQueryOptions(client, sessionId));
    cleanups.push(remounted.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
  });

  it("fills every missing message when more than two pages arrive between refreshes", async () => {
    await loadHistory();
    vi.mocked(api.get).mockClear();
    messages = makeMessages(705);
    await refresh();
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
    expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).toEqual([
      `/api/messages/${sessionId}?limit=100&offset=-1`,
      `/api/messages/${sessionId}?limit=100&offset=350`,
      `/api/messages/${sessionId}?limit=100&offset=450`,
      `/api/messages/${sessionId}?limit=55&offset=550`,
    ]);
    expect(new Set(cachedIds()).size).toBe(cachedIds().length);
    expect(client.getQueryData<MessagePages>(key)!.pages.every((page) => page.total === 705)).toBe(true);
  });

  it("retains history loaded while a tail refresh is in flight", async () => {
    await refresh();
    const latest = serverPage(`/api/messages/${sessionId}?limit=100&offset=-1`);
    let release!: (page: PaginatedMessages) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = refresh();
    await fetchOlderMessages(client, sessionId);
    release(latest);
    await pending;
    expect(cachedIds()).toEqual(messages.slice(150).map((message) => message.id));
  });

  it("fetches a fresh terminal reply instead of reusing an older poll or reverting loaded history", async () => {
    await refresh();
    const unfinished = serverPage(`/api/messages/${sessionId}?limit=100&offset=-1`);
    let release!: (page: PaginatedMessages) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const polling = refresh();
    const cancelled = expect(polling).rejects.toThrow();
    await fetchOlderMessages(client, sessionId);
    messages = makeMessages(352);
    await refreshMessages(client, sessionId);
    await cancelled;
    release(unfinished);
    await vi.advanceTimersByTimeAsync(0);
    expect(cachedIds()).toEqual(messages.slice(150).map((message) => message.id));
  });

  it("deduplicates simultaneous history loads and preserves a concurrent tail update", async () => {
    await refresh();
    const older = serverPage(`/api/messages/${sessionId}?limit=100&offset=150`);
    let release!: (page: PaginatedMessages) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = fetchOlderMessages(client, sessionId);
    expect(fetchOlderMessages(client, sessionId)).toBe(first);
    messages = makeMessages(352);
    await refresh();
    release(older);
    await first;
    expect(cachedIds()).toEqual(messages.slice(150).map((message) => message.id));
  });

  it("loads a partial oldest page without overlapping the loaded window", async () => {
    await loadHistory();
    await fetchOlderMessages(client, sessionId);
    expect(cachedIds()).toEqual(messages.map((message) => message.id));
    expect(vi.mocked(api.get).mock.lastCall?.[0]).toBe(`/api/messages/${sessionId}?limit=50&offset=0`);
    const calls = vi.mocked(api.get).mock.calls.length;
    await fetchOlderMessages(client, sessionId);
    expect(vi.mocked(api.get).mock.calls).toHaveLength(calls);
  });

  it("replaces stale messages with the authoritative latest copy", async () => {
    await loadHistory();
    messages = messages.map((message, index) => index === 349
      ? { ...message, parts: [{ id: "final", message_id: message.id, session_id: sessionId, time_created: message.time_created, data: { type: "text", text: "Final reply" } }] }
      : message);
    await refresh();
    const copies = client.getQueryData<MessagePages>(key)!.pages.flatMap((page) => page.messages).filter((message) => message.id === "message-349");
    expect(copies).toHaveLength(1);
    expect(copies[0].parts[0].data).toEqual({ type: "text", text: "Final reply" });
  });

  it("discards invalid old offsets after history is truncated", async () => {
    await loadHistory();
    messages = makeMessages(120);
    await refresh();
    expect(cachedIds()).toEqual(messages.slice(20).map((message) => message.id));
    await fetchOlderMessages(client, sessionId);
    expect(cachedIds()).toEqual(messages.map((message) => message.id));
  });

  it("keeps the cache intact and reports failures instead of publishing a partial gap", async () => {
    await loadHistory();
    const before = client.getQueryData(key);
    messages = makeMessages(705);
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.endsWith("offset=450")) throw new Error("Network disconnected");
      return serverPage(url);
    });
    await expect(refresh()).rejects.toThrow("Network disconnected");
    expect(client.getQueryData(key)).toBe(before);
    vi.mocked(api.get).mockImplementation(async (url) => serverPage(url));
    await refresh();
    expect(cachedIds()).toEqual(messages.slice(50).map((message) => message.id));
  });
});
