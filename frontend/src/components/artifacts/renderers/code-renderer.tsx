"use client";

import { useState, useCallback, useMemo } from "react";
import { Copy, Check, WrapText } from "lucide-react";
import hljs from "highlight.js/lib/common";
import { Button } from "@/components/ui/button";

interface CodeRendererProps {
  content: string;
  language?: string;
}

// SQL dialects we may be handed (from a query result's `dialect`) that
// highlight.js has no grammar for, but which are SQL for highlighting
// purposes. Anything unknown falls back to plain text.
const LANGUAGE_ALIASES: Record<string, string> = {
  starrocks: "sql",
  doris: "sql",
  mysql: "sql",
  mariadb: "sql",
  postgresql: "sql",
  postgres: "sql",
  sqlite: "sql",
  bigquery: "sql",
  snowflake: "sql",
  redshift: "sql",
  hive: "sql",
  spark: "sql",
  trino: "sql",
  presto: "sql",
  clickhouse: "sql",
  duckdb: "sql",
  tsql: "sql",
};

function resolveLanguage(language?: string): string | null {
  if (!language) return null;
  const key = language.toLowerCase();
  const mapped = LANGUAGE_ALIASES[key] ?? key;
  return hljs.getLanguage(mapped) ? mapped : null;
}

export function CodeRenderer({ content, language }: CodeRendererProps) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const lines = content.split("\n");

  // Highlight the block in one pass so multi-line strings/comments keep their
  // styling. The gutter is a sibling column with the same line-height, so
  // alignment holds without needing per-line markup. `null` = no grammar for
  // this language, in which case we render the raw text instead of HTML.
  const highlightedHtml = useMemo(() => {
    const lang = resolveLanguage(language);
    if (!lang) return null;
    try {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [content, language]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)] shrink-0">
        <span className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setWrap(!wrap)}
            title={wrap ? "No wrap" : "Wrap lines"}
          >
            <WrapText className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Code area with line numbers */}
      <div className="flex-1 overflow-auto bg-[var(--surface-secondary)]">
        <div className="flex min-h-full">
          {/* Line numbers */}
          <div className="shrink-0 select-none border-r border-[var(--border-default)] bg-[var(--surface-tertiary)] px-3 py-3 text-right">
            {lines.map((_, i) => (
              <div key={i} className="text-[12px] leading-[1.6] font-mono text-[var(--text-tertiary)]">
                {i + 1}
              </div>
            ))}
          </div>
          {/* Code content */}
          <pre
            className={`hljs flex-1 bg-transparent px-4 py-3 text-[13px] leading-[1.6] font-mono text-[var(--text-primary)] ${
              wrap ? "whitespace-pre-wrap break-all" : "overflow-x-auto"
            }`}
            {...(highlightedHtml !== null
              ? { dangerouslySetInnerHTML: { __html: highlightedHtml } }
              : {})}
          >
            {highlightedHtml !== null ? undefined : content}
          </pre>
        </div>
      </div>
    </div>
  );
}
