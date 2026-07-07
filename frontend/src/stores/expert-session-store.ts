"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SelectedExpertTeam {
  id: string;
  name: string;
  description?: string;
}

export const CREATE_EXPERT_TEAMS_SKILL = "create_expert_teams";

export interface ExpertTeamCreationMode {
  skill: typeof CREATE_EXPERT_TEAMS_SKILL;
  title: string;
  description?: string;
  model?: string | null;
  providerId?: string | null;
  startedAt: number;
}

interface ExpertSessionStore {
  selectedBySession: Record<string, SelectedExpertTeam>;
  creationBySession: Record<string, ExpertTeamCreationMode>;
  setSelectedExpertTeam: (sessionId: string, team: SelectedExpertTeam) => void;
  clearSelectedExpertTeam: (sessionId: string) => void;
  getSelectedExpertTeam: (sessionId: string | null | undefined) => SelectedExpertTeam | null;
  setExpertTeamCreationMode: (sessionId: string, mode?: Partial<ExpertTeamCreationMode>) => void;
  clearExpertTeamCreationMode: (sessionId: string) => void;
  getExpertTeamCreationMode: (sessionId: string | null | undefined) => ExpertTeamCreationMode | null;
}

export const DRAFT_EXPERT_SESSION_ID = "__draft__";

export const useExpertSessionStore = create<ExpertSessionStore>()(
  persist(
    (set, get) => ({
      selectedBySession: {},
      creationBySession: {},
      setSelectedExpertTeam: (sessionId, team) =>
        set((state) => {
          const nextCreation = { ...state.creationBySession };
          delete nextCreation[sessionId];
          return {
            selectedBySession: {
              ...state.selectedBySession,
              [sessionId]: team,
            },
            creationBySession: nextCreation,
          };
        }),
      clearSelectedExpertTeam: (sessionId) =>
        set((state) => {
          const next = { ...state.selectedBySession };
          delete next[sessionId];
          return { selectedBySession: next };
        }),
      getSelectedExpertTeam: (sessionId) => {
        return get().selectedBySession[sessionId || DRAFT_EXPERT_SESSION_ID] ?? null;
      },
      setExpertTeamCreationMode: (sessionId, mode) =>
        set((state) => {
          const nextSelected = { ...state.selectedBySession };
          delete nextSelected[sessionId];
          return {
            selectedBySession: nextSelected,
            creationBySession: {
              ...state.creationBySession,
              [sessionId]: {
                skill: CREATE_EXPERT_TEAMS_SKILL,
                title: "AI 创建专家团",
                description: "描述专家团需求后，将通过 create_expert_teams 生成可保存的专家团草稿。",
                startedAt: Date.now(),
                ...mode,
              },
            },
          };
        }),
      clearExpertTeamCreationMode: (sessionId) =>
        set((state) => {
          const next = { ...state.creationBySession };
          delete next[sessionId];
          return { creationBySession: next };
        }),
      getExpertTeamCreationMode: (sessionId) => {
        return get().creationBySession[sessionId || DRAFT_EXPERT_SESSION_ID] ?? null;
      },
    }),
    {
      name: "codata-expert-sessions",
    },
  ),
);
