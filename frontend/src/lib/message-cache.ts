import type { InfiniteData } from "@tanstack/react-query";
import type { MessageResponse, PaginatedMessages } from "@/types/message";

export function compareMessagesChronologically(
  left: MessageResponse,
  right: MessageResponse,
): number {
  const byTime = left.time_created.localeCompare(right.time_created);
  return byTime || left.id.localeCompare(right.id);
}

/**
 * Replace the newest server page without dropping older pages already loaded.
 *
 * Refetches can change the latest page's offset and can overlap an older page.
 * Keep the pages ordered by their server offset, remove duplicated message
 * ids, and refresh the cached total everywhere so the reverse-scroll boundary
 * stays coherent.
 */
export function mergeLatestMessagePage(
  old: InfiniteData<PaginatedMessages> | undefined,
  latestPage: PaginatedMessages,
): InfiniteData<PaginatedMessages> {
  if (!old) {
    return { pages: [latestPage], pageParams: [-1] };
  }

  const latestIds = new Set(latestPage.messages.map((message) => message.id));
  const entries = old.pages
    .map((page, index) => ({
      page,
      pageParam: old.pageParams[index],
      isLatest: false,
    }))
    // The server page at this offset is authoritative.
    .filter(({ page }) => page.offset !== latestPage.offset)
    .map(({ page, pageParam, isLatest }) => ({
      page: {
        ...page,
        total: latestPage.total,
        messages: page.messages.filter((message) => !latestIds.has(message.id)),
      },
      pageParam,
      isLatest,
    }))
    .filter(({ page }) => page.messages.length > 0);

  entries.push({
    page: latestPage,
    pageParam: -1,
    isLatest: true,
  });

  entries.sort(
    (left, right) =>
      left.page.offset - right.page.offset ||
      Number(left.isLatest) - Number(right.isLatest),
  );

  return {
    ...old,
    pages: entries.map((entry) => entry.page),
    pageParams: entries.map((entry) => entry.pageParam),
  };
}
