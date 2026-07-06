"use client";

import { useState } from "react";
import { LayoutDashboard, Trash2, Check, X, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useDashboardItems,
  useDeleteDashboardItem,
  useRenameDashboardItem,
} from "@/hooks/use-dashboard";
import { ChartRenderer } from "@/components/artifacts/renderers/chart-renderer";
import type { DashboardItem } from "@/types/dashboard";

function DashboardTile({ item }: { item: DashboardItem }) {
  const rename = useRenameDashboardItem();
  const del = useDeleteDashboardItem();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  const commitRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== item.title) {
      rename.mutate({ id: item.id, title: next });
    } else {
      setDraft(item.title);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
      {/* Tile header */}
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-2">
        {editing ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraft(item.title);
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="button"
              onClick={commitRename}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(item.title);
                setEditing(false);
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
              {item.title || "未命名图表"}
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft(item.title);
                setEditing(true);
              }}
              title="重命名"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                del.mutate(item.id, { onError: () => toast.error("删除失败") })
              }
              title="删除"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--color-destructive)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {/* Chart */}
      <div className="h-[300px] bg-[var(--surface-primary)]">
        <ChartRenderer spec={item.payload.chartSpec} data={item.payload.sqlResult} />
      </div>
    </div>
  );
}

export function DashboardContent() {
  const { data: items, isLoading, isError } = useDashboardItems();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--text-tertiary)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center text-sm text-[var(--text-tertiary)]">
        看板加载失败,请稍后重试。
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed",
          "border-[var(--border-default)] bg-[var(--surface-secondary)] py-16 text-center",
        )}
      >
        <LayoutDashboard className="h-8 w-8 text-[var(--text-tertiary)]" />
        <p className="text-sm text-[var(--text-secondary)]">看板还是空的</p>
        <p className="max-w-xs text-xs text-[var(--text-tertiary)]">
          在对话里对带图表的查询结果点「钉到看板」,图表就会出现在这里。
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <DashboardTile key={item.id} item={item} />
      ))}
    </div>
  );
}
