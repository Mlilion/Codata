const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true";

export function getChatRoute(sessionId?: string | null): string {
  if (!sessionId) return "/c/new";
  return IS_DESKTOP_BUILD
    ? `/c/_?sessionId=${encodeURIComponent(sessionId)}`
    : `/c/${sessionId}`;
}

export function resolveSessionId(
  pathSessionId?: string | null,
  querySessionId?: string | null,
): string | null {
  if (!pathSessionId) return querySessionId ?? null;
  if (pathSessionId === "_") return querySessionId ?? null;
  return pathSessionId;
}

export function getDashboardRoute(dashboardId: string): string {
  // Desktop is a static export served over file:// — dynamic route segments
  // like /dashboard/<id> have no prebuilt HTML (only the /dashboard/_ placeholder
  // exists), so navigating there 404s and bounces to the home page. Route through
  // the placeholder with the id as a query param instead; the detail page reads
  // it via resolveDashboardId. Web mode keeps the clean dynamic path.
  return IS_DESKTOP_BUILD
    ? `/dashboard/_?id=${encodeURIComponent(dashboardId)}`
    : `/dashboard/${dashboardId}`;
}

export function resolveDashboardId(
  pathId?: string | null,
  queryId?: string | null,
): string | null {
  if (!pathId) return queryId ?? null;
  if (pathId === "_") return queryId ?? null;
  return pathId;
}
