"use client";

import { create } from "zustand";
import type { PlanReviewRequest } from "@/types/streaming";

interface PlanReviewStore {
  isOpen: boolean;
  /** Plan data stored here so it survives finishGeneration clearing chat store */
  planData: PlanReviewRequest | null;
  /** Panel width in pixels — defaults to half the viewport */
  panelWidth: number;

  openReview: (data: PlanReviewRequest) => void;
  close: () => void;
  updateWidth: () => void;
}

function getHalfViewport(): number {
  if (typeof window === "undefined") return 520;
  return Math.max(Math.floor(window.innerWidth / 2), 480);
}

export const usePlanReviewStore = create<PlanReviewStore>((set) => ({
  isOpen: false,
  planData: null,
  panelWidth: getHalfViewport(),

  openReview: (data) => {
    try {
      const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
      useRightSidebarStore.getState().open("plan");
    } catch {
      // Right sidebar store may not be available during SSR
    }
    set({ isOpen: true, planData: data, panelWidth: getHalfViewport() });
  },

  close: () => {
    try {
      const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
      const sidebar = useRightSidebarStore.getState();
      if (sidebar.activeTab === "plan") sidebar.close();
    } catch {
      // Right sidebar store may not be available during SSR
    }
    set({ isOpen: false, planData: null });
  },

  updateWidth: () => set({ panelWidth: getHalfViewport() }),
}));
