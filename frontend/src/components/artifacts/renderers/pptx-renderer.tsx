"use client";

import { useState } from "react";
import { Download, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api";
import { API } from "@/lib/constants";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface PptxRendererProps {
  filePath?: string;
}

export function PptxRenderer({ filePath }: PptxRendererProps) {
  const workspace = useWorkspaceStore((s) => s.activeWorkspacePath);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileName = filePath?.split(/[\\/]/).pop() || "presentation.pptx";

  const handleDownload = async () => {
    if (!filePath || downloading) return;

    setDownloading(true);
    setError(null);
    try {
      const res = await api.post<{
        content_base64: string;
        mime_type: string;
        name: string;
      }>(API.FILES.CONTENT_BINARY, { path: filePath, workspace });
      const binary = atob(res.content_base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }

      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: res.mime_type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = res.name || fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to download presentation"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-tertiary)] px-3 py-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {fileName}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleDownload}
          disabled={!filePath || downloading}
          title="Download"
          aria-label={`Download ${fileName}`}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Presentation className="h-8 w-8 text-[var(--text-tertiary)]" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--text-primary)]">
          PPTX preview is not supported.
        </p>
        <p className="max-w-md text-sm text-[var(--text-tertiary)]">
          You can still download this presentation and open it in a compatible app.
        </p>
        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        <Button onClick={handleDownload} disabled={!filePath || downloading}>
          <Download className="mr-2 h-4 w-4" />
          {downloading ? "Downloading…" : "Download presentation"}
        </Button>
      </div>
    </div>
  );
}
