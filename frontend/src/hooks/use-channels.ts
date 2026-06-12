"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type {
  ChannelsResponse,
  FeishuQrStartResponse,
  FeishuQrStatusResponse,
  WeixinQrStartResponse,
  WeixinQrStatusResponse,
} from "@/types/channels";

export function useChannels() {
  return useQuery({
    queryKey: queryKeys.channels,
    queryFn: () => api.get<ChannelsResponse>(API.CHANNELS.LIST),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useAddChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean; message: string }>(API.CHANNELS.ADD, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.channels });
    },
  });
}

export function useRemoveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { channel: string; account?: string }) =>
      api.post<{ ok: boolean; message: string }>(API.CHANNELS.REMOVE, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.channels });
    },
  });
}

export function useStartWeixinQrLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { base_url?: string; route_tag?: string; allow_from?: string[] }) =>
      api.post<WeixinQrStartResponse>(API.CHANNELS.WEIXIN_QR_START, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.channels });
    },
  });
}

export function useWeixinQrStatus(sessionId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionId ? ["channels", "weixin-qr", sessionId] : ["channels", "weixin-qr"],
    enabled: !!sessionId,
    queryFn: async () => {
      const result = await api.get<WeixinQrStatusResponse>(
        API.CHANNELS.WEIXIN_QR_STATUS(sessionId!),
        { timeoutMs: 45_000 },
      );
      if (result.status === "confirmed") {
        qc.invalidateQueries({ queryKey: queryKeys.channels });
      }
      return result;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "confirmed" || status === "expired" || status === "error" ? false : 2000;
    },
    retry: false,
  });
}

export function useCancelWeixinQrLogin() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean }>(API.CHANNELS.WEIXIN_QR_CANCEL(sessionId)),
  });
}

export function useStartFeishuQrRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { allow_from?: string[] }) =>
      api.post<FeishuQrStartResponse>(API.CHANNELS.FEISHU_QR_START, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.channels });
    },
  });
}

export function useFeishuQrStatus(sessionId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionId ? ["channels", "feishu-qr", sessionId] : ["channels", "feishu-qr"],
    enabled: !!sessionId,
    queryFn: async () => {
      const result = await api.get<FeishuQrStatusResponse>(
        API.CHANNELS.FEISHU_QR_STATUS(sessionId!),
        { timeoutMs: 45_000 },
      );
      if (result.status === "confirmed") {
        qc.invalidateQueries({ queryKey: queryKeys.channels });
      }
      return result;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "confirmed" || status === "expired" || status === "error") return false;
      return Math.max(2, query.state.data?.interval ?? 2) * 1000;
    },
    retry: false,
  });
}

export function useCancelFeishuQrRegistration() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean }>(API.CHANNELS.FEISHU_QR_CANCEL(sessionId)),
  });
}
