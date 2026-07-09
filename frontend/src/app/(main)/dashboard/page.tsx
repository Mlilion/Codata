"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LayoutDashboard, Plus, Trash2, Loader2, Star } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getDashboardRoute } from "@/lib/routes";
import {
  useDashboards,
  useCreateDashboard,
  useDeleteDashboard,
} from "@/hooks/use-dashboard";

export default function DashboardListPage() {
  const router = useRouter();
  const { data: dashboards, isLoading } = useDashboards();
  const create = useCreateDashboard();
  const del = useDeleteDashboard();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submitCreate = () => {
    const n = name.trim();
    if (!n) {
      setCreating(false);
      return;
    }
    create.mutate(
      { name: n },
      {
        onSuccess: (board) => {
          setName("");
          setCreating(false);
          router.push(getDashboardRoute(board.id));
        },
        onError: () => toast.error("创建看板失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" asChild>
            <Link href="/c/new">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <LayoutDashboard className="h-5 w-5 text-[var(--text-secondary)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">看板</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-secondary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]"
          >
            <Plus className="h-4 w-4" />
            新建看板
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creating && (
              <div className="flex flex-col justify-between rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="看板名称"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCreate();
                    if (e.key === "Escape") {
                      setName("");
                      setCreating(false);
                    }
                  }}
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setName("");
                      setCreating(false);
                    }}
                    className="rounded-md px-2 py-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={submitCreate}
                    disabled={create.isPending}
                    className="rounded-md bg-[var(--brand-primary)] px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    创建
                  </button>
                </div>
              </div>
            )}

            {(dashboards ?? []).map((board) => (
              <div
                key={board.id}
                className={cn(
                  "group relative flex flex-col rounded-xl border border-[var(--border-default)]",
                  "bg-[var(--surface-secondary)] p-4 transition-colors hover:bg-[var(--surface-tertiary)]",
                )}
              >
                <Link href={getDashboardRoute(board.id)} className="flex-1">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 text-[var(--brand-primary)]" />
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {board.name}
                    </span>
                    {board.is_default && (
                      <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--text-tertiary)] text-[var(--text-tertiary)]" />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                    {board.item_count} 个图表
                  </p>
                </Link>
                {!board.is_default && (
                  <button
                    type="button"
                    onClick={() =>
                      del.mutate(board.id, { onError: () => toast.error("删除看板失败") })
                    }
                    title="删除看板"
                    className="absolute right-3 top-3 text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--color-destructive)] group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
