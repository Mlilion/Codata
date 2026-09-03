/**
 * Backend dev launcher used by dev-desktop.mjs.
 *
 * By default it preserves the existing development behavior (cwd=backend/).
 * When CODATA_DEV_DATA_DIR is set, it runs the backend with cwd set to that
 * data directory and adds backend/ to PYTHONPATH. This mirrors packaged
 * desktop mode, where run.py chdirs into the app data directory before
 * starting FastAPI.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const backendDir = join(repoRoot, "backend");
const customDataDir = process.env.CODATA_DEV_DATA_DIR
  ? resolve(process.env.CODATA_DEV_DATA_DIR)
  : "";

const cwd = customDataDir || backendDir;
if (customDataDir) {
  mkdirSync(customDataDir, { recursive: true });
}

const python = process.platform === "win32"
  ? join(backendDir, "venv", "Scripts", "python.exe")
  : join(backendDir, "venv", "bin", "python");

if (!existsSync(python)) {
  console.error(`[dev-backend] Python venv not found: ${python}`);
  process.exit(1);
}

const env = {
  ...process.env,
  PYTHONUNBUFFERED: "1",
  CODATA_SESSION_TOKEN_PATH: customDataDir
    ? "session_token.json"
    : (process.env.CODATA_SESSION_TOKEN_PATH || "data/session_token.json"),
};

if (customDataDir) {
  env.PYTHONPATH = [backendDir, process.env.PYTHONPATH].filter(Boolean).join(delimiter);
}

const port = process.env.DEV_BACKEND_PORT || "8000";
const reloadDir = customDataDir ? join(backendDir, "app") : "app";

console.log(`[dev-backend] Using backend cwd: ${cwd}`);
if (customDataDir) {
  console.log(`[dev-backend] Using backend source: ${backendDir}`);
}

const proc = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "app.main:create_app",
    "--factory",
    "--reload",
    "--reload-dir",
    reloadDir,
    "--host",
    "0.0.0.0",
    "--port",
    port,
  ],
  { cwd, env, stdio: "inherit" },
);

proc.on("exit", (code) => process.exit(code ?? 1));
