"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api";
import { API } from "@/lib/constants";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface VideoRendererProps {
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
  return new Blob([bytes], { type: mimeType || "video/mp4" });
}

export function VideoRenderer({ filePath }: VideoRendererProps) {
  const workspace = useWorkspaceStore((s) => s.activeWorkspacePath);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
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
        const res = await api.post<BinaryContentResponse>(API.FILES.CONTENT_BINARY, { path: filePath, workspace });
        if (cancelled) return;
        setFileName(res.name);
        objectUrl = URL.createObjectURL(base64ToBlob(res.content_base64, res.mime_type));
        setSrc(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setError(apiErrorMessage(err, "Failed to load video"));
        }
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
    a.download = fileName || "video.mp4";
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
    <div className="flex flex-col h-full bg-black">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/70 shrink-0">
        <span className="text-[11px] font-medium text-white/70 uppercase tracking-wide truncate">
          {fileName || "video.mp4"}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-white/80 hover:text-white" onClick={handleDownload} disabled={!src}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 flex items-center justify-center bg-black">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          </div>
        )}
        {src && (
          <video
            controls
            autoPlay={false}
            playsInline
            className="h-full w-full object-contain"
            src={src}
            poster=""
          >
            <track kind="captions" />
          </video>
        )}
        {!loading && !src && (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Play className="h-4 w-4" />
            <span>No video loaded</span>
          </div>
        )}
      </div>
    </div>
  );
}
