/** Channel (messaging platform) types */

export interface ChannelInfo {
  id: string;
  name: string;
  status: "running" | "configured" | "disabled" | string;
  type: string;
  account?: string;
}

export interface ChannelsResponse {
  channels: Record<string, ChannelInfo>;
  gateway_running: boolean;
  error?: string;
}

export interface PlatformFieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
}

export interface PlatformDef {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  auth: "qr" | "token";
  help: string;
  helpUrl?: string;
  fields?: PlatformFieldDef[];
  guide?: PlatformGuideStep[];
}

export interface PlatformGuideStep {
  titleKey: string;
  bodyKey: string;
  href?: string;
}

export interface WeixinQrStartResponse {
  session_id: string;
  scan_url: string;
  expires_at: number;
  status: "waiting_scan";
}

export interface WeixinQrStatusResponse {
  session_id: string;
  status: "waiting_scan" | "scanned" | "confirmed" | "expired" | "error";
  message?: string | null;
  account?: string | null;
  expires_at?: number | null;
}

export type FeishuQrStartResponse = WeixinQrStartResponse;

export interface FeishuQrStatusResponse {
  session_id: string;
  status: "waiting_scan" | "confirmed" | "expired" | "error";
  message?: string | null;
  account?: string | null;
  expires_at?: number | null;
  provider_status?: "polling" | "slow_down" | "domain_switched" | null;
  interval?: number | null;
}
