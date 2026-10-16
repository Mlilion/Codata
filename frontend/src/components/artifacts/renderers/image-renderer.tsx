"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api";
import { API } from "@/lib/constants";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface ImageRendererProps {
  filePath?: string;
}

interface BinaryContentResponse {
  content_base64: string;
  name: string;
  mime_type: string;
  size: number;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "image/png" });
}

export function ImageRenderer({ filePath }: ImageRendererProps) {
  const workspace = useWorkspaceStore((s) => s.activeWorkspacePath);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setError("No file path provided");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.post<BinaryContentResponse>(
          API.FILES.CONTENT_BINARY,
          { path: filePath, workspace },
          { timeoutMs: 120_000 },
        );
        if (cancelled) return;
        setFileName(res.name);
        objectUrl = URL.createObjectURL(base64ToBlob(res.content_base64, res.mime_type));
        setSrc(objectUrl);
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err, "Failed to load image"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath, workspace]);

  const handleDownload = useCallback(() => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = fileName || "image.png";
    a.click();
  }, [fileName, src]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-sm text-[var(--color-destructive)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-primary)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          {fileName || "image"}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} disabled={!src}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-auto bg-[var(--surface-secondary)] p-4">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
          </div>
        )}
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={fileName || "Preview"}
            className="max-h-full max-w-full object-contain"
          />
        )}
        {!loading && !src && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <ImageIcon className="h-4 w-4" />
            <span>No image loaded</span>
          </div>
        )}
      </div>
    </div>
  );
}
