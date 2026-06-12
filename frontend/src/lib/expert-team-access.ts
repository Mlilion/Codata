import type { ActiveProvider } from "@/stores/settings-store";

export const EXPERT_TEAM_ACCOUNT_ROUTE = "/settings?tab=providers";
export const EXPERT_TEAM_REQUIRED_PROVIDER_ID = "";
export const EXPERT_TEAM_CREATION_ACCESS_CODE = "expert_team_creation_requires_provider";
export const EXPERT_TEAM_CREATION_ACCESS_MESSAGE =
  "Create an expert team after selecting a model provider in Settings.";

export function canCreateExpertTeamWithProvider(
  activeProvider: ActiveProvider,
  selectedProviderId?: string | null,
): boolean {
  if (!activeProvider) return false;
  if (activeProvider === "byok" || activeProvider === "custom") return Boolean(selectedProviderId);
  return true;
}

export function expertTeamAccessRedirectFromError(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("body" in err)) return null;
  const body = (err as { body: unknown }).body;
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;
  const code = (detail as { code?: unknown }).code;
  if (code !== EXPERT_TEAM_CREATION_ACCESS_CODE) return null;
  const redirect = (detail as { redirect?: unknown }).redirect;
  return typeof redirect === "string" && redirect ? redirect : EXPERT_TEAM_ACCOUNT_ROUTE;
}
