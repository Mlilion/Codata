"use client";

import { useState, useEffect, useCallback } from "react";
import { FolderOpen, ChevronRight, ArrowLeft, Check, Home, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

interface DirectoryEntry {
  name: string;
  path: string;
}

interface ListDirectoryResponse {
  path: string;
  parent: string | null;
  dirs: DirectoryEntry[];
}

interface MobileDirectoryBrowserProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string | null;
}

export function MobileDirectoryBrowser({
  open,
  onClose,
  onSelect,
  initialPath,
}: MobileDirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDirectory = useCallback(async (path?: string | null) => {
    setLoading(true);
    try {
      const res = await api.post<ListDirectoryResponse>(API.FILES.LIST_DIRECTORY, {
        path: path || null,
      });
      setCurrentPath(res.path);
      setParentPath(res.parent);
      setDirs(res.dirs);
    } catch (err) {
      console.error("Failed to list directory:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadDirectory(initialPath);
    }
  }, [open, initialPath, loadDirectory]);

  const handleSelect = useCallback(() => {
    onSelect(currentPath);
    onClose();
  }, [currentPath, onSelect, onClose]);

  if (!open) return null;

  // Derive display path — show ~ for home prefix
  const displayPath = currentPath.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-primary)]">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 border-b border-[var(--border-default)]">
        <button
          onClick={onClose}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-[var(--surface-secondary)] active:scale-[0.95] transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold tracking-tight flex-1">Select Workspace</h1>
        <button
          onClick={handleSelect}
          className="h-9 px-4 flex items-center gap-1.5 rounded-full bg-[var(--text-primary)] text-[var(--surface-primary)] text-sm font-medium active:scale-[0.95] transition-transform"
        >
          <Check className="w-4 h-4" />
          Select
        </button>
      </header>

      {/* Current path display */}
      <div className="px-4 py-2.5 bg-[var(--surface-secondary)] border-b border-[var(--border-default)]">
        <p className="text-[13px] text-[var(--text-secondary)] break-all font-mono">
          {displayPath}
        </p>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-default)]">
        {parentPath && (
          <button
            onClick={() => loadDirectory(parentPath)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-secondary)] text-sm text-[var(--text-secondary)] active:scale-[0.97] transition-transform"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Up
          </button>
        )}
        <button
          onClick={() => loadDirectory(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-secondary)] text-sm text-[var(--text-secondary)] active:scale-[0.97] transition-transform"
        >
          <Home className="w-3.5 h-3.5" />
          Home
        </button>
      </div>

      {/* Directory list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center pt-16">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : dirs.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-16 gap-2">
            <FolderOpen className="w-8 h-8 text-[var(--text-tertiary)]" />
            <p className="text-sm text-[var(--text-tertiary)]">No subdirectories</p>
          </div>
        ) : (
          <div className="py-1">
            {dirs.map((dir) => (
              <button
                key={dir.path}
                onClick={() => loadDirectory(dir.path)}
                className="w-full flex items-center gap-3 px-4 py-3 active:bg-[var(--surface-secondary)] transition-colors"
              >
                <FolderOpen className="w-5 h-5 text-[var(--text-tertiary)] shrink-0" />
                <span className="flex-1 text-[15px] text-[var(--text-primary)] text-left truncate">
                  {dir.name}
                </span>
                <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom safe area */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
