import { execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CdpConnection,
  findChromeExecutable,
  findExistingChromeDebugPort,
  getFreePort,
  launchChrome,
  openPageSession,
  resolveSharedChromeProfileDir,
  sleep,
  waitForChromeDebugPort,
  type PageSession,
  type PlatformCandidates,
} from "./index.js";

export class MermaidRenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MermaidRenderError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface MermaidRenderOptions {
  theme?: string;
  scale?: number;
  background?: string;
  timeoutMs?: number;
  minWidth?: number;
}

export interface MermaidRenderResult {
  width: number;
  height: number;
  bytes: number;
}

function resolveRenderScale(scale: number | undefined): number {
  const resolved = scale ?? 2;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new MermaidRenderError(`Invalid Mermaid render scale: ${scale}`);
  }
  return resolved;
}

function resolveMinWidth(minWidth: number | undefined): number | undefined {
  if (minWidth === undefined) return undefined;
  if (!Number.isFinite(minWidth) || minWidth <= 0) {
    throw new MermaidRenderError(`Invalid Mermaid render minWidth: ${minWidth}`);
  }
  return minWidth;
}

const CHROME_CANDIDATES: PlatformCandidates = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  default: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ],
};

let wslHome: string | null | undefined;
function getWslWindowsHome(): string | null {
  if (wslHome !== undefined) return wslHome;
  if (!process.env.WSL_DISTRO_NAME) {
    wslHome = null;
    return null;
  }
  try {
    const raw = execSync('cmd.exe /C "echo %USERPROFILE%"', {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim().replace(/\r/g, "");
    wslHome = execSync(`wslpath -u "${raw}"`, {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim() || null;
  } catch {
    wslHome = null;
  }
  return wslHome;
}

function getProfileDir(): string {
  return resolveSharedChromeProfileDir({
    envNames: ["BAOYU_CHROME_PROFILE_DIR", "MERMAID_RENDER_PROFILE_DIR"],
    wslWindowsHome: getWslWindowsHome(),
  });
}

function resolveAssetsDir(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  const candidates = [
    path.resolve(dir, "..", "assets"),
    path.resolve(dir, "assets"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "mermaid.min.js"))) return candidate;
  }
  throw new MermaidRenderError(
    `Cannot locate mermaid.min.js. Looked in: ${candidates.join(", ")}`,
  );
}

let cachedMermaidScript: string | null = null;
function loadMermaidScript(): string {
  if (cachedMermaidScript) return cachedMermaidScript;
  const assetsDir = resolveAssetsDir();
  cachedMermaidScript = fs.readFileSync(path.join(assetsDir, "mermaid.min.js"), "utf-8");
  return cachedMermaidScript;
}

interface RendererState {
  cdp: CdpConnection;
  chrome: ChildProcess | null;
  port: number | null;
  ownsChrome: boolean;
}

let rendererState: RendererState | null = null;
let connectingPromise: Promise<RendererState> | null = null;
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const cleanup = () => {
    const state = rendererState;
    rendererState = null;
    if (!state) return;
    try { state.cdp.close(); } catch {}
    if (state.ownsChrome && state.chrome) {
      try { state.chrome.kill("SIGTERM"); } catch {}
    }
  };
  process.on("exit", cleanup);
  process.on("beforeExit", cleanup);
}

async function tryConnectExisting(port: number): Promise<CdpConnection | null> {
  try {
    const wsUrl = await waitForChromeDebugPort(port, 5_000, { includeLastError: true });
    return await CdpConnection.connect(wsUrl, 5_000);
  } catch {
    return null;
  }
}

async function ensureRenderer(): Promise<RendererState> {
  if (rendererState) return rendererState;
  if (connectingPromise) return await connectingPromise;

  connectingPromise = (async (): Promise<RendererState> => {
    const profileDir = getProfileDir();
    const existingPort = await findExistingChromeDebugPort({ profileDir });
    if (existingPort) {
      const cdp = await tryConnectExisting(existingPort);
      if (cdp) {
        const state: RendererState = {
          cdp,
          chrome: null,
          port: existingPort,
          ownsChrome: false,
        };
        rendererState = state;
        installExitHook();
        return state;
      }
    }

    const chromePath = findChromeExecutable({
      candidates: CHROME_CANDIDATES,
      envNames: ["BAOYU_CHROME_PATH", "MERMAID_RENDER_CHROME_PATH"],
    });
    if (!chromePath) {
      throw new MermaidRenderError(
        "Chrome not found. Install Google Chrome / Chromium / Edge, or set BAOYU_CHROME_PATH.",
      );
    }

    const port = await getFreePort("MERMAID_RENDER_DEBUG_PORT");
    const chrome = await launchChrome({
      chromePath,
      profileDir,
      port,
      headless: true,
      extraArgs: [
        "--disable-blink-features=AutomationControlled",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    });

    const wsUrl = await waitForChromeDebugPort(port, 30_000, { includeLastError: true });
    const cdp = await CdpConnection.connect(wsUrl, 30_000);
    const state: RendererState = { cdp, chrome, port, ownsChrome: true };
    rendererState = state;
    installExitHook();
    return state;
  })();

  try {
    return await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

function buildHostHtml(code: string, theme: string, background: string): string {
  const script = loadMermaidScript();
  const safeCode = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeTheme = JSON.stringify(theme);
  const cssBackground = background === "transparent" ? "transparent" : background;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: ${cssBackground};
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
  }
  #host {
    display: inline-block;
    padding: 16px;
  }
  #host svg {
    max-width: none !important;
  }
</style>
</head>
<body>
<div id="host"><div class="mermaid">${safeCode}</div></div>
<script>${script}</script>
<script>
  window.__mermaidReady = false;
  window.__mermaidError = null;
  try {
    mermaid.initialize({ startOnLoad: false, theme: ${safeTheme}, securityLevel: "loose" });
    mermaid.run({ querySelector: ".mermaid" })
      .then(function () { window.__mermaidReady = true; })
      .catch(function (err) { window.__mermaidError = String(err && err.message || err); });
  } catch (err) {
    window.__mermaidError = String(err && err.message || err);
  }
</script>
</body>
</html>`;
}

async function evaluate<T = unknown>(
  cdp: CdpConnection,
  sessionId: string,
  expression: string,
): Promise<{ value: T | undefined; exceptionText?: string }> {
  const result = await cdp.send<{
    result: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: false,
    },
    { sessionId },
  );
  const exception = result.exceptionDetails;
  if (exception) {
    return {
      value: undefined,
      exceptionText: exception.exception?.description ?? exception.text ?? "evaluation failed",
    };
  }
  return { value: result.result.value };
}

interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function waitForMermaidSvg(
  cdp: CdpConnection,
  sessionId: string,
  timeoutMs: number,
): Promise<BoundingRect> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await evaluate<{
      ready: boolean;
      error: string | null;
      rect: BoundingRect | null;
    }>(
      cdp,
      sessionId,
      `(function () {
        if (window.__mermaidError) {
          return { ready: false, error: window.__mermaidError, rect: null };
        }
        var svg = document.querySelector(".mermaid svg");
        if (!svg) return { ready: false, error: null, rect: null };
        var bbox = svg.getBoundingClientRect();
        return {
          ready: window.__mermaidReady === true,
          error: null,
          rect: {
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
          },
        };
      })()`,
    );
    if (status.exceptionText) {
      throw new MermaidRenderError(`Mermaid evaluation failed: ${status.exceptionText}`);
    }
    const value = status.value;
    if (value?.error) {
      throw new MermaidRenderError(`Mermaid render failed: ${value.error}`);
    }
    if (value?.ready && value.rect && value.rect.width > 0 && value.rect.height > 0) {
      const host = await evaluate<BoundingRect | null>(
        cdp,
        sessionId,
        `(function () {
          var host = document.getElementById("host");
          if (!host) return null;
          var rect = host.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()`,
      );
      if (host.value) return host.value;
      return value.rect;
    }
    await sleep(80);
  }
  throw new MermaidRenderError(`Mermaid render timed out after ${timeoutMs}ms`);
}

async function withPageSession<T>(
  state: RendererState,
  fn: (sessionId: string, targetId: string) => Promise<T>,
): Promise<T> {
  let session: PageSession | null = null;
  try {
    session = await openPageSession({
      cdp: state.cdp,
      reusing: !state.ownsChrome,
      url: "about:blank",
      matchTarget: () => false,
      enablePage: true,
      enableRuntime: true,
    });
    return await fn(session.sessionId, session.targetId);
  } finally {
    if (session?.createdTarget) {
      try {
        await state.cdp.send("Target.closeTarget", { targetId: session.targetId });
      } catch {}
    }
  }
}

export async function renderMermaidToPng(
  code: string,
  outputPath: string,
  options: MermaidRenderOptions = {},
): Promise<MermaidRenderResult> {
  const theme = options.theme ?? "default";
  const scale = resolveRenderScale(options.scale);
  const minWidth = resolveMinWidth(options.minWidth);
  const background = options.background ?? "white";
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (!code.trim()) {
    throw new MermaidRenderError("Mermaid code is empty");
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const state = await ensureRenderer();
  const html = buildHostHtml(code, theme, background);

  return await withPageSession(state, async (sessionId) => {
    await state.cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      },
      { sessionId },
    );

    await state.cdp.send(
      "Page.setDocumentContent",
      { frameId: await getFrameId(state.cdp, sessionId), html },
      { sessionId },
    );

    const rect = await waitForMermaidSvg(state.cdp, sessionId, timeoutMs);

    const cssWidth = Math.max(1, Math.ceil(rect.width));
    const cssHeight = Math.max(1, Math.ceil(rect.height));
    const targetCssWidth = Math.max(cssWidth, Math.ceil(minWidth ?? cssWidth));
    const captureScale = scale * (targetCssWidth / cssWidth);
    const bitmapWidth = Math.max(1, Math.ceil(cssWidth * captureScale));
    const bitmapHeight = Math.max(1, Math.ceil(cssHeight * captureScale));

    await state.cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: cssWidth,
        height: cssHeight,
        deviceScaleFactor: 1,
        mobile: false,
      },
      { sessionId },
    );

    const shot = await state.cdp.send<{ data: string }>(
      "Page.captureScreenshot",
      {
        format: "png",
        clip: {
          x: rect.x,
          y: rect.y,
          width: cssWidth,
          height: cssHeight,
          scale: captureScale,
        },
        captureBeyondViewport: true,
      },
      { sessionId },
    );

    const buffer = Buffer.from(shot.data, "base64");
    await fs.promises.writeFile(outputPath, buffer);

    return {
      width: bitmapWidth,
      height: bitmapHeight,
      bytes: buffer.length,
    };
  });
}

async function getFrameId(cdp: CdpConnection, sessionId: string): Promise<string> {
  const result = await cdp.send<{ frameTree: { frame: { id: string } } }>(
    "Page.getFrameTree",
    {},
    { sessionId },
  );
  return result.frameTree.frame.id;
}

export async function closeRenderer(): Promise<void> {
  const state = rendererState;
  rendererState = null;
  if (!state) return;
  try { state.cdp.close(); } catch {}
  if (state.ownsChrome && state.chrome) {
    try { state.chrome.kill("SIGTERM"); } catch {}
  }
}
