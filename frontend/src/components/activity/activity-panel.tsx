"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Users,
  Bot,
  CircleSlash,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CodataLogo } from "@/components/ui/codata-logo";
import { ToolCallRow } from "@/components/activity/tool-call-row";
import { IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";
import { useIsMacOS } from "@/hooks/use-platform";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useActivityStore, computeDuration, type ActivityData, type ChainItem } from "@/stores/activity-store";
import { ACTIVITY_PANEL_WIDTH } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PartData, ToolPart, StepFinishPart, StepStartPart } from "@/types/message";

// -- Helpers --

type ExpertStatus = "pending" | "running" | "completed" | "skipped" | "failed";

interface ExpertProgressItem {
  key: string;
  step: number;
  title: string;
  process?: string;
  memberName: string;
  memberRole: string;
  taskName: string;
  status: ExpertStatus;
  dependsOn: string[];
  output?: string;
  reason?: string;
  resultPreview?: string;
  skills: string[];
  tools: string[];
  toolParts: ToolPart[];
  manager?: boolean;
  delegatedBy?: string;
  delegationIndex?: number;
}

interface ActiveExpertProgressItem extends ExpertProgressItem {
  parts: PartData[];
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

function expertStatusValue(value: unknown, fallback: ExpertStatus = "running"): ExpertStatus {
  return value === "completed" || value === "skipped" || value === "failed" || value === "pending" || value === "running"
    ? value
    : fallback;
}

function isExpertStepStart(part: PartData): part is StepStartPart {
  return part.type === "step-start" && part.snapshot?.mode === "expert-team";
}

function toExpertProgressItem(item: ActiveExpertProgressItem): ExpertProgressItem {
  return {
    key: item.key,
    step: item.step,
    title: item.title,
    process: item.process,
    memberName: item.memberName,
    memberRole: item.memberRole,
    taskName: item.taskName,
    status: item.status,
    dependsOn: item.dependsOn,
    output: item.output,
    reason: item.reason,
    resultPreview: item.resultPreview,
    skills: item.skills,
    tools: item.tools,
    toolParts: item.parts.filter((part): part is ToolPart => part.type === "tool"),
    manager: item.manager,
    delegatedBy: item.delegatedBy,
    delegationIndex: item.delegationIndex,
  };
}

function buildExpertProgress(parts: PartData[] = []): ExpertProgressItem[] {
  const items: ActiveExpertProgressItem[] = [];
  const byKey = new Map<string, ActiveExpertProgressItem>();
  const pendingText: string[] = [];
  let current: ActiveExpertProgressItem | null = null;

  const keyForSnapshot = (snapshot: Record<string, unknown>, index: number) => {
    const member = textValue(snapshot.member_id, "member");
    const task = textValue(snapshot.task_id, "task");
    return `${member}:${task}:${numberValue(snapshot.step, index + 1)}`;
  };

  const appendPendingText = () => {
    if (!current || pendingText.length === 0) return;
    const joined = pendingText.join("").trim();
    if (joined) current.resultPreview = joined.length > 2000 ? `${joined.slice(0, 2000).trimEnd()}\n...` : joined;
    pendingText.length = 0;
  };

  for (const part of parts) {
    if (isExpertStepStart(part)) {
      appendPendingText();
      const snapshot = part.snapshot ?? {};
      const key = keyForSnapshot(snapshot, items.length);
      current = {
        key,
        step: numberValue(snapshot.step, items.length + 1),
        title: textValue(snapshot.title, textValue(snapshot.task_name, "专家步骤")),
        process: textValue(snapshot.process),
        memberName: textValue(snapshot.member_name, "专家"),
        memberRole: textValue(snapshot.member_role, "专家成员"),
        taskName: textValue(snapshot.task_name, "协作任务"),
        status: expertStatusValue(snapshot.status, "running"),
        dependsOn: stringListValue(snapshot.depends_on),
        output: textValue(snapshot.task_output),
        reason: textValue(snapshot.reason),
        resultPreview: textValue(snapshot.result_preview),
        skills: stringListValue(snapshot.skills),
        tools: stringListValue(snapshot.tools),
        toolParts: [],
        manager: snapshot.manager === true,
        delegatedBy: textValue(snapshot.delegated_by),
        delegationIndex: typeof snapshot.delegation_index === "number" ? snapshot.delegation_index : undefined,
        parts: [],
      };
      byKey.set(key, current);
      items.push(current);
      continue;
    }

    if (current && (part.type === "tool" || part.type === "file" || part.type === "text")) {
      current.parts.push(part);
    }

    if (part.type === "text") {
      pendingText.push(part.text);
      continue;
    }

    if (part.type !== "step-finish") continue;
    const snapshot = part.snapshot ?? {};
    if (snapshot.mode !== "expert-team") continue;
    appendPendingText();
    const key = keyForSnapshot(snapshot, Math.max(items.length - 1, 0));
    const target = byKey.get(key) ?? current ?? items[items.length - 1];
    if (!target) continue;
    target.status = expertStatusValue(snapshot.status, "completed");
    target.reason = textValue(snapshot.reason, target.reason);
    target.output = textValue(snapshot.task_output, target.output);
    target.resultPreview = textValue(snapshot.result_preview, target.resultPreview);
  }

  appendPendingText();
  return items.sort((a, b) => a.step - b.step).map(toExpertProgressItem);
}

// -- Timeline item types --

type TimelineItem =
  | { kind: "thinking-group"; texts: string[] }
  | { kind: "tool"; tool: ToolPart };

function buildTimelineItems(chain: ChainItem[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let thinkingBuf: string[] = [];

  const flushThinking = () => {
    if (thinkingBuf.length > 0) {
      items.push({ kind: "thinking-group", texts: [...thinkingBuf] });
      thinkingBuf = [];
    }
  };

  for (const c of chain) {
    if (c.type === "reasoning") {
      thinkingBuf.push(c.text);
    } else {
      flushThinking();
      items.push({ kind: "tool", tool: c.data });
    }
  }
  flushThinking();

  return items;
}

// -- Sub-components --

/** A thinking group in the chain — shows reasoning bullets expanded by default */
function ThinkingGroup({ texts }: { texts: string[] }) {
  const { t } = useTranslation("chat");
  const combined = texts.filter(Boolean).join("\n");
  const thoughts = combined
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const VISIBLE_COUNT = 5;
  const [showAll, setShowAll] = useState(false);
  const hasMore = thoughts.length > VISIBLE_COUNT;
  const visibleThoughts = showAll ? thoughts : thoughts.slice(0, VISIBLE_COUNT);
  const isEmpty = thoughts.length === 0;

  return (
    <div className="relative pl-8">
      <div className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--data-accent)]/25 bg-[var(--data-accent-soft)]">
        <CodataLogo size={12} />
      </div>

      <div className="mt-1.5 space-y-1">
        {isEmpty ? (
          <p className="text-xs text-[var(--text-tertiary)] italic">
            {t("analyzingRequest")}
          </p>
        ) : (
          visibleThoughts.map((thought, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-[var(--text-tertiary)] shrink-0" />
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {thought}
              </p>
            </div>
          ))
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-3"
          >
            {showAll ? t("showLess") : t("showMore", { count: thoughts.length - VISIBLE_COUNT })}
          </button>
        )}
      </div>
    </div>
  );
}

function ExpertStatusIcon({ status }: { status: ExpertStatus }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-primary)]" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-[var(--color-destructive)]" />;
  if (status === "skipped") return <CircleSlash className="h-4 w-4 text-[var(--text-tertiary)]" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-[var(--tool-completed)]" />;
  return <Bot className="h-4 w-4 text-[var(--text-tertiary)]" />;
}

function expertStatusLabel(status: ExpertStatus, taskName?: string): string {
  if (status === "running" && taskName === "资料预检") return "等待补充";
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "已完成";
    case "skipped":
      return "已跳过";
    case "failed":
      return "失败";
    default:
      return "等待中";
  }
}

export function ExpertProgressPanel({
  data,
  onClose,
  showClose = true,
}: {
  data: ActivityData;
  onClose: () => void;
  showClose?: boolean;
}) {
  const steps = useMemo(() => buildExpertProgress(data.parts ?? []), [data.parts]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const process = steps.find((step) => step.process)?.process;
  const skills = uniqueStrings(steps.flatMap((step) => step.skills));
  const tools = uniqueStrings([
    ...steps.flatMap((step) => step.tools),
    ...(data.toolParts?.map((tool) => tool.tool) ?? []),
  ]);
  const completed = steps.filter((step) => step.status === "completed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const skipped = steps.filter((step) => step.status === "skipped").length;
  const finished = completed + failed + skipped;
  const total = steps.length;
  const progress = total > 0 ? Math.round((finished / total) * 100) : 0;
  const running = steps.find((step) => step.status === "running");
  const runningLabel = running?.taskName === "资料预检"
    ? "当前：等待用户补充资料"
    : running
      ? `当前：${running.memberName}`
      : total > 0
        ? "协作已完成"
        : "等待专家团开始";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">专家团进度</h2>
        </div>
        {showClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="border-y border-[var(--border-subtle)] px-4 py-3">
        <div className="mb-2 flex items-start justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="text-[var(--text-secondary)]">{runningLabel}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-[var(--brand-primary)]/10 px-1.5 py-0.5 text-ui-3xs font-medium text-[var(--brand-primary)]">
                {processLabel(process)}
              </span>
              <span className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]">
                {processDescription(process)}
              </span>
            </div>
          </div>
          <span className="font-mono text-[var(--text-tertiary)]">{finished}/{total}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
          <div
            className="h-full rounded-full bg-[var(--brand-primary)] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        {(skills.length > 0 || tools.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
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

      <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-auto">
        <div className="space-y-3">
          {steps.map((step) => (
            <ExpertProgressCard
              key={step.key}
              step={step}
              collapsed={collapsed[step.key] ?? step.status === "completed"}
              onToggle={() => setCollapsed((prev) => ({ ...prev, [step.key]: !(prev[step.key] ?? step.status === "completed") }))}
            />
          ))}

          {steps.length === 0 && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-4 text-sm text-[var(--text-tertiary)]">
              正在等待专家团状态...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpertProgressCard({
  step,
  collapsed,
  onToggle,
}: {
  step: ExpertProgressItem;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)]",
        step.delegatedBy && "ml-4 border-[var(--border-subtle)]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-3 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-primary)]">
          <ExpertStatusIcon status={step.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                {step.memberName}
              </div>
              <div className="mt-0.5 truncate text-ui-2xs text-[var(--text-tertiary)]">
                {step.memberRole}
              </div>
              {(step.manager || step.delegatedBy) && (
                <div className="mt-1 flex flex-wrap gap-1">
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
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-ui-3xs",
                  step.status === "completed" && "bg-[var(--color-success)]/10 text-[var(--color-success)]",
                  step.status === "running" && "bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]",
                  step.status === "failed" && "bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]",
                  step.status === "skipped" && "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]",
                  step.status === "pending" && "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]",
                )}
              >
                {expertStatusLabel(step.status, step.taskName)}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform",
                  !collapsed && "rotate-180",
                )}
              />
            </div>
          </div>

          <div className="mt-2 text-xs text-[var(--text-secondary)]">
            第 {step.step} 步 · {step.taskName}
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pl-14">
              {(step.dependsOn.length > 0 || step.output || step.reason) && (
                <div className="flex flex-wrap gap-1.5 text-ui-3xs text-[var(--text-tertiary)]">
                  {step.dependsOn.length > 0 && <span>依赖 {step.dependsOn.join(", ")}</span>}
                  {step.output && <span>输出 {step.output}</span>}
                  {step.reason && <span>{step.reason}</span>}
                </div>
              )}
              {(step.skills.length > 0 || step.tools.length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {step.skills.slice(0, 4).map((skill) => (
                    <span
                      key={`${step.key}-skill-${skill}`}
                      className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-secondary)]"
                    >
                      skill · {skill}
                    </span>
                  ))}
                  {step.tools.slice(0, 6).map((tool) => (
                    <span
                      key={`${step.key}-tool-${tool}`}
                      className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              )}

              {step.resultPreview ? (
                <div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2 text-ui-2xs leading-5 text-[var(--text-secondary)] scrollbar-auto">
                  {step.resultPreview}
                </div>
              ) : (
                <div className="mt-2 text-ui-2xs text-[var(--text-tertiary)]">
                  {step.status === "running" && step.taskName === "资料预检" ? "正在等待用户补充信息..." : step.status === "running" ? "正在处理..." : "暂无结果"}
                </div>
              )}

              {step.toolParts.length > 0 && (
                <div className="mt-3 space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-2.5 py-2">
                  {step.toolParts.map((tool) => (
                    <ToolCallRow key={`${step.key}-tool-call-${tool.call_id}`} tool={tool} />
                  ))}
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// -- Main panel content --

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

export function ActivityPanelContent({ showClose = true }: { showClose?: boolean } = {}) {
  const { t } = useTranslation("chat");
  const activeData = useActivityStore((s) => s.activeData);
  const close = useActivityStore((s) => s.close);

  const timelineItems = useMemo(
    () => (activeData?.chain ? buildTimelineItems(activeData.chain) : []),
    [activeData],
  );

  if (!activeData) return null;
  if (activeData.mode === "expert-team") {
    return <ExpertProgressPanel data={activeData} onClose={close} />;
  }

  // Aggregate metrics from step-finish parts
  const stepFinishes = activeData.stepParts.filter(
    (p): p is StepFinishPart => p.type === "step-finish",
  );
  const totalTokens = stepFinishes.reduce((acc, sf) => {
    const t = sf.tokens;
    return {
      input: acc.input + (t.input || 0),
      output: acc.output + (t.output || 0),
    };
  }, { input: 0, output: 0 });
  const totalCost = stepFinishes.reduce((acc, sf) => acc + (sf.cost || 0), 0);
  const hasMetrics = totalTokens.input > 0 || totalTokens.output > 0 || totalCost > 0;

  // Compute total duration
  const duration = computeDuration(activeData);
  const durationLabel = duration != null && duration > 0 ? `${duration}s` : "";
  const hasRunningTools = activeData.toolParts.some(
    (tool) => tool.state.status === "running" || tool.state.status === "pending",
  );
  const hasTerminalStepFinish = stepFinishes.some((part) => part.reason !== "tool_use");
  const isComplete = (hasTerminalStepFinish || !!activeData.hasVisibleOutput) && !hasRunningTools;

  return (
    <div className="flex h-full flex-col bg-[var(--surface-primary)]">
      <div className="shrink-0 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-[var(--text-primary)]">{t("activity")}</h2>
            <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">工具调用与推理过程</p>
          </div>
          <div className="flex items-center gap-2">
            {durationLabel && (
              <span className="rounded-md bg-[var(--surface-secondary)] px-2 py-1 text-[11px] text-[var(--text-tertiary)]">
                {durationLabel}
              </span>
            )}
            {showClose && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={close}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5 scrollbar-auto">
        {activeData.toolParts.length > 0 && (
          <section className="border-t border-[var(--border-subtle)] pt-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">工具调用</h3>
            <div className="space-y-3">
              {activeData.toolParts.map((tool) => (
                <ToolCallRow key={`summary-tool-${tool.call_id}`} tool={tool} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-6 border-t border-[var(--border-subtle)] pt-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">推理过程</h3>
          <div className="relative space-y-4 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-[var(--border-subtle)]">
            {timelineItems
              .filter((item) => item.kind === "thinking-group")
              .map((item, i) => (
                <ThinkingGroup key={`thinking-${i}`} texts={item.texts} />
              ))}

            {isComplete ? (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-success)] text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
                {durationLabel && (
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {t("thoughtFor", { duration: durationLabel })}
                  </p>
                )}
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">{t("done")}</p>
              </div>
            ) : (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-primary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />
                </div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                  {hasRunningTools ? t("stageWorkingWithTools") : t("stageFinalizing")}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Metrics */}
        {hasMetrics && (
          <div className="pt-4 mt-6">
            <h3 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
              {t("metrics")}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {totalTokens.input > 0 && (
                <div className="flex justify-between rounded-lg bg-[var(--surface-secondary)] px-3 py-2">
                  <span className="text-[var(--text-tertiary)]">{t("input")}</span>
                  <span className="text-[var(--text-secondary)] font-mono">
                    {totalTokens.input.toLocaleString()}
                  </span>
                </div>
              )}
              {totalTokens.output > 0 && (
                <div className="flex justify-between rounded-lg bg-[var(--surface-secondary)] px-3 py-2">
                  <span className="text-[var(--text-tertiary)]">{t("output")}</span>
                  <span className="text-[var(--text-secondary)] font-mono">
                    {totalTokens.output.toLocaleString()}
                  </span>
                </div>
              )}
              {totalCost > 0 && (
                <div className="flex justify-between rounded-lg bg-[var(--surface-secondary)] px-3 py-2 col-span-2">
                  <span className="text-[var(--text-tertiary)]">{t("credits")}</span>
                  <span className="text-[var(--text-secondary)] font-mono">
                    {(totalCost * 100).toFixed(2)} cr
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityPanel() {
  const { t } = useTranslation("chat");
  const isOpen = useActivityStore((s) => s.isOpen);
  const close = useActivityStore((s) => s.close);
  const isDesktop = useIsDesktop();
  const isMac = useIsMacOS();
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;

  // Desktop: fixed right panel with smooth mount/unmount
  if (isDesktop) {
    return (
      <motion.aside
        className="fixed inset-y-0 right-0 z-[35] flex flex-col bg-[var(--surface-primary)] overflow-hidden"
        style={{ width: ACTIVITY_PANEL_WIDTH, top: topOffset }}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <ActivityPanelContent />
      </motion.aside>
    );
  }

  // Mobile: Sheet overlay from right
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="w-[85vw] sm:max-w-[380px] p-0">
        <VisuallyHidden.Root asChild>
          <SheetTitle>{t("activity")}</SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>{t("activityDesc")}</SheetDescription>
        </VisuallyHidden.Root>
        <ActivityPanelContent />
      </SheetContent>
    </Sheet>
  );
}
