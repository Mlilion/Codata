"use client";

import { useMemo } from "react";
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

/** Coerce a cell to a number for measure axes. */
function num(v: string | number | null): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function ChartRenderer({ spec, data }: ChartRendererProps) {
  const rows = useMemo(() => toObjects(data), [data]);
  const xField = spec.x.field;
  const yFields = spec.y.map((y) => y.field);
  const series = spec.series;

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
    />
  );

  // For grouped/multi series with a single measure, pivot rows by series value.
  const { pivoted, seriesKeys } = useMemo(() => {
    if (!series) return { pivoted: rows, seriesKeys: yFields };
    const keys = new Set<string>();
    const byX = new Map<string, Row>();
    for (const r of rows) {
      const xVal = String(r[xField] ?? "");
      const sVal = String(r[series] ?? "");
      keys.add(sVal);
      const bucket = byX.get(xVal) ?? { [xField]: r[xField] ?? null };
      bucket[sVal] = num(r[yFields[0]]);
      byX.set(xVal, bucket);
    }
    return { pivoted: Array.from(byX.values()), seriesKeys: Array.from(keys) };
  }, [rows, series, xField, yFields]);

  const chart = renderChart(spec, {
    rows: series ? pivoted : rows,
    xField,
    keys: series ? seriesKeys : yFields,
    axisProps,
    grid,
    tooltip,
  });

  return (
    <div className="flex h-full flex-col">
      {spec.title && (
        <div className="px-4 pt-3 text-sm font-medium text-[var(--text-primary)]">
          {spec.title}
        </div>
      )}
      <div className="min-h-0 flex-1 p-4">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
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

  switch (spec.chartType) {
    case "line":
    case "multi_line":
      return (
        <LineChart data={rows}>
          {grid}
          <XAxis dataKey={xField} {...axisProps} />
          <YAxis {...axisProps} />
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
            />
          ))}
        </LineChart>
      );

    case "area":
      return (
        <AreaChart data={rows}>
          {grid}
          <XAxis dataKey={xField} {...axisProps} />
          <YAxis {...axisProps} />
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
            />
          ))}
        </AreaChart>
      );

    case "pie": {
      const valueKey = keys[0];
      return (
        <PieChart>
          {tooltip}
          <Pie
            data={rows}
            dataKey={valueKey}
            nameKey={xField}
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 11 }} />
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
          <XAxis dataKey={xField} {...axisProps} />
          <YAxis {...axisProps} />
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
