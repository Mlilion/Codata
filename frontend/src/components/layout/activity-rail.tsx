"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  MessageSquare,
  PlugZap,
  Radio,
  Settings,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebarStore, type AppMode } from "@/stores/sidebar-store";
import { useIsMacOS } from "@/hooks/use-platform";
import { ACTIVITY_RAIL_WIDTH, IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Top-level product modes ("destinations" — where you work). Switching a mode
 * swaps the secondary sidebar (chat sessions ↔ dashboards / expert teams) and
 * drops to a neutral draft so the current route can't restore the old mode.
 */
const MODES: { id: AppMode; label: string; icon: LucideIcon }[] = [
  { id: "codata", label: "Codata", icon: BarChart3 },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

/**
 * Shared capabilities ("what the agent can use"). These belong to the agent,
 * not to any single mode, so they stay visible and in a fixed position no
 * matter which mode is active. Reused by the mobile drawer.
 */
export const CAPABILITY_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/skills", label: "技能", icon: Sparkles },
  { href: "/mcp", label: "MCP", icon: PlugZap },
  { href: "/automations", label: "自动化", icon: Zap },
  { href: "/knowledge", label: "知识库", icon: BookOpen },
  { href: "/remote", label: "渠道", icon: Radio },
];

/**
 * Capability links rendered as a labelled list. Used by the mobile drawer,
 * where the desktop rail is hidden but the shared capabilities still need a
 * home. Mode switching in the drawer is handled by SidebarNav.
 */
export function ActivityRailCapabilities() {
  const pathname = usePathname();
  return (
    <div className="space-y-1 px-3 pb-2">
      {CAPABILITY_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname?.startsWith(href) ?? false;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-ui-body transition-colors",
              active
                ? "bg-[var(--sidebar-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const className = cn(
    "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
    active
      ? "bg-[var(--data-accent-soft)] text-[var(--data-accent)]"
      : "text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]",
  );
  const inner = <Icon className="h-4 w-4" />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={className}>
            {inner}
          </Link>
        ) : (
          <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={className}>
            {inner}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Always-visible activity rail anchored to the window's left edge. Never
 * collapses — it separates *capabilities* and *mode* (fixed x) from the
 * secondary sidebar's *destinations* (which change with mode). See
 * app/(main)/layout.tsx for how it composes with the sidebars.
 */
export function ActivityRail() {
  const router = useRouter();
  const pathname = usePathname();
  const appMode = useSidebarStore((s) => s.appMode);
  const setAppMode = useSidebarStore((s) => s.setAppMode);
  const isMac = useIsMacOS();

  // macOS: clear the native traffic lights. Windows/Linux: clear the custom
  // title bar row.
  const topOffset = IS_DESKTOP ? (isMac ? 40 : TITLE_BAR_HEIGHT) : 0;

  const changeMode = (mode: AppMode) => {
    if (mode === appMode) return;
    setAppMode(mode);
    // Product workspaces and historical sessions carry their own mode; move to
    // a neutral draft first so the current route can't immediately restore it.
    if (pathname !== "/c/new") router.push("/c/new");
  };

  const isSettings = pathname?.startsWith("/settings") ?? false;

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        aria-label="Activity rail"
        data-tauri-drag-region={IS_DESKTOP ? "" : undefined}
        className="hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col items-center bg-[var(--surface-secondary)]"
        style={{ width: ACTIVITY_RAIL_WIDTH, paddingTop: topOffset }}
      >
        {/* Right divider — starts below the macOS traffic lights so the light
            cluster isn't cut by the seam, then runs to the bottom. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 w-px bg-[var(--border-subtle)]"
          style={{ top: topOffset }}
        />

        <div className="flex flex-col items-center gap-1 pt-2">
          {MODES.map((mode) => (
            <RailButton
              key={mode.id}
              icon={mode.icon}
              label={mode.label}
              active={!isSettings && appMode === mode.id}
              onClick={() => changeMode(mode.id)}
            />
          ))}
        </div>

        <div className="my-2 h-px w-6 shrink-0 bg-[var(--border-subtle)]" />

        <div className="flex flex-col items-center gap-1">
          {CAPABILITY_ITEMS.map((item) => (
            <RailButton
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              active={pathname?.startsWith(item.href) ?? false}
            />
          ))}
        </div>

        <div className="mt-auto flex flex-col items-center gap-1 pb-3">
          <RailButton icon={Settings} label="设置" href="/settings" active={isSettings} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
