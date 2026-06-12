"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, FileText, FolderOpen, NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore, type WorkspaceFile } from "@/stores/workspace-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { cn } from "@/lib/utils";
import { artifactTypeFromExtension, languageFromExtension } from "@/lib/artifacts";

function FileItem({ file }: { file: WorkspaceFile }) {
  const handleClick = () => {
    const store = useArtifactStore.getState();
    // Match by filePath first, then fall back to matching by title (for artifacts
    // created by the artifact tool which don't have filePath set yet)
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const existing = store.artifacts.find(
      (a) => a.filePath === file.path || (!a.filePath && a.title === baseName),
    );
    const artifactType = artifactTypeFromExtension(file.path);
    if (existing) {
      // Re-open with filePath and current extension-based type so binary media
      // files do not reuse an older text preview artifact.
      store.openArtifact({
        ...existing,
        type: artifactType ?? existing.type,
        filePath: file.path,
        language: artifactType === "code" ? languageFromExtension(file.path) : existing.language,
      });
      return;
    }
    store.openArtifact({
      id: `workspace-${file.path}`,
      type: artifactType ?? "file-preview",
      title: file.name,
      content: "",
      language: artifactType === "code" ? languageFromExtension(file.path) : undefined,
      filePath: file.path,
    });
  };

  const displayName =
    file.type === "instructions" ? `Instructions \u00b7 ${file.name}` : file.name;

  return (
    <button
      className="w-full flex items-center gap-2.5 px-4 py-1.5 text-left transition-colors"
      onClick={handleClick}
    >
      <FileText className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
      <span className="text-[13px] text-[var(--text-secondary)] truncate">
        {displayName}
      </span>
    </button>
  );
}

export function ScratchpadCard() {
  const { t } = useTranslation("chat");
  const content = useWorkspaceStore((s) => s.scratchpadContent);
  const setContent = useWorkspaceStore((s) => s.setScratchpadContent);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--shadow-sm)]">
      <button
        className={cn(
          "flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--surface-secondary)]",
          expanded && "bg-[var(--surface-secondary)]",
        )}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
          <NotebookPen className="h-4 w-4 text-[var(--text-tertiary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-[var(--text-primary)]">
            {t("workspaceScratchpad")}
          </span>
          <span className="mt-1 block truncate text-[12px] text-[var(--text-tertiary)]">
            {content.trim() ? t("workspaceNotesAvailable") : t("workspaceScratchpadPlaceholder")}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-[var(--border-default)] p-3">
          <textarea
            className={cn(
              "min-h-[96px] w-full resize-none rounded-lg px-3 py-2 text-[13px] leading-relaxed",
              "border border-[var(--border-focus)] bg-[var(--surface-primary)] text-[var(--text-primary)]",
              "placeholder:text-[var(--text-quaternary)] focus:outline-none",
            )}
            placeholder={t("workspaceScratchpadPlaceholder")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

interface FilesCardProps {
  collapsible?: boolean;
  files?: WorkspaceFile[];
  title?: string;
  emptyText?: string;
}

export function FilesCard({ collapsible = true, files, title, emptyText }: FilesCardProps = {}) {
  const { t } = useTranslation("chat");
  const storeFiles = useWorkspaceStore((s) => s.workspaceFiles);
  const workspaceFiles = files ?? storeFiles;
  const collapsed = useWorkspaceStore((s) => s.collapsedSections["files"]);
  const toggleSection = useWorkspaceStore((s) => s.toggleSection);
  const latestFile = workspaceFiles[workspaceFiles.length - 1];
  const isCollapsed = collapsible ? collapsed : false;
  const displayTitle = title ?? t("workspaceFiles");
  const displayEmptyText = emptyText ?? t("workspaceNoFiles");

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--shadow-sm)]">
      <button
        className="flex w-full items-start justify-between px-4 py-4 text-left transition-colors hover:bg-[var(--surface-secondary)]"
        onClick={() => collapsible && toggleSection("files")}
        aria-expanded={!isCollapsed}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
            <FolderOpen className="h-4 w-4 text-[var(--text-tertiary)]" />
          </div>
          <div className="min-w-0">
            <span className="block text-[13px] font-medium text-[var(--text-primary)]">
              {displayTitle}
            </span>
            <span className="mt-1 block text-[12px] text-[var(--text-tertiary)]">
              {workspaceFiles.length > 0
                ? t("workspaceGeneratedFiles", { count: workspaceFiles.length })
                : displayEmptyText}
            </span>
            {latestFile && (
              <span className="mt-2 block truncate text-[12px] text-[var(--text-secondary)]">
                {t("workspaceLatestFile", { name: latestFile.name })}
              </span>
            )}
          </div>
        </div>
        <div className="ml-3 flex items-center gap-2">
          {workspaceFiles.length > 0 && (
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
              {workspaceFiles.length}
            </span>
          )}
          {collapsible && (
            <ChevronDown
              className={cn(
                "h-4 w-4 text-[var(--text-tertiary)] transition-transform duration-200",
                collapsed && "-rotate-90",
              )}
            />
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--border-default)] pb-1 pt-2">
              {workspaceFiles.length > 0 ? (
                <div className="space-y-0.5">
                  {workspaceFiles.map((file) => (
                    <FileItem key={file.path} file={file} />
                  ))}
                </div>
              ) : (
                <p className="px-4 py-2 text-[12px] text-[var(--text-quaternary)]">
                  {displayEmptyText}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
