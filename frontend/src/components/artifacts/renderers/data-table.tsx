"use client";

import { useState, useMemo, useCallback } from "react";
import { Download, Search } from "lucide-react";

type SortDir = "asc" | "desc" | null;
type Cell = string | number | null;

interface DataTableProps {
  headers: string[];
  rows: Cell[][];
  /** Total row count on the server (may exceed rows.length when truncated). */
  totalRowCount?: number;
  truncated?: boolean;
  /** Show the search box + download button. Default true. */
  toolbar?: boolean;
  /** CSV filename for download; download hidden if omitted. */
  downloadName?: string;
}

function toStr(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell);
}

/**
 * Sortable/searchable data grid shared by the CSV renderer and the Codata
 * SQL-result renderer. Accepts already-parsed headers + rows.
 */
export function DataTable({
  headers,
  rows,
  totalRowCount,
  truncated,
  toolbar = true,
  downloadName,
}: DataTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((row) => row.some((cell) => toStr(cell).toLowerCase().includes(q)));
  }, [rows, searchQuery]);

  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return filteredRows;
    const col = sortCol;
    return [...filteredRows].sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      const na = Number(va);
      const nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb) && va !== null && vb !== null && va !== "" && vb !== "") {
        return sortDir === "asc" ? na - nb : nb - na;
      }
      const cmp = toStr(va).localeCompare(toStr(vb), undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortCol, sortDir]);

  const handleSort = useCallback(
    (colIndex: number) => {
      if (sortCol !== colIndex) {
        setSortCol(colIndex);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir(null);
      }
    },
    [sortCol, sortDir],
  );

  const handleDownload = useCallback(() => {
    const escape = (c: Cell) => {
      const s = toStr(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (downloadName || "data").replace(/[/\\]/g, "_") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [headers, rows, downloadName]);

  const isFiltered = searchQuery.trim().length > 0;
  const total = totalRowCount ?? rows.length;

  if (headers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">
        无数据
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {toolbar && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)] shrink-0">
          <div className="flex items-center gap-1.5 flex-1 max-w-[240px] px-2 py-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] focus-within:border-[var(--border-heavy)] transition-colors">
            <Search className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索..."
              className="flex-1 text-xs bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            />
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleDownload}
            title="下载 CSV"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-primary)]">
        <table className="csv-table">
          <thead>
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  onClick={() => handleSort(i)}
                  className="cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {header}
                    {sortCol === i && (
                      <span className="text-[10px] leading-none">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr key={ri}>
                {headers.map((_, ci) => (
                  <td key={ci}>{toStr(row[ci])}</td>
                ))}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="text-center text-[var(--text-tertiary)] py-8">
                  无匹配行
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center px-3 py-1.5 border-t border-[var(--border-default)] bg-[var(--surface-tertiary)] text-[11px] text-[var(--text-tertiary)] shrink-0 tabular-nums">
        {isFiltered
          ? `显示 ${sortedRows.length} / ${rows.length} 行 × ${headers.length} 列`
          : `${total}${truncated ? "+" : ""} 行 × ${headers.length} 列${truncated ? `(仅显示前 ${rows.length} 行)` : ""}`}
      </div>
    </div>
  );
}
