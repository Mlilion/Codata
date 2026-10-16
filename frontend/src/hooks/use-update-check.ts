/**
 * Automatic updates are disabled in the open-source desktop build.
 * Users can download releases manually from the About page.
 */

export async function checkForUpdates(): Promise<boolean> {
  return false;
}

export function useUpdateCheck() {
  return {
    available: false,
    version: null,
    notes: null,
    checking: false,
    downloading: false,
    progress: 0,
    error: null,
    lastCheckedAt: null,
    downloadAndInstall: async () => {},
    dismiss: () => {},
    checkNow: async () => false,
  };
}
