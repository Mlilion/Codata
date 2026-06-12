import { KeyRound, Server } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

type ProviderIconFallback = "key" | "server";
type ProviderIconSize = "xs" | "sm" | "md";

const LLM_ICON_PATH = "/llm-icons";

const PROVIDER_ICON_BY_ID: Record<string, string> = {
  anthropic: "anthropic",
  azure: "microsoft",
  baichuan: "baichuan",
  chatglm: "chatglm",
  cohere: "cohere",
  deepseek: "deepseek",
  doubao: "doubao",
  ernie: "ernie",
  gemini: "gemini",
  google: "gemini",
  hunyuan: "hunyuan",
  kimi: "kimi",
  microsoft: "microsoft",
  mistral: "mistral",
  nvidia: "nvidia",
  openai: "openai",
  perplexity: "perplexity",
  qwen: "qwen",
  spark: "spark",
  stepfun: "stepfun",
  xai: "xai",
  yi: "yi",
  zhipu: "chatglm",
};

const PROVIDER_ICON_MATCHERS: Array<{ icon: string; terms: string[] }> = [
  { icon: "anthropic", terms: ["anthropic"] },
  { icon: "claude", terms: ["claude"] },
  { icon: "openai", terms: ["openai", "chatgpt", "gpt"] },
  { icon: "microsoft", terms: ["azure", "microsoft"] },
  { icon: "gemini", terms: ["gemini"] },
  { icon: "google", terms: ["google"] },
  { icon: "deepseek", terms: ["deepseek"] },
  { icon: "qwen", terms: ["qwen", "dashscope", "aliyun", "alibaba", "tongyi"] },
  { icon: "kimi", terms: ["kimi", "moonshot"] },
  { icon: "mistral", terms: ["mistral"] },
  { icon: "xai", terms: ["xai", "x.ai", "grok"] },
  { icon: "cohere", terms: ["cohere"] },
  { icon: "perplexity", terms: ["perplexity"] },
  { icon: "baichuan", terms: ["baichuan"] },
  { icon: "chatglm", terms: ["chatglm", "zhipu", "bigmodel"] },
  { icon: "doubao", terms: ["doubao", "volcengine", "ark"] },
  { icon: "hunyuan", terms: ["hunyuan", "tencent"] },
  { icon: "ernie", terms: ["ernie", "baidu", "wenxin"] },
  { icon: "spark", terms: ["spark", "xunfei", "iflytek"] },
  { icon: "yi", terms: ["yi", "lingyiwanwu", "01ai"] },
  { icon: "stepfun", terms: ["stepfun"] },
  { icon: "nvidia", terms: ["nvidia"] },
  { icon: "amazon", terms: ["amazon", "bedrock"] },
  { icon: "meta", terms: ["meta"] },
  { icon: "llama", terms: ["llama"] },
  { icon: "copilot", terms: ["copilot"] },
];

const SIZE_CLASS: Record<ProviderIconSize, { image: string; box: string; fallback: string }> = {
  xs: { image: "h-6 w-6", box: "h-6 w-6 rounded-md", fallback: "h-3.5 w-3.5" },
  sm: { image: "h-7 w-7", box: "h-7 w-7 rounded-md", fallback: "h-4 w-4" },
  md: { image: "h-10 w-10", box: "h-10 w-10 rounded-lg", fallback: "h-5 w-5" },
};

export function ProviderIcon({
  providerId,
  name,
  baseUrl,
  fallback = "key",
  size = "md",
  className,
}: {
  providerId?: string | null;
  name?: string | null;
  baseUrl?: string | null;
  fallback?: ProviderIconFallback;
  size?: ProviderIconSize;
  className?: string;
}) {
  const icon = resolveProviderIcon(providerId, name, baseUrl);
  const sizeClass = SIZE_CLASS[size];

  if (icon) {
    return (
      <Image
        src={`${LLM_ICON_PATH}/${icon}.png`}
        alt=""
        width={40}
        height={40}
        className={cn(
          "shrink-0 object-contain",
          sizeClass.image,
          className,
        )}
        loading="lazy"
        aria-hidden="true"
      />
    );
  }

  if (fallback === "server") {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-[var(--brand-primary)] text-[var(--brand-primary-text)]",
          sizeClass.box,
          className,
        )}
      >
        <Server className={sizeClass.fallback} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-[var(--surface-secondary)] text-[var(--text-primary)] ring-1 ring-[var(--border-default)]",
        sizeClass.box,
        className,
      )}
    >
      <KeyRound className={sizeClass.fallback} />
    </div>
  );
}

function resolveProviderIcon(
  providerId?: string | null,
  name?: string | null,
  baseUrl?: string | null,
) {
  const cleanProviderId = providerId?.replace(/^custom_/, "");
  const directIcon = cleanProviderId ? PROVIDER_ICON_BY_ID[cleanProviderId] : null;
  if (directIcon) return directIcon;

  const haystack = [providerId, name, baseUrl].filter(Boolean).join(" ").toLowerCase();
  const matched = PROVIDER_ICON_MATCHERS.find(({ terms }) =>
    terms.some((term) => haystack.includes(term)),
  );
  return matched?.icon ?? null;
}
