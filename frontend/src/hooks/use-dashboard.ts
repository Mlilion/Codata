"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type {
  Dashboard,
  DashboardCreate,
  DashboardItem,
  DashboardItemCreate,
  DashboardLayout,
} from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Dashboards (named collections)
// ---------------------------------------------------------------------------

export function useDashboards() {
  return useQuery({
    queryKey: queryKeys.dashboard.list,
    queryFn: () => api.get<Dashboard[]>(API.DASHBOARD.DASHBOARDS),
    staleTime: 5_000,
  });
}

export function useCreateDashboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DashboardCreate) =>
      api.post<Dashboard>(API.DASHBOARD.DASHBOARDS, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.list });
    },
  });
}

export function useRenameDashboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<Dashboard>(API.DASHBOARD.DASHBOARD_DETAIL(id), { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.list });
    },
  });
}

export function useDeleteDashboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API.DASHBOARD.DASHBOARD_DETAIL(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.list });
    },
  });
}

// ---------------------------------------------------------------------------
// Items (pinned charts), scoped to a dashboard
// ---------------------------------------------------------------------------

export function useDashboardItems(dashboardId?: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.items(dashboardId),
    queryFn: () => api.get<DashboardItem[]>(API.DASHBOARD.ITEMS(dashboardId)),
    staleTime: 5_000,
    enabled: dashboardId === undefined || !!dashboardId,
  });
}

export function useCreateDashboardItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DashboardItemCreate) =>
      api.post<DashboardItem>(API.DASHBOARD.CREATE, data),
    onSuccess: () => {
      // Refresh both the item lists and the per-board counts.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRefreshDashboardItem(dashboardId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<DashboardItem>(API.DASHBOARD.REFRESH(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.items(dashboardId) });
    },
  });
}

export function useRenameDashboardItem(dashboardId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<DashboardItem>(API.DASHBOARD.DETAIL(id), { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.items(dashboardId) });
    },
  });
}

/** Persist grid-canvas positions/sizes. Optimistic so drags/resizes stick instantly. */
export function useSaveDashboardLayout(dashboardId?: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.dashboard.items(dashboardId);
  return useMutation({
    mutationFn: (layouts: Array<{ id: string } & DashboardLayout>) =>
      api.post(API.DASHBOARD.LAYOUT, { layouts }),
    onMutate: async (layouts) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<DashboardItem[]>(key);
      if (prev) {
        const byId = new Map(layouts.map((l) => [l.id, l]));
        queryClient.setQueryData<DashboardItem[]>(
          key,
          prev.map((item) => {
            const l = byId.get(item.id);
            return l ? { ...item, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : item;
          }),
        );
      }
      return { prev };
    },
    onError: (_err, _layouts, context) => {
      if (context?.prev) {
        queryClient.setQueryData(key, context.prev);
      }
    },
    // No onSettled invalidate: refetching mid-drag would clobber local state.
  });
}

export function useDeleteDashboardItem(dashboardId?: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.dashboard.items(dashboardId);
  return useMutation({
    mutationFn: (id: string) => api.delete(API.DASHBOARD.DELETE(id)),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<DashboardItem[]>(key);
      queryClient.setQueryData<DashboardItem[]>(
        key,
        (old) => old?.filter((item) => item.id !== id) ?? [],
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        queryClient.setQueryData(key, context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
