"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, Bot, CheckCircle2, ChevronDown, CircleSlash, Loader2 } from "lucide-react";
import type { PartData, StepStartPart, ToolPart } from "@/types/message";
import { TextPart } from "@/components/parts/text-part";
import { FileArtifactCard } from "@/components/parts/file-artifact-card";
import { cn } from "@/lib/utils";
import { ToolCallRow } from "@/components/activity/tool-call-row";

interface ExpertStep {
  key: string;
  step: number;
  title: string;
  process?: string;
  memberName: string;
  memberRole: string;
  taskName: string;
  status: "running" | "completed" | "skipped" | "failed";
  dependsOn: string[];
  output?: string;
  reason?: string;
  handoff?: string;
  resultPreview?: string;
  skills: string[];
  tools: string[];
  hierarchical?: boolean;
  manager?: boolean;
  delegatedBy?: string;
  delegationIndex?: number;
  parts: PartData[];
}

interface ExpertTeamTimelineProps {
  parts: PartData[];
  isStreaming?: boolean;
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function stringListValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function compactPreview(value: string, limit = 700): string {
  const cleaned = value.replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit).trimEnd()}...`;
}

function readablePreview(value: string, limit = 360): string {
  const cleaned = value.replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit).trimEnd()}...`;
}

function textPartPreview(parts: Array<PartData & { type: "text" }>): string {
  const text = parts.map((part) => part.text).join("").trim();
  if (!text) return "";
  return compactPreview(text);
}

function processLabel(process?: string): string {
  if (process === "hierarchical") return "统筹调度";
  if (process === "workflow") return "工作流";
  if (process === "sequential") return "顺序";
  return "普通";
}

function StatusIcon({
  status,
  running,
}: {
  status: ExpertStep["status"];
  running: boolean;
}) {
  if (running) return <Loader2 className="h-4 w-4 animate-spin text-[var(--data-accent)]" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-[var(--color-destructive)]" />;
  if (status === "skipped") return <CircleSlash className="h-4 w-4 text-[var(--text-tertiary)]" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />;
  return <Bot className="h-4 w-4 text-[var(--text-tertiary)]" />;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-2 text-ui-3xs text-[var(--text-secondary)]">
      {children}
    </span>
  );
}

function CompactChipList({ values, limit = 2 }: { values: string[]; limit?: number }) {
  const visible = values.slice(0, limit);
  const hidden = values.length - visible.length;
  if (values.length === 0) return null;

  return (
    <>
      {visible.map((value) => (
        <Chip key={`chip-${value}`}>{value}</Chip>
      ))}
      {hidden > 0 && <Chip>+{hidden}</Chip>}
    </>
  );
}

function isExpertStep(part: PartData): part is StepStartPart {
  return part.type === "step-start" && part.snapshot?.mode === "expert-team";
}

function buildToolTimeline(toolParts: ToolPart[]): ToolPart[] {
  return toolParts;
}

function buildSteps(parts: PartData[]): ExpertStep[] {
  const steps: ExpertStep[] = [];
  let current: ExpertStep | null = null;

  for (const part of parts) {
    if (isExpertStep(part)) {
      const snapshot = part.snapshot ?? {};
      current = {
        key: `${textValue(snapshot.member_id, "member")}-${textValue(snapshot.task_id, "task")}-${steps.length}`,
        step: numberValue(snapshot.step, steps.length + 1),
        title: textValue(snapshot.title, textValue(snapshot.task_name, "专家步骤")),
        process: textValue(snapshot.process),
        memberName: textValue(snapshot.member_name, "专家"),
        memberRole: textValue(snapshot.member_role, "专家成员"),
        taskName: textValue(snapshot.task_name, "协作任务"),
        status: snapshot.status === "skipped" || snapshot.status === "failed" ? snapshot.status : "running",
        dependsOn: stringListValue(snapshot.depends_on),
        output: textValue(snapshot.task_output),
        reason: textValue(snapshot.reason),
        handoff: textValue(snapshot.handoff),
        resultPreview: textValue(snapshot.result_preview),
        skills: stringListValue(snapshot.skills),
        tools: stringListValue(snapshot.tools),
        hierarchical: snapshot.hierarchical === true,
        manager: snapshot.manager === true,
        delegatedBy: textValue(snapshot.delegated_by),
        delegationIndex: typeof snapshot.delegation_index === "number" ? snapshot.delegation_index : undefined,
        parts: [],
      };
      steps.push(current);
      continue;
    }

    if (part.type === "step-finish") {
      const target = current ?? steps[steps.length - 1];
      const status = part.snapshot?.status;
      if (target) {
        target.status = status === "skipped" || status === "failed" ? status : "completed";
        target.reason = textValue(part.snapshot?.reason, target.reason);
        target.handoff = textValue(part.snapshot?.handoff, target.handoff);
        target.resultPreview = textValue(part.snapshot?.result_preview, target.resultPreview);
      }
      continue;
    }

    if (!current) continue;
    if (part.type === "text" || part.type === "tool" || part.type === "file") {
      current.parts.push(part);
    }
  }

  for (let index = 0; index < steps.length - 1; index += 1) {
    if (steps[index].status === "running") steps[index].status = "completed";
  }

  return steps;
}

export function hasExpertTeamTimeline(parts: PartData[]): boolean {
  return parts.some(isExpertStep);
}

export function ExpertTeamTimeline({
  parts,
  isStreaming,
}: ExpertTeamTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const steps = buildSteps(parts);
  if (steps.length === 0) return null;
  const process = steps.find((step) => step.process)?.process;
  const finishedCount = steps.filter((step, index) => {
    const isLast = index === steps.length - 1;
    const running = !!isStreaming && step.status === "running" && isLast;
    return !running && (step.status === "completed" || step.status === "skipped" || step.status === "failed");
  }).length;

  const toggleAll = () => {
    const next = !allExpanded;
    setAllExpanded(next);
    setExpandedSteps(next ? Object.fromEntries(steps.map((step) => [step.key, true])) : {});
  };

  const toggleStep = (key: string) => {
    setExpandedSteps((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold leading-6 text-[var(--text-primary)]">专家团协作记录</h3>
              <span className="inline-flex min-h-6 items-center rounded-md bg-[rgba(18,185,129,0.12)] px-2 text-ui-3xs font-semibold text-[var(--color-success)]">
                {processLabel(process)}
              </span>
              <span className="font-mono text-ui-3xs text-[var(--text-tertiary)]">{finishedCount}/{steps.length}</span>
            </div>
            <div className="mt-1 truncate text-ui-3xs text-[var(--text-tertiary)]">
              详细输出保留在消息区，进度与工具调用由右侧面板持续跟踪
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              {allExpanded ? "收起" : "展开"}
            </button>
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="absolute bottom-4 left-[24px] top-4 w-px bg-[var(--border-subtle)]" />
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const running = !!isStreaming && step.status === "running" && isLast;
          const textParts = step.parts.filter((part): part is PartData & { type: "text" } => part.type === "text");
          const toolParts = step.parts.filter((part): part is ToolPart => part.type === "tool");
          const fileParts = step.parts.filter(
            (part): part is PartData & { type: "file" } => part.type === "file",
          );
          const fullSummary = compactPreview(step.handoff || step.resultPreview || textPartPreview(textParts), 900);
          const summary = readablePreview(fullSummary);
          const hasDetails = textParts.length > 0 || toolParts.length > 0;
          const detailsOpen = expandedSteps[step.key] ?? (running || step.status === "failed" || (!isStreaming && isLast));
          const toolTimeline = buildToolTimeline(toolParts);
          const rowTools = uniqueStrings([...step.tools, ...toolParts.map((tool) => tool.tool)]);

          return (
            <div
              key={step.key}
              className={cn(
                "relative border-b border-[var(--border-subtle)] last:border-b-0",
                running && "bg-[rgba(11,118,246,0.045)] shadow-[inset_3px_0_0_var(--data-accent)]",
              )}
            >
              <div className="grid grid-cols-[42px_minmax(0,1fr)_minmax(170px,0.42fr)_64px] gap-3 px-4 py-3.5">
                <div className="relative z-[1] flex items-start justify-center">
                  <span className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border bg-[var(--surface-primary)]",
                    step.status === "completed" && !running && "border-[rgba(18,185,129,0.28)]",
                    running && "border-[rgba(11,118,246,0.34)]",
                    step.status === "failed" && "border-[rgba(239,68,68,0.28)]",
                    step.status === "skipped" && "border-[var(--border-default)]",
                  )}>
                    <StatusIcon status={step.status} running={running} />
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text-primary)]">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {step.memberName} · {step.taskName}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 ml-6 flex min-w-0 flex-wrap items-center gap-1.5">
                    {step.manager && (
                      <span className="rounded-md bg-[var(--surface-secondary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-secondary)]">
                        总控专家
                      </span>
                    )}
                    {step.delegatedBy && (
                      <span className="rounded-md bg-[var(--surface-secondary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]">
                        委派任务{step.delegationIndex ? ` #${step.delegationIndex}` : ""}
                      </span>
                    )}
                    <span className="text-ui-3xs text-[var(--text-tertiary)]">{step.memberRole}</span>
                  </div>
                  <div className="mt-2 ml-6">
                    <div className="mb-1 text-ui-3xs font-medium text-[var(--text-tertiary)]">结果摘要</div>
                    <div className="line-clamp-4 whitespace-pre-wrap text-ui-2xs leading-5 text-[var(--text-secondary)]">
                      {summary || (running ? "正在处理..." : "该专家未产生摘要")}
                    </div>
                  </div>
                </div>
                <div className="min-w-0 space-y-1.5 text-ui-3xs text-[var(--text-tertiary)]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0">依赖</span>
                    {step.dependsOn.length > 0 ? <CompactChipList values={step.dependsOn} limit={1} /> : <span>-</span>}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0">输出</span>
                    {step.output ? <Chip>{step.output}</Chip> : <span>-</span>}
                  </div>
                  {rowTools.length > 0 && (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0">工具</span>
                      <CompactChipList values={rowTools} limit={2} />
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => hasDetails && toggleStep(step.key)}
                    disabled={!hasDetails}
                    className={cn(
                      "inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
                      !hasDetails && "cursor-default opacity-60 hover:bg-[var(--surface-primary)] hover:text-[var(--text-secondary)]",
                    )}
                    aria-expanded={hasDetails ? detailsOpen : undefined}
                  >
                    详情
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")} />
                  </button>
                </div>
              </div>

              {hasDetails && detailsOpen && (
                <div className="mx-4 mb-3 ml-[58px] grid gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-ui-3xs font-semibold text-[var(--text-tertiary)]">工具调用</div>
                    {toolTimeline.length > 0 && (
                      <div className="space-y-2">
                        {toolTimeline.map((tool) => (
                          <ToolCallRow key={`tool-call-${tool.call_id}`} tool={tool} />
                        ))}
                      </div>
                    )}
                    {toolTimeline.length === 0 && (
                      <div className="text-xs text-[var(--text-tertiary)]">暂无工具调用</div>
                    )}
                    {fileParts.length > 0 && (
                      <div className="grid gap-1.5 pt-1">
                        {fileParts.map((file) => (
                          <FileArtifactCard
                            key={file.file_id}
                            filePath={file.path}
                            title={file.name}
                            cardId={`expert-file-${file.file_id}`}
                            compact={fileParts.length > 1}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-ui-3xs font-semibold text-[var(--text-tertiary)]">
                      {running ? "输出预览（流式）" : step.handoff ? "交接摘要" : "输出预览"}
                    </div>
                    {textParts.length > 0 ? (
                      textParts.map((part, partIndex) => (
                        <TextPart
                          key={`${step.key}-text-${partIndex}`}
                          data={part}
                          isStreaming={running && partIndex === textParts.length - 1}
                        />
                      ))
                    ) : fullSummary ? (
                      <div className="max-h-44 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-3 py-2 text-ui-2xs leading-5 text-[var(--text-secondary)] scrollbar-auto">
                        {fullSummary}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-tertiary)]">暂无完整文本输出</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
