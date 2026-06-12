"use client";

import { WORKSPACE_PANEL_WIDTH, IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";
import { useIsMacOS } from "@/hooks/use-platform";
import { useTranslation } from "react-i18next";
import { FolderKanban } from "lucide-react";
import { ProgressCard } from "./progress-section";
import { ScratchpadCard } from "./files-section";
import { ContextCard } from "./context-section";

export function WorkspacePanelContent() {
  const { t } = useTranslation("chat");

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 scrollbar-auto">
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-primary)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]">
          <FolderKanban className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t("workspacePanelTitle")}
          </h3>
          <p className="mt-0.5 text-ui-caption text-[var(--text-secondary)]">
            {t("workspacePanelDesc")}
          </p>
        </div>
      </div>
      <div className="space-y-3">
        <ProgressCard />
        <ScratchpadCard />
        <ContextCard />
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  const isMac = useIsMacOS();
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;
  return (
    <aside
      className="fixed inset-y-0 right-0 z-30 flex flex-col overflow-hidden bg-[var(--surface-chat)]"
      style={{
        width: WORKSPACE_PANEL_WIDTH,
        top: topOffset,
      }}
    >
      <WorkspacePanelContent />
    </aside>
  );
}
