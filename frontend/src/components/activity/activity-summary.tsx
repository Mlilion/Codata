"use client";

import { CheckCircle2, ChevronRight, Wrench, XCircle, CircleSlash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodataLogo } from "@/components/ui/codata-logo";
import { useActivityStore, type ActivityData } from "@/stores/activity-store";
import { useRightSidebarStore } from "@/stores/right-sidebar-store";
import { useExecutionTraceStore } from '@/stores/execution-trace-store';

interface ActivitySummaryProps {
  data: ActivityData;
}

export function ActivitySummary({ data }: ActivitySummaryProps) {
  const { t } = useTranslation("chat");
  const toggleForMessage = useActivityStore((s) => s.toggleForMessage);
  const rightSidebarOpen = useRightSidebarStore((s) => s.isOpen);
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const completed=useExecutionTraceStore(s=>data.traceId&&s.traces[data.traceId]?.spans.length?s.traces[data.traceId].completed:undefined)??data.executionTrace?.completed;
  const rootStatus=useExecutionTraceStore(s=>data.traceId?s.traces[data.traceId]?.spans.find(p=>p.kind==='request')?.status:undefined)
    ??data.executionTrace?.spans.find(p=>p.kind==='request')?.status;
  const measuredMs=useExecutionTraceStore(s=>data.traceId?s.traces[data.traceId]?.metrics.end_to_end_ms:undefined)
    ??data.executionTrace?.client?.metrics.end_to_end_ms;
  const measuredTools=useExecutionTraceStore(s=>data.traceId&&s.traces[data.traceId]?.spans.length?s.traces[data.traceId].spans.filter(p=>p.kind==='tool').length:undefined)
    ??data.executionTrace?.spans.filter(p=>p.kind==='tool').length;
  const isActiveOpen = useActivityStore(
    (s) =>
      rightSidebarOpen &&
      (activeTab === "activity" || activeTab === "expert") &&
      s.isOpen &&
      !!data.sourceKey &&
      s.activeKey === data.sourceKey,
  );

  const hasReasoning = data.reasoningTexts.length > 0;
  const hasTools = data.toolParts.length > 0;
  const totalDuration = measuredMs===undefined?data.totalDuration:measuredMs/1000;
  const lastStepFinish = [...data.stepParts]
    .reverse()
    .find((part) => part.type === "step-finish");
  const hasRunningTools = data.toolParts.some(
    (tool) => tool.state.status === "running" || tool.state.status === "pending",
  );
  const isCompleted = completed ?? ((!!lastStepFinish && lastStepFinish.reason !== "tool_use") ||
    (!!data.hasVisibleOutput && !hasRunningTools));

  if (!hasReasoning && !hasTools && !data.traceId) return null;

  const parts: string[] = [];
  if (isCompleted) {
    parts.push(rootStatus==='error'?'执行失败':rootStatus==='cancelled'?'已取消':rootStatus==='incomplete'?'未完整采集':t("done"));
  } else if (hasReasoning) {
    parts.push(
      data.thinkingDuration != null
        ? t("thoughtFor", { duration: `${data.thinkingDuration}s` })
        : t("reasoning"),
    );
  }
  if (hasTools||measuredTools) {
    const count = measuredTools??data.toolParts.length;
    parts.push(t("toolCallCount", { count }));
  }
  if (totalDuration != null && totalDuration > 0) {
    parts.push(`用时 ${totalDuration.toFixed(1)} 秒`);
  }

  return (
    <button
      type="button"
      onClick={() => data.sourceKey && toggleForMessage(data.sourceKey, data)}
      className="data-agent-card group flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-heavy)] hover:text-[var(--text-secondary)]"
    >
      {isCompleted ? (
        rootStatus==='error'?<XCircle className="h-3.5 w-3.5 text-[var(--tool-error)]"/>:rootStatus==='cancelled'||rootStatus==='incomplete'?<CircleSlash className="h-3.5 w-3.5 text-[var(--text-tertiary)]"/>:<CheckCircle2 className="h-3.5 w-3.5 text-[var(--tool-completed)]" />
      ) : hasReasoning ? (
        <CodataLogo size={14} />
      ) : (
        <Wrench className="h-3.5 w-3.5" />
      )}
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
        Agent run
      </span>
      <span className="min-w-0 flex-1 truncate">{parts.join(" · ")}</span>
      <ChevronRight
        className={`h-3 w-3 transition-transform duration-200 ${isActiveOpen ? "rotate-90" : ""}`}
      />
    </button>
  );
}
