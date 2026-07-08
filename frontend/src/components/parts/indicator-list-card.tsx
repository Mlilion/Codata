"use client";

import { useEffect, useState } from "react";
import { Gauge, ChevronDown, ChevronRight, Copy, Check, CircleDollarSign, LineChart, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IndicatorItem } from "@/lib/codata-artifact";

interface IndicatorListCardProps {
  indicators: IndicatorItem[];
  total?: number;
}

function indicatorIcon(item: IndicatorItem) {
  const key = `${item.code ?? ""} ${item.name ?? ""}`.toLowerCase();
  if (key.includes("pay") || key.includes("paid") || key.includes("arpu") || key.includes("付费")) {
    return CircleDollarSign;
  }
  if (key.includes("user") || key.includes("dau") || key.includes("活跃") || key.includes("留存")) {
    return Users;
  }
  return LineChart;
}

function SqlDrawer({ item }: { item: IndicatorItem }) {
  const [copied, setCopied] = useState(false);
  const hasSql = !!item.sql?.trim();

  const copySql = () => {
    if (!item.sql) return;
    navigator.clipboard.writeText(item.sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-t border-[rgba(11,118,246,0.14)] bg-[rgba(11,118,246,0.035)] px-4 pb-4 pt-0">
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-primary)]">
        <div className="flex h-9 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)]/70 px-3">
          <span className={cn("h-2 w-2 rounded-full", hasSql ? "bg-[var(--color-success)]" : "bg-[var(--border-heavy)]")} />
          <span className="text-xs font-medium text-[var(--text-secondary)]">SQL 计算逻辑</span>
          <span className="min-w-0 flex-1" />
          {hasSql && (
            <button
              type="button"
              onClick={copySql}
              title="复制 SQL"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        {hasSql ? (
          <pre className="max-h-44 overflow-x-auto overflow-y-auto px-4 py-3 font-mono text-xs leading-6 text-[var(--text-primary)] scrollbar-auto">
            <code>{item.sql}</code>
          </pre>
        ) : (
          <div className="px-4 py-5 text-sm text-[var(--text-tertiary)]">
            当前指标未返回 SQL。
          </div>
        )}
      </div>
    </div>
  );
}

function IndicatorRow({
  item,
  expanded,
  onToggle,
}: {
  item: IndicatorItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = indicatorIcon(item);
  const hasSql = !!item.sql?.trim();

  return (
    <div
      className={cn(
        "border-t border-[var(--border-subtle)] first:border-t-0",
        expanded && "bg-[rgba(11,118,246,0.04)] shadow-[inset_3px_0_0_var(--data-accent)]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "group grid min-h-14 w-full grid-cols-[minmax(180px,1.1fr)_minmax(150px,0.9fr)_80px_minmax(220px,1.5fr)_48px] items-center gap-4 px-4 py-3 text-left transition-colors",
          "hover:bg-[rgba(11,118,246,0.025)]",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
              expanded
                ? "border-[rgba(11,118,246,0.18)] bg-[var(--data-accent-soft)] text-[var(--data-accent)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-secondary)] text-[var(--text-tertiary)]",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
            {item.name || item.code || "指标"}
          </span>
        </span>
        <span className="min-w-0">
          {item.code ? (
            <span className="inline-block max-w-full truncate rounded-md bg-[var(--surface-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)]">
              {item.code}
            </span>
          ) : (
            <span className="text-xs text-[var(--text-tertiary)]">-</span>
          )}
        </span>
        <span className="min-w-0 text-sm text-[var(--text-secondary)]">
          {item.unit ? (
            <span className="inline-flex min-w-8 justify-center rounded-md bg-[var(--surface-secondary)] px-2 py-1 text-xs">
              {item.unit}
            </span>
          ) : (
            <span className="text-xs text-[var(--text-tertiary)]">-</span>
          )}
        </span>
        <span className="min-w-0 truncate text-sm text-[var(--text-secondary)]">
          {item.description || "暂无指标说明"}
        </span>
        <span className="flex justify-end">
          {hasSql ? (
            <ChevronDown
              className={cn(
                "h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:text-[var(--text-secondary)]",
                !expanded && "-rotate-90",
              )}
            />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
          )}
        </span>
      </button>
      {expanded && <SqlDrawer item={item} />}
    </div>
  );
}

/**
 * Renders a search_indicators / compile_metric_sql result as a list of
 * registered metrics. Multiple matches are grouped into a compact picker so
 * the user can inspect each metric's authoritative SQL without a tall stack.
 */
export function IndicatorListCard({ indicators, total }: IndicatorListCardProps) {
  const shown = indicators.length;
  const more = typeof total === "number" && total > shown ? total - shown : 0;
  const [open, setOpen] = useState(true);
  const firstSqlIndex = indicators.findIndex((item) => item.sql?.trim());
  const [expandedIndex, setExpandedIndex] = useState(firstSqlIndex >= 0 ? firstSqlIndex : 0);

  useEffect(() => {
    if (expandedIndex >= indicators.length) {
      setExpandedIndex(firstSqlIndex >= 0 ? firstSqlIndex : indicators.length ? 0 : -1);
    }
  }, [expandedIndex, firstSqlIndex, indicators.length]);

  return (
    <div className="data-agent-card overflow-hidden rounded-lg">
      <div className="flex items-center gap-3 border-b border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[rgba(11,118,246,0.18)] bg-[var(--data-accent-soft)]">
          <Gauge className="h-5 w-5 text-[var(--data-accent)]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text-primary)]">指标匹配</span>
          <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
            {shown} 个匹配{more > 0 ? ` · 共 ${total} 个` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
          title={open ? "收起" : "展开"}
          aria-expanded={open}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>
      {open && (
        <>
          <div className="overflow-x-auto bg-[var(--surface-primary)] scrollbar-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(180px,1.1fr)_minmax(150px,0.9fr)_80px_minmax(220px,1.5fr)_48px] gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)]/55 px-4 py-2.5 text-xs font-medium text-[var(--text-tertiary)]">
                <span>指标</span>
                <span>Code</span>
                <span>Unit</span>
                <span>说明</span>
                <span className="text-right">操作</span>
              </div>
              {indicators.map((item, i) => (
                <IndicatorRow
                  key={item.code || i}
                  item={item}
                  expanded={i === expandedIndex}
                  onToggle={() => setExpandedIndex((current) => (current === i ? -1 : i))}
                />
              ))}
            </div>
          </div>
          <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-primary)] px-4 py-2.5 text-xs text-[var(--text-tertiary)]">
            点击指标查看计算逻辑（SQL）。
          </div>
        </>
      )}
    </div>
  );
}
