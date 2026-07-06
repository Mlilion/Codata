"use client";

import { useMemo, useState } from "react";
import { Code2, BarChart3, Table2, Settings2, Pin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Artifact, ChartSpec } from "@/types/artifact";
import { cn } from "@/lib/utils";
import { useCreateDashboardItem } from "@/hooks/use-dashboard";
import { CodeRenderer } from "./code-renderer";
import { DataTable } from "./data-table";
import { ChartRenderer } from "./chart-renderer";
import { ChartConfigPanel, defaultChartSpec } from "./chart-config-panel";

type TabId = "table" | "sql" | "chart";

interface SqlResultRendererProps {
  artifact: Artifact;
  /** Show the "pin to dashboard" action on the chart tab (default true). */
  pinnable?: boolean;
}

/**
 * Codata data-result renderer: a tabbed card showing the result table, the
 * generated SQL, and a chart. The chart tab is always available when there is
 * tabular data — if the model didn't supply a chart spec, we derive a sensible
 * default and let the user configure it (type / axes / series / title).
 */
export function SqlResultRenderer({ artifact, pinnable = true }: SqlResultRendererProps) {
  const { sqlResult, chartSpec } = artifact;
  const sql = sqlResult?.sql ?? artifact.content ?? "";
  const createDashboardItem = useCreateDashboardItem();

  const hasTable = !!sqlResult && sqlResult.columns.length > 0;
  const hasSql = sql.trim().length > 0;
  // A chart is possible whenever we have tabular data — model-supplied or not.
  const canChart = hasTable;

  // Editable chart spec: seed from the model's spec, else a derived default.
  const [spec, setSpec] = useState<ChartSpec | null>(() =>
    chartSpec ?? (sqlResult && hasTable ? defaultChartSpec(sqlResult) : null),
  );
  const [configOpen, setConfigOpen] = useState(false);

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string; icon: typeof Table2 }[] = [];
    if (hasTable) list.push({ id: "table", label: "结果", icon: Table2 });
    if (canChart) list.push({ id: "chart", label: "图表", icon: BarChart3 });
    if (hasSql) list.push({ id: "sql", label: "SQL", icon: Code2 });
    return list;
  }, [hasTable, canChart, hasSql]);

  // Default to the chart tab only when the model actively supplied a chart.
  const [active, setActive] = useState<TabId>(() =>
    chartSpec ? "chart" : hasTable ? "table" : "sql",
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

  const handlePin = () => {
    if (!spec || !sqlResult) return;
    createDashboardItem.mutate(
      { title: spec.title || artifact.title || "查询结果", payload: { chartSpec: spec, sqlResult } },
      {
        onSuccess: () => toast.success("已钉到看板"),
        onError: () => toast.error("钉看板失败"),
      },
    );
  };

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
        {/* Chart-tab actions: configure + pin to dashboard */}
        {activeTab === "chart" && spec && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              title="配置图表"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors",
                configOpen
                  ? "bg-[var(--surface-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)]",
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>配置</span>
            </button>
            {pinnable && (
              <button
                type="button"
                onClick={handlePin}
                disabled={createDashboardItem.isPending}
                title="钉到看板"
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
              >
                {createDashboardItem.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pin className="h-3.5 w-3.5" />
                )}
                <span>钉看板</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {activeTab === "table" && sqlResult && (
          <DataTable
            headers={headers}
            rows={sqlResult.rows}
            totalRowCount={sqlResult.rowCount}
            truncated={sqlResult.truncated}
            downloadName={artifact.title || "result"}
          />
        )}
        {activeTab === "chart" && spec && sqlResult && (
          <>
            {configOpen && (
              <ChartConfigPanel
                columns={sqlResult.columns}
                spec={spec}
                onChange={setSpec}
              />
            )}
            <div className="min-h-0 flex-1">
              <ChartRenderer spec={spec} data={sqlResult} />
            </div>
          </>
        )}
        {activeTab === "sql" && <CodeRenderer content={sql} language={sqlResult?.dialect || "sql"} />}
      </div>
    </div>
  );
}
