"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Check, LayoutDashboard, Pencil, X } from "lucide-react";
import { PageContent, PageFrame, PageHeader } from "@/components/ui/page-frame";
import { useDashboards, useRenameDashboard } from "@/hooks/use-dashboard";
import { resolveDashboardId } from "@/lib/routes";
import { DashboardContent } from "../content";

export default function DashboardDetailClient() {
  const params = useParams<{ id?: string | string[] }>();
  const searchParams = useSearchParams();
  const routeId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const dashboardId = resolveDashboardId(routeId ?? null, searchParams.get("id")) ?? "";
  const { data: dashboards } = useDashboards();
  const rename = useRenameDashboard();
  const board = dashboards?.find((d) => d.id === dashboardId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(board?.name ?? "");
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== board?.name) rename.mutate({ id: dashboardId, name: next });
  };

  return (
    <PageFrame className="flex-1">
      <PageContent className="max-w-6xl lg:py-8">
        <PageHeader
          title={
            editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  className="h-9 min-w-0 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 text-ui-title font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                />
                <button
                  type="button"
                  onClick={commit}
                  title="保存名称"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  title="取消重命名"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <span className="flex items-center gap-2">
                {board?.name ?? "看板"}
                <button
                  type="button"
                  onClick={startEdit}
                  title="重命名看板"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </span>
            )
          }
          description="查看已固定的图表，并管理看板布局。"
          icon={LayoutDashboard}
          backHref="/dashboard"
        />
        {dashboardId && <DashboardContent dashboardId={dashboardId} />}
      </PageContent>
    </PageFrame>
  );
}
