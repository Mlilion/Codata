"use client";

import { motion } from "framer-motion";
import { Database, History, LayoutDashboard } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarHeader } from "@/components/layout/sidebar-header";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import { SidebarResizeHandle } from "@/components/layout/sidebar-resize-handle";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useIsMacOS } from "@/hooks/use-platform";
import { IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";

/**
 * Codata data-workspace sidebar. Swaps in place of the chat `Sidebar` when
 * appMode === "codata" (see app/(main)/layout.tsx). Shares the same aside
 * shell + mode switch so the user can toggle back to Chat.
 *
 * Content is a static scaffold for now — data sources, query history, and
 * dashboards will be wired to datasage (list_databases / list_tables) in a
 * later phase.
 */
const SECTIONS: { id: string; label: string; icon: typeof Database; hint: string }[] = [
  { id: "sources", label: "数据源", icon: Database, hint: "连接的数据库与表" },
  { id: "history", label: "历史查询", icon: History, hint: "最近的分析会话" },
  { id: "dashboards", label: "看板", icon: LayoutDashboard, hint: "已保存的图表" },
];

export function CodataSidebar() {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const width = useSidebarStore((s) => s.width);
  const isMac = useIsMacOS();
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;

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
        <SidebarNav />
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <div key={section.id} className="mb-4">
                <div className="flex items-center gap-2 px-2 py-1.5 text-ui-body font-medium text-[var(--text-secondary)]">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{section.label}</span>
                </div>
                <p className="px-2 pb-1 text-ui-caption text-[var(--text-tertiary)]">
                  {section.hint}
                </p>
              </div>
            );
          })}
          <div className="mx-2 mt-2 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-4 text-center">
            <p className="text-ui-caption text-[var(--text-tertiary)]">
              在下方对话框直接提问,Codata 会生成 SQL、图表和结果表格
            </p>
          </div>
        </div>
        <SidebarFooter />
        {!isCollapsed && <SidebarResizeHandle />}
      </motion.aside>
    </TooltipProvider>
  );
}
