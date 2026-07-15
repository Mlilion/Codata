"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch } from "@/lib/api";

export interface KnowledgeEntry {
  id: string;
  title: string;
  feishu_url: string;
  doc_type: string;
  note: string;
  enabled: boolean;
  created_at: string;
  ingest_status: "pending" | "processing" | "done" | "failed";
  ingest_error: string;
  source_type: "feishu" | "file";
  source_name: string;
  file_path: string;
}

interface KnowledgeListResponse {
  entries: KnowledgeEntry[];
}

const KNOWLEDGE_KEY = ["knowledge"] as const;

export function useKnowledge() {
  return useQuery({
    queryKey: KNOWLEDGE_KEY,
    queryFn: async () => {
      const data = await api.get<KnowledgeListResponse>("/api/knowledge");
      return data.entries ?? [];
    },
    staleTime: 5_000,
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some(
        (e) => e.ingest_status === "pending" || e.ingest_status === "processing",
      )
        ? 3000
        : false;
    },
  });
}

export function useReingestKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/knowledge/${id}/reingest`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
    },
  });
}

export function useAddKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { feishu_url: string; note?: string }) =>
      api.post<KnowledgeEntry>("/api/knowledge", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
    },
  });
}

export function useUploadKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/api/knowledge/upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ?? "上传失败");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
    },
  });
}

export function usePatchKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      note?: string;
      enabled?: boolean;
      title?: string;
    }) => api.patch<KnowledgeEntry>(`/api/knowledge/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
    },
  });
}

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/knowledge/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
    },
  });
}
