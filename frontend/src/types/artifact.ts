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

/** A tabular query result (from datasage execute_sql / chart_spec). */
export interface SqlResultData {
  sql?: string;
  dialect?: string;
  columns: { name: string; type?: string }[];
  rows: (string | number | null)[][];
  rowCount: number;
  truncated: boolean;
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
}
