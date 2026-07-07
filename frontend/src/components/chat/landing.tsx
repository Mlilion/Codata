"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Lightbulb,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useTranslation } from 'react-i18next';
import { ChatForm } from "./chat-form";
import { ChatHeader } from "./chat-header";
import { OfflineOverlay } from "@/components/layout/offline-overlay";
import { StreamingMessage } from "@/components/messages/assistant-message";
import { FileChip } from "./file-chip";
import { CodataLogo } from "@/components/ui/codata-logo";
import { useChat } from "@/hooks/use-chat";
import { useChatStore } from "@/stores/chat-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useActivityStore } from "@/stores/activity-store";
import { useRightSidebarStore } from "@/stores/right-sidebar-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAnalysisRecommendations } from "@/hooks/use-analysis";
import { useDataSourceStatus } from "@/hooks/use-data-source-status";

const STARTER_ACTIONS = [
  { labelKey: "starterOrganizeBills", promptKey: "starterOrganizeBillsPrompt" },
  { labelKey: "starterSummarizeFolder", promptKey: "starterSummarizeFolderPrompt" },
  { labelKey: "starterDraftFromNotes", promptKey: "starterDraftFromNotesPrompt" },
  { labelKey: "starterCompareDocs", promptKey: "starterCompareDocsPrompt" },
];

interface LandingProps {
  directoryParam?: string | null;
  skillParam?: string | null;
}

function workspaceBasename(path: string | null | undefined): string | null {
  if (!path || path === ".") return null;
  const trimmed = path.replace(/[\\/]+$/, "");
  const segments = trimmed.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || null;
}

export function Landing({ directoryParam = null, skillParam = null }: LandingProps) {
  const { t } = useTranslation('chat');
  const { sendMessage, isGenerating, stopGeneration, pendingUserText, pendingAttachments, streamingParts, streamingText, streamingReasoning } = useChat();
  const globalWorkspace = useSettingsStore((s) => s.workspaceDirectory);
  const workspaceName = workspaceBasename(globalWorkspace);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const isCodata = useSidebarStore((s) => s.appMode) === "codata";
  const { data: recData } = useAnalysisRecommendations(isCodata);
  const recommendations = recData?.recommendations ?? [];
  const { data: dsStatus } = useDataSourceStatus(isCodata);
  // Treat unknown (loading/error) as connected so the guide doesn't flash
  // before the status resolves.
  const dataConnected = dsStatus?.connected ?? true;

  useEffect(() => {
    const state = useChatStore.getState();
    state.resetSession(null);
    state.setFocusedSession(null);
    // Respect ?directory=... (used by "Add new project"); otherwise start unrestricted.
    useSettingsStore.getState().setWorkspaceDirectory(directoryParam || null);
    // Close right-side panels when landing page mounts (new chat / after delete)
    useRightSidebarStore.getState().close();
    useArtifactStore.getState().clearAll();
    useActivityStore.getState().clear();
  }, [directoryParam]);

  // Capture the user text in local state so it persists even after
  // startGeneration() clears pendingUserText from the global store.
  // This prevents the user bubble from flashing away before navigation.
  const capturedTextRef = useRef<string | null>(null);
  if (pendingUserText) {
    capturedTextRef.current = pendingUserText;
  }
  if (!isGenerating) {
    capturedTextRef.current = null;
  }
  const displayText = pendingUserText ?? capturedTextRef.current;

  // When generating, switch to a chat-like layout — uses the same
  // StreamingMessage component as chat-view for visual consistency.
  if (isGenerating) {
    return (
      <div className="relative flex flex-1 flex-col h-full overflow-hidden">
        <OfflineOverlay />
        <ChatHeader />

        {/* Messages area — optimistic user bubble + streaming assistant */}
        <div className="flex-1 overflow-y-auto">
          {displayText && (
            <div className="px-4 py-3">
              <div className="mx-auto max-w-5xl">
                <motion.div
                  className="flex justify-end"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl bg-[var(--user-bubble-bg)] px-4 py-2.5 shadow-[var(--shadow-sm)] border border-[var(--border-default)]">
                    <div className="text-[13px] text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
                      {displayText}
                    </div>
                    {pendingAttachments && pendingAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {pendingAttachments.map((att) => (
                          <FileChip key={att.file_id} file={att} />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </div>
          )}

          {/* Streaming assistant message — same component used in chat-view */}
          <div className="px-4 py-5">
            <div className="mx-auto max-w-5xl">
              <StreamingMessage
                sessionId={null}
                parts={streamingParts}
                streamingText={streamingText}
                streamingReasoning={streamingReasoning}
              />
            </div>
          </div>
        </div>

        {/* Input */}
        <ChatForm
          isGenerating={isGenerating}
          onSend={sendMessage}
          onStop={stopGeneration}
          directory={globalWorkspace}
          selectedSkill={skillParam}
        />
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col h-full overflow-hidden">
      <OfflineOverlay />
      <ChatHeader showModelSelector={false} />

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3 scrollbar-auto sm:px-6">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center py-6 sm:py-8">
          {/* Provider setup prompt */}
          {!activeProvider && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="mb-8 flex w-full max-w-3xl items-center gap-4 rounded-xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/5 px-5 py-4"
            >
              <Settings className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('setupProvider')}
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {t('setupProviderDesc')}
                </p>
              </div>
              <Link
                href="/settings?tab=providers"
                className="shrink-0 inline-flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
              >
                {t('configureSettings')}
              </Link>
            </motion.div>
          )}

          <main className="min-w-0">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--shadow-sm)]">
                <CodataLogo size={34} className="rounded-xl" />
              </div>
              <div className="min-w-0">
                <span className="sr-only">
                  {workspaceName
                    ? t('greetingInWorkspace', { workspace: workspaceName })
                    : t('greeting')}
                </span>
                <h1 className="text-ui-title-lg font-semibold text-[var(--text-primary)] sm:text-2xl">
                  {workspaceName
                    ? t('greetingInWorkspace', { workspace: workspaceName })
                    : isCodata
                      ? t('landingTitleCodata')
                      : t('landingTitle')}
                </h1>
                <p className="mt-1 max-w-2xl text-ui-body leading-relaxed text-[var(--text-secondary)]">
                  {isCodata ? t("landingSubtitleCodata") : t("landingSubtitle")}
                </p>
              </div>
            </div>

            <ChatForm
              variant="landing"
              isGenerating={isGenerating}
              onSend={sendMessage}
              onStop={stopGeneration}
              directory={globalWorkspace}
              placeholder={isCodata ? t("landingPlaceholderCodata") : t("landingPlaceholder")}
              className="w-full"
              selectedSkill={skillParam}
            />

            {isCodata ? (
              !dataConnected ? (
                // No data source connected yet: show the 3-step onboarding
                // guide instead of canned recommendations.
                <section className="mt-6">
                  <div className="mx-auto max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-5 text-left">
                    <p className="mb-3 text-ui-body font-medium text-[var(--text-primary)]">
                      开始你的第一次分析
                    </p>
                    <ol className="space-y-2 text-ui-caption text-[var(--text-secondary)]">
                      <li>
                        ①{" "}
                        <Link href="/mcp" className="underline">
                          连接数据源
                        </Link>
                        （datasage 数据平台）
                      </li>
                      <li>
                        ②{" "}
                        <Link href="/settings?tab=providers" className="underline">
                          配置模型
                        </Link>
                      </li>
                      <li>③ 回到这里,用自然语言提出你的第一个数据问题</li>
                    </ol>
                  </div>
                </section>
              ) : (
                // Codata mode: analysis recommendations.
                <section className="mt-6">
                  <div className="mb-2 flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-[var(--text-tertiary)]" />
                    <h2 className="text-ui-caption font-semibold text-[var(--text-primary)]">
                      推荐分析
                    </h2>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {recommendations.slice(0, 3).map((rec) => (
                      <button
                        key={rec}
                        type="button"
                        onClick={() => useArtifactStore.getState().requestFix(rec)}
                        className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-3 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--border-heavy)] hover:bg-[var(--surface-secondary)]"
                      >
                        <span className="min-w-0 text-ui-body text-[var(--text-primary)]">{rec}</span>
                        <Sparkles className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--brand-primary)]" />
                      </button>
                    ))}
                  </div>
                </section>
              )
            ) : (
              <section className="mt-6">
                <div className="mb-2 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-[var(--text-tertiary)]" />
                  <h2 className="text-ui-caption font-semibold text-[var(--text-primary)]">
                    {t("recommendedActions")}
                  </h2>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STARTER_ACTIONS.map(({ labelKey, promptKey }) => (
                    <button
                      key={labelKey}
                      type="button"
                      onClick={() => useArtifactStore.getState().requestFix(t(promptKey))}
                      className="group flex min-h-16 items-start justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-3 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--border-heavy)] hover:bg-[var(--surface-secondary)]"
                    >
                      <span className="min-w-0">
                        <span className="block text-ui-body font-medium text-[var(--text-primary)]">
                          {t(labelKey)}
                        </span>
                        <span className="mt-1 line-clamp-2 text-ui-caption text-[var(--text-secondary)]">
                          {t(promptKey)}
                        </span>
                      </span>
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--brand-primary)]" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
