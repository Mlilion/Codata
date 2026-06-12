/**
 * Remote access compatibility stubs.
 *
 * The remote tunnel feature has been removed. These exports remain so shared
 * chat components can keep importing the old helpers without enabling any
 * remote-mode behavior.
 */

export interface RemoteConfig {
  url: string;
  token: string;
}

export type RemoteProvider = "chatgpt" | "openrouter";

export function getRemoteConfig(): RemoteConfig | null {
  return null;
}

export function saveRemoteConfig(config: RemoteConfig): void {
  void config;
  // Remote access has been removed.
}

export function clearRemoteConfig(): void {
  // Remote access has been removed.
}

export function isRemoteMode(): boolean {
  return false;
}

export function getRemoteToken(): string | null {
  return null;
}

export function getRemoteUrl(): string | null {
  return null;
}

export function getRemoteProvider(): RemoteProvider | null {
  return null;
}

export function saveRemoteProvider(provider: RemoteProvider): void {
  void provider;
  // Remote access has been removed.
}

export function autoConnectFromUrl(): boolean {
  return false;
}

export function parseQRData(data: string): RemoteConfig | null {
  void data;
  return null;
}
