import {
  Settings,
  Cpu,
  Plug,
  MessageSquare,
  BarChart3,
  Brain,
  ShieldCheck,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SettingsGroupId = "core" | "ai" | "workspace" | "system";

export interface SettingsTab {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  descKey: string;
  group: SettingsGroupId;
  keywordsKey: string;
}

export const SETTINGS_TABS = [
  { id: "general", icon: Settings, labelKey: "tabGeneral", descKey: "tabGeneralDesc", group: "core", keywordsKey: "tabGeneralKeywords" },
  { id: "providers", icon: Cpu, labelKey: "tabProviders", descKey: "tabProvidersDesc", group: "ai", keywordsKey: "tabProvidersKeywords" },
  { id: "permissions", icon: ShieldCheck, labelKey: "tabPermissions", descKey: "tabPermissionsDesc", group: "ai", keywordsKey: "tabPermissionsKeywords" },
  { id: "plugins", icon: Plug, labelKey: "tabPlugins", descKey: "tabPluginsDesc", group: "workspace", keywordsKey: "tabPluginsKeywords" },
  { id: "remote", icon: MessageSquare, labelKey: "tabRemote", descKey: "tabRemoteDesc", group: "workspace", keywordsKey: "tabRemoteKeywords" },
  { id: "usage", icon: BarChart3, labelKey: "tabUsage", descKey: "tabUsageDesc", group: "workspace", keywordsKey: "tabUsageKeywords" },
  { id: "memory", icon: Brain, labelKey: "tabMemory", descKey: "tabMemoryDesc", group: "workspace", keywordsKey: "tabMemoryKeywords" },
  { id: "about", icon: Info, labelKey: "tabAbout", descKey: "tabAboutDesc", group: "system", keywordsKey: "tabAboutKeywords" },
] as const satisfies readonly SettingsTab[];

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const SETTINGS_GROUPS: { id: SettingsGroupId; labelKey: string }[] = [
  { id: "core", labelKey: "settingsGroupCore" },
  { id: "ai", labelKey: "settingsGroupAI" },
  { id: "workspace", labelKey: "settingsGroupWorkspace" },
  { id: "system", labelKey: "settingsGroupSystem" },
];
