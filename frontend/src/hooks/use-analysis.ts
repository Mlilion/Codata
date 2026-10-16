"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

interface RecommendationsResponse {
  recommendations: string[];
}

/** History-based analysis suggestions for the Codata landing page. */
export function useAnalysisRecommendations(enabled = true) {
  return useQuery({
    queryKey: ["analysis", "recommendations"],
    queryFn: () => api.get<RecommendationsResponse>(API.ANALYSIS.RECOMMENDATIONS),
    enabled,
    staleTime: 30_000,
  });
}
