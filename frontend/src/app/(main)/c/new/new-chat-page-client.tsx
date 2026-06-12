"use client";

import { useSearchParams } from "next/navigation";
import { Landing } from "@/components/chat/landing";

export function NewChatPageClient() {
  const searchParams = useSearchParams();
  const directory = searchParams.get("directory");
  const skill = searchParams.get("skill");

  return <Landing directoryParam={directory ?? null} skillParam={skill ?? null} />;
}
