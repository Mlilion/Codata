"use client";

import { useState } from "react";
import { AlertCircle, Bot, CheckCircle2, ChevronDown, CircleSlash, Loader2, Users } from "lucide-react";
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

function processDescription(process?: string): string {
  if (process === "hierarchical") return "总控专家先拆解任务，再动态委派给合适成员";
  if (process === "workflow") return "按依赖图执行，支持并发步骤";
  if (process === "sequential") return "按任务顺序逐步执行";
  return "按普通专家团流程执行";
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
  const skills = uniqueStrings(steps.flatMap((step) => step.skills));
  const tools = uniqueStrings([
    ...steps.flatMap((step) => step.tools),
    ...parts.filter((part): part is ToolPart => part.type === "tool").map((part) => part.tool),
  ]);

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
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <Users className="h-4 w-4 shrink-0" />
            <span>专家团协作流程</span>
          </div>
          <span className="inline-flex items-center rounded-md bg-[var(--brand-primary)]/10 px-2 py-0.5 text-ui-3xs font-medium text-[var(--brand-primary)]">
            {processLabel(process)}
          </span>
        </div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-ui-3xs text-[var(--text-tertiary)]">
            {processDescription(process)}
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex min-h-8 items-center justify-center rounded-md border border-[var(--border-subtle)] px-2.5 text-ui-3xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {allExpanded ? "全部收起" : "全部展开"}
          </button>
        </div>
        {(skills.length > 0 || tools.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skills.slice(0, 8).map((skill) => (
              <span key={`skill-${skill}`} className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-secondary)]">
                skill · {skill}
              </span>
            ))}
            {tools.slice(0, 10).map((tool) => (
              <span key={`tool-${tool}`} className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]">
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const running = isStreaming && step.status === "running" && isLast;
          const textParts = step.parts.filter((part): part is PartData & { type: "text" } => part.type === "text");
          const toolParts = step.parts.filter((part): part is ToolPart => part.type === "tool");
          const fileParts = step.parts.filter(
            (part): part is PartData & { type: "file" } => part.type === "file",
          );
          const summary = compactPreview(step.handoff || step.resultPreview || textPartPreview(textParts), 900);
          const hasDetails = textParts.length > 0 || toolParts.length > 0;
          const detailsOpen = expandedSteps[step.key] ?? (running || step.status === "failed");
          const toolTimeline = buildToolTimeline(toolParts);

          return (
            <div
              key={step.key}
              className={cn(
                "rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]",
                step.delegatedBy && "ml-5 border-[var(--border-subtle)]",
              )}
            >
              <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
                  {running ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
                  ) : step.status === "failed" ? (
                    <AlertCircle className="h-4 w-4 text-[var(--color-destructive)]" />
                  ) : step.status === "skipped" ? (
                    <CircleSlash className="h-4 w-4 text-[var(--text-tertiary)]" />
                  ) : step.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--tool-completed)]" />
                  ) : (
                    <Bot className="h-4 w-4 text-[var(--text-secondary)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {step.memberName}
                    </span>
                    <span className="text-ui-2xs text-[var(--text-tertiary)]">
                      {step.memberRole}
                    </span>
                    {step.manager && (
                      <span className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-secondary)]">
                        总控专家
                      </span>
                    )}
                    {step.delegatedBy && (
                      <span className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]">
                        委派任务{step.delegationIndex ? ` #${step.delegationIndex}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-ui-2xs text-[var(--text-secondary)]">
                    第 {step.step} 步 · {step.taskName}
                  </div>
                  {(step.dependsOn.length > 0 || step.output || step.reason) && (
                    <div className="mt-1 flex flex-wrap gap-1.5 text-ui-3xs text-[var(--text-tertiary)]">
                      {step.dependsOn.length > 0 && <span>依赖 {step.dependsOn.join(", ")}</span>}
                      {step.output && <span>输出 {step.output}</span>}
                      {step.reason && <span>{step.reason}</span>}
                    </div>
                  )}
                  {(step.skills.length > 0 || step.tools.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {step.skills.slice(0, 4).map((skill) => (
                        <span key={`${step.key}-skill-${skill}`} className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-secondary)]">
                          skill · {skill}
                        </span>
                      ))}
                      {step.tools.slice(0, 6).map((tool) => (
                        <span key={`${step.key}-tool-${tool}`} className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {hasDetails && (
                    <button
                      type="button"
                      onClick={() => toggleStep(step.key)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 text-ui-3xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                      aria-expanded={detailsOpen}
                    >
                      详情
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")} />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3 px-3 py-3">
                {summary ? (
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2">
                    <div className="mb-1 text-ui-3xs font-medium text-[var(--text-tertiary)]">
                      {step.handoff ? "交接摘要" : "输出摘要"}
                    </div>
                    <div className="line-clamp-6 whitespace-pre-wrap text-ui-2xs leading-5 text-[var(--text-secondary)]">
                      {summary}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {running ? "正在处理..." : "该专家未产生摘要"}
                  </div>
                )}

                {toolParts.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {toolParts.map((tool) => (
                        <span
                          key={tool.call_id}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-ui-3xs",
                            tool.state.status === "completed"
                              ? "border-[var(--border-subtle)] bg-[var(--surface-secondary)] text-[var(--text-tertiary)]"
                              : "border-[var(--border-default)] bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
                          )}
                        >
                          {tool.tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {fileParts.length > 0 && (
                  <div className="grid gap-1.5 sm:grid-cols-2">
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

                {hasDetails && detailsOpen && (
                  <div className="space-y-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-3">
                    <div className="text-ui-3xs font-medium text-[var(--text-tertiary)]">完整过程</div>
                    {toolTimeline.length > 0 && (
                      <div className="space-y-2">
                        {toolTimeline.map((tool) => (
                          <ToolCallRow key={`tool-call-${tool.call_id}`} tool={tool} />
                        ))}
                      </div>
                    )}
                    {textParts.length > 0 ? (
                      textParts.map((part, partIndex) => (
                        <TextPart
                          key={`${step.key}-text-${partIndex}`}
                          data={part}
                          isStreaming={running && partIndex === textParts.length - 1}
                        />
                      ))
                    ) : (
                      <div className="text-xs text-[var(--text-tertiary)]">没有完整文本输出</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
