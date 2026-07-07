"use client";

import { useRef, useState, useCallback } from "react";
import { RotateCw, Code, Eye, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_DESKTOP } from "@/lib/constants";

interface HtmlRendererProps {
  content: string;
  title?: string;
}

export function HtmlRenderer({ content, title }: HtmlRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showSource, setShowSource] = useState(false);
  const [key, setKey] = useState(0);

  const refresh = useCallback(() => {
    setKey((k) => k + 1);
  }, []);

  // Open the full report in a real browser view. Web: a blob URL in a new tab
  // (full viewport, native zoom). Desktop (Tauri WebView2 can't open blob URLs
  // and there's no local serve URL): fall back to "save as .html" so the user
  // can open it in their browser.
  const openInBrowser = useCallback(async () => {
    const filename = `${(title || "report").replace(/[^\w.-]+/g, "-")}.html`;
    if (IS_DESKTOP) {
      const { desktopAPI } = await import("@/lib/tauri-api");
      const bytes = Array.from(new TextEncoder().encode(content));
      await desktopAPI.downloadAndSave({ data: bytes, defaultName: filename });
      return;
    }
    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [content, title]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)] shrink-0">
        <span className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
          {showSource ? "Source" : "Preview"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={openInBrowser}
            title={IS_DESKTOP ? "另存为 HTML(用浏览器打开)" : "在浏览器打开"}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowSource(!showSource)}
            title={showSource ? "Show preview" : "Show source"}
          >
            {showSource ? <Eye className="h-3.5 w-3.5" /> : <Code className="h-3.5 w-3.5" />}
          </Button>
          {!showSource && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refresh}
              title="Refresh"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {showSource ? (
        <pre className="flex-1 overflow-auto p-4 text-[13px] leading-relaxed font-mono text-[var(--text-primary)] bg-[var(--surface-secondary)]">
          {content}
        </pre>
      ) : (
        <iframe
          key={key}
          ref={iframeRef}
          srcDoc={content}
          sandbox="allow-scripts"
          title={title || "HTML Preview"}
          className="flex-1 w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
