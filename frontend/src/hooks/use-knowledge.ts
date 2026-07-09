"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface KnowledgeEntry {
  id: string;
  title: string;
  feishu_url: string;
  doc_type: string;
  note: string;
  enabled: boolean;
  created_at: string;
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
