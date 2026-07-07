"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ClipboardList,
  FileCode2,
  FolderKanban,
  PanelRightClose,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { WorkspacePanelContent } from "@/components/workspace/workspace-panel";
import { ActivityPanelContent, ExpertProgressPanel } from "@/components/activity/activity-panel";
import { ArtifactPanelHeader } from "@/components/artifacts/artifact-panel-header";
import { ArtifactPanelContent } from "@/components/artifacts/artifact-panel-content";
import { PlanReviewContent } from "@/components/plan-review/plan-review-panel";
import { FilesCard } from "@/components/workspace/files-section";
import { useActivityStore } from "@/stores/activity-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { usePlanReviewStore } from "@/stores/plan-review-store";
import { useRightSidebarStore, type RightSidebarTab } from "@/stores/right-sidebar-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useIsMacOS } from "@/hooks/use-platform";
import { cn } from "@/lib/utils";
import {
  IS_DESKTOP,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  TITLE_BAR_HEIGHT,
} from "@/lib/constants";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

interface TabConfig {
  id: RightSidebarTab;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  badge?: number;
  disabled?: boolean;
}

function ResizeHandle({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setDragging(true);
    startXRef.current = event.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const delta = startXRef.current - event.clientX;
      onChange(
        Math.max(
          RIGHT_SIDEBAR_MIN_WIDTH,
          Math.min(RIGHT_SIDEBAR_MAX_WIDTH, startWidthRef.current + delta),
        ),
      );
    };
    const onMouseUp = () => setDragging(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, onChange]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-[var(--brand-primary)]/20"
      aria-hidden="true"
    />
  );
}

function RightSidebarHeader() {
  const { t } = useTranslation("chat");
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const setActiveTab = useRightSidebarStore((s) => s.setActiveTab);
  const activityData = useActivityStore((s) => s.activeData);
  const artifacts = useArtifactStore((s) => s.artifacts);
  const planData = usePlanReviewStore((s) => s.planData);
  const todos = useWorkspaceStore((s) => s.todos);
  const workspaceFiles = useWorkspaceStore((s) => s.workspaceFiles);
  const deliverableFiles = useMemo(
    () => workspaceFiles.filter((file) => file.visibility === "deliverable"),
    [workspaceFiles],
  );
  const closeCurrentTab = useCloseCurrentTab();
  const hasExpert = activityData?.mode === "expert-team";
  const hasActivity = !!activityData && activityData.mode !== "expert-team";
  const workspaceBadge = todos.length;
  const artifactBadge = artifacts.length + deliverableFiles.length;

  const tabs = useMemo<TabConfig[]>(
    () => [
      { id: "workspace", labelKey: "rightSidebarWorkspace", descKey: "rightSidebarWorkspaceDesc", icon: FolderKanban, badge: workspaceBadge },
      { id: "expert", labelKey: "rightSidebarExpert", descKey: "rightSidebarExpertDesc", icon: Users, disabled: !hasExpert },
      { id: "activity", labelKey: "rightSidebarActivity", descKey: "rightSidebarActivityDesc", icon: Activity, disabled: !hasActivity },
      { id: "artifact", labelKey: "rightSidebarArtifact", descKey: "rightSidebarArtifactDesc", icon: FileCode2, badge: artifactBadge, disabled: artifactBadge === 0 },
      { id: "plan", labelKey: "rightSidebarPlan", descKey: "rightSidebarPlanDesc", icon: ClipboardList, badge: planData ? 1 : 0, disabled: !planData },
    ],
    [artifactBadge, hasActivity, hasExpert, planData, workspaceBadge],
  );
  const activeConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const ActiveIcon = activeConfig.icon;

  return (
    <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)]/88 backdrop-blur-sm">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--data-accent-soft)] text-[var(--data-accent)]">
          <ActiveIcon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
            Inspector
          </div>
          <h2 className="truncate text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t(activeConfig.labelKey)}
          </h2>
          <p className="mt-0.5 truncate text-ui-caption text-[var(--text-tertiary)]">
            {t(activeConfig.descKey)}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={closeCurrentTab}>
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex h-11 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-[var(--surface-secondary)] p-1 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={tab.disabled}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                  selected
                    ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--surface-primary)]/70 hover:text-[var(--text-secondary)]",
                  tab.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--text-tertiary)]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t(tab.labelKey)}</span>
                {!!tab.badge && (
                  <span className="ml-0.5 rounded-full bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--text-tertiary)]">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function useCloseCurrentTab() {
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const closeSidebar = useRightSidebarStore((s) => s.close);
  const closeActivity = useActivityStore((s) => s.close);
  const closeArtifact = useArtifactStore((s) => s.close);
  const closePlan = usePlanReviewStore((s) => s.close);
  const closeWorkspace = useWorkspaceStore((s) => s.close);

  return useCallback(() => {
    if (activeTab === "expert" || activeTab === "activity") {
      closeActivity();
    } else if (activeTab === "artifact") {
      closeArtifact();
    } else if (activeTab === "plan") {
      closePlan();
    } else if (activeTab === "workspace") {
      closeWorkspace();
    } else {
      closeSidebar();
    }
  }, [activeTab, closeActivity, closeArtifact, closePlan, closeSidebar, closeWorkspace]);
}

function EmptyTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-xs rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-5 py-6">
        <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{description}</p>
      </div>
    </div>
  );
}

function RightSidebarContent() {
  const { t } = useTranslation("chat");
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const closeActivity = useActivityStore((s) => s.close);
  const activityData = useActivityStore((s) => s.activeData);
  const artifact = useArtifactStore((s) => s.activeArtifact);
  const planData = usePlanReviewStore((s) => s.planData);
  const workspaceFiles = useWorkspaceStore((s) => s.workspaceFiles);
  const deliverableFiles = useMemo(
    () => workspaceFiles.filter((file) => file.visibility === "deliverable"),
    [workspaceFiles],
  );

  if (activeTab === "workspace") {
    return <WorkspacePanelContent />;
  }

  if (activeTab === "expert") {
    return activityData?.mode === "expert-team" ? (
      <ExpertProgressPanel data={activityData} onClose={closeActivity} showClose={false} />
    ) : (
      <EmptyTab title={t("rightSidebarExpertEmpty")} description={t("rightSidebarExpertEmptyDesc")} />
    );
  }

  if (activeTab === "activity") {
    return activityData && activityData.mode !== "expert-team" ? (
      <ActivityPanelContent showClose={false} />
    ) : (
      <EmptyTab title={t("rightSidebarActivityEmpty")} description={t("rightSidebarActivityEmptyDesc")} />
    );
  }

  if (activeTab === "artifact") {
    return artifact || deliverableFiles.length > 0 ? (
      <div className="flex h-full flex-col">
        {artifact && <ArtifactPanelHeader showClose={false} />}
        <div className={cn("min-h-0 flex-1", artifact ? "overflow-hidden" : "overflow-y-auto px-3 py-4")}>
          {artifact ? (
            <ArtifactPanelContent />
          ) : (
            <FilesCard collapsible={false} files={deliverableFiles} title={t("rightSidebarArtifact")} emptyText={t("rightSidebarArtifactEmpty")} />
          )}
        </div>
        {artifact && deliverableFiles.length > 0 && (
          <div className="max-h-[34%] shrink-0 overflow-y-auto border-t border-[var(--border-default)] px-3 py-3">
            <FilesCard collapsible={false} files={deliverableFiles} title={t("rightSidebarArtifact")} emptyText={t("rightSidebarArtifactEmpty")} />
          </div>
        )}
      </div>
    ) : (
      <EmptyTab title={t("rightSidebarArtifactEmpty")} description={t("rightSidebarArtifactEmptyDesc")} />
    );
  }

  if (activeTab === "plan") {
    return planData ? (
      <PlanReviewContent showClose={false} />
    ) : (
      <EmptyTab title={t("rightSidebarPlanEmpty")} description={t("rightSidebarPlanEmptyDesc")} />
    );
  }

  return null;
}

export function RightSidebar() {
  const isOpen = useRightSidebarStore((s) => s.isOpen);
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const setActiveTab = useRightSidebarStore((s) => s.setActiveTab);
  const closeCurrentTab = useCloseCurrentTab();
  const width = useRightSidebarStore((s) => s.width);
  const setWidth = useRightSidebarStore((s) => s.setWidth);
  const activityData = useActivityStore((s) => s.activeData);
  const artifact = useArtifactStore((s) => s.activeArtifact);
  const workspaceFiles = useWorkspaceStore((s) => s.workspaceFiles);
  const deliverableFiles = useMemo(
    () => workspaceFiles.filter((file) => file.visibility === "deliverable"),
    [workspaceFiles],
  );
  const planData = usePlanReviewStore((s) => s.planData);
  const isDesktop = useIsDesktop();
  const isMac = useIsMacOS();
  const topOffset = IS_DESKTOP && !isMac ? TITLE_BAR_HEIGHT : 0;

  useEffect(() => {
    if (activeTab === "expert" && activityData?.mode !== "expert-team") setActiveTab("workspace");
    if (activeTab === "activity" && (!activityData || activityData.mode === "expert-team")) setActiveTab("workspace");
    if (activeTab === "artifact" && !artifact && deliverableFiles.length === 0) setActiveTab("workspace");
    if (activeTab === "plan" && !planData) setActiveTab("workspace");
  }, [activeTab, activityData, artifact, deliverableFiles.length, planData, setActiveTab]);

  if (isDesktop) {
    return (
      <motion.aside
        className="fixed inset-y-0 right-0 z-[35] flex flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-primary)] shadow-[var(--shadow-lg)]"
        style={{ width, top: topOffset }}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <ResizeHandle width={width} onChange={setWidth} />
        <RightSidebarHeader />
        <div className="flex min-h-0 flex-1 flex-col">
          <RightSidebarContent />
        </div>
      </motion.aside>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeCurrentTab()}>
      <SheetContent side="right" className="w-[90vw] p-0 sm:max-w-[560px]">
        <VisuallyHidden.Root asChild>
          <SheetTitle>Right sidebar</SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>Workspace, activity, expert team, artifacts, and plans</SheetDescription>
        </VisuallyHidden.Root>
        <div className="flex h-full flex-col">
          <RightSidebarHeader />
          <div className="flex min-h-0 flex-1 flex-col">
            <RightSidebarContent />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
