"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/page-frame";
import {
  useAddChannel,
  useCancelFeishuQrRegistration,
  useCancelWeixinQrLogin,
  useChannels,
  useFeishuQrStatus,
  useRemoveChannel,
  useStartFeishuQrRegistration,
  useStartWeixinQrLogin,
  useWeixinQrStatus,
} from "@/hooks/use-channels";
import {
  DingTalkIcon,
  FeishuIcon,
  QQIcon,
  TelegramIcon,
  WeChatIcon,
  WeComIcon,
} from "@/components/icons/platform-icons";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChannelInfo, PlatformDef, PlatformFieldDef, PlatformGuideStep } from "@/types/channels";

export function RemoteTabContent() {
  return <ChannelsSection />;
}

const FEISHU_SCOPES = [
  "im:chat:readonly",
  "im:message:send",
  "im:message:receive_v1",
  "contact:user:readonly",
];

const FEISHU_SCOPES_JSON = JSON.stringify(
  {
    scopes: {
      tenant: [
        "contact:contact.base:readonly",
        "im:chat",
        "im:chat.members:read",
        "im:message",
        "im:message.group_at_msg:readonly",
        "im:message.p2p_msg:readonly",
        "im:message:send_as_bot",
        "im:resource",
      ],
      user: [],
    },
  },
  null,
  2,
);

const PLATFORM_ORDER = ["feishu", "weixin", "wecom", "dingtalk", "telegram", "qq"];

const PLATFORMS = ([
  {
    id: "feishu",
    name: "Feishu",
    icon: <FeishuIcon size={28} />,
    color: "text-[#3370FF]",
    auth: "token",
    help: "Create an app at Feishu Open Platform",
    helpUrl: "https://open.feishu.cn/app",
    fields: [
      { key: "app_id", label: "App ID", placeholder: "请输入 App ID" },
      { key: "app_secret", label: "App Secret", placeholder: "请输入 App Secret", secret: true },
      { key: "verification_token", label: "Verification Token", placeholder: "请输入 Verification Token", secret: true, required: false },
      { key: "encrypt_key", label: "Encrypt Key", placeholder: "请输入 Encrypt Key", secret: true, required: false },
    ],
    guide: [
      { titleKey: "platformGuide_feishu_1_title", bodyKey: "platformGuide_feishu_1_body", href: "https://open.feishu.cn/app" },
      { titleKey: "platformGuide_feishu_2_title", bodyKey: "platformGuide_feishu_2_body" },
      { titleKey: "platformGuide_feishu_3_title", bodyKey: "platformGuide_feishu_3_body" },
    ],
  },
  {
    id: "weixin",
    name: "WeChat",
    icon: <WeChatIcon size={28} />,
    color: "text-[#07C160]",
    auth: "qr",
    help: "Use iLink QR login or paste a WeChat bot token",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "请输入 Bot Token", secret: true, required: false },
      { key: "base_url", label: "Base URL", placeholder: "https://ilinkai.weixin.qq.com", required: false },
      { key: "route_tag", label: "Route Tag", placeholder: "Optional route tag", required: false },
    ],
    guide: [
      { titleKey: "platformGuide_weixin_1_title", bodyKey: "platformGuide_weixin_1_body" },
      { titleKey: "platformGuide_weixin_2_title", bodyKey: "platformGuide_weixin_2_body" },
      { titleKey: "platformGuide_weixin_3_title", bodyKey: "platformGuide_weixin_3_body" },
    ],
  },
  {
    id: "wecom",
    name: "WeCom",
    icon: <WeComIcon size={28} />,
    color: "text-[#0082EF]",
    auth: "token",
    help: "Create an AI Bot at WeCom Admin Console",
    fields: [
      { key: "bot_id", label: "Bot ID", placeholder: "Enter WeCom Bot ID" },
      { key: "secret", label: "Secret", placeholder: "Enter WeCom Bot secret", secret: true },
      { key: "welcome_message", label: "Welcome Message", placeholder: "Optional welcome message", required: false },
    ],
    guide: [
      { titleKey: "platformGuide_wecom_1_title", bodyKey: "platformGuide_wecom_1_body" },
      { titleKey: "platformGuide_wecom_2_title", bodyKey: "platformGuide_wecom_2_body" },
    ],
  },
  {
    id: "dingtalk",
    name: "DingTalk",
    icon: <DingTalkIcon size={28} />,
    color: "text-[#0089FF]",
    auth: "token",
    help: "Create a bot at DingTalk Open Platform",
    helpUrl: "https://open-dev.dingtalk.com",
    fields: [
      { key: "client_id", label: "Client ID / App Key", placeholder: "Enter DingTalk Client ID" },
      { key: "client_secret", label: "Client Secret / App Secret", placeholder: "Enter DingTalk Client Secret", secret: true },
    ],
    guide: [
      { titleKey: "platformGuide_dingtalk_1_title", bodyKey: "platformGuide_dingtalk_1_body", href: "https://open-dev.dingtalk.com" },
      { titleKey: "platformGuide_dingtalk_2_title", bodyKey: "platformGuide_dingtalk_2_body" },
      { titleKey: "platformGuide_dingtalk_3_title", bodyKey: "platformGuide_dingtalk_3_body" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: <TelegramIcon size={28} />,
    color: "text-[#26A5E4]",
    auth: "token",
    help: "Get a token from @BotFather on Telegram",
    helpUrl: "https://t.me/BotFather",
    fields: [{ key: "token", label: "Bot Token", placeholder: "123456:ABC-DEF...", secret: true }],
    guide: [
      { titleKey: "platformGuide_telegram_1_title", bodyKey: "platformGuide_telegram_1_body", href: "https://t.me/BotFather" },
      { titleKey: "platformGuide_telegram_2_title", bodyKey: "platformGuide_telegram_2_body" },
    ],
  },
  {
    id: "qq",
    name: "QQ",
    icon: <QQIcon size={28} />,
    color: "text-[var(--text-primary)]",
    auth: "token",
    help: "Create a bot at QQ Open Platform",
    helpUrl: "https://q.qq.com",
    fields: [
      { key: "app_id", label: "App ID", placeholder: "Enter QQ App ID" },
      { key: "secret", label: "Secret", placeholder: "Enter QQ secret", secret: true },
    ],
    guide: [
      { titleKey: "platformGuide_qq_1_title", bodyKey: "platformGuide_qq_1_body", href: "https://q.qq.com" },
    ],
  },
] satisfies PlatformDef[]).sort((a, b) => PLATFORM_ORDER.indexOf(a.id) - PLATFORM_ORDER.indexOf(b.id));

function ChannelsSection() {
  const { data: channelsData, isLoading, refetch } = useChannels();
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>("feishu");
  const [authMode, setAuthMode] = useState<"qr" | "manual">("qr");
  const channels = useMemo(() => channelsData?.channels ?? {}, [channelsData?.channels]);
  const gatewayRunning = channelsData?.gateway_running ?? false;
  const selectedPlatform = PLATFORMS.find((platform) => platform.id === selectedPlatformId) ?? PLATFORMS[0];
  const selectedChannel = channels[selectedPlatform.id];
  const supportsQr = platformSupportsQr(selectedPlatform);

  const groupedPlatforms = useMemo(() => {
    const running = PLATFORMS.filter((platform) => channels[platform.id]?.status === "running");
    const configured = PLATFORMS.filter((platform) => channels[platform.id]?.status === "configured");
    const disabled = PLATFORMS.filter((platform) => channels[platform.id]?.status === "disabled");
    const idle = PLATFORMS.filter((platform) => !channels[platform.id]);
    return [
      { id: "running", title: "已连接", platforms: running },
      { id: "configured", title: "已配置", platforms: configured },
      { id: "idle", title: "未配置", platforms: idle },
      { id: "disabled", title: "已停用", platforms: disabled },
    ];
  }, [channels]);

  const configuredCount = Object.values(channels).filter((ch) => ch.status !== "disabled").length;
  const runningCount = Object.values(channels).filter((ch) => ch.status === "running").length;

  useEffect(() => {
    setAuthMode(supportsQr ? "qr" : "manual");
  }, [selectedPlatform.id, supportsQr]);

  const handleDone = () => {
    void refetch();
  };

  return (
    <div data-testid="channel-workspace" className="flex min-h-full w-full flex-col gap-5 overflow-y-auto px-5 py-5 text-[var(--text-primary)] min-[1320px]:h-full min-[1320px]:min-h-[720px] min-[1320px]:flex-row min-[1320px]:overflow-hidden">
      <section data-testid="channel-list" className="flex w-full shrink-0 flex-col min-[1320px]:w-[400px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-ui-xl font-semibold text-[var(--text-primary)]">消息渠道</h1>
            <p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">将 Codata 连接到消息平台</p>
          </div>
          <Button
            variant="outline"
            className="h-8 rounded-lg border-[var(--border-default)] px-3 text-[12px] text-[var(--text-secondary)] shadow-sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            刷新
          </Button>
        </div>

        <div className="mt-5 grid h-11 grid-cols-[1.1fr_0.82fr_0.82fr_0.7fr] items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 text-[11px] shadow-[var(--shadow-sm)]">
          <span className="flex items-center gap-2 whitespace-nowrap font-medium text-[var(--text-primary)]">
            <span className={cn("h-2 w-2 rounded-full", gatewayRunning ? "bg-[var(--color-success)]" : "bg-[var(--text-tertiary)]")} />
            {gatewayRunning ? "网关运行中" : "网关未运行"}
          </span>
          <MetricDivider label="已配置" value={configuredCount} />
          <MetricDivider label="运行中" value={runningCount} />
          <MetricDivider label="支持" value={PLATFORMS.length} />
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1 scrollbar-auto">
          {groupedPlatforms.map((group) => (
            <ChannelGroup key={group.id} title={group.title} platforms={group.platforms} channels={channels} selectedId={selectedPlatform.id} onSelect={setSelectedPlatformId} />
          ))}
        </div>
      </section>

      <section className="min-w-0 flex-1">
        <ChannelDetailPanel
          platform={selectedPlatform}
          channel={selectedChannel}
          authMode={supportsQr ? authMode : "manual"}
          onAuthModeChange={setAuthMode}
          onDone={handleDone}
        />
      </section>
    </div>
  );
}

function MetricDivider({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center justify-center gap-1.5 whitespace-nowrap border-l border-[var(--border-default)] font-medium text-[var(--text-primary)]">
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

function ChannelGroup({
  title,
  platforms,
  channels,
  selectedId,
  onSelect,
}: {
  title: string;
  platforms: PlatformDef[];
  channels: Record<string, ChannelInfo>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (platforms.length === 0) return null;
  const compact = title === "未配置";

  return (
    <div className="mb-5">
      <div className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">
        {title} ({platforms.length})
      </div>
      <div className={cn("overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)]", !compact && "space-y-0")}>
        {platforms.map((platform, index) => (
          <PlatformRow
            key={platform.id}
            platform={platform}
            channel={channels[platform.id]}
            selected={selectedId === platform.id}
            separated={compact && index > 0}
            onSelect={() => onSelect(platform.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PlatformRow({
  platform,
  channel,
  selected,
  separated,
  onSelect,
}: {
  platform: PlatformDef;
  channel?: ChannelInfo;
  selected: boolean;
  separated?: boolean;
  onSelect: () => void;
}) {
  const status = channel?.status ?? "idle";
  const account = channel?.account || platformDefaultAccount(platform, status);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-[58px] w-full items-center gap-3 px-3 text-left transition-colors",
        separated && "border-t border-[var(--border-default)]",
        selected ? "border border-[var(--brand-border)] bg-[var(--brand-soft)] shadow-[inset_3px_0_0_var(--brand-primary)]" : "hover:bg-[var(--surface-hover)]",
      )}
    >
      <PlatformIcon platform={platform} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{platformDisplayName(platform)}</span>
          <ChannelStatusPill status={status} />
        </div>
        <div className="mt-1 truncate text-[12px] text-[var(--text-secondary)]">{platformSubtitle(platform)}</div>
      </div>
      <div className="flex w-[92px] shrink-0 items-center justify-end gap-2">
        {account && <span className="truncate text-[12px] text-[var(--text-secondary)]">{account}</span>}
        <RowAction status={status} />
      </div>
    </button>
  );
}

function RowAction({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)]">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "configured") return <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]">编辑</span>;
  if (status === "disabled") return <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]">重连</span>;
  return <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]">连接</span>;
}

function ChannelDetailPanel({
  platform,
  channel,
  authMode,
  onAuthModeChange,
  onDone,
}: {
  platform: PlatformDef;
  channel?: ChannelInfo;
  authMode: "qr" | "manual";
  onAuthModeChange: (mode: "qr" | "manual") => void;
  onDone: () => void;
}) {
  const connected = channel?.status === "running";
  const supportsQr = platformSupportsQr(platform);
  const formId = `channel-config-form-${platform.id}`;
  const account = channel?.account || platformDefaultAccount(platform, channel?.status ?? "idle");

  return (
    <div data-testid="channel-detail" className="flex min-h-[660px] flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[var(--shadow-sm)]">
      <div className="flex min-h-[86px] items-center justify-between gap-4 border-b border-[var(--border-default)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformIcon platform={platform} size="lg" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold text-[var(--text-primary)]">{platformDisplayName(platform)}</h2>
              <ChannelStatusPill status={channel?.status ?? "idle"} />
            </div>
            <p className="mt-1.5 truncate text-[13px] text-[var(--text-secondary)]">{platformSubtitle(platform)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {account && <span className="max-w-[180px] truncate text-[12px] font-medium text-[var(--text-secondary)]">{account}</span>}
          {connected ? <DisconnectChannelButton channel={platform.id} onDone={onDone} /> : null}
        </div>
      </div>

      <div className="flex h-11 items-end gap-5 border-b border-[var(--border-default)] px-5">
        {supportsQr && (
          <button
            type="button"
            onClick={() => onAuthModeChange("qr")}
            className={cn(
              "h-full border-b-2 px-5 text-[13px] font-semibold transition-colors",
              authMode === "qr" ? "border-[var(--brand-primary)] text-[var(--text-accent)]" : "border-transparent text-[var(--text-secondary)]",
            )}
          >
            扫码创建
          </button>
        )}
        <button
          type="button"
          onClick={() => onAuthModeChange("manual")}
          className={cn(
            "h-full border-b-2 px-5 text-[13px] font-semibold transition-colors",
            !supportsQr || authMode === "manual" ? "border-[var(--brand-primary)] text-[var(--text-accent)]" : "border-transparent text-[var(--text-secondary)]",
          )}
        >
          手动配置
        </button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 px-5 py-5 lg:grid-cols-[minmax(230px,1fr)_minmax(230px,0.82fr)]">
        <div className="min-w-0 space-y-5">
          {supportsQr && authMode === "qr" ? (
            <InlineQrSetupCard platform={platform} onDone={onDone} />
          ) : null}
          <CredentialConfigForm platform={platform} formId={formId} onDone={onDone} />
        </div>
        <PlatformGuide platform={platform} />
      </div>

      <div className="flex h-[60px] items-center justify-center gap-3 border-t border-[var(--border-default)] bg-[var(--surface-raised)] px-5">
        <Button type="submit" form={formId} className="h-9 w-[140px] rounded-lg bg-[var(--brand-primary)] text-[13px] font-semibold text-white hover:bg-[var(--brand-primary-hover)]">
          保存并连接
        </Button>
        {connected ? (
          <DisconnectChannelButton channel={platform.id} onDone={onDone} wide />
        ) : (
          <Button variant="outline" className="h-9 w-[130px] rounded-lg border-[var(--border-default)] text-[13px] font-semibold text-[var(--text-secondary)]" disabled>
            断开
          </Button>
        )}
      </div>
    </div>
  );
}

function InlineQrSetupCard({ platform, onDone }: { platform: PlatformDef; onDone: () => void }) {
  if (platform.id === "feishu") return <FeishuInlineQrCard onDone={onDone} />;
  return <WeixinInlineQrCard onDone={onDone} />;
}

function FeishuInlineQrCard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("settings");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const startQr = useStartFeishuQrRegistration();
  const cancelQr = useCancelFeishuQrRegistration();
  const statusQuery = useFeishuQrStatus(sessionId);
  const qrDataUrl = useQrDataUrl(scanUrl || "codata://feishu-bot-setup");

  useEffect(() => {
    if (statusQuery.data?.status === "confirmed") {
      toast.success(t("channelFeishuQrConfirmed", "Feishu connected"));
      setSessionId(null);
      setScanUrl(null);
      onDone();
    }
  }, [statusQuery.data?.status, onDone, t]);

  const handleStart = async () => {
    try {
      if (sessionId) await cancelQr.mutateAsync(sessionId).catch(() => undefined);
      const result = await startQr.mutateAsync({});
      setSessionId(result.session_id);
      setScanUrl(result.scan_url);
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelFeishuQrStartFailed", "Failed to start Feishu registration")));
    }
  };

  return (
    <QrSetupCard
      title="企业自建应用（推荐）"
      description="扫描二维码，创建飞书应用并授权"
      qrDataUrl={qrDataUrl}
      isStarting={startQr.isPending}
      onStart={handleStart}
      copyLabel="复制飞书权限"
    />
  );
}

function WeixinInlineQrCard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("settings");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const startQr = useStartWeixinQrLogin();
  const cancelQr = useCancelWeixinQrLogin();
  const statusQuery = useWeixinQrStatus(sessionId);
  const qrDataUrl = useQrDataUrl(scanUrl || "codata://weixin-bot-setup");

  useEffect(() => {
    if (statusQuery.data?.status === "confirmed") {
      toast.success(t("channelQrConfirmed", "WeChat connected"));
      setSessionId(null);
      setScanUrl(null);
      onDone();
    }
  }, [statusQuery.data?.status, onDone, t]);

  const handleStart = async () => {
    try {
      if (sessionId) await cancelQr.mutateAsync(sessionId).catch(() => undefined);
      const result = await startQr.mutateAsync({});
      setSessionId(result.session_id);
      setScanUrl(result.scan_url);
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelQrStartFailed", "Failed to start QR login")));
    }
  };

  return (
    <QrSetupCard
      title="扫码登录（推荐）"
      description="扫描二维码，连接微信服务号"
      qrDataUrl={qrDataUrl}
      isStarting={startQr.isPending}
      onStart={handleStart}
      copyLabel="复制连接信息"
    />
  );
}

function QrSetupCard({
  title,
  description,
  qrDataUrl,
  isStarting,
  onStart,
  copyLabel,
}: {
  title: string;
  description: string;
  qrDataUrl: string | null;
  isStarting: boolean;
  onStart: () => void;
  copyLabel: string;
}) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(FEISHU_SCOPES_JSON);
    toast.success("已复制");
  };

  return (
    <div className="flex min-h-[276px] flex-col items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-5 py-5 text-center">
      <div className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</div>
      <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{description}</p>
      <div className="mt-4 flex h-[118px] w-[118px] items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-2">
        {qrDataUrl ? (
          // QR codes are generated as client-only data URLs, so Next image optimization does not apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="channel qr code" className="h-full w-full" />
        ) : (
          <QrCode className="h-10 w-10 text-[var(--text-tertiary)]" />
        )}
      </div>
      <Button className="mt-4 h-8 w-[168px] rounded-lg bg-[var(--surface-raised)] text-[12px] font-semibold text-[var(--text-accent)] ring-1 ring-[var(--brand-primary)] hover:bg-[var(--brand-soft-hover)]" onClick={onStart} disabled={isStarting}>
        {isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
        扫描二维码创建
      </Button>
      <button type="button" className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-accent)]" onClick={handleCopy}>
        <Copy className="h-3.5 w-3.5" />
        {copyLabel}
      </button>
    </div>
  );
}

function CredentialConfigForm({ platform, formId, onDone }: { platform: PlatformDef; formId: string; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const addChannel = useAddChannel();

  useEffect(() => {
    setValues({});
    setShowSecret({});
    setError(null);
  }, [platform.id]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { channel: platform.id };
    for (const field of platform.fields || []) {
      const value = values[field.key]?.trim() ?? "";
      const required = field.required !== false && !(platform.id === "weixin" && platform.auth === "qr");
      if (!value && required) {
        setError(t("channelFieldRequired", { field: fieldLabel(t, platform.id, field) }));
        return;
      }
      if (value) body[field.key] = value;
    }

    addChannel.mutate(body, {
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(result.message || t("channelConnected", "Channel connected"));
          onDone();
        } else {
          setError(result.message);
        }
      },
      onError: (err) => setError(apiErrorMessage(err, t("channelConnectFailed", "Failed to connect channel"))),
    });
  };

  return (
    <form id={formId} className="space-y-2.5" onSubmit={handleSubmit}>
      <div className="text-[13px] font-semibold text-[var(--text-primary)]">凭证配置</div>
      <div className="space-y-2.5">
        {platform.fields?.map((field) => (
          <FieldInput
            key={field.key}
            platformId={platform.id}
            field={field}
            value={values[field.key] || ""}
            showSecret={!!showSecret[field.key]}
            onToggleSecret={() => setShowSecret((current) => ({ ...current, [field.key]: !current[field.key] }))}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
      </div>
      {error && <p className="text-[12px] text-red-500">{error}</p>}
      {addChannel.isPending && (
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在连接
        </div>
      )}
    </form>
  );
}

function FieldInput({
  platformId,
  field,
  value,
  showSecret,
  onToggleSecret,
  onChange,
}: {
  platformId: string;
  field: PlatformFieldDef;
  value: string;
  showSecret: boolean;
  onToggleSecret: () => void;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">{fieldLabel(t, platformId, field)}</span>
      <span className="relative block">
        <Input
          type={field.secret && !showSecret ? "password" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          autoComplete="one-time-code"
          className={cn("h-8 rounded-md border-[var(--border-default)] bg-[var(--surface-raised)] text-[12px] placeholder:text-[var(--text-tertiary)]", field.secret && "pr-9")}
        />
        {field.secret && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            onClick={onToggleSecret}
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </span>
    </label>
  );
}

function PlatformGuide({ platform }: { platform: PlatformDef }) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);
  const guide = platform.guide ?? [];

  const handleCopyScopes = async () => {
    await navigator.clipboard.writeText(FEISHU_SCOPES_JSON);
    setCopied(true);
    toast.success(t("channelCopied", "Copied"));
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <aside className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
      <div className="text-[14px] font-semibold text-[var(--text-primary)]">配置引导</div>
      <p className="mt-1.5 text-[12px] text-[var(--text-secondary)]">{platformSubtitle(platform)}</p>

      <div className="mt-5 space-y-5">
        {platform.id === "feishu" ? (
          <>
            <GuideStep index={1} title="创建飞书应用" body="扫描二维码或进入飞书开放平台创建自建应用。">
              <a href={platform.helpUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--text-accent)]">
                打开控制台
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </GuideStep>
            <GuideStep index={2} title="配置机器人" body="在应用中添加机器人，并设置消息与事件订阅。" />
            <GuideStep index={3} title="授权权限" body="复制以下权限范围并在飞书应用中完成授权。">
              <div className="mt-2 min-w-0 overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] p-2.5 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1 overflow-x-auto pr-1">
                    {FEISHU_SCOPES.map((scope) => (
                      <div key={scope} className="whitespace-nowrap">
                        {scope}
                      </div>
                    ))}
                  </div>
                  <button type="button" className="shrink-0 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--brand-soft-hover)]" onClick={handleCopyScopes}>
                    {copied ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </GuideStep>
            <GuideStep index={4} title="填写凭证" body="将 App ID、App Secret、Token 和 Encrypt Key 填入左侧表单并保存连接。" />
          </>
        ) : (
          guide.map((step: PlatformGuideStep, index) => (
            <GuideStep key={step.titleKey} index={index + 1} title={t(step.titleKey)} body={t(step.bodyKey)}>
              {step.href && (
                <a href={step.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--text-accent)]">
                  打开控制台
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </GuideStep>
          ))
        )}
      </div>
    </aside>
  );
}

function GuideStep({ index, title, body, children }: { index: number; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-3">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--text-accent)]">{index}</span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-[var(--text-primary)]">{title}</div>
        <p className="mt-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">{body}</p>
        {children}
      </div>
    </div>
  );
}

function DisconnectChannelButton({ channel, onDone, wide }: { channel: string; onDone: () => void; wide?: boolean }) {
  const { t } = useTranslation("settings");
  const removeChannel = useRemoveChannel();

  const handleRemove = async () => {
    try {
      const result = await removeChannel.mutateAsync({ channel });
      toast.info(result.message || t("channelRemoved"));
      setTimeout(onDone, 500);
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelDisconnectFailed", "Failed to disconnect channel")));
    }
  };

  return (
    <Button
      variant="outline"
      className={cn(
        "h-8 rounded-lg border-[var(--border-default)] text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--color-destructive-soft)] hover:text-[var(--color-destructive)]",
        wide ? "w-[130px]" : "px-4",
      )}
      disabled={removeChannel.isPending}
      onClick={handleRemove}
    >
      {removeChannel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : wide ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5 text-[var(--color-destructive)]" />}
      断开
    </Button>
  );
}

function ChannelStatusPill({ status }: { status?: string }) {
  if (status === "running") return <StatusPill tone="success">已连接</StatusPill>;
  if (status === "configured") return <StatusPill tone="brand">已配置</StatusPill>;
  if (status === "disabled") return <StatusPill>已停用</StatusPill>;
  return <StatusPill>未配置</StatusPill>;
}

function PlatformIcon({ platform, size }: { platform: PlatformDef; size: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)]",
        platform.color,
        size === "lg" ? "h-11 w-11" : "h-9 w-9",
      )}
    >
      {platform.icon}
    </span>
  );
}

function platformSupportsQr(platform: PlatformDef): boolean {
  return platform.id === "feishu" || platform.id === "weixin";
}

function platformDisplayName(platform: PlatformDef): string {
  switch (platform.id) {
    case "feishu":
      return "飞书";
    case "weixin":
      return "微信";
    case "wecom":
      return "企业微信";
    case "dingtalk":
      return "钉钉";
    default:
      return platform.name;
  }
}

function platformSubtitle(platform: PlatformDef): string {
  switch (platform.id) {
    case "feishu":
      return "与飞书机器人连接";
    case "weixin":
      return "与微信服务号连接";
    case "wecom":
      return "与企业微信机器人连接";
    case "dingtalk":
      return "与钉钉机器人连接";
    case "telegram":
      return "与 Telegram Bot 连接";
    case "qq":
      return "与 QQ 机器人连接";
    default:
      return platform.help;
  }
}

function platformDefaultAccount(platform: PlatformDef, status: string): string {
  if (status === "running" && platform.id === "feishu") return "codata-bot";
  if (status === "configured" && platform.id === "weixin") return "Codata 服务号";
  return "";
}

function fieldLabel(_t: ReturnType<typeof useTranslation<"settings">>["t"], _platformId: string, field: PlatformFieldDef) {
  return field.label;
}

function useQrDataUrl(scanUrl: string | null) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!scanUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(scanUrl, { width: 256, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scanUrl]);

  return qrDataUrl;
}
