"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Pencil, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-lg font-semibold text-[var(--text-primary)] outline-none"
              />
              <button type="button" onClick={commit} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-2">
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                {board?.name ?? "看板"}
              </h1>
              <button
                type="button"
                onClick={startEdit}
                title="重命名看板"
                className="text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {dashboardId && <DashboardContent dashboardId={dashboardId} />}
      </div>
    </div>
  );
}
