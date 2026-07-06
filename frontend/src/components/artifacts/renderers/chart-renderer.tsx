"use client";

import { useCallback, useMemo, useRef } from "react";
import { Download } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { ChartSpec, SqlResultData } from "@/types/artifact";

// Brand-neutral categorical palette (see dataviz guidance).
const COLORS = [
  "#4f8ff7",
  "#f79f4f",
  "#4fcf8f",
  "#c77dff",
  "#f7746f",
  "#4fc4cf",
  "#f7c14f",
  "#8f9ff7",
];

// Cap how many x-axis categories / pie slices we draw; beyond this the chart
// turns to mush, so we truncate and tell the user.
const MAX_CATEGORIES = 50;

interface ChartRendererProps {
  spec: ChartSpec;
  data: SqlResultData;
}

type Row = Record<string, string | number | null>;

/** Build keyed row objects from columns + rows arrays. */
function toObjects(data: SqlResultData): Row[] {
  const names = data.columns.map((c) => c.name);
  return data.rows.map((row) => {
    const obj: Row = {};
    names.forEach((name, i) => {
      obj[name] = row[i] ?? null;
    });
    return obj;
  });
}

/** Coerce a cell to a number for measure axes. Non-numeric → null (skipped). */
function num(v: string | number | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

/** Compact number formatting for AXIS ticks (12.3K / 1.2M) — keeps axes uncrowded. */
function formatAxisNumber(v: unknown): string {
  if (typeof v !== "number" || !isFinite(v)) return v == null ? "" : String(v);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(0)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Full-precision formatting for TOOLTIPS (12,304) — the exact value on hover. */
function formatFullNumber(v: unknown): string {
  if (typeof v !== "number" || !isFinite(v)) return v == null ? "" : String(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Truncate a long category label so the axis stays readable. */
function shortLabel(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

/** Serialize the rendered recharts SVG to a PNG and trigger a download. */
async function exportChartPng(container: HTMLElement | null, filename: string): Promise<void> {
  const svg = container?.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  // Inline the computed text color so the exported PNG isn't transparent-on-transparent.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("chart image load failed"));
      img.src = url;
    });
    const scale = 2; // retina-quality export
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Solid background so the PNG isn't transparent.
    const bg = getComputedStyle(document.body).getPropertyValue("--surface-primary").trim() || "#ffffff";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ChartRenderer({ spec, data }: ChartRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const exportPng = useCallback(() => {
    void exportChartPng(containerRef.current, spec.title || "chart");
  }, [spec.title]);
  const rows = useMemo(() => toObjects(data), [data]);
  const xField = spec.x.field;
  const yFields = spec.y.map((y) => y.field);
  const series = spec.series;

  // For grouped/multi series with a single measure, pivot rows by series value.
  // (Series pivot uses y[0] as the measure — multi-y + series is not a valid
  // combination, so we prefer the series split there.)
  const { plotRows, keys, truncated } = useMemo(() => {
    if (series) {
      const seriesKeys = new Set<string>();
      const byX = new Map<string, Row>();
      for (const r of rows) {
        const xVal = String(r[xField] ?? "");
        const sVal = String(r[series] ?? "");
        seriesKeys.add(sVal);
        const bucket = byX.get(xVal) ?? { [xField]: r[xField] ?? null };
        const measure = num(r[yFields[0]]);
        if (measure !== null) bucket[sVal] = measure;
        byX.set(xVal, bucket);
      }
      const all = Array.from(byX.values());
      return {
        plotRows: all.slice(0, MAX_CATEGORIES),
        keys: Array.from(seriesKeys),
        truncated: all.length > MAX_CATEGORIES,
      };
    }
    // No series: coerce each measure column to numbers.
    const coerced = rows.map((r) => {
      const out: Row = { [xField]: r[xField] ?? null };
      for (const y of yFields) out[y] = num(r[y]);
      return out;
    });
    return {
      plotRows: coerced.slice(0, MAX_CATEGORIES),
      keys: yFields,
      truncated: coerced.length > MAX_CATEGORIES,
    };
  }, [rows, series, xField, yFields]);

  const axisProps = {
    tick: { fontSize: 11, fill: "var(--text-tertiary)" },
    stroke: "var(--border-default)",
  };
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />;
  const tooltip = (
    <Tooltip
      contentStyle={{
        background: "var(--surface-primary)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        fontSize: 12,
      }}
      formatter={(value) => formatFullNumber(value)}
    />
  );

  // Empty-state: nothing plottable.
  const hasPlottable =
    plotRows.length > 0 &&
    keys.length > 0 &&
    plotRows.some((r) => keys.some((k) => typeof r[k] === "number"));
  if (!hasPlottable) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-tertiary)]">
        无可绘制的数据(检查所选的数值列)
      </div>
    );
  }

  const chart = renderChart(spec, { rows: plotRows, xField, keys, axisProps, grid, tooltip });

  return (
    <div ref={containerRef} className="group relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        {spec.title && (
          <div className="flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
            {spec.title}
          </div>
        )}
        <button
          type="button"
          onClick={exportPng}
          title="导出 PNG"
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-4 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
      {truncated && (
        <div className="px-4 pb-2 text-center text-[11px] text-[var(--text-tertiary)]">
          仅显示前 {MAX_CATEGORIES} 个类目
        </div>
      )}
    </div>
  );
}

interface RenderCtx {
  rows: Row[];
  xField: string;
  keys: string[];
  axisProps: { tick: object; stroke: string };
  grid: React.ReactElement;
  tooltip: React.ReactElement;
}

function renderChart(spec: ChartSpec, ctx: RenderCtx): React.ReactElement {
  const { rows, xField, keys, axisProps, grid, tooltip } = ctx;
  const showLegend = keys.length > 1;
  const xAxis = (
    <XAxis dataKey={xField} {...axisProps} tickFormatter={shortLabel} minTickGap={8} />
  );
  const yAxis = <YAxis {...axisProps} tickFormatter={formatAxisNumber} width={48} />;

  switch (spec.chartType) {
    case "line":
    case "multi_line":
      return (
        <LineChart data={rows}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {keys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      );

    case "area":
      return (
        <AreaChart data={rows}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {keys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.2}
              connectNulls
            />
          ))}
        </AreaChart>
      );

    case "pie": {
      const valueKey = keys[0];
      // Pie needs non-negative values; drop rows that aren't positive numbers.
      const pieRows = rows.filter((r) => typeof r[valueKey] === "number" && (r[valueKey] as number) > 0);
      if (pieRows.length === 0) {
        return (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
            饼图需要正数值
          </div>
        );
      }
      return (
        <PieChart>
          {tooltip}
          <Pie
            data={pieRows}
            dataKey={valueKey}
            nameKey={xField}
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {pieRows.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={shortLabel} />
        </PieChart>
      );
    }

    case "stacked_bar":
    case "grouped_bar":
    case "bar":
    default: {
      const stacked = spec.chartType === "stacked_bar";
      return (
        <BarChart data={rows}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {keys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId={stacked ? "stack" : undefined}
              fill={COLORS[i % COLORS.length]}
              radius={stacked ? undefined : [3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      );
    }
  }
}
