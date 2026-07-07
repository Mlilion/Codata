"use client";

import {
  BookOpen,
  ChevronRight,
  Download,
  Moon,
  RefreshCw,
  Settings,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useUpdateCheck } from "@/hooks/use-update-check";
import { useSidebarStore } from "@/stores/sidebar-store";
import { IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";
import { cn } from "@/lib/utils";

const USER_GUIDE_URL = "https://example.com/codata-office-user-guide.html";

export function SidebarFooter() {
  const { t } = useTranslation(["common", "settings"]);
  const { resolvedTheme, setTheme } = useTheme();
  const update = useUpdateCheck();
  const pathname = usePathname();
  const sidebarWidth = useSidebarStore((s) => s.width);

  const updateAvailable = update.available;
  const updateVersion = update.version;
  const displayName = t("common:localUser");
  const isDark = resolvedTheme === "dark";

  const checkUpdates = async () => {
    toast.info(t("settings:checkingUpdates"));
    const found = await update.checkNow();
    if (found) {
      toast.success(
        updateVersion
          ? `${t("settings:updateAvailable")} · v${updateVersion}`
          : t("settings:updateAvailable"),
      );
    } else if (update.error) {
      toast.error(t("settings:updateFailed"));
    } else {
      toast.success(t("settings:upToDate"));
    }
  };

  const openUserGuide = () => {
    if (IS_DESKTOP) {
      void desktopAPI.openExternal(USER_GUIDE_URL);
      return;
    }
    window.open(USER_GUIDE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]",
              pathname?.startsWith("/settings")
                ? "bg-[var(--sidebar-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]",
            )}
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-primary)] ring-1 ring-[var(--border-default)]">
              <UserRound className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui-body font-medium" suppressHydrationWarning>
                {displayName}
              </div>
            </div>
            {updateAvailable && (
              <span
                className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--brand-primary)]"
                aria-label={t("settings:updateAvailable")}
                title={
                  updateVersion
                    ? `${t("settings:updateAvailable")} · v${updateVersion}`
                    : t("settings:updateAvailable")
                }
              />
            )}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          alignOffset={-12}
          side="top"
          sideOffset={8}
          className="p-2"
          style={{ width: sidebarWidth }}
        >
          <div className="p-2">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-secondary)] ring-1 ring-[var(--border-default)]">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {displayName}
                </p>
              </div>
            </div>
          </div>

          <DropdownMenuItem asChild>
            <Link href="/settings" className="justify-between">
              <span className="inline-flex items-center gap-2">
                <Settings className="h-3.5 w-3.5" />
                {t("common:settings")}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={(event) => event.preventDefault()}
            className="justify-between"
          >
            <span className="inline-flex items-center gap-2">
              <Moon className="h-3.5 w-3.5" />
              {t("settings:darkTheme")}
            </span>
            <Switch
              checked={isDark}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              className="h-4 w-8 data-[state=checked]:[&_span]:translate-x-3.5 [&_span]:h-3 [&_span]:w-3"
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              openUserGuide();
            }}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("settings:aboutUserGuideTitle")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void checkUpdates();
            }}
            disabled={update.checking}
            className="justify-between"
          >
            <span className="inline-flex items-center gap-2">
              {update.checking ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : updateAvailable ? (
                <Download className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("settings:checkForUpdates")}
            </span>
            {updateAvailable && updateVersion && (
              <span className="text-ui-3xs font-medium text-[var(--brand-primary)]">
                v{updateVersion}
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
