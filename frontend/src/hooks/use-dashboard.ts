"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type { DashboardItem, DashboardItemCreate } from "@/types/dashboard";

export function useDashboardItems() {
  return useQuery({
    queryKey: queryKeys.dashboard.all,
    queryFn: () => api.get<DashboardItem[]>(API.DASHBOARD.LIST),
    staleTime: 5_000,
  });
}

export function useCreateDashboardItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DashboardItemCreate) =>
      api.post<DashboardItem>(API.DASHBOARD.CREATE, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useRenameDashboardItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<DashboardItem>(API.DASHBOARD.DETAIL(id), { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useReorderDashboardItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.post(API.DASHBOARD.REORDER, { ordered_ids: orderedIds }),
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.all });
      const prev = queryClient.getQueryData<DashboardItem[]>(queryKeys.dashboard.all);
      if (prev) {
        const byId = new Map(prev.map((i) => [i.id, i]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((i): i is DashboardItem => !!i);
        queryClient.setQueryData<DashboardItem[]>(queryKeys.dashboard.all, reordered);
      }
      return { prev };
    },
    onError: (_err, _ids, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKeys.dashboard.all, context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useDeleteDashboardItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API.DASHBOARD.DELETE(id)),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.all });
      const prev = queryClient.getQueryData<DashboardItem[]>(queryKeys.dashboard.all);
      queryClient.setQueryData<DashboardItem[]>(
        queryKeys.dashboard.all,
        (old) => old?.filter((item) => item.id !== id) ?? [],
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKeys.dashboard.all, context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
