"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { LayoutDashboard, Trash2, Check, X, Pencil, Loader2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useDashboardItems,
  useDeleteDashboardItem,
  useRenameDashboardItem,
  useSaveDashboardLayout,
} from "@/hooks/use-dashboard";
import { ChartRenderer } from "@/components/artifacts/renderers/chart-renderer";
import type { DashboardItem } from "@/types/dashboard";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ReactGridLayout = WidthProvider(GridLayout);

const COLS = 12;
const ROW_HEIGHT = 40;
const DEFAULT_W = 6; // half width
const DEFAULT_H = 11; // ~440px tall — enough for header + chart title/legend/axis
const MIN_W = 3;
const MIN_H = 6; // ~240px — never collapse a chart below a readable size

/** Build the rgl layout array: use each item's saved layout, else auto-place by index. */
function buildLayout(items: DashboardItem[]): Layout[] {
  return items.map((item, i) => {
    if (item.layout) {
      return {
        i: item.id,
        x: item.layout.x,
        y: item.layout.y,
        // Clamp any previously-saved tiny sizes up to the readable minimum.
        w: Math.max(item.layout.w, MIN_W),
        h: Math.max(item.layout.h, MIN_H),
        minW: MIN_W,
        minH: MIN_H,
      };
    }
    // Auto-place: two columns, in order.
    return {
      i: item.id,
      x: (i % 2) * DEFAULT_W,
      y: Math.floor(i / 2) * DEFAULT_H,
      w: DEFAULT_W,
      h: DEFAULT_H,
      minW: MIN_W,
      minH: MIN_H,
    };
  });
}

function DashboardTile({ item, dashboardId }: { item: DashboardItem; dashboardId: string }) {
  const rename = useRenameDashboardItem(dashboardId);
  const del = useDeleteDashboardItem(dashboardId);
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
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
      {/* Tile header (drag handle) */}
      <div className="tile-drag-handle flex cursor-grab items-center gap-2 border-b border-[var(--border-default)] px-3 py-2 active:cursor-grabbing">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        {editing ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
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
              onMouseDown={(e) => e.stopPropagation()}
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
              onMouseDown={(e) => e.stopPropagation()}
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
              onMouseDown={(e) => e.stopPropagation()}
              title="重命名"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => del.mutate(item.id, { onError: () => toast.error("删除失败") })}
              onMouseDown={(e) => e.stopPropagation()}
              title="删除"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--color-destructive)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {/* Chart fills the rest of the tile */}
      <div className="min-h-0 flex-1 bg-[var(--surface-primary)]">
        <ChartRenderer spec={item.payload.chartSpec} data={item.payload.sqlResult} />
      </div>
    </div>
  );
}

export function DashboardContent({ dashboardId }: { dashboardId: string }) {
  const { data: items, isLoading, isError } = useDashboardItems(dashboardId);
  const saveLayout = useSaveDashboardLayout(dashboardId);

  // Per-tile sizes are declared via data-grid on each child (below), so rgl
  // never falls back to its w1/h1 default. onLayoutChange only persists real
  // user drags/resizes — guarded against the mount-time fire.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = false;
  }, [dashboardId, items]);

  const handleLayoutChange = (next: Layout[]) => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    saveLayout.mutate(next.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
  };

  const gridItems = useMemo(() => items ?? [], [items]);
  // Map item id → its declared grid box (saved layout or auto-placement).
  const layoutById = useMemo(() => {
    const map = new Map<string, Layout>();
    for (const l of buildLayout(gridItems)) map.set(l.i, l);
    return map;
  }, [gridItems]);

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
    <ReactGridLayout
      className="dashboard-grid"
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={[16, 16]}
      isDraggable
      isResizable
      draggableHandle=".tile-drag-handle"
      onLayoutChange={handleLayoutChange}
    >
      {gridItems.map((item) => (
        <div key={item.id} data-grid={layoutById.get(item.id)}>
          <DashboardTile item={item} dashboardId={dashboardId} />
        </div>
      ))}
    </ReactGridLayout>
  );
}
