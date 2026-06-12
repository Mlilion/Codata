"use client";

import { useCallback, useSyncExternalStore } from "react";
import { IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_DELAY = 5000; // 5 seconds
const DISMISSED_KEY = "workcraft-dismissed-update";

interface UpdateState {
  available: boolean;
  version: string | null;
  notes: string | null;
  checking: boolean;
  downloading: boolean;
  progress: number;
  dismissed: boolean;
  error: string | null;
  lastCheckedAt: number | null;
}

interface UpdateInfo extends Omit<UpdateState, "dismissed"> {
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
  checkNow: () => Promise<boolean>;
}

let state: UpdateState = {
  available: false,
  version: null,
  notes: null,
  checking: false,
  downloading: false,
  progress: 0,
  dismissed: false,
  error: null,
  lastCheckedAt: null,
};

const listeners = new Set<() => void>();
let pendingUpdate: unknown = null;
let initialized = false;

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function checkForUpdates(options?: { ignoreDismissed?: boolean }) {
  if (!IS_DESKTOP) {
    setState({ lastCheckedAt: Date.now() });
    return false;
  }
  setState({ checking: true, error: null });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      setState({
        available: false,
        version: null,
        notes: null,
        dismissed: false,
        checking: false,
        lastCheckedAt: Date.now(),
      });
      return false;
    }
    const dismissedVersion = localStorage.getItem(DISMISSED_KEY);
    if (!options?.ignoreDismissed && dismissedVersion === update.version) {
      setState({ checking: false, lastCheckedAt: Date.now() });
      return false;
    }
    pendingUpdate = update;
    setState({
      version: update.version,
      notes: update.body ?? null,
      available: true,
      dismissed: false,
      checking: false,
      lastCheckedAt: Date.now(),
    });
    return true;
  } catch (e) {
    console.warn("Update check failed:", e);
    const message = e instanceof Error ? e.message : String(e);
    setState({ error: message, checking: false, lastCheckedAt: Date.now() });
    return false;
  }
}

async function downloadAndInstall() {
  const update = pendingUpdate as {
    downloadAndInstall: (cb: (ev: {
      event: "Started" | "Progress" | "Finished";
      data: { contentLength?: number; chunkLength?: number };
    }) => void) => Promise<void>;
  } | null;
  if (!update) return;
  setState({ downloading: true, error: null });
  let totalLength = 0;
  let downloaded = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started" && event.data.contentLength) {
        totalLength = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength ?? 0;
        if (totalLength > 0) {
          setState({ progress: Math.round((downloaded / totalLength) * 100) });
        }
      } else if (event.event === "Finished") {
        setState({ progress: 100 });
      }
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    console.error("Update install failed:", e);
    const message = e instanceof Error ? e.message : String(e);
    setState({ error: message, downloading: false });
  }
}

function dismiss() {
  if (state.version) localStorage.setItem(DISMISSED_KEY, state.version);
  setState({ dismissed: true, available: false });
}

function initOnce() {
  if (initialized || !IS_DESKTOP) return;
  initialized = true;
  setTimeout(checkForUpdates, STARTUP_DELAY);
  setInterval(checkForUpdates, CHECK_INTERVAL);
  desktopAPI.onCheckForUpdates(() => {
    void checkForUpdates();
  });
}

if (typeof window !== "undefined") {
  initOnce();
}

const serverSnapshot: UpdateState = {
  available: false,
  version: null,
  notes: null,
  checking: false,
  downloading: false,
  progress: 0,
  dismissed: false,
  error: null,
  lastCheckedAt: null,
};

export function useUpdateCheck(): UpdateInfo {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
  const boundDownload = useCallback(() => downloadAndInstall(), []);
  const boundDismiss = useCallback(() => dismiss(), []);
  const boundCheck = useCallback(() => checkForUpdates({ ignoreDismissed: true }), []);

  return {
    available: s.available && !s.dismissed,
    version: s.version,
    notes: s.notes,
    checking: s.checking,
    downloading: s.downloading,
    progress: s.progress,
    error: s.error,
    lastCheckedAt: s.lastCheckedAt,
    downloadAndInstall: boundDownload,
    dismiss: boundDismiss,
    checkNow: boundCheck,
  };
}
