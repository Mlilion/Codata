"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  Settings2,
  Unplug,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

/* ------------------------------------------------------------------ */
/* Tab content (embedded in Settings)                                  */
/* ------------------------------------------------------------------ */

export function RemoteTabContent() {
  return <ChannelsSection />;
}

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

const PLATFORMS: PlatformDef[] = [
  {
    id: "dingtalk",
    name: "DingTalk",
    icon: <DingTalkIcon size={20} />,
    color: "text-[#0089FF]",
    auth: "token",
    help: "Create a bot at DingTalk Open Platform",
    helpUrl: "https://open-dev.dingtalk.com",
    fields: [
      { key: "client_id", label: "Client ID / App Key", placeholder: "Enter DingTalk client ID or app key" },
      { key: "client_secret", label: "Client Secret / App Secret", placeholder: "Enter DingTalk client secret or app secret", secret: true },
    ],
    guide: [
      { titleKey: "platformGuide_dingtalk_1_title", bodyKey: "platformGuide_dingtalk_1_body", href: "https://open-dev.dingtalk.com" },
      { titleKey: "platformGuide_dingtalk_2_title", bodyKey: "platformGuide_dingtalk_2_body" },
      { titleKey: "platformGuide_dingtalk_3_title", bodyKey: "platformGuide_dingtalk_3_body" },
    ],
  },
  {
    id: "feishu",
    name: "Feishu",
    icon: <FeishuIcon size={20} />,
    color: "text-[#3370FF]",
    auth: "token",
    help: "Create an app at Feishu Open Platform",
    helpUrl: "https://open.feishu.cn/app",
    fields: [
      { key: "app_id", label: "App ID", placeholder: "cli_xxxxx" },
      { key: "app_secret", label: "App Secret", placeholder: "Enter app secret", secret: true },
      { key: "verification_token", label: "Verification Token", placeholder: "Optional verification token", secret: true, required: false },
      { key: "encrypt_key", label: "Encrypt Key", placeholder: "Optional encrypt key", secret: true, required: false },
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
    icon: <WeChatIcon size={20} />,
    color: "text-[#07C160]",
    auth: "qr",
    help: "Use iLink QR login or paste a WeChat bot token",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "Paste WeChat bot token", secret: true, required: false },
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
    icon: <WeComIcon size={20} />,
    color: "text-[#0082EF]",
    auth: "token",
    help: "Create an AI Bot at WeCom Admin Console",
    fields: [
      { key: "bot_id", label: "Bot ID", placeholder: "Enter WeCom bot ID" },
      { key: "secret", label: "Secret", placeholder: "Enter WeCom bot secret", secret: true },
      { key: "welcome_message", label: "Welcome Message", placeholder: "Optional welcome message", required: false },
    ],
    guide: [
      { titleKey: "platformGuide_wecom_1_title", bodyKey: "platformGuide_wecom_1_body" },
      { titleKey: "platformGuide_wecom_2_title", bodyKey: "platformGuide_wecom_2_body" },
    ],
  },
  {
    id: "qq",
    name: "QQ",
    icon: <QQIcon size={20} />,
    color: "text-[#12B7F5]",
    auth: "token",
    help: "Create a bot at QQ Open Platform",
    helpUrl: "https://q.qq.com",
    fields: [
      { key: "app_id", label: "App ID", placeholder: "Enter QQ app ID" },
      { key: "secret", label: "Secret", placeholder: "Enter QQ app secret", secret: true },
    ],
    guide: [
      { titleKey: "platformGuide_qq_1_title", bodyKey: "platformGuide_qq_1_body", href: "https://q.qq.com" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: <TelegramIcon size={20} />,
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
];

function ChannelsSection() {
  const { t } = useTranslation("settings");
  const { data: channelsData, isLoading, refetch } = useChannels();
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const channels = channelsData?.channels ?? {};
  const configuredCount = Object.values(channels).filter((ch) => ch.status !== "disabled").length;
  const runningCount = Object.values(channels).filter((ch) => ch.status === "running").length;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("channelsTitle")}</h2>
            <p className="text-xs leading-5 text-[var(--text-secondary)]">{t("channelsDesc")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            {t("channelRefresh", "Refresh")}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <SystemMetric label={t("channelSystem", "Channel System")} value={t("channelSystemBuiltIn", { count: configuredCount })} tone="neutral" />
          <SystemMetric label={t("channelRunning", "Running")} value={String(runningCount)} tone="success" />
          <SystemMetric label={t("channelSupported", "Supported")} value={String(PLATFORMS.length)} tone="accent" />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const channel = channels[platform.id];
          const isExpanded = expandedPlatform === platform.id;
          return (
            <PlatformCard
              key={platform.id}
              platform={platform}
              channel={channel}
              expanded={isExpanded}
              onToggleExpanded={() => setExpandedPlatform(isExpanded ? null : platform.id)}
              onDone={() => {
                setExpandedPlatform(null);
                refetch();
              }}
            />
          );
        })}
      </section>
    </div>
  );
}

function SystemMetric({ label, value, tone }: { label: string; value: string; tone: "neutral" | "success" | "accent" }) {
  const dotClass = tone === "success" ? "bg-emerald-500" : tone === "accent" ? "bg-blue-500" : "bg-[var(--text-tertiary)]";
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        <span className="text-ui-3xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">{label}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function PlatformCard({
  platform,
  channel,
  expanded,
  onToggleExpanded,
  onDone,
}: {
  platform: PlatformDef;
  channel?: ChannelInfo;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("settings");
  const connected = channel?.status === "running";
  const disabled = channel?.status === "disabled";
  const configured = !!channel && !connected && !disabled;
  const mode: "connect" | "edit" = disabled ? "edit" : "connect";

  return (
    <div
      className={cn(
        "rounded-lg border bg-[var(--surface-primary)] transition-colors",
        connected && "border-emerald-500/35 bg-emerald-500/5",
        configured && "border-amber-500/35 bg-amber-500/5",
        !connected && !configured && "border-[var(--border-default)]",
        expanded && "md:col-span-2",
      )}
    >
      <div className="flex min-h-[86px] items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-secondary)]", platform.color)}>
            {platform.icon}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{platform.name}</h3>
              <ChannelStatusBadge status={channel?.status} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{t(`platformHelp_${platform.id}`, platform.help)}</p>
            {channel?.account && (
              <p className="mt-1 truncate text-ui-3xs text-[var(--text-tertiary)]">{channel.account}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <RemoveChannelButton channel={platform.id} onRemoved={onDone} />
          ) : disabled ? (
            <>
              <ReconnectChannelButton channel={platform.id} onDone={onDone} />
              <Button variant="outline" size="sm" className="h-8 px-2.5 text-ui-2xs" onClick={onToggleExpanded}>
                <Settings2 className="h-3.5 w-3.5" />
                {expanded ? t("channelCancel") : t("channelEdit")}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="h-8 px-2.5 text-ui-2xs" onClick={onToggleExpanded}>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
              {expanded ? t("channelCancel") : configured ? t("channelConfigure") : t("channelConnect")}
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border-default)] p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <ChannelForm platform={platform} mode={mode} onDone={onDone} />
            <PlatformGuide platform={platform} />
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelStatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation("settings");
  if (status === "running") {
    return <Badge className="h-5 px-2 text-ui-3xs" variant="success">{t("channelStatusRunning", "Connected")}</Badge>;
  }
  if (status === "configured") {
    return <Badge className="h-5 px-2 text-ui-3xs" variant="warning">{t("channelStatusConfigured", "Configured")}</Badge>;
  }
  if (status === "disabled") {
    return <Badge className="h-5 px-2 text-ui-3xs" variant="secondary">{t("channelStatusDisabled", "Disabled")}</Badge>;
  }
  return <Badge className="h-5 px-2 text-ui-3xs" variant="outline">{t("channelStatusIdle", "Not configured")}</Badge>;
}

function ChannelForm({ platform, mode, onDone }: { platform: PlatformDef; mode: "connect" | "edit"; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const addChannel = useAddChannel();

  const handleSubmit = async () => {
    setError(null);
    const body: Record<string, unknown> = { channel: platform.id };
    for (const field of platform.fields || []) {
      const value = values[field.key]?.trim() ?? "";
      const required = field.required !== false && !(platform.id === "weixin" && platform.auth === "qr");
      if (!value && required && mode === "connect") {
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
    <div className="space-y-4">
      {platform.id === "feishu" && <FeishuQrPanel onConnected={onDone} />}

      {platform.id === "weixin" && platform.auth === "qr" && (
        <WeixinQrPanel
          baseUrl={values.base_url}
          routeTag={values.route_tag}
          onConnected={onDone}
        />
      )}

      <div className="space-y-2 rounded-lg border border-[var(--border-default)] p-3">
        <div>
          <div className="text-xs font-medium text-[var(--text-primary)]">
            {platform.auth === "qr" ? t("channelManualConfig", "Manual configuration") : t("channelCredentialConfig", "Credential configuration")}
          </div>
          <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-tertiary)]">
            {platform.auth === "qr"
              ? t("channelManualConfigDesc", "Use this if QR login is unavailable or you already have an iLink token.")
              : t("channelCredentialConfigDesc", "Credentials are saved in the local channel configuration. Disconnect before editing a running channel.")}
          </p>
        </div>

        <div className="space-y-[10px]">
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

        {error && <p className="text-ui-2xs text-red-500">{error}</p>}

        <Button size="sm" className="h-8 w-full text-ui-2xs" onClick={handleSubmit} disabled={addChannel.isPending}>
          {addChannel.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("channelConnecting")}
            </>
          ) : mode === "edit" ? (
            t("channelSaveAndConnect")
          ) : (
            t("channelConnect")
          )}
        </Button>
      </div>
    </div>
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
    <label className="block space-y-1">
      <span className="text-ui-3xs font-medium text-[var(--text-tertiary)]">{fieldLabel(t, platformId, field)}</span>
      <span className="relative block">
        <Input
          type={field.secret && !showSecret ? "password" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t(`fieldPlaceholder_${platformId}_${field.key}`, field.placeholder)}
          autoComplete="one-time-code"
          className={cn("h-8 text-xs", field.secret && "pr-9")}
        />
        {field.secret && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            onClick={onToggleSecret}
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </span>
    </label>
  );
}

function fieldLabel(t: ReturnType<typeof useTranslation<"settings">>["t"], platformId: string, field: PlatformFieldDef) {
  return t(`fieldLabel_${platformId}_${field.key}`, t(`fieldLabel_${field.key}`, field.label));
}

function useQrDataUrl(scanUrl: string | null) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!scanUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(scanUrl, { width: 256, margin: 2, errorCorrectionLevel: "M" })
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

function WeixinQrPanel({ baseUrl, routeTag, onConnected }: { baseUrl?: string; routeTag?: string; onConnected: () => void }) {
  const { t } = useTranslation("settings");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const startQr = useStartWeixinQrLogin();
  const cancelQr = useCancelWeixinQrLogin();
  const statusQuery = useWeixinQrStatus(sessionId);
  const qrStatus = statusQuery.data?.status;
  const qrDataUrl = useQrDataUrl(scanUrl);

  useEffect(() => {
    if (qrStatus === "confirmed") {
      toast.success(t("channelQrConfirmed", "WeChat connected"));
      setSessionId(null);
      setDialogOpen(false);
      onConnected();
    }
  }, [qrStatus, onConnected, t]);

  const handleStart = async () => {
    try {
      if (sessionId) await cancelQr.mutateAsync(sessionId).catch(() => undefined);
      const result = await startQr.mutateAsync({
        base_url: baseUrl?.trim() || undefined,
        route_tag: routeTag?.trim() || undefined,
      });
      setSessionId(result.session_id);
      setScanUrl(result.scan_url);
      setDialogOpen(true);
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelQrStartFailed", "Failed to start QR login")));
    }
  };

  const handleCancel = async () => {
    if (sessionId) await cancelQr.mutateAsync(sessionId).catch(() => undefined);
    setSessionId(null);
    setDialogOpen(false);
  };

  const statusText =
    qrStatus === "scanned"
      ? t("channelQrScanned", "Scanned. Confirm on your phone.")
      : qrStatus === "expired"
        ? t("channelQrExpired", "QR code expired. Refresh to try again.")
        : qrStatus === "error"
          ? statusQuery.data?.message || t("channelQrError", "QR login failed")
          : t("channelQrWaiting", "Open WeChat and scan the QR code.");

  return (
    <ChannelQrPanel
      accentClass="text-[#07C160]"
      containerClass="border-[#07C160]/25 bg-[#07C160]/5"
      title={t("channelWeixinQrTitle", "WeChat QR login")}
      description={t("channelWeixinQrDesc", "Scan to obtain an iLink bot token and start the WeChat channel.")}
      actionLabel={t("channelScanLogin", "Scan login")}
      qrAlt={t("channelWeixinQrAlt", "WeChat login QR code")}
      status={qrStatus}
      statusText={statusText}
      scanUrl={scanUrl}
      qrDataUrl={qrDataUrl}
      dialogOpen={dialogOpen}
      isStarting={startQr.isPending}
      onStart={handleStart}
      onDialogOpenChange={(open) => {
        if (open) setDialogOpen(true);
        else void handleCancel();
      }}
    />
  );
}

function FeishuQrPanel({ onConnected }: { onConnected: () => void }) {
  const { t } = useTranslation("settings");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const startQr = useStartFeishuQrRegistration();
  const cancelQr = useCancelFeishuQrRegistration();
  const statusQuery = useFeishuQrStatus(sessionId);
  const qrStatus = statusQuery.data?.status;
  const providerStatus = statusQuery.data?.provider_status;
  const qrDataUrl = useQrDataUrl(scanUrl);

  useEffect(() => {
    if (qrStatus === "confirmed") {
      toast.success(t("channelFeishuQrConfirmed", "Feishu connected"));
      setSessionId(null);
      setDialogOpen(false);
      onConnected();
    }
  }, [qrStatus, onConnected, t]);

  const handleStart = async () => {
    try {
      if (sessionId) await cancelQr.mutateAsync(sessionId).catch(() => undefined);
      const result = await startQr.mutateAsync({});
      setSessionId(result.session_id);
      setScanUrl(result.scan_url);
      setDialogOpen(true);
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelFeishuQrStartFailed", "Failed to start Feishu registration")));
    }
  };

  const handleCancel = async () => {
    if (sessionId) await cancelQr.mutateAsync(sessionId).catch(() => undefined);
    setSessionId(null);
    setDialogOpen(false);
  };

  const statusText =
    qrStatus === "expired"
      ? t("channelQrExpired", "QR code expired. Refresh to try again.")
      : qrStatus === "error"
        ? statusQuery.data?.message || t("channelFeishuQrError", "Feishu registration failed")
        : providerStatus === "slow_down"
          ? t("channelFeishuQrSlowDown", "Polling slowed down automatically.")
          : providerStatus === "domain_switched"
            ? t("channelFeishuQrDomainSwitched", "Switched to the Lark domain.")
            : t("channelFeishuQrWaiting", "Use Feishu to scan and complete app creation.");

  return (
    <ChannelQrPanel
      accentClass="text-[#3370FF]"
      containerClass="border-[#3370FF]/25 bg-[#3370FF]/5"
      title={t("channelFeishuQrTitle", "Create Feishu Bot by QR")}
      description={t("channelFeishuQrDesc", "Codata creates a PersonalAgent app after you scan, then saves App ID and App Secret automatically.")}
      actionLabel={t("channelFeishuQrAction", "Scan to create")}
      qrAlt={t("channelFeishuQrAlt", "Feishu app registration QR code")}
      status={qrStatus}
      statusText={statusText}
      scanUrl={scanUrl}
      qrDataUrl={qrDataUrl}
      dialogOpen={dialogOpen}
      isStarting={startQr.isPending}
      onStart={handleStart}
      onDialogOpenChange={(open) => {
        if (open) setDialogOpen(true);
        else void handleCancel();
      }}
    />
  );
}

function ChannelQrPanel({
  accentClass,
  containerClass,
  title,
  description,
  actionLabel,
  qrAlt,
  status,
  statusText,
  scanUrl,
  qrDataUrl,
  dialogOpen,
  isStarting,
  onStart,
  onDialogOpenChange,
}: {
  accentClass: string;
  containerClass: string;
  title: string;
  description: string;
  actionLabel: string;
  qrAlt: string;
  status?: string;
  statusText: string;
  scanUrl: string | null;
  qrDataUrl: string | null;
  dialogOpen: boolean;
  isStarting: boolean;
  onStart: () => void | Promise<void>;
  onDialogOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const statusIcon =
    status === "confirmed" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : status === "scanned" ? (
      <CheckCircle2 className="h-4 w-4 text-blue-500" />
    ) : status === "expired" || status === "error" ? (
      <XCircle className="h-4 w-4 text-red-500" />
    ) : (
      <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
    );

  return (
    <div className={cn("rounded-lg border p-3", containerClass)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-[var(--shadow-sm)]", accentClass)}>
            <QrCode className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--text-primary)]">{title}</div>
            <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-secondary)]">{description}</p>
          </div>
        </div>
        <Button size="sm" className="h-8 text-ui-2xs" onClick={onStart} disabled={isStarting}>
          {isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
          {actionLabel}
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className={cn("h-4 w-4", accentClass)} />
              {title}
            </DialogTitle>
            <DialogDescription>{statusText}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2">
            <div className="flex h-[256px] w-[256px] items-center justify-center rounded-xl bg-white p-3 shadow-[var(--shadow-sm)]">
              {qrDataUrl ? (
                // QR codes are generated as client-only data URLs, so Next image optimization does not apply.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt={qrAlt} className="h-full w-full" />
              ) : (
                <div className="px-4 text-center text-xs text-slate-500">
                  {scanUrl ? t("channelQrGenerating", "Generating QR code...") : t("channelQrNoCode", "No QR code")}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              {statusIcon}
              <span>{statusText}</span>
            </div>

            <div className="flex w-full gap-2">
              <Button variant="outline" size="sm" className="h-8 flex-1 text-ui-2xs" onClick={onStart} disabled={isStarting}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("channelQrRefresh", "Refresh")}
              </Button>
              {scanUrl && (
                <Button variant="outline" size="sm" className="h-8 flex-1 text-ui-2xs" asChild>
                  <a href={scanUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("channelOpenLink", "Open link")}
                  </a>
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
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
    <aside className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
      <div>
        <div className="text-xs font-medium text-[var(--text-primary)]">{t("channelSetupGuide", "Setup guide")}</div>
        <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-tertiary)]">{t(`platformHelp_${platform.id}`, platform.help)}</p>
      </div>

      {guide.length > 0 && (
        <div className="space-y-3">
          {guide.map((step: PlatformGuideStep, index) => (
            <div key={step.titleKey} className="grid grid-cols-[20px_1fr] gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-primary)] text-ui-3xs font-semibold text-[var(--text-secondary)]">
                {index + 1}
              </span>
              <div>
                <div className="text-ui-2xs font-medium text-[var(--text-primary)]">{t(step.titleKey)}</div>
                <p className="mt-0.5 text-ui-3xs leading-5 text-[var(--text-secondary)]">{t(step.bodyKey)}</p>
                {step.href && (
                  <a href={step.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-ui-3xs text-[var(--brand-primary)] hover:underline">
                    {t("channelOpenConsole", "Open console")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {platform.id === "feishu" && (
        <Button variant="outline" size="sm" className="h-8 w-full text-ui-2xs" onClick={handleCopyScopes}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("channelCopied", "Copied") : t("channelCopyFeishuScopes", "Copy Feishu scopes")}
        </Button>
      )}

      {platform.helpUrl && (
        <Button variant="outline" size="sm" className="h-8 w-full text-ui-2xs" asChild>
          <a href={platform.helpUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            {t("channelDocumentation", "Documentation")}
          </a>
        </Button>
      )}
    </aside>
  );
}

function ReconnectChannelButton({ channel, onDone }: { channel: string; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const addChannel = useAddChannel();

  const handleReconnect = async () => {
    try {
      const result = await addChannel.mutateAsync({ channel });
      toast.success(result.message || t("channelConnected", "Channel connected"));
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelConnectFailed", "Failed to connect channel")));
    } finally {
      setTimeout(onDone, 500);
    }
  };

  return (
    <Button variant="outline" size="sm" className="h-8 px-2.5 text-ui-2xs" disabled={addChannel.isPending} onClick={handleReconnect}>
      {addChannel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
      {t("channelConnect")}
    </Button>
  );
}

function RemoveChannelButton({ channel, onRemoved }: { channel: string; onRemoved: () => void }) {
  const { t } = useTranslation("settings");
  const removeChannel = useRemoveChannel();

  const handleRemove = async () => {
    try {
      const result = await removeChannel.mutateAsync({ channel });
      toast.info(result.message || t("channelRemoved"));
      setTimeout(onRemoved, 500);
    } catch (err) {
      toast.error(apiErrorMessage(err, t("channelDisconnectFailed", "Failed to disconnect channel")));
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 px-2.5 text-ui-2xs text-red-500 hover:bg-red-500/10"
      aria-label={t("channelDisconnect")}
      disabled={removeChannel.isPending}
      onClick={handleRemove}
    >
      {removeChannel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PowerOff className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{t("channelDisconnect")}</span>
      <Unplug className="h-3.5 w-3.5 sm:hidden" />
    </Button>
  );
}
