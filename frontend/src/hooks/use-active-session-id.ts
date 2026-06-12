"use client";

import { useParams, useSearchParams } from "next/navigation";
import { resolveSessionId } from "@/lib/routes";

export function useActiveSessionId() {
  const params = useParams();
  const searchParams = useSearchParams();
  return resolveSessionId(
    typeof params.sessionId === "string" ? params.sessionId : null,
    searchParams.get("sessionId"),
  );
}
