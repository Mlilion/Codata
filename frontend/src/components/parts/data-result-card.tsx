"use client";

import { useMemo, useState } from "react";
import { Database, ChevronDown, ChevronRight, Maximize2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArtifactStore } from "@/stores/artifact-store";
import { codataArtifactFromMetadata, codataJobFromMetadata } from "@/lib/codata-artifact";
import { SqlResultRenderer } from "@/components/artifacts/renderers/sql-result-renderer";
import type { ToolPart } from "@/types/message";

interface DataResultCardProps {
  data: ToolPart;
  /** The most recent data card in the thread starts expanded; older ones collapse. */
  defaultOpen?: boolean;
}

/**
 * Codata inline data card — the main-area answer card (à la WrenAI). Reads the
 * structured `codata_kind` payload off the tool result's metadata and renders
 * the shared tabbed result (结果 / 图表 / SQL) directly in the message thread.
 *
 * Collapsed cards show a one-line summary; the latest result opens expanded.
 * The ↗ button promotes the same artifact into the right panel for a wider view.
 */
export function DataResultCard({ data, defaultOpen = false }: DataResultCardProps) {
  const openArtifact = useArtifactStore((s) => s.openArtifact);
  const metadata = (data.state.metadata ?? null) as Record<string, unknown> | null;
  const title = (data.state.title as string | undefined) ?? undefined;

  const artifact = useMemo(
    () => codataArtifactFromMetadata(data.call_id, title, metadata),
    [data.call_id, title, metadata],
  );
  const job = useMemo(() => codataJobFromMetadata(metadata), [metadata]);

  const [open, setOpen] = useState(defaultOpen);

  const isRunning = data.state.status === "running" || data.state.status === "pending";
  if (isRunning) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-[var(--text-tertiary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="shimmer-text">正在查询…</span>
      </div>
    );
  }

  // Async job that hasn't produced rows yet — show its status.
  if (!artifact && job) {
    const failed = /fail|error/i.test(job.status);
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
          {failed ? (
            <Database className="h-4 w-4 text-[var(--color-destructive)]" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-primary)]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
            {failed ? "查询失败" : "查询进行中"}
          </span>
          <span className="block truncate text-xs text-[var(--text-tertiary)]">
            {[
              job.jobId && `任务 ${job.jobId}`,
              !failed && job.estimatedSeconds ? `预计 ${job.estimatedSeconds}s` : null,
              job.status && `状态 ${job.status}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </div>
    );
  }

  if (!artifact) return null;

  const { sqlResult, chartSpec } = artifact;
  const rowCount = sqlResult?.rowCount ?? sqlResult?.rows.length ?? 0;
  const colCount = sqlResult?.columns.length ?? 0;
  const summary = sqlResult
    ? `${rowCount} 行 · ${colCount} 列`
    : chartSpec
      ? chartSpec.chartType
      : "SQL";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
      {/* Header row — click to toggle */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
            <Database className="h-4 w-4 text-[var(--brand-primary)]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
              {artifact.title}
            </span>
            <span className="block text-xs text-[var(--text-tertiary)]">{summary}</span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => openArtifact(artifact)}
          title="在侧栏放大查看"
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            "text-[var(--text-tertiary)] hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]",
            "transition-colors",
          )}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded body — the shared tabbed renderer */}
      {open && (
        <div className="h-[420px] border-t border-[var(--border-default)] bg-[var(--surface-primary)]">
          <SqlResultRenderer artifact={artifact} />
        </div>
      )}
    </div>
  );
}
