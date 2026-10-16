"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type {
  ExpertRolesResponse,
  ExpertTeamConfig,
  ExpertTeamDetailResponse,
  ExpertTeamWriteRequest,
  ExpertTeamsResponse,
  GenerateExpertTeamRequest,
  GenerateExpertTeamResponse,
  SummonExpertTeamResponse,
  ValidateExpertTeamResponse,
} from "@/types/expert-teams";

export function useExpertTeams() {
  return useQuery({
    queryKey: queryKeys.expertTeams.all,
    queryFn: () => api.get<ExpertTeamsResponse>(API.EXPERT_TEAMS.LIST),
    staleTime: 30_000,
  });
}

export function useExpertRoles() {
  return useQuery({
    queryKey: queryKeys.expertRoles,
    queryFn: () => api.get<ExpertRolesResponse>(API.EXPERT_ROLES.LIST),
    staleTime: 60_000,
  });
}

export function useExpertTeamDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.expertTeams.detail(id ?? ""),
    queryFn: () => api.get<ExpertTeamDetailResponse>(API.EXPERT_TEAMS.DETAIL(id!)),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useSummonExpertTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
      model,
      provider_id,
      workspace,
      permission_presets,
      permission_rules,
      reasoning,
    }: {
      id: string;
      input: string;
      model?: string | null;
      provider_id?: string | null;
      workspace?: string | null;
      permission_presets?: Record<string, boolean> | null;
      permission_rules?: Array<{ action: "allow" | "deny"; permission: string; pattern?: string }> | null;
      reasoning?: boolean | null;
    }) =>
      api.post<SummonExpertTeamResponse>(
        API.EXPERT_TEAMS.SUMMON(id),
        {
          input,
          model,
          provider_id,
          workspace,
          permission_presets,
          permission_rules,
          reasoning,
        },
        { timeoutMs: 30_000 },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
}

export function useCreateExpertTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ExpertTeamWriteRequest) =>
      api.post<ExpertTeamDetailResponse>(API.EXPERT_TEAMS.CREATE, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expertTeams.all });
    },
  });
}

export function useGenerateExpertTeam() {
  return useMutation({
    mutationFn: (body: GenerateExpertTeamRequest) =>
      api.post<GenerateExpertTeamResponse>(API.EXPERT_TEAMS.GENERATE, body, {
        timeoutMs: 180_000,
      }),
  });
}

export function useValidateExpertTeam() {
  return useMutation({
    mutationFn: (team: ExpertTeamConfig) =>
      api.post<ValidateExpertTeamResponse>(API.EXPERT_TEAMS.VALIDATE, { team }),
  });
}

export function useUpdateExpertTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ExpertTeamWriteRequest) =>
      api.put<ExpertTeamDetailResponse>(API.EXPERT_TEAMS.UPDATE(request.team.id), request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expertTeams.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.expertTeams.detail(data.team.id) });
    },
  });
}

export function useDeleteExpertTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(API.EXPERT_TEAMS.DELETE(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expertTeams.all });
    },
  });
}
