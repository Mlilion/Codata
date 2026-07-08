"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

interface DataSourceStatus {
  connected: boolean;
}

/** Whether a datasage data source is connected — gates the Codata onboarding guide. */
export function useDataSourceStatus(enabled = true) {
  return useQuery({
    queryKey: ["data-source-status"],
    queryFn: () => api.get<DataSourceStatus>(API.DATA_SOURCE.STATUS),
    enabled,
    staleTime: 30_000,
  });
}
