"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { setStreamRegistryQueryClient } from "@/lib/session-stream-registry";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000, // 60 seconds - increased from 30s for better caching
          gcTime: 5 * 60 * 1000, // 5 minutes - retain frequently accessed data
          retry: 1,
          refetchOnWindowFocus: false,
          structuralSharing: true, // Prevent unnecessary re-renders
        },
      },
    });
    setStreamRegistryQueryClient(qc);
    return qc;
  });

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
