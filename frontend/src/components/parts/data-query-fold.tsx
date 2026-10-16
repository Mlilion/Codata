"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Layers, AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataResultCard } from "./data-result-card";
import { hasCodataResult } from "@/lib/codata-artifact";
import type { ToolPart } from "@/types/message";

interface DataQueryFoldProps {
  /** The intermediate data-result cards to fold. */
  cards: ToolPart[];
}

/** One-line digest gleaned from a single query_indicator / execute_sql call. */
interface CardDigest {
  /** Short human description, e.g. "2024-01" or "省份×月份". */
  label: string;
  rowCount: number;
  truncated: boolean;
  colCount: number;
  /** Whether this card came from execute_sql (not query_indicator). */
  isCustomSql: boolean;
}

const MONTH_NAMES = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

function digestFromCard(card: ToolPart): CardDigest {
  const input = (card.state.input ?? {}) as Record<string, unknown>;
  const meta = (card.state.metadata ?? {}) as Record<string, unknown>;

  const rowCount =
    typeof meta.row_count === "number" ? meta.row_count : 0;
  const truncated = Boolean(meta.truncated);
  const colCount = Array.isArray(meta.columns) ? meta.columns.length : 0;

  // execute_sql tools carry no caliber → custom SQL
  const isCustomSql = hasCodataResult(meta) && meta.caliber == null;

  // Build a compact label from args — prefer month window when present.
  const parts: string[] = [];

  const start = typeof input.start === "string" ? input.start : "";
  const end = typeof input.end === "string" ? input.end : "";

  // Prefer month label when it's a single-month window
  const startMonth = start.slice(0, 7); // "2024-01"
  const endMonth = end.slice(0, 7);
  if (startMonth && startMonth === endMonth) {
    const m = parseInt(startMonth.slice(5), 10);
    if (m >= 1 && m <= 12) parts.push(MONTH_NAMES[m - 1]);
    else parts.push(startMonth);
  } else if (start && end) {
    parts.push(`${start.slice(0, 10)} – ${end.slice(0, 10)}`);
  }

  const dims = Array.isArray(input.dimensions) ? (input.dimensions as string[]).filter(Boolean) : [];
  if (dims.length > 0) {
    // Shorten dimension codes to last segment
    const short = dims.map((d) => d.split("_").pop() ?? d).join("×");
    parts.push(short);
  }

  return {
    label: parts.join(" · ") || card.tool.replace(/^(codataadmin_|codata_)/, ""),
    rowCount,
    truncated,
    colCount,
    isCustomSql,
  };
}

/**
 * Foldable group of intermediate data-result cards.
 *
 * When a single assistant turn produces more than a couple of query_result
 * cards (e.g. 12 month-by-month slices for a missing month grain), the
 * intermediate cards are noisy — users only care about the final answer.
 * This component folds them into a one-line summary, expandable on click.
 */
export function DataQueryFold({ cards }: DataQueryFoldProps) {
  const [open, setOpen] = useState(false);

  const digests = useMemo(() => cards.map(digestFromCard), [cards]);

  const totalRows = useMemo(() => digests.reduce((s, d) => s + d.rowCount, 0), [digests]);
  const anyTruncated = useMemo(() => digests.some((d) => d.truncated), [digests]);
  const customSqlCount = useMemo(() => digests.filter((d) => d.isCustomSql).length, [digests]);

  // Only show the first 8 digests inline; the rest go behind "..."
  const visibleDigests = digests.slice(0, 8);
  const overflow = Math.max(0, digests.length - 8);

  return (
    <div className={cn("data-agent-card overflow-hidden rounded-lg", open && "ring-1 ring-[var(--border-heavy)]")}>
      {/* Header row — always visible, click to toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-[var(--surface-tertiary)]/40 transition-colors"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-tertiary)]">
          <Layers className="h-4 w-4 text-[var(--text-tertiary)]" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
            取数过程 · {cards.length} 次查询
            {customSqlCount > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-sm bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                <Wrench className="h-3 w-3" />
                {customSqlCount} 次自定义 SQL
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            <span>{totalRows.toLocaleString()} 行总计</span>
            {anyTruncated ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-0.5 text-[var(--color-warning)]">
                  <AlertTriangle className="h-3 w-3" />
                  有截断
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-0.5 text-[var(--tool-completed)]">
                  <CheckCircle2 className="h-3 w-3" />
                  完整
                </span>
              </>
            )}
          </span>

          {/* Digest pills — compact per-card labels */}
          <span className="mt-1 flex flex-wrap gap-1">
            {visibleDigests.map((d, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 rounded-sm bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--text-tertiary)]"
              >
                {d.label}
                {d.truncated && (
                  <AlertTriangle className="h-2.5 w-2.5 text-[var(--color-warning)]" />
                )}
              </span>
            ))}
            {overflow > 0 && (
              <span className="text-[10px] text-[var(--text-quaternary)]">
                +{overflow} 更多
              </span>
            )}
          </span>
        </span>

        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        )}
      </button>

      {/* Expanded body — scrollable list of DataResultCards */}
      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--surface-primary)] max-h-[600px] overflow-y-auto overscroll-contain">
          <div className="divide-y divide-[var(--border-subtle)]">
            {cards.map((card) => (
              <div key={card.call_id} className="px-3 py-2">
                <DataResultCard data={card} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}