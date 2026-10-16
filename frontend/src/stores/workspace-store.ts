"use client";

import { create } from "zustand";

function openWorkspaceTab(options: { preserveActive?: boolean } = {}) {
  try {
    const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
    const sidebar = useRightSidebarStore.getState();
    if (options.preserveActive && sidebar.isOpen && sidebar.activeTab !== "workspace") return;
    sidebar.open("workspace");
  } catch {
    // store may not be available during SSR
  }
}

export interface WorkspaceTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  type: "instructions" | "generated" | "uploaded" | "referenced";
  tool?: string;
  visibility?: "deliverable" | "draft" | "intermediate" | "hidden";
  relative_path?: string;
}

interface WorkspaceStore {
  isOpen: boolean;
  /** Per-section collapsed state (false / missing = expanded). */
  collapsedSections: Record<string, boolean>;
  todos: WorkspaceTodo[];
  workspaceFiles: WorkspaceFile[];
  scratchpadContent: string;
  /** Current session's workspace directory (set by ChatView on session load). */
  activeWorkspacePath: string | null;

  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleSection: (section: string) => void;
  expandSection: (section: string) => void;
  collapseSection: (section: string) => void;
  setTodos: (todos: WorkspaceTodo[]) => void;
  addWorkspaceFile: (file: WorkspaceFile) => void;
  setWorkspaceFiles: (files: WorkspaceFile[]) => void;
  setScratchpadContent: (content: string) => void;
  setActiveWorkspacePath: (path: string | null) => void;
  resetForSession: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  isOpen: false,
  collapsedSections: {
    progress: true,
    files: true,
    context: true,
  },
  todos: [],
  workspaceFiles: [],
  scratchpadContent: "",
  activeWorkspacePath: null,

  toggle: () => {
    const willOpen = !get().isOpen;
    if (willOpen) openWorkspaceTab();
    set({ isOpen: willOpen });
  },
  open: () => {
    openWorkspaceTab();
    set({ isOpen: true });
  },
  close: () => {
    try {
      const { useRightSidebarStore } = require("@/stores/right-sidebar-store");
      const sidebar = useRightSidebarStore.getState();
      if (sidebar.activeTab === "workspace") sidebar.close();
    } catch {
      // store may not be available during SSR
    }
    set({ isOpen: false });
  },

  toggleSection: (section) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [section]: !s.collapsedSections[section],
      },
    })),

  expandSection: (section) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [section]: false,
      },
    })),

  collapseSection: (section) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [section]: true,
      },
    })),

  setTodos: (todos) => {
    const hasRunningTodo = todos.some((todo) => todo.status === "in_progress");
    if (hasRunningTodo) openWorkspaceTab({ preserveActive: true });
    set({ todos, ...(hasRunningTodo ? { isOpen: true } : {}) });
  },

  addWorkspaceFile: (file) => {
    const { workspaceFiles } = get();
    if (workspaceFiles.some((f) => f.path === file.path)) return;
    set({ workspaceFiles: [...workspaceFiles, file] });
  },

  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
  setScratchpadContent: (content) => set({ scratchpadContent: content }),
  setActiveWorkspacePath: (path) => set({ activeWorkspacePath: path && path !== "." ? path : null }),

  resetForSession: () =>
    set({
      todos: [],
      workspaceFiles: [],
      scratchpadContent: "",
      collapsedSections: {
        progress: true,
        files: true,
        context: true,
      },
      activeWorkspacePath: null,
      isOpen: false,
    }),
}));
