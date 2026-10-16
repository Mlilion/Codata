"use client";

import { Suspense } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarHeader } from "./sidebar-header";
import { SessionList } from "./session-list";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useIsMacOS } from "@/hooks/use-platform";
import { useEffectiveSidebarWidth } from "@/hooks/use-effective-sidebar-width";
import { ACTIVITY_RAIL_WIDTH, IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";

export function Sidebar() {
  const { t } = useTranslation("common");
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const requestedWidth = useSidebarStore((s) => s.width);
  const width = useEffectiveSidebarWidth(requestedWidth);
  const isMac = useIsMacOS();

  // macOS: sidebar extends to the window top (traffic lights overlay the
  // sidebar header). Windows/Linux: sit below the 32px custom title bar.
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;

  return (
    <TooltipProvider delayDuration={200}>
      <motion.aside
        aria-label="Chat sidebar"
        className="sidebar-glass fixed inset-y-0 z-30 flex flex-col overflow-hidden bg-[var(--sidebar-translucent-bg)] backdrop-blur-xl"
        style={{ left: ACTIVITY_RAIL_WIDTH, ...(IS_DESKTOP ? { top: topOffset } : {}) }}
        initial={false}
        animate={{ width: isCollapsed ? 0 : width }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <SidebarHeader />
        <div className="px-3 pb-2">
          <Link
            href="/c/new"
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] text-ui-body font-medium text-[var(--surface-primary)] transition-all hover:opacity-90 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            {t("newChat")}
          </Link>
        </div>
        <Suspense fallback={<div className="flex-1" />}>
          <SessionList />
        </Suspense>
        <SidebarFooter />
        {!isCollapsed && <SidebarResizeHandle />}
      </motion.aside>
    </TooltipProvider>
  );
}
