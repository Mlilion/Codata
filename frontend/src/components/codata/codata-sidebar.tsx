"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarHeader } from "@/components/layout/sidebar-header";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import { ActivityRailCapabilities } from "@/components/layout/activity-rail";
import { SessionItem } from "@/components/layout/session-item";
import { DeleteConfirmationDialog } from "@/components/layout/delete-confirmation-dialog";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useDashboards } from "@/hooks/use-dashboard";
import { useSessions } from "@/hooks/use-sessions";
import { useActiveSessionId } from "@/hooks/use-active-session-id";
import { useSessionActions } from "@/hooks/use-session-actions";
import { useIsMacOS } from "@/hooks/use-platform";
import { useEffectiveSidebarWidth } from "@/hooks/use-effective-sidebar-width";
import { cn } from "@/lib/utils";
import { ACTIVITY_RAIL_WIDTH, IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";
import { getDashboardRoute } from "@/lib/routes";

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
  href?: string;
}[] = [
  { id: "dashboards", label: "看板", icon: ChartColumn, href: "/dashboard" },
  { id: "experts", label: "专家团", icon: Users, href: "/experts" },
];
const CODATA_SIDEBAR_WIDTH = 270;

function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
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
  tag,
}: {
  href?: string;
  active?: boolean;
  icon: LucideIcon;
  label: string;
  hint?: string;
  badge?: number;
  tag?: string;
}) {
  const content = (
    <>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          active
            ? "bg-[var(--data-accent-soft)] text-[var(--data-accent)]"
            : "bg-[var(--surface-primary)] text-[var(--text-tertiary)]",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block min-w-0 truncate text-ui-body font-medium">{label}</span>
          {tag && (
            <span className="shrink-0 rounded-md bg-[var(--data-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--data-accent)]">
              {tag}
            </span>
          )}
        </span>
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
    "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
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
  const requestedWidth = useSidebarStore((s) => s.width);
  const width = useEffectiveSidebarWidth(requestedWidth, CODATA_SIDEBAR_WIDTH);
  const isMac = useIsMacOS();
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;

  return (
    <TooltipProvider delayDuration={200}>
      <motion.aside
        aria-label="Codata sidebar"
        className="sidebar-glass fixed inset-y-0 z-30 flex flex-col overflow-hidden bg-[var(--sidebar-translucent-bg)] backdrop-blur-xl"
        style={{ left: ACTIVITY_RAIL_WIDTH, ...(IS_DESKTOP ? { top: topOffset } : {}) }}
        initial={false}
        animate={{ width: isCollapsed ? 0 : width }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <CodataSidebarContent />
      </motion.aside>
    </TooltipProvider>
  );
}

/**
 * `railChrome` renders the mode switch + shared capability links inline. The
 * desktop rail owns those, so it defaults off; the mobile drawer (no rail)
 * passes true.
 */
export function CodataSidebarContent({ railChrome = false }: { railChrome?: boolean } = {}) {
  const pathname = usePathname();
  const activeSessionId = useActiveSessionId();
  const { data: dashboards } = useDashboards();
  const dashboardCount = dashboards?.length ?? 0;
  const { data: sessionPages } = useSessions("codata");
  const codataSessions = (sessionPages?.pages.flat() ?? []).slice(0, 20);
  const {
    editingId,
    deleteTarget,
    handleDeleteRequest,
    handleDeleteConfirm,
    handleDeleteCancel,
    handleRename,
    handleTogglePin,
    handleArchive,
    handleEditStart,
    handleEditEnd,
    exportPdf,
    exportMarkdown,
  } = useSessionActions();

  return (
    <>
      <SidebarHeader />
      {railChrome && <SidebarNav />}
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
              badge={section.id === "dashboards" ? dashboardCount : undefined}
            />
          );
        })}

        {(dashboards ?? []).length > 0 && (
          <>
            <SidebarGroupLabel>看板</SidebarGroupLabel>
            <div className="space-y-0.5">
            {(dashboards ?? []).slice(0, 6).map((b) => {
              const boardHref = getDashboardRoute(b.id);
              return (
                <NavRow
                  key={b.id}
                  href={boardHref}
                  active={pathname === boardHref}
                  icon={ChartColumn}
                  label={b.name}
                />
              );
            })}
            </div>
          </>
        )}

        <SidebarGroupLabel>最近分析</SidebarGroupLabel>
        <div className="-mx-3 space-y-0.5">
          {codataSessions.length === 0 ? (
            <div className="mx-3 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-4 text-ui-caption text-[var(--text-tertiary)]">
              暂无分析会话
            </div>
          ) : (
            codataSessions.slice(0, 8).map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                isActive={activeSessionId === s.id}
                onDelete={handleDeleteRequest}
                onRename={handleRename}
                onExportPdf={exportPdf}
                onExportMarkdown={exportMarkdown}
                onTogglePin={handleTogglePin}
                onArchive={handleArchive}
                isEditing={editingId === s.id}
                onEditStart={handleEditStart}
                onEditEnd={handleEditEnd}
              />
            ))
          )}
        </div>
      </div>
      {railChrome && <ActivityRailCapabilities />}
      <SidebarFooter />
      <DeleteConfirmationDialog
        open={!!deleteTarget}
        title={deleteTarget?.title ?? ""}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </>
  );
}
