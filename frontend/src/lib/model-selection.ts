import { isHiddenPublicProvider } from "@/lib/public-provider-boundary";
import type { ActiveProvider } from "@/stores/settings-store";
import type { ModelInfo } from "@/types/model";

export const AUTOMATIC_MODEL_VALUE = "__automatic__";

export function isFreeModel(model: ModelInfo): boolean {
  return model.pricing.prompt === 0 && model.pricing.completion === 0;
}

export function isLegacyFreeRouterModel(model: ModelInfo): boolean {
  const normalizedName = model.name.trim().toLowerCase();
  return model.id === "openrouter/auto" || normalizedName === "free models router";
}

export function modelMatches(model: ModelInfo, modelId: string | null, providerId: string | null): boolean {
  if (!modelId) return false;
  return model.id === modelId && (!providerId || model.provider_id === providerId);
}

export function activeProviderForProviderId(providerId: string): ActiveProvider {
  if (isHiddenPublicProvider(providerId)) return null;
  if (providerId === "openai-subscription") return "chatgpt";
  if (providerId === "ollama") return "ollama";
  if (providerId === "local") return "local";
  if (providerId.startsWith("custom_")) return "custom";
  return "byok";
}

export function modelBelongsToActiveProvider(model: ModelInfo, activeProvider: ActiveProvider): boolean {
  if (!activeProvider) return false;
  return activeProviderForProviderId(model.provider_id) === activeProvider;
}

export function chooseAutomaticModel(models: ModelInfo[], activeProvider: ActiveProvider): ModelInfo | null {
  if (models.length === 0) return null;

  if (activeProvider === "chatgpt") {
    return (
      models.find((model) => model.id === "openai-subscription/gpt-5.5") ??
      models.find((model) => model.id === "openai-subscription/gpt-5.4") ??
      models[0]
    );
  }

  return models[0];
}

export function modelSelectValue(modelId: string, providerId: string): string {
  return `${encodeURIComponent(providerId)}::${encodeURIComponent(modelId)}`;
}

export function parseModelSelectValue(value: string): { providerId: string; modelId: string } | null {
  if (value === AUTOMATIC_MODEL_VALUE) return null;
  const separatorIndex = value.indexOf("::");
  if (separatorIndex < 0) return null;
  try {
    return {
      providerId: decodeURIComponent(value.slice(0, separatorIndex)),
      modelId: decodeURIComponent(value.slice(separatorIndex + 2)),
    };
  } catch {
    return null;
  }
}
