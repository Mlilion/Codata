import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBackendUrl: vi.fn<() => Promise<string>>(),
  getBackendToken: vi.fn<() => Promise<string>>(),
  onBackendRestart: vi.fn(() => () => {}),
  onBackendCrashLog: vi.fn(() => () => {}),
}));

vi.mock("./tauri-api", () => ({
  desktopAPI: {
    getBackendUrl: mocks.getBackendUrl,
    getBackendToken: mocks.getBackendToken,
    getPendingNavigation: vi.fn(),
    getPlatform: vi.fn(),
    openExternal: vi.fn(),
    downloadAndSave: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(),
    updateTrayRecents: vi.fn(),
    onMaximizeChange: vi.fn(() => () => {}),
    onBackendRestarting: vi.fn(() => () => {}),
    onBackendRestart: mocks.onBackendRestart,
    onBackendCrashLog: mocks.onBackendCrashLog,
    onNavigate: vi.fn(() => () => {}),
    onToggleSidebar: vi.fn(() => () => {}),
    onCheckForUpdates: vi.fn(() => () => {}),
    onOpenSearch: vi.fn(() => () => {}),
  },
}));

vi.mock("./remote-connection", () => ({
  getRemoteConfig: vi.fn(() => null),
}));

describe("desktop backend URL resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getBackendUrl.mockReset();
    mocks.getBackendToken.mockReset();
    mocks.onBackendRestart.mockClear();
    mocks.onBackendCrashLog.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("rejects port zero without caching it so a later retry can recover", async () => {
    mocks.getBackendUrl
      .mockResolvedValueOnce("http://127.0.0.1:0")
      .mockResolvedValueOnce("http://127.0.0.1:24892");

    const { getBackendUrl } = await import("./constants");

    await expect(getBackendUrl()).rejects.toThrow(/backend url is not ready/i);
    await expect(getBackendUrl()).resolves.toBe("http://127.0.0.1:24892");
    expect(mocks.getBackendUrl).toHaveBeenCalledTimes(2);
  });
});
