"use client";

import { MessageSquare, BarChart3 } from "lucide-react";
import { useSidebarStore, type AppMode } from "@/stores/sidebar-store";
import { cn } from "@/lib/utils";

const MODES: { id: AppMode; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "codata", label: "Codata", icon: BarChart3 },
];

/**
 * Top-level product-mode switch (Chat ↔ Codata), rendered at the top of the
 * sidebar. Mounted between the drag strip and the session list.
 */
export function SidebarNav() {
  const appMode = useSidebarStore((s) => s.appMode);
  const setAppMode = useSidebarStore((s) => s.setAppMode);

  return (
    <div className="px-3 pt-1 pb-2">
      <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-secondary)] p-1">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const selected = appMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => setAppMode(mode.id)}
              aria-pressed={selected}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-ui-body font-medium transition-colors",
                selected
                  ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
