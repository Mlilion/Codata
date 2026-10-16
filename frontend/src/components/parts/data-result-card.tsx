"use client";

import { useMemo, useState } from "react";
import { Columns3, Database, ChevronDown, ChevronRight, Maximize2, Loader2, Table2, ShieldCheck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArtifactStore } from "@/stores/artifact-store";
import {
  codataArtifactFromMetadata,
  codataJobFromMetadata,
  codataIndicatorsFromMetadata,
} from "@/lib/codata-artifact";
import { SqlResultRenderer } from "@/components/artifacts/renderers/sql-result-renderer";
import { IndicatorListCard } from "./indicator-list-card";
import type { ToolPart } from "@/types/message";

interface DataResultCardProps {
  data: ToolPart;
  /** Whether the result body starts expanded. Final answer results default open. */
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
  const indicators = useMemo(() => codataIndicatorsFromMetadata(metadata), [metadata]);

  const [open, setOpen] = useState(defaultOpen);
  const [caliberDetailOpen, setCaliberDetailOpen] = useState(false);
  const [qualityDetailOpen, setQualityDetailOpen] = useState(false);

  const isRunning = data.state.status === "running" || data.state.status === "pending";
  if (isRunning) {
    return (
      <div className="data-agent-card flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm text-[var(--text-tertiary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="shimmer-text">正在查询…</span>
      </div>
    );
  }

  // Registered-metric search → list every match (not just the first's SQL).
  if (indicators) {
    const total = typeof metadata?.total === "number" ? metadata.total : undefined;
    return <IndicatorListCard indicators={indicators} total={total} />;
  }

  // Async job that hasn't produced rows yet — show its status.
  if (!artifact && job) {
    const failed = /fail|error/i.test(job.status);
    return (
      <div className="data-agent-card flex items-center gap-2.5 rounded-lg px-4 py-3">
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

  const { sqlResult, chartSpec, caliberSource } = artifact;
  const rowCount = sqlResult?.rowCount ?? sqlResult?.rows.length ?? 0;
  const colCount = sqlResult?.columns.length ?? 0;
  const summary = sqlResult
    ? `${rowCount} 行 · ${colCount} 列`
    : chartSpec
      ? chartSpec.chartType
      : "SQL";

  // --- Caliber badge state ---
  const caliberInfo = sqlResult?.caliber ?? null;
  const warnings = Array.isArray(caliberInfo?.warnings) ? caliberInfo.warnings : [];
  const knowledge = sqlResult?.knowledge ?? [];
  const topNLabel = sqlResult?.topNApplied && sqlResult.totalGroups != null
    ? `前 ${rowCount} / ${sqlResult.totalGroups} 组`
    : null;

  return (
    <div className="data-agent-card overflow-hidden rounded-lg">
      {/* Header row — click to toggle */}
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-expanded={open}
        >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--data-accent-soft)]">
              <Database className="h-4 w-4 text-[var(--data-accent)]" />
            </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 truncate text-sm font-medium text-[var(--text-primary)]">
              <span className="truncate">{artifact.title}</span>
              {/* ---- Caliber badge ---- */}
              {caliberSource === "authoritative" && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setCaliberDetailOpen((v) => !v); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setCaliberDetailOpen((v) => !v); } }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight cursor-pointer",
                    "bg-emerald-50 text-emerald-700 border border-emerald-200",
                    "dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
                    "hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors",
                  )}
                  title={caliberInfo?.indicator ? `口径: ${caliberInfo.indicator}` : "权威口径"}
                >
                  <ShieldCheck className="h-3 w-3" />
                  权威口径
                </span>
              )}
              {caliberSource === "custom" && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setCaliberDetailOpen((v) => !v); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setCaliberDetailOpen((v) => !v); } }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight cursor-pointer",
                    "bg-amber-50 text-amber-700 border border-amber-200",
                    "dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800",
                    "hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors",
                  )}
                  title="此结果来自自定义 SQL，未经指标中心审核"
                >
                  <Wrench className="h-3 w-3" />
                  自定义口径
                </span>
              )}
            </span>
            <span className="block text-xs text-[var(--text-tertiary)]">
              {topNLabel ?? `${summary} · 查询结果`}
            </span>
            {(warnings.length > 0 || knowledge.length > 0) && (
              <button
                type="button"
                className="mt-1 block truncate text-left text-[11px] text-[var(--color-warning)] hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  setQualityDetailOpen((value) => !value);
                }}
                aria-expanded={qualityDetailOpen}
              >
                {warnings.length + knowledge.length} 条口径提示
              </button>
            )}
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

      {/* Caliber detail popover — shown below header when badge is clicked */}
      {caliberDetailOpen && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)]/50 px-4 py-3">
          <div className="text-xs">
            {caliberSource === "authoritative" && caliberInfo ? (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  权威口径
                </span>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[var(--text-secondary)]">
                  {caliberInfo.indicator && (
                    <>
                      <span className="text-[var(--text-tertiary)]">指标编码</span>
                      <code className="text-[11px]">{caliberInfo.indicator}</code>
                    </>
                  )}
                  {caliberInfo.name && (
                    <>
                      <span className="text-[var(--text-tertiary)]">指标名称</span>
                      <span>{caliberInfo.name}</span>
                    </>
                  )}
                  {caliberInfo.unit && (
                    <>
                      <span className="text-[var(--text-tertiary)]">单位</span>
                      <span>{caliberInfo.unit}</span>
                    </>
                  )}
                  {caliberInfo.definition && (
                    <>
                      <span className="text-[var(--text-tertiary)]">口径定义</span>
                      <span className="text-[var(--text-quaternary)] italic">
                        {caliberInfo.definition}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                  <Wrench className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  自定义口径
                </span>
                <p className="text-[var(--text-secondary)]">
                  此结果来自自定义 SQL，未经指标中心审核。
                </p>
                {artifact.content && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                      查看 SQL
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto rounded border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {artifact.content}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {qualityDetailOpen && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)]/50 px-4 py-3">
          <div className="space-y-2 text-xs text-[var(--text-secondary)]">
            <div className="font-semibold text-[var(--text-primary)]">结果说明</div>
            {warnings.map((warning, index) => (
              <div key={`warning-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                {typeof warning === "string" ? warning : JSON.stringify(warning)}
              </div>
            ))}
            {knowledge.map((item, index) => (
              <div key={`knowledge-${index}`} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-2.5 py-2">
                {typeof item === "string" ? item : String(item.note ?? item.description ?? JSON.stringify(item))}
              </div>
            ))}
            {sqlResult?.topNApplied && (
              <div className="text-[var(--text-tertiary)]">
                此结果按用户请求执行 Top-N；总组数为 {sqlResult.totalGroups ?? "未知"}。
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded body — the shared tabbed renderer */}
      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--surface-primary)]">
          <div className="flex h-10 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)]/65 px-3">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
              <Table2 className="h-3.5 w-3.5 text-[var(--data-accent)]" />
              {rowCount.toLocaleString()} rows
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
              <Columns3 className="h-3.5 w-3.5" />
              {colCount} columns
            </span>
            <span className="min-w-2 flex-1" />
            <span className="text-[11px] text-[var(--text-quaternary)]">Result preview</span>
          </div>
          <div className="h-[360px]">
          <SqlResultRenderer artifact={artifact} />
          </div>
        </div>
      )}
    </div>
  );
}
