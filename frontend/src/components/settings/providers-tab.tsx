"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useModels } from "@/hooks/use-models";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import { errorToMessage } from "@/lib/errors";
import {
  activeProviderForProviderId,
  AUTOMATIC_MODEL_VALUE,
  chooseAutomaticModel,
  isLegacyFreeRouterModel,
  modelBelongsToActiveProvider,
  modelMatches,
  modelSelectValue,
  parseModelSelectValue,
} from "@/lib/model-selection";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { ActiveProvider } from "@/stores/settings-store";
import type { ModelInfo } from "@/types/model";
import type {
  ProviderInfo,
  ProviderTestResult,
} from "@/types/usage";

type AddMode = "list" | "add";
type ProviderKind = string;
type ActiveModelSource = "byok" | "custom" | null;
type ModelRefreshResponse = { refreshed?: Record<string, number> };
type ActivationRequest = { type: "configured"; provider: ProviderInfo; enabled: boolean };

interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  previewPath: string;
  keyPlaceholder: string;
  needsBaseUrl?: boolean;
}

const UNAVAILABLE_DEFAULT_MODEL_VALUE = "__unavailable_default__";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Gemini",
  groq: "Groq",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  xai: "xAI",
  together: "Together",
  deepinfra: "DeepInfra",
  cerebras: "Cerebras",
  cohere: "Cohere",
  perplexity: "Perplexity",
  fireworks: "Fireworks",
  azure: "Azure",
  openrouter: "OpenRouter",
  qwen: "Qwen",
  kimi: "Kimi",
  minimax: "MiniMax",
  zhipu: "ZhipuAI",
  siliconflow: "SiliconFlow",
  xiaomi: "MiMo",
  "openai-subscription": "ChatGPT",
  ollama: "Ollama",
  local: "Local",
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    previewPath: "/v1/messages",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "sk-...",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "sk-or-...",
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    previewPath: "/v1beta/models",
    keyPlaceholder: "AIza...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "sk-...",
  },
  {
    id: "qwen",
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "sk-...",
  },
  {
    id: "kimi",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "sk-...",
  },
  {
    id: "xiaomi",
    name: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "...",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    baseUrl: "",
    previewPath: "/chat/completions",
    keyPlaceholder: "...",
    needsBaseUrl: true,
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "gsk_...",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "...",
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "xai-...",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    previewPath: "/chat/completions",
    keyPlaceholder: "sk-...",
  },
];

export function ProvidersTab() {
  const { t } = useTranslation("settings");
  const [mode, setMode] = useState<AddMode>("list");

  if (mode === "add") {
    return <AddProviderView onBack={() => setMode("list")} />;
  }

  return <ProviderListView onAdd={() => setMode("add")} t={t} />;
}

function ProviderListView({
  onAdd,
  t,
}: {
  onAdd: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const qc = useQueryClient();
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const defaultProviderId = useSettingsStore((s) => s.defaultProviderId);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const { data: models, isLoading: modelsLoading } = useModels();
  const [modelRefreshMessage, setModelRefreshMessage] = useState("");

  const { data: providers } = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => api.get<ProviderInfo[]>(API.CONFIG.PROVIDERS),
  });

  const configuredProviders = useMemo(
    () => (providers ?? []).filter((p) => p.is_configured),
    [providers],
  );
  const builtInProviders = useMemo(
    () => configuredProviders.filter((p) => !p.id.startsWith("custom_")),
    [configuredProviders],
  );
  const customProviders = useMemo(
    () => configuredProviders.filter((p) => p.id.startsWith("custom_")),
    [configuredProviders],
  );
  const enabledConfiguredProviders = useMemo(
    () => configuredProviders.filter(isProviderEnabled),
    [configuredProviders],
  );
  const selectableModels = useMemo(
    () => (models ?? []).filter((model) => !isLegacyFreeRouterModel(model)),
    [models],
  );
  const selectedDefaultModel = useMemo(
    () => selectableModels.find((model) => modelMatches(model, defaultModel, defaultProviderId)) ?? null,
    [selectableModels, defaultModel, defaultProviderId],
  );
  const activeProviderModels = useMemo(
    () => selectableModels.filter((model) => modelBelongsToActiveProvider(model, activeProvider)),
    [selectableModels, activeProvider],
  );
  const hasUnavailableDefault = Boolean(defaultModel) && !selectedDefaultModel;
  const defaultModelSelectValue = selectedDefaultModel
    ? modelSelectValue(selectedDefaultModel.id, selectedDefaultModel.provider_id)
    : hasUnavailableDefault
      ? UNAVAILABLE_DEFAULT_MODEL_VALUE
      : AUTOMATIC_MODEL_VALUE;

  const changeDefaultModel = (value: string) => {
    const parsed = parseModelSelectValue(value);

    if (!parsed) {
      setDefaultModel(null, null);
      const automaticModel =
        chooseAutomaticModel(activeProviderModels, activeProvider) ??
        chooseAutomaticModel(selectableModels, activeProvider);
      if (automaticModel) {
        setSelectedModel(automaticModel.id, automaticModel.provider_id);
        setActiveProvider(activeProviderForProviderId(automaticModel.provider_id));
      }
      return;
    }

    const model = selectableModels.find(
      (candidate) =>
        candidate.id === parsed.modelId &&
        candidate.provider_id === parsed.providerId,
    );
    if (!model) return;

    setDefaultModel(model.id, model.provider_id);
    setSelectedModel(model.id, model.provider_id);
    setActiveProvider(activeProviderForProviderId(model.provider_id));
  };

  const selectModelSource = useMutation({
    mutationFn: async (request: ActivationRequest): Promise<{ activeProvider: ActiveModelSource }> => {
      if (request.enabled) {
        await disableOtherProviders(configuredProviders, request.provider.id);
        await setProviderEnabled(request.provider, true);
        return { activeProvider: providerActiveSource(request.provider) };
      }

      await setProviderEnabled(request.provider, false);
      return { activeProvider: null };
    },
    onSuccess: ({ activeProvider }, request) => {
      setActiveProvider(activeProvider);
      qc.setQueryData<ProviderInfo[]>(queryKeys.providers, (current) =>
        applyProviderActivationSnapshot(current, request),
      );
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
  const {
    isPending: isSelectingModelSource,
    mutate: selectModelSourceMutate,
    mutateAsync: selectModelSourceMutateAsync,
    variables: selectModelSourceVariables,
  } = selectModelSource;

  const refreshModels = useMutation({
    mutationFn: () => api.post<ModelRefreshResponse>(API.MODELS_REFRESH),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: queryKeys.models });
      const refreshedCount = Object.values(result.refreshed ?? {}).reduce(
        (sum, count) => sum + count,
        0,
      );
      setModelRefreshMessage(t("modelsRefreshSuccess", { count: refreshedCount }));
    },
    onError: (err) => {
      setModelRefreshMessage(errorToMessage(err, t("modelsRefreshFailed")));
    },
  });

  const enabledConfiguredKey = enabledConfiguredProviders.map((p) => p.id).join("|");

  useEffect(() => {
    if (!providers || isSelectingModelSource || enabledConfiguredProviders.length === 0) {
      return;
    }

    if (enabledConfiguredProviders.length === 1) {
      const onlyProvider = enabledConfiguredProviders[0];
      const expectedActiveProvider = providerActiveSource(onlyProvider);
      if (activeProvider !== expectedActiveProvider) {
        setActiveProvider(expectedActiveProvider);
      }
      return;
    }

    if (enabledConfiguredProviders.length > 1) {
      const preferred =
        enabledConfiguredProviders.find((provider) => providerActiveSource(provider) === activeProvider) ??
        enabledConfiguredProviders[0];
      void selectModelSourceMutateAsync({ type: "configured", provider: preferred, enabled: true });
    }
  }, [
    activeProvider,
    enabledConfiguredKey,
    providers,
    isSelectingModelSource,
    selectModelSourceMutateAsync,
    setActiveProvider,
    enabledConfiguredProviders,
  ]);

  const deleteBuiltInProvider = useMutation({
    mutationFn: (id: string) => api.delete<ProviderInfo>(API.CONFIG.PROVIDER_KEY(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
  });

  const deleteCustomEndpoint = useMutation({
    mutationFn: (id: string) => api.delete<ProviderInfo>(API.CONFIG.CUSTOM_ENDPOINT_ITEM(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
  const activeConfiguredProviderId = getActiveConfiguredProviderId(
    enabledConfiguredProviders,
    activeProvider,
  );
  const displayedConfiguredProviderId = isSelectingModelSource
    ? selectModelSourceVariables?.type === "configured" && selectModelSourceVariables.enabled
      ? selectModelSourceVariables.provider.id
      : null
    : activeConfiguredProviderId;
  const mutatingSelectedProviderId =
    isSelectingModelSource && selectModelSourceVariables?.type === "configured"
      ? selectModelSourceVariables.provider.id
      : null;
  const mutatingBuiltInId = mutatingSelectedProviderId
    ? mutatingSelectedProviderId
    : deleteBuiltInProvider.isPending
      ? deleteBuiltInProvider.variables
      : null;
  const mutatingCustomId = mutatingSelectedProviderId
    ? mutatingSelectedProviderId
    : deleteCustomEndpoint.isPending
      ? deleteCustomEndpoint.variables
      : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t("modelConfigTitle")}
          </h2>
          <p className="mt-1 text-ui-caption text-[var(--text-secondary)]">
            {t("modelConfigDesc")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={onAdd}
          className="shrink-0 bg-[var(--text-primary)] text-[var(--surface-primary)] hover:bg-[var(--text-secondary)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("addModelConfig")}
        </Button>
      </div>

      <DefaultModelSelector
        models={selectableModels}
        value={defaultModelSelectValue}
        selectedModel={selectedDefaultModel}
        loading={modelsLoading}
        hasUnavailableDefault={hasUnavailableDefault}
        onChange={changeDefaultModel}
        t={t}
      />

      <ModelSummaryTable
        title={t("enabledModels")}
        subtitle={t("modelsAvailableSubtitle", { count: selectableModels.length })}
        models={selectableModels}
        refreshing={refreshModels.isPending}
        refreshMessage={modelRefreshMessage}
        onRefresh={() => refreshModels.mutate()}
        t={t}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-ui-body font-semibold text-[var(--text-primary)]">
            {t("customModelConfigs")}
          </h3>
          <span className="text-ui-caption text-[var(--text-tertiary)]">
            {builtInProviders.length + customProviders.length} {t("configuredCount")}
          </span>
        </div>

        {builtInProviders.length === 0 && customProviders.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-8 text-center">
            <p className="text-ui-body font-medium text-[var(--text-primary)]">
              {t("noCustomModelConfigs")}
            </p>
            <p className="mt-1 text-ui-caption text-[var(--text-secondary)]">
              {t("noCustomModelConfigsDesc")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {builtInProviders.map((provider) => (
              <ConfiguredProviderCard
                key={provider.id}
                provider={provider}
                active={displayedConfiguredProviderId === provider.id}
                onToggle={(checked) => selectModelSourceMutate({ type: "configured", provider, enabled: checked })}
                onDelete={() => deleteBuiltInProvider.mutate(provider.id)}
                mutating={isSelectingModelSource || mutatingBuiltInId === provider.id}
                t={t}
              />
            ))}
            {customProviders.map((provider) => (
              <ConfiguredProviderCard
                key={provider.id}
                provider={provider}
                active={displayedConfiguredProviderId === provider.id}
                onToggle={(checked) => selectModelSourceMutate({ type: "configured", provider, enabled: checked })}
                onDelete={() => deleteCustomEndpoint.mutate(provider.id)}
                mutating={isSelectingModelSource || mutatingCustomId === provider.id}
                t={t}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DefaultModelSelector({
  models,
  value,
  selectedModel,
  loading,
  hasUnavailableDefault,
  onChange,
  t,
}: {
  models: ModelInfo[];
  value: string;
  selectedModel: ModelInfo | null;
  loading: boolean;
  hasUnavailableDefault: boolean;
  onChange: (value: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-ui-body font-semibold text-[var(--text-primary)]">
            {t("defaultModel")}
          </h3>
          <p className="mt-1 text-ui-caption text-[var(--text-secondary)]">
            {t("defaultModelDesc")}
          </p>
          <p className="mt-1 text-ui-caption text-[var(--text-tertiary)]">
            {selectedModel
              ? t("defaultModelCurrent", {
                  model: selectedModel.name,
                  provider: providerLabel(selectedModel.provider_id),
                })
              : hasUnavailableDefault
                ? t("defaultModelUnavailable")
                : t("defaultModelAutomaticDesc")}
          </p>
        </div>
        <Select value={value} onValueChange={onChange} disabled={loading || (models.length === 0 && !hasUnavailableDefault)}>
          <SelectTrigger className="w-full bg-[var(--surface-primary)] text-ui-body shadow-none sm:w-[320px]">
            <SelectValue placeholder={loading ? t("loading") : t("defaultModelAutomatic")} />
          </SelectTrigger>
          <SelectContent className="max-h-[360px]">
            {hasUnavailableDefault && (
              <SelectItem value={UNAVAILABLE_DEFAULT_MODEL_VALUE} textValue={t("defaultModelUnavailable")} disabled>
                <span className="truncate text-[var(--text-tertiary)]">
                  {t("defaultModelUnavailable")}
                </span>
              </SelectItem>
            )}
            <SelectItem value={AUTOMATIC_MODEL_VALUE} textValue={t("defaultModelAutomatic")}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{t("defaultModelAutomatic")}</span>
                <span className="truncate text-ui-3xs text-[var(--text-tertiary)]">
                  {t("defaultModelAutomaticDesc")}
                </span>
              </span>
            </SelectItem>
            {models.map((model) => (
              <SelectItem
                key={`${model.provider_id}:${model.id}`}
                value={modelSelectValue(model.id, model.provider_id)}
                textValue={`${model.name} ${providerLabel(model.provider_id)}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderIcon
                    providerId={model.provider_id}
                    name={model.name}
                    fallback={model.provider_id.startsWith("custom_") ? "server" : "key"}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{model.name}</span>
                    <span className="block truncate text-ui-3xs text-[var(--text-tertiary)]">
                      {providerLabel(model.provider_id)}
                    </span>
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}

function ModelSummaryTable({
  title,
  subtitle,
  models,
  refreshing,
  refreshMessage,
  onRefresh,
  t,
}: {
  title: string;
  subtitle: string;
  models: ModelInfo[];
  refreshing: boolean;
  refreshMessage: string;
  onRefresh: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleCount = expanded ? models.length : 6;
  const visible = models.slice(0, visibleCount);
  const hiddenCount = Math.max(0, models.length - visible.length);

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-ui-body font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-ui-caption text-[var(--text-tertiary)]">{subtitle}</p>
          {refreshMessage && (
            <p className="mt-1 text-ui-3xs text-[var(--text-tertiary)]">{refreshMessage}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t("refreshModels")}
          title={t("refreshModels")}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {visible.map((model) => (
          <div key={`${model.provider_id}:${model.id}`} className="grid grid-cols-[minmax(0,1fr)_120px_72px] items-center gap-3 px-4 py-2.5 text-ui-caption">
            <span className="flex min-w-0 items-center gap-2" title={model.name}>
              <ProviderIcon
                providerId={model.provider_id}
                name={model.name}
                size="sm"
              />
              <span className="truncate font-medium text-[var(--text-primary)]">
                {model.name}
              </span>
            </span>
            <span className="truncate font-mono text-[var(--text-secondary)]">
              {formatContext(model.capabilities.max_context)}
            </span>
            <span className="text-right font-medium text-[var(--color-success)]">
              {t("available")}
            </span>
          </div>
        ))}
      </div>
      {models.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-default)] px-4 py-2 text-ui-caption text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              {t("collapseModels")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              {t("viewMoreModels", { count: hiddenCount })}
            </>
          )}
        </button>
      )}
    </section>
  );
}

function ConfiguredProviderCard({
  provider,
  active,
  onToggle,
  onDelete,
  mutating,
  t,
}: {
  provider: ProviderInfo;
  active: boolean;
  onToggle: (checked: boolean) => void;
  onDelete: () => void;
  mutating: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-3 transition-opacity",
        !active && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderIcon
            providerId={provider.id}
            name={provider.name}
            baseUrl={provider.base_url}
            fallback={provider.id.startsWith("custom_") ? "server" : "key"}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-ui-body font-semibold text-[var(--text-primary)]">
                {provider.name}
              </h3>
              {active && <Badge variant="outline" className="px-1.5 py-0 text-ui-3xs">{t("activeProvider")}</Badge>}
            </div>
            <p className="truncate text-ui-caption text-[var(--text-secondary)]">
              {provider.base_url
                ? provider.base_url
                : t("providerCardDesc", { count: provider.model_count })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-ui-caption text-[var(--text-tertiary)] sm:inline">
            {provider.model_count} {t("providerModels")}
          </span>
          <Switch checked={active} onCheckedChange={onToggle} disabled={mutating} />
          <button
            type="button"
            onClick={onDelete}
            disabled={mutating}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)] disabled:opacity-40"
            aria-label={t("removeModelConfig")}
          >
            {mutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </section>
  );
}

function AddProviderView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const { data: providers } = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => api.get<ProviderInfo[]>(API.CONFIG.PROVIDERS),
  });

  const providerOptions = useMemo(() => {
    const providerMap = new Map((providers ?? []).map((p) => [p.id, p.name]));
    return PROVIDER_PRESETS.map((preset) => ({
      ...preset,
      name: providerMap.get(preset.id) ?? preset.name,
    }));
  }, [providers]);

  const [providerKind, setProviderKind] = useState<ProviderKind>("anthropic");
  const preset = providerOptions.find((p) => p.id === providerKind);
  const selectedName = preset?.name ?? t("customEndpoint");
  const [channelName, setChannelName] = useState("My Anthropic");
  const [baseUrl, setBaseUrl] = useState(preset?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  const isCustom = providerKind === "custom";
  const canEditBaseUrl = isCustom || !!preset?.needsBaseUrl;
  const previewPath = isCustom ? "/models" : (preset?.previewPath ?? "");
  const previewUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}${previewPath}` : "";
  const keyPlaceholder = preset?.keyPlaceholder ?? t("apiKeyPlaceholderOptional");
  const hasRequiredKey = isCustom || !!apiKey.trim();
  const canSubmit = hasRequiredKey && (!canEditBaseUrl || !!baseUrl.trim());

  const changeProviderKind = (value: string) => {
    setProviderKind(value);
    setTestResult(null);
    setError(null);
    if (value === "custom") {
      setChannelName("");
      setBaseUrl("");
      return;
    }
    const nextPreset = providerOptions.find((p) => p.id === value);
    setChannelName(`My ${nextPreset?.name ?? value}`);
    setBaseUrl(nextPreset?.baseUrl ?? "");
  };

  const testConnection = useMutation({
    mutationFn: () => {
      if (isCustom) {
        return api.post<ProviderTestResult>(API.CONFIG.CUSTOM_ENDPOINT_TEST, {
          name: channelName.trim() || t("customEndpoint"),
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          enabled,
        });
      }
      return api.post<ProviderTestResult>(API.CONFIG.PROVIDER_TEST(providerKind), {
        api_key: apiKey.trim(),
        base_url: canEditBaseUrl ? baseUrl.trim() : undefined,
        enabled,
      });
    },
    onSuccess: (result) => {
      setError(null);
      setTestResult(result);
    },
    onError: (err) => {
      setTestResult(null);
      setError(errorToMessage(err, t("modelConfigTestFailed")));
    },
  });

  const createProvider = useMutation({
    mutationFn: () => {
      if (isCustom) {
        return api.post<ProviderInfo>(API.CONFIG.CUSTOM_ENDPOINT, {
          name: channelName.trim() || t("customEndpoint"),
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          enabled,
        });
      }
      return api.post<ProviderInfo>(API.CONFIG.PROVIDER_KEY(providerKind), {
        api_key: apiKey.trim(),
        base_url: canEditBaseUrl ? baseUrl.trim() : undefined,
        enabled,
      });
    },
    onSuccess: (result) => {
      if (result.enabled) {
        setActiveProvider(isCustom ? "custom" : "byok");
      }
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
      onBack();
    },
    onError: (err) => {
      setError(errorToMessage(err, t("failedSaveKey")));
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="truncate text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t("addModelConfigTitle")}
          </h2>
        </div>
        <Button
          size="sm"
          onClick={() => createProvider.mutate()}
          disabled={!canSubmit || createProvider.isPending}
          className="shrink-0 bg-[var(--text-primary)] text-[var(--surface-primary)] hover:opacity-90"
        >
          {createProvider.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("create")}
        </Button>
      </div>

      <section>
        <h3 className="mb-3 text-ui-body font-semibold text-[var(--text-primary)]">
          {t("basicInfo")}
        </h3>
        <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
          <FormRow label={t("channelName")}>
            <Input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder={t("channelNamePlaceholder")}
              className="bg-[var(--surface-primary)] text-ui-body shadow-none"
            />
          </FormRow>

          <FormRow label={t("providerType")}>
            <Select value={providerKind} onValueChange={changeProviderKind}>
              <SelectTrigger className="bg-[var(--surface-primary)] text-ui-body shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id} textValue={option.name}>
                    <span className="flex items-center gap-2">
                      <ProviderIcon
                        providerId={option.id}
                        name={option.name}
                        baseUrl={option.baseUrl}
                        size="sm"
                      />
                      <span>{option.name}</span>
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value="custom" textValue={t("customEndpoint")}>
                  <span className="flex items-center gap-2">
                    <ProviderIcon fallback="server" size="sm" />
                    <span>{t("customEndpoint")}</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow
            label="Base URL"
            hint={previewUrl ? `${t("preview")}: ${previewUrl}` : undefined}
          >
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              readOnly={!canEditBaseUrl}
              placeholder={t("providerUrlPlaceholder_custom")}
              className={cn(
                "bg-[var(--surface-primary)] font-mono text-ui-body shadow-none",
                !canEditBaseUrl && "text-[var(--text-secondary)]",
              )}
            />
          </FormRow>

          <FormRow label="API Key">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder={keyPlaceholder}
                  className="bg-[var(--surface-primary)] pr-9 font-mono text-ui-body shadow-none"
                  autoComplete="one-time-code"
                  data-form-type="other"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={showKey ? t("hideApiKey") : t("showApiKey")}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testConnection.mutate()}
                disabled={!canSubmit || testConnection.isPending}
                className="shrink-0"
              >
                {testConnection.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {t("testConnection")}
              </Button>
            </div>
          </FormRow>

          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-ui-body font-medium text-[var(--text-primary)]">
                {t("enableThisChannel")}
              </p>
              <p className="mt-0.5 text-ui-caption text-[var(--text-secondary)]">
                {t("enableThisChannelDesc")}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </section>

      {(error || testResult) && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-ui-caption",
            error
              ? "border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"
              : "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]",
          )}
        >
          {error ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
          <span>
            {error ?? t("modelConfigTestPassed", { count: testResult?.model_count ?? 0 })}
          </span>
        </div>
      )}

      <section>
        <h3 className="mb-3 text-ui-body font-semibold text-[var(--text-primary)]">
          {t("enabledModels")}
        </h3>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-8 text-center">
          {testResult && testResult.models.length > 0 ? (
            <div className="mx-auto max-w-md space-y-2 text-left">
              {testResult.models.slice(0, 8).map((model) => (
                <div
                  key={model}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-ui-caption"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ProviderIcon
                      providerId={isCustom ? "custom" : providerKind}
                      name={selectedName}
                      baseUrl={baseUrl}
                      fallback={isCustom ? "server" : "key"}
                      size="sm"
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">{model}</span>
                  </span>
                  <Badge variant="outline" className="px-1.5 py-0 text-ui-3xs">
                    {selectedName}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ui-caption text-[var(--text-secondary)]">
              {t("enabledModelsEmpty")}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-[var(--border-default)] px-4 py-3 last:border-b-0">
      <label className="mb-2 block text-ui-body font-medium text-[var(--text-primary)]">
        {label}
      </label>
      {hint && <p className="mb-2 text-ui-caption text-[var(--text-tertiary)]">{hint}</p>}
      {children}
    </div>
  );
}

function isProviderEnabled(provider: ProviderInfo) {
  return provider.enabled && provider.status !== "disabled";
}

function getActiveConfiguredProviderId(
  providers: ProviderInfo[],
  activeProvider: ActiveProvider,
) {
  if (providers.length === 0) return null;

  const matchingProvider = providers.find((provider) => providerActiveSource(provider) === activeProvider);
  return matchingProvider?.id ?? providers[0].id;
}

function providerActiveSource(provider: ProviderInfo): ActiveModelSource {
  return provider.id.startsWith("custom_") ? "custom" : "byok";
}

function providerLabel(providerId: string) {
  if (providerId.startsWith("custom_")) return "Custom";
  return PROVIDER_LABELS[providerId] ?? providerId;
}

function formatContext(value: number | null | undefined) {
  if (!value) return "-";
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M ctx`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K ctx`;
  return `${value} ctx`;
}

async function setProviderEnabled(provider: ProviderInfo, enabled: boolean) {
  if (isProviderEnabled(provider) === enabled) return;

  if (provider.id.startsWith("custom_")) {
    await api.patch<ProviderInfo>(API.CONFIG.CUSTOM_ENDPOINT_ITEM(provider.id), { enabled });
    return;
  }

  await api.post<ProviderInfo>(API.CONFIG.PROVIDER_TOGGLE(provider.id), { enabled });
}

async function disableOtherProviders(providers: ProviderInfo[], keepId?: string) {
  await Promise.all(
    providers
      .filter((provider) => provider.id !== keepId && isProviderEnabled(provider))
      .map((provider) => setProviderEnabled(provider, false)),
  );
}

function applyProviderActivationSnapshot(
  providers: ProviderInfo[] | undefined,
  request: ActivationRequest,
): ProviderInfo[] | undefined {
  if (!providers) return providers;

  return providers.map((provider) => {
    if (provider.id === request.provider.id) {
      return providerSnapshotWithEnabled(provider, request.enabled);
    }
    if (request.enabled) {
      return providerSnapshotWithEnabled(provider, false);
    }
    return provider;
  });
}

function providerSnapshotWithEnabled(provider: ProviderInfo, enabled: boolean): ProviderInfo {
  if (!provider.is_configured) return provider;
  if (provider.enabled === enabled && isProviderEnabled(provider) === enabled) return provider;
  return {
    ...provider,
    enabled,
    status: enabled ? "connected" : "disabled",
  };
}
