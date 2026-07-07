"use client";

import { useMemo } from "react";
import type { ChartSpec, ChartType, SqlResultData } from "@/types/artifact";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "柱状图" },
  { value: "grouped_bar", label: "分组柱状" },
  { value: "stacked_bar", label: "堆叠柱状" },
  { value: "line", label: "折线图" },
  { value: "multi_line", label: "多折线" },
  { value: "area", label: "面积图" },
  { value: "pie", label: "饼图" },
];

interface ChartConfigPanelProps {
  columns: { name: string; type?: string }[];
  spec: ChartSpec;
  onChange: (spec: ChartSpec) => void;
}

/** True if a column's sampled values are mostly numeric. */
export function isNumericColumn(data: SqlResultData, colIndex: number): boolean {
  let numeric = 0;
  let seen = 0;
  for (const row of data.rows.slice(0, 30)) {
    const v = row[colIndex];
    if (v === null || v === undefined || v === "") continue;
    seen += 1;
    if (typeof v === "number" || !isNaN(Number(String(v).replace(/,/g, "")))) numeric += 1;
  }
  return seen > 0 && numeric / seen >= 0.7;
}

/** Pick a sensible default chart spec for a result: first text col = x, first numeric col = y. */
export function defaultChartSpec(data: SqlResultData): ChartSpec {
  const names = data.columns.map((c) => c.name);
  const numericIdx = names.map((_, i) => i).filter((i) => isNumericColumn(data, i));
  const numericSet = new Set(numericIdx);
  const xIdx = names.findIndex((_, i) => !numericSet.has(i));
  const x = names[xIdx >= 0 ? xIdx : 0] ?? names[0] ?? "";
  const yIdx = numericIdx.find((i) => names[i] !== x) ?? numericIdx[0];
  const y = yIdx !== undefined ? names[yIdx] : names.find((n) => n !== x) ?? names[0] ?? "";
  return {
    chartType: "bar",
    x: { field: x },
    y: [{ field: y }],
    title: "",
  };
}

const selectCls =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]";
const labelCls = "block text-[11px] font-medium text-[var(--text-tertiary)] mb-1";

export function ChartConfigPanel({ columns, spec, onChange }: ChartConfigPanelProps) {
  const names = useMemo(() => columns.map((c) => c.name), [columns]);
  const yFields = spec.y.map((y) => y.field);
  const isPie = spec.chartType === "pie";
  // Grouped/stacked/multi_line support a series split.
  const supportsSeries =
    spec.chartType === "grouped_bar" ||
    spec.chartType === "stacked_bar" ||
    spec.chartType === "multi_line";

  const update = (patch: Partial<ChartSpec>) => onChange({ ...spec, ...patch });

  const toggleY = (field: string) => {
    const next = yFields.includes(field)
      ? yFields.filter((f) => f !== field)
      : [...yFields, field];
    update({ y: (next.length ? next : [field]).map((f) => ({ field: f })) });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Chart type */}
        <div>
          <label className={labelCls}>图表类型</label>
          <select
            className={selectCls}
            value={spec.chartType}
            onChange={(e) => {
              const chartType = e.target.value as ChartType;
              // Dropping to a type without series support clears series.
              const clearsSeries =
                chartType !== "grouped_bar" &&
                chartType !== "stacked_bar" &&
                chartType !== "multi_line";
              update({ chartType, ...(clearsSeries ? { series: undefined } : {}) });
            }}
          >
            {CHART_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* X / category */}
        <div>
          <label className={labelCls}>{isPie ? "分类" : "X 轴"}</label>
          <select
            className={selectCls}
            value={spec.x.field}
            onChange={(e) => update({ x: { field: e.target.value } })}
          >
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* Series (only for grouped/stacked/multi_line) */}
        {supportsSeries && (
          <div>
            <label className={labelCls}>分组 (可选)</label>
            <select
              className={selectCls}
              value={spec.series ?? ""}
              onChange={(e) => update({ series: e.target.value || undefined })}
            >
              <option value="">无</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Title */}
        <div>
          <label className={labelCls}>标题</label>
          <input
            className={selectCls}
            value={spec.title ?? ""}
            placeholder="图表标题"
            onChange={(e) => update({ title: e.target.value })}
          />
        </div>
      </div>

      {/* Y measures — pie uses a single value; series uses y[0] only. */}
      <div>
        <label className={labelCls}>{isPie ? "数值" : supportsSeries && spec.series ? "数值 (分组时取一个)" : "Y 轴 (可多选)"}</label>
        <div className="flex flex-wrap gap-1.5">
          {names.map((n) => {
            const selected = isPie || (supportsSeries && spec.series)
              ? yFields[0] === n
              : yFields.includes(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => {
                  if (isPie || (supportsSeries && spec.series)) {
                    update({ y: [{ field: n }] });
                  } else {
                    toggleY(n);
                  }
                }}
                className={
                  "rounded-md border px-2 py-1 text-xs transition-colors " +
                  (selected
                    ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--text-primary)]"
                    : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")
                }
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
