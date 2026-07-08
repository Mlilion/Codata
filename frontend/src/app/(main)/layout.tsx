"use client";

import { Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { CodataSidebar } from "@/components/codata/codata-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SearchCommandDialog } from "@/components/layout/search-command-dialog";
import { RightSidebar } from "@/components/right-sidebar/right-sidebar";
import { usePlanReviewStore } from "@/stores/plan-review-store";
import { ConnectionStatus } from "@/components/layout/connection-status";
import { RouteProgressBar } from "@/components/layout/route-progress-bar";
import { SplashScreen } from "@/components/layout/splash-screen";
import { TitleBar } from "@/components/desktop/title-bar";
import {
  WindowTopIcons,
  WINDOW_TOP_ICONS_WIDTH_MAC,
  WINDOW_TOP_ICONS_WIDTH_OTHER,
} from "@/components/layout/window-top-icons";
import { UpdateBanner } from "@/components/desktop/update-banner";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSettingsHasHydrated } from "@/stores/settings-store";
import { useAutoDetectProvider } from "@/hooks/use-auto-detect-provider";
import { useIsMacOS } from "@/hooks/use-platform";
import { useTraySync } from "@/hooks/use-tray-sync";
import { useActivityStore } from "@/stores/activity-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRightSidebarStore } from "@/stores/right-sidebar-store";
import { IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";
import { ErrorBoundary } from "@/components/ui/error-boundary";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const appMode = useSidebarStore((s) => s.appMode);
  const setAppMode = useSidebarStore((s) => s.setAppMode);
  const sidebarWidth = useSidebarStore((s) => s.width);
  const rightSidebarIsOpen = useRightSidebarStore((s) => s.isOpen);
  const rightSidebarWidth = useRightSidebarStore((s) => s.width);
  const isDesktop = useIsDesktop();
  const isMac = useIsMacOS();
  useAutoDetectProvider();
  useTraySync();

  const settingsHydrated = useSettingsHasHydrated();

  // Client-side only check for desktop mode (prevents hydration mismatch)
  const [showSplash, setShowSplash] = useState(false);
  useEffect(() => {
    setShowSplash(IS_DESKTOP);
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    let cancelled = false;

    void desktopAPI.getPendingNavigation().then((path) => {
      if (!cancelled && path) {
        router.push(path);
      }
    });

    const cleanup = desktopAPI.onNavigate((path) => {
      router.push(path);
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [router]);

  // Toggle the `macos-vibrancy` class on <html> so globals.css can drop the
  // body background and let NSVisualEffectView (applied natively by the
  // window-vibrancy crate on macOS) show through transparent surfaces.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const root = document.documentElement;
    if (isMac) root.classList.add("macos-vibrancy");
    return () => root.classList.remove("macos-vibrancy");
  }, [isMac]);

  // Intercept clicks on external links and open them in the system browser
  // instead of navigating the Tauri webview (which blocks external URLs).
  useEffect(() => {
    if (!IS_DESKTOP) return;

    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Only intercept absolute external URLs (http/https)
      if (!/^https?:\/\//i.test(href)) return;

      e.preventDefault();
      e.stopPropagation();
      desktopAPI.openExternal(href);
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  // Close overlay panels on page navigation
  const closeActivity = useActivityStore((s) => s.close);
  const closeArtifact = useArtifactStore((s) => s.close);
  const closePlanReview = usePlanReviewStore((s) => s.close);
  const closeWorkspace = useWorkspaceStore((s) => s.close);
  const closeRightSidebar = useRightSidebarStore((s) => s.close);
  useEffect(() => {
    closeActivity();
    closeArtifact();
    closePlanReview();
    closeWorkspace();
    closeRightSidebar();
  }, [pathname, closeActivity, closeArtifact, closePlanReview, closeWorkspace, closeRightSidebar]);

  const isChatPage = pathname?.startsWith("/c/") ?? false;
  const isSettingsPage = pathname?.startsWith("/settings") ?? false;
  const isCodataWorkspacePage =
    (pathname?.startsWith("/experts") || pathname?.startsWith("/dashboard")) ?? false;
  useEffect(() => {
    if (isCodataWorkspacePage && appMode !== "codata") {
      setAppMode("codata");
    }
  }, [appMode, isCodataWorkspacePage, setAppMode]);
  // Codata mode swaps the sidebar (unless on settings, which owns its own nav).
  const isCodataMode = (appMode === "codata" || isCodataWorkspacePage) && !isSettingsPage;
  const isActiveChat = isChatPage && pathname !== "/c/new";
  const effectiveSidebarWidth = isCodataMode ? Math.min(sidebarWidth, 270) : sidebarWidth;
  // Settings replaces the sidebar with its own; always keep the gutter.
  const marginLeft =
    isDesktop && (isSettingsPage || !isCollapsed) ? effectiveSidebarWidth : 0;
  const marginRight = isDesktop && isActiveChat && rightSidebarIsOpen ? rightSidebarWidth : 0;

  // macOS uses native traffic lights overlay — page headers extend to the top.
  // Windows/Linux keep the custom title bar as a real 32px row.
  const titleBarPadding = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;
  const shouldReserveCollapsedTopButton =
    isDesktop && isCollapsed && !isChatPage && !isSettingsPage;

  if (!settingsHydrated) {
    return (
      <div className="h-full overflow-hidden isolate bg-[var(--surface-primary)]">
        {showSplash && <SplashScreen />}
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden isolate">
      {/* Opaque backdrop behind everything right of the sidebar.
          Only the sidebar area stays transparent to preserve macOS vibrancy;
          all other regions sit on solid surface-chat, eliminating any flash of
          the root background during panel open/close animations. */}
      <motion.div
        aria-hidden="true"
        className="fixed inset-y-0 right-0 -z-10 pointer-events-none bg-[var(--surface-chat)]"
        initial={false}
        animate={{ left: marginLeft }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      />

      {/* Skip link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[var(--surface-primary)] focus:text-[var(--text-primary)] focus:border focus:border-[var(--border-default)] focus:shadow-[var(--shadow-md)] focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Splash screen for desktop app initialization */}
      {showSplash && <SplashScreen />}

      {/* Top progress bar for route transitions */}
      <RouteProgressBar />

      {/* Desktop title bar (Electron only) */}
      <TitleBar />

      {/* Desktop sidebar — Settings swaps in its own nav */}
      <div className="hidden lg:block">
        {isSettingsPage ? (
          <Suspense fallback={null}>
            <SettingsSidebar />
          </Suspense>
        ) : isCodataMode ? (
          <CodataSidebar />
        ) : (
          <Sidebar />
        )}
      </div>

      {/* Floating window top-left icons (panel-left + new chat) — sit above
          sidebar and chat header at a fixed x. Settings has its own nav. */}
      {isDesktop && !isSettingsPage && <WindowTopIcons />}

      {/* Mobile nav drawer */}
      <MobileNav />
      <SearchCommandDialog />

      {/* Main content area */}
      <motion.main
        id="main-content"
        tabIndex={-1}
        className={`h-full flex flex-col outline-none vibrancy-opaque overflow-hidden${
          marginLeft > 0
            ? " rounded-tl-xl rounded-bl-xl border-l border-t border-b border-[var(--border-subtle)]"
            : ""
        }`}
        style={{
          paddingTop: titleBarPadding,
          paddingLeft: shouldReserveCollapsedTopButton
            ? isMac
              ? WINDOW_TOP_ICONS_WIDTH_MAC
              : WINDOW_TOP_ICONS_WIDTH_OTHER
            : 0,
        }}
        initial={false}
        animate={{ marginLeft, marginRight }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <ConnectionStatus />
        <UpdateBanner />
        {children}
      </motion.main>

      {/* Unified right sidebar — only on active chat sessions */}
      <ErrorBoundary>
        <AnimatePresence mode="wait">
          {isActiveChat && rightSidebarIsOpen && <RightSidebar key="right-sidebar" />}
        </AnimatePresence>
      </ErrorBoundary>
    </div>
  );
}
