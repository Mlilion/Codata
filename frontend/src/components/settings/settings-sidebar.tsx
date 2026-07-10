"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useIsMacOS } from "@/hooks/use-platform";
import { useEffectiveSidebarWidth } from "@/hooks/use-effective-sidebar-width";
import { IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";
import { useSidebarStore } from "@/stores/sidebar-store";
import { SidebarResizeHandle } from "@/components/layout/sidebar-resize-handle";
import { SETTINGS_GROUPS, SETTINGS_TABS, type SettingsGroupId, type SettingsTabId } from "./settings-tabs";

type SettingsTabItem = (typeof SETTINGS_TABS)[number];

export function SettingsSidebar() {
  const { t } = useTranslation(["settings"]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawActiveTab = searchParams.get("tab");
  const activeTab: SettingsTabId = SETTINGS_TABS.some((tab) => tab.id === rawActiveTab)
    ? (rawActiveTab as SettingsTabId)
    : "general";
  const isMac = useIsMacOS();
  const requestedSidebarWidth = useSidebarStore((s) => s.width);
  const sidebarWidth = useEffectiveSidebarWidth(requestedSidebarWidth);
  const [query, setQuery] = useState("");

  const navigateTab = useCallback(
    (tab: string) => {
      router.replace(`/settings?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTabs = useMemo(() => {
    if (!normalizedQuery) return SETTINGS_TABS;
    return SETTINGS_TABS.filter((tab) => {
      const haystack = [
        t(`settings:${tab.labelKey}`),
        t(`settings:${tab.descKey}`),
        t(`settings:${tab.keywordsKey}`),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, t]);
  const tabsByGroup = useMemo(() => {
    const grouped: Record<SettingsGroupId, SettingsTabItem[]> = {
      core: [],
      ai: [],
      workspace: [],
      system: [],
    };
    filteredTabs.forEach((tab) => {
      grouped[tab.group].push(tab);
    });
    return grouped;
  }, [filteredTabs]);

  return (
    <aside
      aria-label="Settings sidebar"
      className="sidebar-glass fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-[var(--sidebar-translucent-bg)] backdrop-blur-xl"
      style={{ width: sidebarWidth, top: topOffset }}
    >
      <SidebarResizeHandle />
      <div
        data-tauri-drag-region
        className="flex items-center"
        style={
          IS_DESKTOP && isMac
            ? { height: 60, paddingLeft: 91, paddingRight: 16 }
            : { height: 56, paddingTop: 4, paddingLeft: 16, paddingRight: 16 }
        }
      >
        <Link
          href="/c/new"
          className="flex items-center gap-2 text-ui-body text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings:backToApp")}
        </Link>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings:settingsSearchPlaceholder")}
            className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] pl-9 pr-8 text-ui-caption text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]"
              aria-label={t("settings:settingsSearchClear")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-auto">
        {SETTINGS_GROUPS.map((group) => {
          const tabs = tabsByGroup[group.id];
          if (tabs.length === 0) return null;
          return (
            <div key={group.id} className="mb-4">
              <div className="px-3 pb-1 text-ui-2xs font-semibold uppercase text-[var(--text-tertiary)]">
                {t(`settings:${group.labelKey}`)}
              </div>
              <div className="space-y-0.5">
                {tabs.map(({ id, icon: Icon, labelKey, descKey }) => (
                  <button
                    key={id}
                    onClick={() => navigateTab(id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      activeTab === id
                        ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] shadow-[var(--sidebar-active-shadow)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    <Icon className="mt-0.5 h-[16px] w-[16px] shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-ui-body font-medium">
                        {t(`settings:${labelKey}`)}
                      </span>
                      <span className="mt-0.5 block truncate text-ui-2xs text-[var(--text-tertiary)]">
                        {t(`settings:${descKey}`)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {filteredTabs.length === 0 && (
          <div className="px-3 py-8 text-center text-ui-caption text-[var(--text-tertiary)]">
            {t("settings:settingsSearchEmpty")}
          </div>
        )}
      </nav>
    </aside>
  );
}
