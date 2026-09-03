/**
 * Dev launcher that auto-picks a free port for the frontend,
 * then passes it to both Next.js (--port) and Tauri (TAURI_CONFIG override).
 */
import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

async function findFreePort(preferred = 3000) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(preferred, "0.0.0.0", () => {
      server.close(() => resolve(preferred));
    });
    server.on("error", () => {
      // preferred port busy — let OS assign one
      const s = createServer();
      s.listen(0, "0.0.0.0", () => {
        const port = s.address().port;
        s.close(() => resolve(port));
      });
    });
  });
}

const port = await findFreePort(3000);
const backendPort = await findFreePort(8000);
console.log(`\x1b[33m[dev-desktop] Using frontend port: ${port}\x1b[0m`);
console.log(`\x1b[33m[dev-desktop] Using backend port: ${backendPort}\x1b[0m`);

function findVsDevCmd() {
  if (process.platform !== "win32") {
    return null;
  }

  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const vswhere = programFilesX86
    ? join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe")
    : null;
  if (vswhere && existsSync(vswhere)) {
    try {
      const installationPath = execFileSync(
        vswhere,
        [
          "-latest",
          "-products",
          "*",
          "-requires",
          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
          "-property",
          "installationPath",
        ],
        { encoding: "utf8" },
      ).trim();
      const candidate = join(installationPath, "Common7", "Tools", "VsDevCmd.bat");
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Fall back to common install locations below.
    }
  }

  const roots = [
    programFilesX86,
    process.env.ProgramFiles,
  ].filter(Boolean);
  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];

  for (const root of roots) {
    for (const edition of editions) {
      const candidate = join(
        root,
        "Microsoft Visual Studio",
        "2022",
        edition,
        "Common7",
        "Tools",
        "VsDevCmd.bat",
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
const rustPathEntries = [];
if (process.platform === "win32") {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    rustPathEntries.push(
      join(home, ".cargo", "bin"),
      join(home, ".rustup", "toolchains", "stable-x86_64-pc-windows-msvc", "bin"),
    );
  }
}

const backendDataDir = process.env.CODATA_DEV_DATA_DIR
  ? resolve(process.env.CODATA_DEV_DATA_DIR)
  : resolve(process.cwd(), "backend", "data");

const env = {
  ...process.env,
  [pathKey]: [...rustPathEntries, process.env[pathKey] || ""].filter(Boolean).join(delimiter),
  DEV_BACKEND_PORT: String(backendPort),
  DEV_BACKEND_DATA_DIR: backendDataDir,
  NEXT_PUBLIC_API_URL: `http://localhost:${backendPort}`,
  // Tauri merges TAURI_CONFIG JSON into tauri.conf.json at runtime
  TAURI_CONFIG: JSON.stringify({
    build: { devUrl: `http://localhost:${port}` },
  }),
};

const cmd = [
  "npx concurrently -k",
  "-n backend,frontend,tauri",
  "-c blue,green,yellow",
  `"node scripts/dev-backend.mjs"`,
  `"cd frontend && npx next dev --turbopack --port ${port}"`,
  `"cd desktop-tauri && npx tauri dev"`,
].join(" ");

const vsDevCmd = findVsDevCmd();
if (vsDevCmd) {
  console.log(`\x1b[33m[dev-desktop] Using MSVC environment: ${vsDevCmd}\x1b[0m`);
}

const shellCmd = vsDevCmd
  ? `call "${vsDevCmd}" -arch=x64 -host_arch=x64 >nul && ${cmd}`
  : cmd;

const proc = spawn(shellCmd, [], { stdio: "inherit", shell: true, env });

proc.on("exit", (code) => process.exit(code ?? 1));
