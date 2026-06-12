"use client";

import { ArrowLeft, PlugZap, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConnectorsTab } from "@/app/(main)/plugins/content";

export default function McpPage() {
  const [search, setSearch] = useState("");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-chat)]">
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4 lg:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" asChild>
                <Link href="/c/new">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <PlugZap className="h-5 w-5 text-[var(--text-secondary)]" />
              <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">MCP</h1>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              管理外部连接器、自定义 MCP Server 和工具连接状态。
            </p>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 MCP 连接器"
              className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-focus)]"
            />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-7 scrollbar-auto">
        <div className="mx-auto max-w-4xl">
          <ConnectorsTab search={search} />
        </div>
      </div>
    </div>
  );
}
