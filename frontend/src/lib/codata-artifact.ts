import type { Artifact, SqlResultData, ChartSpec } from "@/types/artifact";

/** Codata result kinds carried on tool-result metadata (`codata_kind`). */
export const CODATA_KINDS = new Set(["sql_result", "indicator", "chart", "sql_job"]);

/** A pending/running async SQL job (from execute_sql async / get_job_status). */
export interface SqlJobData {
  jobId: string;
  status: string;
  estimatedSeconds?: number;
  sql?: string;
}

/**
 * True when a tool result carries a Codata data payload we render as a data
 * card (SQL result / indicator / chart / async job). Used both by the inline
 * message dispatcher and the live stream registry so they agree on what counts.
 */
export function hasCodataResult(metadata?: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  return typeof metadata.codata_kind === "string" && CODATA_KINDS.has(metadata.codata_kind);
}

/**
 * Extract async-job info from a `sql_job` payload, or null for other kinds.
 * A running/pending async query has no rows yet — the card shows its status.
 */
export function codataJobFromMetadata(
  metadata?: Record<string, unknown> | null,
): SqlJobData | null {
  if (!metadata || metadata.codata_kind !== "sql_job") return null;
  return {
    jobId: typeof metadata.job_id === "string" ? metadata.job_id : "",
    status: typeof metadata.status === "string" ? metadata.status : "pending",
    estimatedSeconds:
      typeof metadata.estimated_seconds === "number" ? metadata.estimated_seconds : undefined,
    sql: typeof metadata.sql === "string" ? metadata.sql : undefined,
  };
}

/**
 * Build a Codata data `Artifact` from a tool result's structured metadata, or
 * return null when the metadata isn't a recognised Codata payload / has
 * nothing to show. Shared by the inline `DataResultCard` and the right-panel
 * artifact so both read the payload the same way.
 */
export function codataArtifactFromMetadata(
  callId: string,
  title: string | undefined,
  metadata?: Record<string, unknown> | null,
): Artifact | null {
  if (!hasCodataResult(metadata)) return null;
  const meta = metadata as Record<string, unknown>;
  const kind = meta.codata_kind;

  const columns = Array.isArray(meta.columns)
    ? (meta.columns as { name: string; type?: string }[])
    : [];
  const rows = Array.isArray(meta.rows)
    ? (meta.rows as (string | number | null)[][])
    : [];

  let sql: string | undefined;
  if (typeof meta.sql === "string") {
    sql = meta.sql;
  } else if (kind === "indicator" && Array.isArray(meta.indicators)) {
    const first = (meta.indicators as { sql?: string }[])[0];
    sql = first?.sql;
  }

  const sqlResult: SqlResultData | undefined =
    columns.length > 0
      ? {
          sql,
          dialect: typeof meta.dialect === "string" ? meta.dialect : undefined,
          columns,
          rows,
          rowCount: typeof meta.row_count === "number" ? meta.row_count : rows.length,
          truncated: Boolean(meta.truncated),
        }
      : undefined;

  const chartSpec =
    meta.chart_spec && typeof meta.chart_spec === "object"
      ? (meta.chart_spec as ChartSpec)
      : undefined;

  // Need something to show.
  if (!sqlResult && !chartSpec && !sql) return null;

  return {
    id: callId,
    identifier: callId,
    type: "sql_result",
    title: title || chartSpec?.title || "查询结果",
    content: sql ?? "",
    language: "sql",
    sqlResult,
    chartSpec,
  };
}
