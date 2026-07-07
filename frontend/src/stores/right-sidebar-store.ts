"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  RIGHT_SIDEBAR_WIDTH,
} from "@/lib/constants";

export type RightSidebarTab = "workspace" | "expert" | "activity" | "artifact" | "plan";

const DEFAULT_WIDTH = RIGHT_SIDEBAR_WIDTH;

interface RightSidebarStore {
  isOpen: boolean;
  activeTab: RightSidebarTab;
  lastTab: RightSidebarTab;
  width: number;
  open: (tab?: RightSidebarTab) => void;
  close: () => void;
  setActiveTab: (tab: RightSidebarTab) => void;
  setWidth: (width: number) => void;
  toggle: (tab?: RightSidebarTab) => void;
}

export const useRightSidebarStore = create<RightSidebarStore>()(
  persist(
    (set, get) => ({
      isOpen: false,
      activeTab: "workspace",
      lastTab: "workspace",
      width: DEFAULT_WIDTH,

      open: (tab) => {
        const nextTab = tab ?? get().lastTab ?? "workspace";
        set({ isOpen: true, activeTab: nextTab, lastTab: nextTab });
      },

      close: () => set({ isOpen: false }),

      setActiveTab: (tab) => set({ activeTab: tab, lastTab: tab, isOpen: true }),

      setWidth: (width) => {
        set({
          width: Math.max(
            RIGHT_SIDEBAR_MIN_WIDTH,
            Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.round(width)),
          ),
        });
      },

      toggle: (tab) => {
        const { isOpen, activeTab, lastTab } = get();
        const nextTab = tab ?? lastTab ?? "workspace";
        if (isOpen && activeTab === nextTab) {
          set({ isOpen: false });
        } else {
          set({ isOpen: true, activeTab: nextTab, lastTab: nextTab });
        }
      },
    }),
    {
      name: "codata-right-sidebar",
      partialize: (s) => ({
        lastTab: s.lastTab,
        width: s.width,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<RightSidebarStore>) };
        return {
          ...merged,
          width: Math.max(
            RIGHT_SIDEBAR_MIN_WIDTH,
            Math.min(RIGHT_SIDEBAR_MAX_WIDTH, merged.width ?? DEFAULT_WIDTH),
          ),
        };
      },
    },
  ),
);
