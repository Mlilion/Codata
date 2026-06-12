"use client";

export const NAVIGATE_TO_SESSION_EVENT = "workcraft:navigate-to-session";

export interface NavigateToSessionDetail {
  sessionId: string;
}

let permissionRequestInFlight: Promise<NotificationPermission> | null = null;

async function ensurePermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  if (!permissionRequestInFlight) {
    permissionRequestInFlight = Notification.requestPermission().finally(() => {
      permissionRequestInFlight = null;
    });
  }
  return permissionRequestInFlight;
}

interface NotifyOptions {
  sessionId: string;
  title: string;
  body: string;
  kind: "done" | "error";
}

export async function notifyBackgroundFinish({
  sessionId,
  title,
  body,
  kind,
}: NotifyOptions): Promise<void> {
  const perm = await ensurePermission();
  if (perm !== "granted") return;
  try {
    const notification = new Notification(title, {
      body,
      tag: `workcraft-${kind}-${sessionId}`,
    });
    notification.onclick = () => {
      try {
        window.focus();
        window.dispatchEvent(
          new CustomEvent<NavigateToSessionDetail>(NAVIGATE_TO_SESSION_EVENT, {
            detail: { sessionId },
          }),
        );
      } finally {
        notification.close();
      }
    };
  } catch {
    // Best effort; browsers can still block notifications after permission.
  }
}
