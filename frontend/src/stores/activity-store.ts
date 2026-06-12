"use client";

import { create } from "zustand";
import type { PartData, ToolPart, StepStartPart, StepFinishPart } from "@/types/message";

/** A single item in the execution chain (preserves interleaving order). */
export type ChainItem =
  | { type: "reasoning"; text: string }
  | { type: "tool"; data: ToolPart };

export interface ActivityData {
  sourceKey?: string;
  mode?: "default" | "expert-team";
  parts?: PartData[];
  reasoningTexts: string[];
  toolParts: ToolPart[];
  thinkingDuration?: number;
  stepParts: (StepStartPart | StepFinishPart)[];
  hasVisibleOutput?: boolean;
  /** Ordered chain of reasoning + tool items (preserves execution order). */
  chain: ChainItem[];
}

/** Derive wall-clock duration from tool timing (for history-loaded messages). */
export function computeDuration(data: ActivityData): number | undefined {
  if (data.thinkingDuration != null && data.thinkingDuration > 0) {
    return data.thinkingDuration;
  }
  const times: number[] = [];
  for (const tool of data.toolParts) {
    if (tool.state.time_start) times.push(new Date(tool.state.time_start).getTime());
    if (tool.state.time_end) times.push(new Date(tool.state.time_end).getTime());
  }
  if (times.length >= 2) {
    const ms = Math.max(...times) - Math.min(...times);
    return Math.round(ms / 1000);
  }
  return undefined;
}

interface ActivityStore {
  isOpen: boolean;
  activeKey: string | null;
  activeData: ActivityData | null;
  openForMessage: (key: string, data: ActivityData) => void;
  toggleForMessage: (key: string, data: ActivityData) => void;
  refreshForMessage: (key: string, data: ActivityData) => void;
  close: () => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  isOpen: false,
  activeKey: null,
  activeData: null,
  openForMessage: (key, data) => {
    try {
      const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
      useRightSidebarStore.getState().open(data.mode === "expert-team" ? "expert" : "activity");
    } catch {
      // Right sidebar store may not be available during SSR
    }
    set({ isOpen: true, activeKey: key, activeData: data });
  },
  toggleForMessage: (key, data) => {
    const { isOpen, activeKey } = get();
    const targetTab = data.mode === "expert-team" ? "expert" : "activity";
    try {
      const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
      const sidebar = useRightSidebarStore.getState();
      if (isOpen && activeKey === key && sidebar.isOpen && sidebar.activeTab === targetTab) {
        sidebar.close();
        set({ isOpen: false, activeKey: null });
        return;
      }
      sidebar.open(targetTab);
    } catch {
      // Right sidebar store may not be available during SSR
      if (isOpen && activeKey === key) {
        set({ isOpen: false, activeKey: null });
        return;
      }
    }

    set({ isOpen: true, activeKey: key, activeData: data });
  },
  refreshForMessage: (key, data) => {
    const { isOpen, activeKey } = get();
    if (isOpen && activeKey === key) {
      set({ activeData: data });
    }
  },
  close: () => {
    try {
      const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
      const sidebar = useRightSidebarStore.getState();
      if (sidebar.activeTab === "activity" || sidebar.activeTab === "expert") sidebar.close();
    } catch {
      // Right sidebar store may not be available during SSR
    }
    set({ isOpen: false, activeKey: null });
  },
  clear: () => set({ isOpen: false, activeKey: null, activeData: null }),
}));
