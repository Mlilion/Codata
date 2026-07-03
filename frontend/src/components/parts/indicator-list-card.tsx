"use client";

import { useState } from "react";
import { Gauge, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IndicatorItem } from "@/lib/codata-artifact";

interface IndicatorListCardProps {
  indicators: IndicatorItem[];
  total?: number;
}

function IndicatorRow({ item }: { item: IndicatorItem }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasSql = !!item.sql?.trim();

  const copySql = () => {
    if (!item.sql) return;
    navigator.clipboard.writeText(item.sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-b border-[var(--border-default)] last:border-b-0">
      <button
        type="button"
        onClick={() => hasSql && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left",
          hasSql && "hover:bg-[var(--surface-secondary)]",
        )}
        aria-expanded={hasSql ? open : undefined}
      >
        {hasSql ? (
          open ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">
              {item.name || item.code || "指标"}
            </span>
            {item.unit && (
              <span className="shrink-0 rounded bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                {item.unit}
              </span>
            )}
          </span>
          {item.code && item.name && (
            <span className="block truncate text-xs text-[var(--text-tertiary)]">{item.code}</span>
          )}
          {item.description && (
            <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
              {item.description}
            </span>
          )}
        </span>
      </button>
      {open && hasSql && (
        <div className="relative mx-3 mb-2 rounded-lg bg-[var(--surface-secondary)]">
          <button
            type="button"
            onClick={copySql}
            title="复制 SQL"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <pre className="overflow-x-auto p-3 pr-10 text-xs text-[var(--text-primary)]">
            <code>{item.sql}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a search_indicators / compile_metric_sql result as a list of
 * registered metrics. Each row expands to show its authoritative SQL — so a
 * multi-metric search shows every match, not just the first one's SQL.
 */
export function IndicatorListCard({ indicators, total }: IndicatorListCardProps) {
  const shown = indicators.length;
  const more = typeof total === "number" && total > shown ? total - shown : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
          <Gauge className="h-4 w-4 text-[var(--brand-primary)]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[var(--text-primary)]">指标</span>
          <span className="block text-xs text-[var(--text-tertiary)]">
            {shown} 个匹配{more > 0 ? ` · 共 ${total} 个` : ""}
          </span>
        </span>
      </div>
      <div>
        {indicators.map((item, i) => (
          <IndicatorRow key={item.code || i} item={item} />
        ))}
      </div>
    </div>
  );
}
