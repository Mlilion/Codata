"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "@/lib/constants";

export type OrganizeMode = "by-project" | "chronological" | "chats-first";
export type SortBy = "created" | "updated";
/** Top-level product mode: general chat vs. Codata data-agent workspace. */
export type AppMode = "chat" | "codata";

interface SidebarStore {
  /** Whether persisted sidebar preferences have finished hydrating. */
  hasHydrated: boolean;
  /** Mobile drawer open state */
  isOpen: boolean;
  /** Desktop sidebar collapsed state */
  isCollapsed: boolean;
  /** Whether the search input is visible */
  isSearchOpen: boolean;
  searchQuery: string;
  /** Project directories that user has collapsed (default: expanded) */
  collapsedProjects: Record<string, boolean>;
  /** Command-palette search dialog open state */
  isSearchModalOpen: boolean;
  /** How session list is organized */
  organizeMode: OrganizeMode;
  /** Which timestamp sessions are sorted by */
  sortBy: SortBy;
  /** Top-level product mode (chat vs. Codata data workspace) */
  appMode: AppMode;
  /** Current sidebar width (drag-resizable) */
  width: number;
  setOpen: (open: boolean) => void;
  /** Toggle desktop sidebar collapse */
  toggle: () => void;
  toggleSearch: () => void;
  setSearchQuery: (query: string) => void;
  toggleProjectCollapsed: (directory: string) => void;
  setSearchModalOpen: (open: boolean) => void;
  setOrganizeMode: (mode: OrganizeMode) => void;
  setSortBy: (sortBy: SortBy) => void;
  setAppMode: (mode: AppMode) => void;
  setHasHydrated: (hydrated: boolean) => void;
  collapseAllProjects: (directories: string[]) => void;
  expandAllProjects: () => void;
  setWidth: (width: number) => void;
}

function clampWidth(w: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(w)));
}

// Mode is intentionally not persisted: the route/session is the source of
// truth. Keep an in-memory request so a route effect that runs during Zustand
// hydration is not overwritten by the store's initial default.
let requestedAppMode: AppMode | null = null;

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      hasHydrated: false,
      isOpen: false,
      isCollapsed: false,
      isSearchOpen: false,
      searchQuery: "",
      collapsedProjects: {},
      isSearchModalOpen: false,
      organizeMode: "by-project",
      sortBy: "updated",
      appMode: "codata",
      width: SIDEBAR_WIDTH,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isCollapsed: !s.isCollapsed })),
      toggleSearch: () =>
        set((s) => ({
          isSearchOpen: !s.isSearchOpen,
          searchQuery: s.isSearchOpen ? "" : s.searchQuery,
        })),
      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleProjectCollapsed: (directory) =>
        set((s) => {
          const next = { ...s.collapsedProjects };
          if (next[directory]) delete next[directory];
          else next[directory] = true;
          return { collapsedProjects: next };
        }),
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),
      setOrganizeMode: (mode) => set({ organizeMode: mode }),
      setSortBy: (sortBy) => set({ sortBy }),
      setAppMode: (mode) => {
        requestedAppMode = mode;
        set({ appMode: mode });
      },
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      collapseAllProjects: (directories) =>
        set(() => {
          const next: Record<string, boolean> = {};
          for (const d of directories) next[d] = true;
          return { collapsedProjects: next };
        }),
      expandAllProjects: () => set({ collapsedProjects: {} }),
      setWidth: (width) => set({ width: clampWidth(width) }),
    }),
    {
      name: "codata-sidebar",
      partialize: (s) => ({
        collapsedProjects: s.collapsedProjects,
        organizeMode: s.organizeMode,
        sortBy: s.sortBy,
        width: s.width,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SidebarStore>) };
        return {
          ...merged,
          appMode: current.appMode,
          width: clampWidth(merged.width ?? SIDEBAR_WIDTH),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        if (requestedAppMode) state?.setAppMode(requestedAppMode);
      },
    },
  ),
);
