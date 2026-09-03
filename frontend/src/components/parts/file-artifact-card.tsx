"use client";

import { useCallback, useMemo, useState } from "react";
import {
  BookPlus,
  Code,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Globe,
  Image,
  Loader2,
  Presentation,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import { API } from "@/lib/constants";
import { artifactTypeFromExtension, languageFromExtension } from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { useImportKnowledge } from "@/hooks/use-knowledge";
import { useArtifactStore } from "@/stores/artifact-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ArtifactType } from "@/types/artifact";
import type { ToolPart } from "@/types/message";

interface FileArtifactCardProps {
  data?: ToolPart;
  filePath?: string;
  title?: string;
  cardId?: string;
  compact?: boolean;
}

interface BinaryContentResponse {
  content_base64: string;
  name: string;
  mime_type: string;
  size: number;
}

const TYPE_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  html: { icon: Globe, label: "Page 路 HTML" },
  svg: { icon: Image, label: "Image 路 SVG" },
  image: { icon: Image, label: "Image" },
  markdown: { icon: FileText, label: "Document 路 MD" },
  docx: { icon: FileText, label: "Document 路 Word" },
  pdf: { icon: FileText, label: "Document 路 PDF" },
  pptx: { icon: Presentation, label: "Presentation 路 PPTX" },
  xlsx: { icon: FileSpreadsheet, label: "Spreadsheet 路 Excel" },
  csv: { icon: FileSpreadsheet, label: "Spreadsheet 路 CSV" },
  video: { icon: Film, label: "Video" },
  mermaid: { icon: Code, label: "Diagram 路 Mermaid" },
  react: { icon: Code, label: "Component 路 TSX" },
  code: { icon: Code, label: "Code" },
  file: { icon: FileArchive, label: "File" },
};

const KNOWLEDGE_IMPORTABLE_EXTS = new Set([".md", ".markdown", ".txt"]);

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function fileExtension(path: string): string {
  const name = basename(path).toLowerCase();
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : "";
}

function titleWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function labelForFile(filePath: string, artifactType: ArtifactType | null): string {
  if (artifactType === "code") {
    const language = languageFromExtension(filePath);
    return language ? `Code 路 ${language.charAt(0).toUpperCase() + language.slice(1)}` : "Code";
  }
  return TYPE_CONFIG[artifactType ?? "file"]?.label ?? TYPE_CONFIG.file.label;
}

function artifactPanelType(filePath: string): ArtifactType {
  return artifactTypeFromExtension(filePath) ?? "file-preview";
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function FileArtifactCard({
  data,
  filePath: directFilePath,
  title: directTitle,
  cardId,
  compact = false,
}: FileArtifactCardProps) {
  const openArtifact = useArtifactStore((s) => s.openArtifact);
  const workspace = useWorkspaceStore((s) => s.activeWorkspacePath);
  const importKnowledge = useImportKnowledge();
  const [downloading, setDownloading] = useState(false);

  const input = (data?.state.input ?? {}) as Record<string, string | undefined>;
  const metadata = (data?.state.metadata ?? {}) as Record<string, string | undefined>;
  const filePath = directFilePath || metadata.file_path || input.file_path || "";
  const fileName = filePath ? basename(filePath) : "File";
  const title = directTitle || metadata.title || input.title || titleWithoutExtension(fileName);
  const isRunning = data?.state.status === "running" || data?.state.status === "pending";
  const isError = data?.state.status === "error";

  const artifactType = useMemo(() => (filePath ? artifactTypeFromExtension(filePath) : null), [filePath]);
  const typeLabel = filePath ? labelForFile(filePath, artifactType) : "File";
  const config = TYPE_CONFIG[artifactType ?? "file"] ?? TYPE_CONFIG.file;
  const TypeIcon = config.icon;
  const canImportKnowledge = !!workspace && !!filePath && KNOWLEDGE_IMPORTABLE_EXTS.has(fileExtension(filePath));

  const handleOpen = useCallback(() => {
    if (!filePath || isRunning || isError) return;
    openArtifact({
      id: cardId || `present-${data?.call_id ?? filePath}`,
      type: artifactPanelType(filePath),
      title: title || fileName,
      content: "",
      language: languageFromExtension(filePath),
      filePath,
    });
  }, [cardId, data?.call_id, fileName, filePath, isError, isRunning, openArtifact, title]);

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!filePath || downloading) return;

      setDownloading(true);
      try {
        const res = await api.post<BinaryContentResponse>(
          API.FILES.CONTENT_BINARY,
          { path: filePath, workspace },
          { timeoutMs: 120_000 },
        );
        downloadBlob(base64ToBlob(res.content_base64, res.mime_type), res.name || fileName);
      } finally {
        setDownloading(false);
      }
    },
    [downloading, fileName, filePath, workspace],
  );

  const handleImportKnowledge = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!filePath || !canImportKnowledge || importKnowledge.isPending) return;
      importKnowledge.mutate(
        {
          file_path: filePath,
          workspace: workspace || undefined,
          title: title || fileName,
        },
        {
          onSuccess: () => toast.success("已加入知识库"),
          onError: (err) => toast.error(apiErrorMessage(err, "加入知识库失败")),
        },
      );
    },
    [canImportKnowledge, fileName, filePath, importKnowledge, title, workspace],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpen();
      }
    },
    [handleOpen],
  );

  const iconButtonSize = compact ? "h-7 w-7" : "h-8 w-8";

  return (
    <div
      role="button"
      tabIndex={isRunning || isError ? -1 : 0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left",
        "bg-[var(--surface-secondary)] transition-all duration-150",
        !isRunning && !isError && "cursor-pointer hover:-translate-y-0.5 hover:bg-[var(--surface-tertiary)] hover:shadow-[var(--shadow-md)]",
        isError ? "border-[var(--color-destructive)]/30" : "border-[var(--border-default)]",
        compact && "min-h-[5.25rem]",
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
        ) : (
          <TypeIcon className="h-4 w-4 text-[var(--brand-primary)]" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium text-[var(--text-primary)]",
            isRunning && "shimmer-text",
          )}
          title={title || fileName}
        >
          {title || fileName}
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]" title={fileName}>
          {typeLabel}
        </p>
      </div>

      {!isRunning && !isError && filePath && (
        <TooltipProvider delayDuration={200}>
          <div className="flex shrink-0 items-center gap-1">
            {canImportKnowledge && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleImportKnowledge}
                    disabled={importKnowledge.isPending}
                    aria-label={`Add ${title || fileName} to knowledge base`}
                    className={cn(
                      "flex items-center justify-center rounded-lg",
                      "bg-[var(--surface-tertiary)] text-[var(--text-secondary)] transition-colors",
                      "hover:bg-[var(--surface-primary)] hover:text-[var(--text-primary)]",
                      iconButtonSize,
                      importKnowledge.isPending && "opacity-60",
                    )}
                  >
                    {importKnowledge.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <BookPlus className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>加入知识库</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  aria-label={`${downloading ? "Exporting" : "Download"} ${title || fileName}`}
                  className={cn(
                    "flex items-center justify-center rounded-lg",
                    "bg-[var(--surface-tertiary)] text-[var(--text-secondary)] transition-colors",
                    "hover:bg-[var(--surface-primary)] hover:text-[var(--text-primary)]",
                    iconButtonSize,
                    downloading && "opacity-60",
                  )}
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{downloading ? "导出中" : "下载"}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
