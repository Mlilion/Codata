"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  BookPlus,
  FileDiff,
  FileText,
  FolderSearch,
  Globe,
  HelpCircle,
  Layers,
  ListTodo,
  Loader2,
  Pencil,
  Play,
  Plug,
  Search,
  XCircle,
  CircleSlash,
} from "lucide-react";
import { durationLabel } from '@/lib/trace-layout';
import type { TraceSpan } from '@/types/execution-trace';
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ToolPart } from "@/types/message";
import { extractSourcesFromTool } from "@/lib/sources";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  read: FileText,
  write: FileText,
  edit: Pencil,
  multiedit: Pencil,
  apply_patch: FileDiff,
  publish_knowledge: BookPlus,
  bash: Play,
  glob: FolderSearch,
  grep: Search,
  web_fetch: Globe,
  web_search: Globe,
  question: HelpCircle,
  todo: ListTodo,
  task: Layers,
};

function getToolTitle(data: ToolPart): string {
  if (data.state.title) return data.state.title;
  const input = data.state.input as Record<string, string | undefined>;
  switch (data.tool) {
    case "read":
    case "write":
    case "edit":
    case "multiedit":
    case "publish_knowledge":
      return getFileName(input.file_path) ?? "file";
    case "apply_patch":
      return "Apply patch";
    case "bash":
      return truncate(String(input.command ?? "Run command"), 50);
    case "glob":
      return truncate(String(input.pattern ?? "**/*"), 30);
    case "grep":
      return truncate(String(input.pattern ?? ""), 30);
    case "web_search":
      return truncate(String(input.query ?? ""), 40);
    case "web_fetch":
      return truncate(String(input.url ?? ""), 40);
    case "task":
      return truncate(String(input.description ?? "Subtask"), 30);
    default:
      return data.tool;
  }
}

function getFileName(filePath?: string): string | null {
  if (!filePath) return null;
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function getElapsed(tool: ToolPart): string {
  if (!tool.state.time_start || !tool.state.time_end) return "";
  const ms = new Date(tool.state.time_end).getTime() - new Date(tool.state.time_start).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallRow({ tool, timing, onInspect,expanded,onExpandedChange,onExpansionComplete,highlighted=false }: { tool: ToolPart; timing?: {durationMs:number;queueMs?:number;executionMs?:number;queued?:boolean;status:TraceSpan['status']}; onInspect?:()=>void;expanded?:boolean;onExpandedChange?:(open:boolean)=>void;onExpansionComplete?:(open:boolean)=>void;highlighted?:boolean }) {
  const { t } = useTranslation("chat");
  const [localOpen,setLocalOpen] = useState(false);
  const isOpen=expanded??localOpen;
  const setIsOpen=(open:boolean)=>{if(onExpandedChange)onExpandedChange(open);else setLocalOpen(open);};
  const ToolIcon = TOOL_ICONS[tool.tool] ?? Plug;
  const actualStatus = timing?.status ?? tool.state.status;
  const isRunning = actualStatus === "running" || actualStatus === "pending";
  const isError = actualStatus === "error";
  const isCancelled = actualStatus === 'cancelled';
  const elapsed = timing ? durationLabel(timing.durationMs) : getElapsed(tool);
  const title = getToolTitle(tool);

  const sources = useMemo(() => {
    if (tool.tool !== "web_search" && tool.tool !== "web_fetch") return [];
    return extractSourcesFromTool(tool);
  }, [tool]);

  const MAX_VISIBLE_SOURCES = 3;
  const visibleSources = sources.slice(0, MAX_VISIBLE_SOURCES);
  const moreCount = sources.length - MAX_VISIBLE_SOURCES;

  return (
    <div className={cn('relative rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-3 py-2 pl-9',highlighted&&'border-[var(--data-accent)]')}>
      <div className="absolute left-3 top-2.5 flex items-center justify-center">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />
        ) : isCancelled ? <CircleSlash className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : isError ? (
          <XCircle className="h-3.5 w-3.5 text-[var(--tool-error)]" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--tool-completed)]" />
        )}
      </div>

      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="group flex w-full items-center gap-2 text-left"
      >
        <ToolIcon className="h-3.5 w-3.5 shrink-0 text-[var(--data-accent)]" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]">
          {title}
        </span>
        {elapsed && (
          <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
            {timing?.queued?'排队中 · ':''}{elapsed}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {visibleSources.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {visibleSources.map((source) => (
            <span
              key={source.url}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.favicon} alt="" className="h-3 w-3 rounded-sm" />
              <span className="max-w-[100px] truncate">{source.domain}</span>
            </span>
          ))}
          {moreCount > 0 && (
            <span className="self-center text-[10px] text-[var(--text-tertiary)]">
              {t("moreItems", { count: moreCount })}
            </span>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            onAnimationComplete={()=>onExpansionComplete?.(isOpen)}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {timing&&<p className="mt-2 text-[11px] text-[var(--text-tertiary)]">排队 {timing.queueMs===undefined?'未采集':durationLabel(timing.queueMs)} · 执行 {timing.executionMs===undefined?(timing.queued?'未开始':'未采集'):durationLabel(timing.executionMs)}</p>}
            {tool.state.metadata?.trace_output_preview===true&&<p className="mt-1 text-[11px] text-[var(--text-tertiary)]">子任务调用摘要，完整内容见所属子会话。</p>}
            <div className="mb-1 mt-2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)]">
              {Object.keys(tool.state.input).length > 0 && (
                <div className="border-b border-[var(--border-default)]">
                  <p className="bg-[var(--surface-tertiary)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                    {t("input")}
                  </p>
                  <pre className="max-h-[150px] overflow-x-auto overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {JSON.stringify(tool.state.input, null, 2)}
                  </pre>
                </div>
              )}
              {tool.state.output && (
                <div>
                  <p
                    className={cn(
                      "bg-[var(--surface-tertiary)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider",
                      isError ? "text-[var(--tool-error)]" : "text-[var(--tool-completed)]",
                    )}
                  >
                    {t("output")}
                  </p>
                  <pre className="max-h-[200px] overflow-x-auto overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {tool.state.output.length > 3000
                      ? `${tool.state.output.slice(0, 3000)}\n${t("truncated")}`
                      : tool.state.output}
                  </pre>
                </div>
              )}
            </div>
            {onInspect&&<button type="button" className="mt-2 mb-1 rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--data-accent)]" onClick={onInspect}>查看耗时与证据</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
