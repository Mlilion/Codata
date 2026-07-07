"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Plus,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarHeader } from "@/components/layout/sidebar-header";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import { CodataLogo } from "@/components/ui/codata-logo";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useDashboards } from "@/hooks/use-dashboard";
import { useSessions } from "@/hooks/use-sessions";
import { useIsMacOS } from "@/hooks/use-platform";
import { cn } from "@/lib/utils";
import { IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";

/**
 * Codata data-workspace sidebar. Swaps in place of the chat `Sidebar` when
 * appMode === "codata" (see app/(main)/layout.tsx). Shares the same aside
 * shell + mode switch so the user can toggle back to Chat.
 *
 * Only renders real product surfaces: new analyses, dashboard pages,
 * expert teams, saved dashboards, and existing Codata sessions.
 */
const SECTIONS: {
  id: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  href?: string;
}[] = [
  { id: "dashboards", label: "看板", icon: LayoutDashboard, hint: "已保存的图表集合", href: "/dashboard" },
  { id: "experts", label: "专家团", icon: Users, hint: "复杂分析工作流", href: "/experts" },
];
const CODATA_SIDEBAR_WIDTH = 270;

function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
      {children}
    </div>
  );
}

function NavRow({
  href,
  active,
  icon: Icon,
  label,
  hint,
  badge,
}: {
  href?: string;
  active?: boolean;
  icon: LucideIcon;
  label: string;
  hint?: string;
  badge?: number;
}) {
  const content = (
    <>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          active
            ? "bg-[var(--data-accent-soft)] text-[var(--data-accent)]"
            : "bg-[var(--surface-primary)] text-[var(--text-tertiary)]",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui-body font-medium">{label}</span>
        {hint && <span className="block truncate text-ui-caption text-[var(--text-tertiary)]">{hint}</span>}
      </span>
      {typeof badge === "number" && badge > 0 && (
        <span className="rounded-full bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
          {badge}
        </span>
      )}
    </>
  );
  const className = cn(
    "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
    active
      ? "data-agent-active-rail bg-[var(--data-accent-soft)] text-[var(--text-primary)]"
      : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]",
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

export function CodataSidebar() {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const width = Math.min(useSidebarStore((s) => s.width), CODATA_SIDEBAR_WIDTH);
  const isMac = useIsMacOS();
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;
  const pathname = usePathname();
  const { data: dashboards } = useDashboards();
  const dashboardCount = dashboards?.length ?? 0;
  const { data: sessionPages } = useSessions("codata");
  const codataSessions = (sessionPages?.pages.flat() ?? []).slice(0, 20);

  return (
    <TooltipProvider delayDuration={200}>
      <motion.aside
        aria-label="Codata sidebar"
        className="sidebar-glass fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-[var(--sidebar-translucent-bg)] backdrop-blur-xl"
        style={IS_DESKTOP ? { top: topOffset } : undefined}
        initial={false}
        animate={{ width: isCollapsed ? 0 : width }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <SidebarHeader />
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-primary)]/65 px-2 py-2">
            <CodataLogo size={26} className="rounded-md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui-body font-semibold text-[var(--text-primary)]">Codata</div>
              <div className="truncate text-[10px] text-[var(--text-tertiary)]">数据智能体工作台</div>
            </div>
          </div>
        </div>
        <SidebarNav />
        <div className="px-3 pb-2">
          <Link
            href="/c/new"
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] text-ui-body font-medium text-[var(--surface-primary)] transition-all hover:opacity-90 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            新建分析
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-auto">
          <SidebarGroupLabel>工作区</SidebarGroupLabel>
          {SECTIONS.map((section) => {
            const href = section.href;
            const active = href ? pathname === href || pathname?.startsWith(`${href}/`) : false;
            return (
              <NavRow
                key={section.id}
                href={href}
                active={active}
                icon={section.icon}
                label={section.label}
                hint={section.hint}
                badge={section.id === "dashboards" ? dashboardCount : undefined}
              />
            );
          })}

          {(dashboards ?? []).length > 0 && (
            <>
              <SidebarGroupLabel>看板</SidebarGroupLabel>
              {(dashboards ?? []).slice(0, 6).map((b) => {
                const boardHref = `/dashboard/${b.id}`;
                return (
                  <NavRow
                    key={b.id}
                    href={boardHref}
                    active={pathname === boardHref}
                    icon={LayoutDashboard}
                    label={b.name}
                  />
                );
              })}
            </>
          )}

          <SidebarGroupLabel>最近分析</SidebarGroupLabel>
          <div className="space-y-0.5">
            {codataSessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-4 text-ui-caption text-[var(--text-tertiary)]">
                暂无分析会话
              </div>
            ) : (
              codataSessions.slice(0, 8).map((s) => {
                const href = `/c/${s.id}`;
                return (
                  <NavRow
                    key={s.id}
                    href={href}
                    active={pathname === href}
                    icon={Search}
                    label={s.title || "未命名分析"}
                  />
                );
              })
            )}
          </div>
        </div>
        <SidebarFooter />
      </motion.aside>
    </TooltipProvider>
  );
}
