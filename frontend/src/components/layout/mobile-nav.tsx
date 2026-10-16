"use client";

import { useEffect, useState } from "react";
import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";
import { SessionList } from "./session-list";
import { SidebarFooter } from "./sidebar-footer";
import { ActivityRailCapabilities } from "./activity-rail";
import { CodataSidebarContent } from "@/components/codata/codata-sidebar";
import { useSidebarStore } from "@/stores/sidebar-store";

export function MobileNav() {
  const { t } = useTranslation("common");
  const { isOpen, setOpen } = useSidebarStore();
  const appMode = useSidebarStore((s) => s.appMode);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden fixed top-3 left-3 z-40 h-8 w-8"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-[260px]">
        <TooltipProvider delayDuration={200}>
          <div
            className="flex flex-col h-full"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
            }}
          >
            {appMode === "codata" ? (
              <CodataSidebarContent railChrome />
            ) : (
              <>
                <SidebarHeader />
                <SidebarNav />
                <div className="px-3 pb-2">
                  <Link
                    href="/c/new"
                    className="flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] text-ui-body font-medium text-[var(--surface-primary)] transition-all hover:opacity-90 active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4" />
                    {t("newChat")}
                  </Link>
                </div>
                <SessionList />
                <ActivityRailCapabilities />
                <SidebarFooter />
              </>
            )}
          </div>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
