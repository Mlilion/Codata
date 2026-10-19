/** Artifact types — for the artifact preview panel. */

export type ArtifactType =
  | "react"
  | "html"
  | "svg"
  | "code"
  | "markdown"
  | "mermaid"
  | "docx"
  | "xlsx"
  | "pdf"
  | "pptx"
  | "csv"
  | "image"
  | "video"
  | "file-preview"
  | "sql_result";

/** Chart types supported by the Codata chart renderer. */
export type ChartType =
  | "bar"
  | "grouped_bar"
  | "stacked_bar"
  | "line"
  | "multi_line"
  | "pie"
  | "area";

/** Caliber metadata returned with query_indicator results. */
export interface CaliberInfo {
  indicator?: string;
  name?: string;
  unit?: string;
  definition?: string;
  data_layer?: string;
  [key: string]: unknown;
}

/** A tabular query result (from data-client execute_sql / chart_spec). */
export interface SqlResultData {
  sql?: string;
  requestedSql?: string;
  dialect?: string;
  columns: { name: string; type?: string }[];
  rows: (string | number | null)[][];
  rowCount: number;
  truncated: boolean;
  /** Caliber metadata — present for query_indicator results, absent for execute_sql. */
  caliber?: CaliberInfo | null;
  knowledge?: (Record<string, unknown> | string)[];
  topNApplied?: boolean;
  totalGroups?: number;
}

/** Chart spec produced by the backend chart_spec tool. */
export interface ChartSpec {
  chartType: ChartType;
  x: { field: string; label?: string };
  y: { field: string; label?: string }[];
  series?: string;
  title?: string;
}

export interface Artifact {
  /** Unique ID (tool call_id or generated hash). */
  id: string;
  /** Display title shown in the panel header. */
  title: string;
  /** Determines which renderer to use. */
  type: ArtifactType;
  /** Raw content (source code, markup, etc.). */
  content: string;
  /** Programming language (for code/react types). */
  language?: string;
  /** File path on disk (for file-preview type). */
  filePath?: string;
  /** Identifier for updating the same artifact across iterations. */
  identifier?: string;
  /** Structured tabular result (for type "sql_result"). */
  sqlResult?: SqlResultData;
  /** Chart spec (for type "sql_result" with a chart). */
  chartSpec?: ChartSpec;
  /** Whether this result came from an authoritative caliber (query_indicator)
   *  or a custom SQL path (execute_sql). */
  caliberSource?: "authoritative" | "custom";
}
