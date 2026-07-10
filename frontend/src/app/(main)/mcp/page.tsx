"use client";

import { PlugZap, Search } from "lucide-react";
import { useState } from "react";
import { PageContent, PageFrame, PageHeader } from "@/components/ui/page-frame";
import { ConnectorsTab } from "@/app/(main)/plugins/content";

export default function McpPage() {
  const [search, setSearch] = useState("");

  return (
    <PageFrame className="flex-1">
      <PageContent className="max-w-5xl lg:py-8">
        <PageHeader
          title="MCP"
          description="管理外部连接器、自定义 MCP Server 和工具连接状态。"
          icon={PlugZap}
          backHref="/c/new"
          actions={
            <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 MCP 连接器"
              className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-focus)]"
              />
            </div>
          }
        />
        <ConnectorsTab search={search} />
      </PageContent>
    </PageFrame>
  );
}
