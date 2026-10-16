type BackendUrlEnv = Record<string, string | undefined>;

const DEFAULT_BACKEND_URL = "http://localhost:8000";

function cleanUrl(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "");
}

export function resolveBrowserBackendUrl(
  env: BackendUrlEnv = process.env,
): string {
  return (
    cleanUrl(env.NEXT_PUBLIC_STREAM_API_URL) ||
    cleanUrl(env.NEXT_PUBLIC_API_URL) ||
    DEFAULT_BACKEND_URL
  );
}
