"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Plug, Brain, Pencil, Check, X, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConnectors } from "@/hooks/use-connectors";
import { useSkills } from "@/hooks/use-plugins";
import { useAnySessionGenerating } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  useWorkspaceMemory,
  useUpdateWorkspaceMemory,
  useRefreshWorkspaceMemory,
  useExportWorkspaceMemory,
} from "@/hooks/use-workspace-memory";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  connected: "bg-green-500",
  needs_auth: "bg-yellow-500",
  failed: "bg-red-500",
};

function ConnectorsBlock() {
  const { t } = useTranslation("chat");
  const { data, isLoading } = useConnectors();
  const connectors = data?.connectors ? Object.values(data.connectors) : [];
  // Only show connectors that are actually connected (not just enabled)
  const connected = connectors.filter((c) => c.status === "connected");

  if (isLoading) {
    return (
      <div className="px-4 py-2">
        <div className="h-4 w-24 rounded bg-[var(--surface-tertiary)] animate-pulse" />
      </div>
    );
  }

  return (
      <div className="mb-1">
        <p className="px-4 py-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">
        {t("workspaceConnectors")}
      </p>
      {connected.length === 0 ? (
        <p className="px-4 py-1 text-[12px] text-[var(--text-quaternary)]">
          {t("workspaceNoConnectors")}
        </p>
      ) : (
        <div className="space-y-0.5">
          {connected.map((connector) => (
            <div
              key={connector.id}
              className="flex items-center gap-2.5 px-4 py-1.5"
            >
              <div
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  STATUS_DOT[connector.status] ?? "bg-[var(--text-quaternary)]",
                )}
              />
              <Plug className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              <span className="text-[13px] text-[var(--text-secondary)] truncate">
                {connector.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillsSummary() {
  const { t } = useTranslation("chat");
  const { data: skills, isLoading } = useSkills();

  if (isLoading) return null;
  if (!skills || skills.length === 0) return null;

  return (
    <div>
      <p className="px-4 py-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">
        {t("workspaceSkills")}
      </p>
      <div className="px-4 py-1">
        <span className="text-[13px] text-[var(--text-secondary)]">
          {t("workspaceSkillsAvailable", { count: skills.length })}
        </span>
      </div>
    </div>
  );
}

function MemoryBlock() {
  const { t } = useTranslation("chat");
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimestampRef = useRef<string | null>(null);
  const isGenerating = useAnySessionGenerating();
  const prevGeneratingRef = useRef(isGenerating);

  const { data, isLoading } = useWorkspaceMemory(workspacePath, {
    refetchInterval: isRefreshing ? 3000 : false,
  });
  const updateMutation = useUpdateWorkspaceMemory();
  const refreshMutation = useRefreshWorkspaceMemory();
  const exportMutation = useExportWorkspaceMemory();

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const content = data?.content ?? "";

  // Auto-poll after generation completes (memory queue debounces ~10s + LLM call)
  useEffect(() => {
    if (prevGeneratingRef.current && !isGenerating && workspacePath) {
      refreshTimestampRef.current = data?.time_updated ?? null;
      setIsRefreshing(true);
    }
    prevGeneratingRef.current = isGenerating;
  }, [isGenerating, workspacePath, data?.time_updated]);

  // Stop polling when time_updated changes, or after 60s timeout
  useEffect(() => {
    if (!isRefreshing) return;
    if (data?.time_updated && data.time_updated !== refreshTimestampRef.current) {
      setIsRefreshing(false);
      return;
    }
    const timer = setTimeout(() => setIsRefreshing(false), 60000);
    return () => clearTimeout(timer);
  }, [isRefreshing, data?.time_updated]);

  const handleStartEdit = useCallback(() => {
    setEditContent(content);
    setIsEditing(true);
  }, [content]);

  const handleSave = useCallback(() => {
    if (!workspacePath) return;
    updateMutation.mutate(
      { workspace_path: workspacePath, content: editContent },
      {
        onSuccess: () => {
          setIsEditing(false);
          toast.success(t("workspaceMemorySaved"));
        },
        onError: () => toast.error(t("workspaceMemorySaveFailed")),
      },
    );
  }, [workspacePath, editContent, updateMutation, t]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditContent("");
  }, []);

  const handleRefresh = useCallback(() => {
    if (!workspacePath) return;
    refreshTimestampRef.current = data?.time_updated ?? null;
    setIsRefreshing(true);
    refreshMutation.mutate(workspacePath, {
      onError: () => {
        setIsRefreshing(false);
        toast.error(t("workspaceMemoryRefreshFailed"));
      },
    });
  }, [workspacePath, data?.time_updated, refreshMutation, t]);

  const handleExport = useCallback(() => {
    if (!workspacePath) return;
    exportMutation.mutate(workspacePath, {
      onSuccess: (res) => toast.success(t("workspaceMemoryExported", { path: res.exported_to })),
      onError: () => toast.error(t("workspaceMemoryExportFailed")),
    });
  }, [workspacePath, exportMutation, t]);

  if (!workspacePath) return null;

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <p className="text-[11px] font-medium text-[var(--text-tertiary)]">
            {t("workspaceMemory")}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="rounded p-1 text-[var(--text-tertiary)] hover:text-green-500 hover:bg-[var(--surface-tertiary)] transition-colors disabled:opacity-50"
                title={t("workspaceSave")}
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                onClick={handleCancel}
                className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)] transition-colors"
                title={t("workspaceCancel")}
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)] transition-colors disabled:opacity-50"
                title={t("workspaceRefresh")}
              >
                <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
              </button>
              <button
                onClick={handleStartEdit}
                className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)] transition-colors"
                title={t("workspaceEdit")}
              >
                <Pencil className="h-3 w-3" />
              </button>
              {content && (
                <button
                  onClick={handleExport}
                  disabled={exportMutation.isPending}
                  className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)] transition-colors disabled:opacity-50"
                  title={t("workspaceExport")}
                >
                  <Download className="h-3 w-3" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="px-4 pb-1">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[80px] max-h-[200px] p-2 text-[11px] font-mono rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)] resize-y focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            placeholder={t("workspaceMemoryPlaceholder")}
          />
        ) : isLoading || isRefreshing ? (
          <div className="space-y-1">
            <div className="h-3 w-3/4 rounded bg-[var(--surface-tertiary)] animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-[var(--surface-tertiary)] animate-pulse" />
          </div>
        ) : content ? (
          <div className="max-h-[150px] overflow-y-auto scrollbar-auto">
            <pre className="text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
              {content}
            </pre>
          </div>
        ) : (
          <p className="text-[11px] text-[var(--text-quaternary)]">
            {t("workspaceNoMemory")}
          </p>
        )}
      </div>
    </div>
  );
}

export function ContextCard() {
  const { t } = useTranslation("chat");
  const collapsed = useWorkspaceStore((s) => s.collapsedSections["context"]);
  const toggleSection = useWorkspaceStore((s) => s.toggleSection);
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--shadow-sm)]">
      <button
        className="flex w-full items-start justify-between px-4 py-4 text-left transition-colors hover:bg-[var(--surface-secondary)]"
        onClick={() => toggleSection("context")}
      >
        <div className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-[var(--text-primary)]">
            {t("workspaceContext")}
          </span>
          <span className="mt-1 block truncate text-[12px] text-[var(--text-tertiary)]">
            {workspacePath ? t("workspaceContextReady") : t("workspaceContextWaiting")}
          </span>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {workspacePath ? (
              <>
                <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                  {t("workspaceMemory")}
                </span>
                <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                  {t("workspaceSkills")}
                </span>
                <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                  {t("workspaceConnectors")}
                </span>
              </>
            ) : (
              <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                {t("workspaceWaiting")}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-[var(--text-tertiary)] transition-transform duration-200",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--border-default)] pb-3 pt-2">
              <MemoryBlock />
              <ConnectorsBlock />
              <SkillsSummary />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
