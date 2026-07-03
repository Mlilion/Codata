"use client";

import { useMemo, useState } from "react";
import { Code2, BarChart3, Table2 } from "lucide-react";
import type { Artifact } from "@/types/artifact";
import { cn } from "@/lib/utils";
import { CodeRenderer } from "./code-renderer";
import { DataTable } from "./data-table";
import { ChartRenderer } from "./chart-renderer";

type TabId = "table" | "sql" | "chart";

interface SqlResultRendererProps {
  artifact: Artifact;
}

/**
 * Codata data-result renderer: a tabbed card showing the result table, the
 * generated SQL, and (when available) an auto-generated chart. Consumes the
 * structured `sqlResult` / `chartSpec` carried on the artifact.
 */
export function SqlResultRenderer({ artifact }: SqlResultRendererProps) {
  const { sqlResult, chartSpec } = artifact;
  const sql = sqlResult?.sql ?? artifact.content ?? "";

  const hasTable = !!sqlResult && sqlResult.columns.length > 0;
  const hasChart = !!chartSpec && hasTable;
  const hasSql = sql.trim().length > 0;

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string; icon: typeof Table2 }[] = [];
    if (hasTable) list.push({ id: "table", label: "结果", icon: Table2 });
    if (hasChart) list.push({ id: "chart", label: "图表", icon: BarChart3 });
    if (hasSql) list.push({ id: "sql", label: "SQL", icon: Code2 });
    return list;
  }, [hasTable, hasChart, hasSql]);

  const [active, setActive] = useState<TabId>(() =>
    hasChart ? "chart" : hasTable ? "table" : "sql",
  );

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
        无结果数据
      </div>
    );
  }

  const activeTab = tabs.some((t) => t.id === active) ? active : tabs[0].id;

  const headers = sqlResult?.columns.map((c) => c.name) ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--border-default)] bg-[var(--surface-primary)] px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors",
                selected
                  ? "bg-[var(--surface-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1">
        {activeTab === "table" && sqlResult && (
          <DataTable
            headers={headers}
            rows={sqlResult.rows}
            totalRowCount={sqlResult.rowCount}
            truncated={sqlResult.truncated}
            downloadName={artifact.title || "result"}
          />
        )}
        {activeTab === "chart" && chartSpec && sqlResult && (
          <ChartRenderer spec={chartSpec} data={sqlResult} />
        )}
        {activeTab === "sql" && <CodeRenderer content={sql} language={sqlResult?.dialect || "sql"} />}
      </div>
    </div>
  );
}
