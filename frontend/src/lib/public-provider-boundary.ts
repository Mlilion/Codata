const HIDDEN_PUBLIC_PROVIDER_IDS = new Set<string>();

export function isHiddenPublicProvider(providerId: string | null | undefined): boolean {
  return Boolean(providerId && HIDDEN_PUBLIC_PROVIDER_IDS.has(providerId));
}
