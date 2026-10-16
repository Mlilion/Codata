"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowRight, AtSign, Check, ChevronDown, Plus, Sparkles, Square, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HeaderModelDropdown } from "@/components/selectors/header-model-dropdown";
import { ChatTextarea } from "./chat-textarea";
import { ChatActions } from "./chat-actions";
import { WorkspaceToggle } from "./workspace-toggle";
import { FileChip } from "./file-chip";
import { FileMentionPopup } from "./file-mention-popup";
import { useAutoResize } from "@/hooks/use-auto-resize";
import { uploadFile, browseFiles, attachByPath, ingestFiles } from "@/lib/upload";
import type { FileSearchResult } from "@/lib/upload";
import { cn } from "@/lib/utils";
import type { FileAttachment } from "@/types/chat";
import { useArtifactStore } from "@/stores/artifact-store";
import { useChatSession } from "@/stores/chat-store";
import { useExpertSessionStore } from "@/stores/expert-session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProviderModels } from "@/hooks/use-provider-models";
import { useExpertTeams } from "@/hooks/use-expert-teams";
import { useIndexStatus } from "@/hooks/use-index-status";
import { formatCreditsPerM, usdToCreditsPerM } from "@/lib/pricing";
import type { SendMessageOptions } from "@/hooks/use-chat";
import { CREATE_EXPERT_TEAMS_SKILL, DRAFT_EXPERT_SESSION_ID } from "@/stores/expert-session-store";

interface ChatFormProps {
  isGenerating: boolean;
  isCompacting?: boolean;
  onSend: (text: string, attachments?: FileAttachment[], options?: SendMessageOptions) => Promise<boolean> | void;
  onStop: () => void;
  className?: string;
  sessionId?: string;
  directory?: string | null;
  variant?: "default" | "landing";
  placeholder?: string;
  selectedSkill?: string | null;
}

/** Persistent per-session draft cache backed by localStorage. */
interface Draft {
  input: string;
  attachments: FileAttachment[];
  savedAt: number;
}

const DRAFT_STORAGE_KEY = "codata-drafts";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** In-memory mirror of localStorage drafts — avoids repeated JSON parsing. */
let draftMirror: Map<string, Draft> | null = null;

function loadDrafts(): Map<string, Draft> {
  if (draftMirror) return draftMirror;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) { draftMirror = new Map(); return draftMirror; }
    const parsed: Record<string, Draft> = JSON.parse(raw);
    const now = Date.now();
    // Evict expired drafts on load
    const entries = Object.entries(parsed).filter(
      ([, d]) => now - d.savedAt < DRAFT_MAX_AGE_MS,
    );
    draftMirror = new Map(entries);
  } catch {
    draftMirror = new Map();
  }
  return draftMirror;
}

function saveDraft(key: string, draft: Draft) {
  const map = loadDrafts();
  map.set(key, draft);
  flushDrafts(map);
}

function deleteDraft(key: string) {
  const map = loadDrafts();
  if (map.delete(key)) flushDrafts(map);
}

function flushDrafts(map: Map<string, Draft>) {
  try {
    localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(map)),
    );
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

function mergeAttachments(
  existing: FileAttachment[],
  incoming: FileAttachment[],
): { merged: FileAttachment[]; duplicateCount: number } {
  const keyOf = (f: FileAttachment) => `${f.path}::${f.size}::${f.name}`;
  const seen = new Set(existing.map(keyOf));
  const unique: FileAttachment[] = [];
  let duplicateCount = 0;

  for (const file of incoming) {
    const key = keyOf(file);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(file);
  }

  return {
    merged: [...existing, ...unique],
    duplicateCount,
  };
}

function attachmentSuggestions(files: FileAttachment[], t: TFunction): string[] {
  if (files.length === 0) return [];
  const names = files.map((f) => f.name.toLowerCase());
  const hasSheet = names.some((n) => n.endsWith(".xlsx") || n.endsWith(".csv"));
  const hasDoc = names.some((n) => n.endsWith(".docx") || n.endsWith(".pdf"));
  const hasSlides = names.some((n) => n.endsWith(".pptx"));

  const suggestions: string[] = [];
  if (hasSheet) suggestions.push(t('suggestSummarize'));
  if (hasDoc) suggestions.push(t('suggestExtract'));
  if (hasSlides) suggestions.push(t('suggestConvert'));
  if (files.length >= 3) suggestions.push(t('suggestCompare'));
  return suggestions.slice(0, 2);
}

function ExpertTeamSelector({
  sessionKey,
  selectedTeam,
  disabled,
  landing = false,
}: {
  sessionKey: string;
  selectedTeam: { id: string; name: string; description?: string } | null;
  disabled?: boolean;
  landing?: boolean;
}) {
  const { data } = useExpertTeams();
  const [open, setOpen] = useState(false);
  const setSelectedExpertTeam = useExpertSessionStore((s) => s.setSelectedExpertTeam);
  const clearSelectedExpertTeam = useExpertSessionStore((s) => s.clearSelectedExpertTeam);
  const teams = data?.teams ?? [];
  const selectedLabel = selectedTeam ? selectedTeam.name : "专家团";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex max-w-[220px] items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors disabled:opacity-50",
            selectedTeam && "border border-[var(--brand-primary)]/20 bg-[var(--brand-primary)]/10",
            landing
              ? "rounded-xl hover:bg-[var(--surface-secondary)]"
              : "rounded-full hover:bg-[var(--surface-tertiary)]/80",
          )}
          title={selectedTeam?.description || selectedLabel}
        >
          <Users className={cn("h-4 w-4 shrink-0", selectedTeam ? "text-[var(--brand-primary)]" : "text-[var(--text-tertiary)]")} />
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-1.5">
        <div className="max-h-[340px] overflow-y-auto pr-1 scrollbar-auto">
          {teams.map((team) => {
            const isActive = selectedTeam?.id === team.id;
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  setSelectedExpertTeam(sessionKey, {
                    id: team.id,
                    name: team.name,
                    description: team.description,
                  });
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isActive ? "bg-[var(--surface-secondary)]" : "hover:bg-[var(--surface-secondary)]",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20">
                  <Users className="h-4 w-4 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{team.name}</span>
                    <span className="shrink-0 text-ui-3xs text-[var(--text-tertiary)]">{team.member_count}人</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-tertiary)]">{team.description}</div>
                </div>
                {isActive && <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />}
              </button>
            );
          })}
        </div>
        {selectedTeam && (
          <button
            type="button"
            onClick={() => {
              clearSelectedExpertTeam(sessionKey);
              setOpen(false);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)]"
          >
            <X className="h-3.5 w-3.5" />
            清除专家团
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function formatEstimatedUsd(cost: number): string {
  if (cost <= 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function expertSessionKey(sessionId?: string): string {
  return sessionId || DRAFT_EXPERT_SESSION_ID;
}

/**
 * Find the active @mention trigger in the input text relative to the cursor position.
 * Returns { active: true, query, startIndex } if cursor is inside an @mention,
 * or { active: false } otherwise.
 */
function detectMention(
  text: string,
  cursorPos: number,
): { active: true; query: string; startIndex: number } | { active: false } {
  // Look backwards from cursor for '@'
  const before = text.slice(0, cursorPos);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return { active: false };

  // '@' must be at start of input or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1])) {
    return { active: false };
  }

  // Query is text between '@' and cursor — must not contain newlines or spaces
  const query = before.slice(atIndex + 1);
  if (/[\s]/.test(query)) return { active: false };

  return { active: true, query, startIndex: atIndex };
}

function ChatFormInner({
  isGenerating,
  isCompacting = false,
  onSend,
  onStop,
  className,
  sessionId,
  directory,
  variant = "default",
  placeholder,
  selectedSkill,
}: ChatFormProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const { ref, resize } = useAutoResize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: providerModels, activeProvider } = useProviderModels();
  const noModelsAvailable = !activeProvider || providerModels.length === 0;
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);
  const selectedExpertTeam = useExpertSessionStore((s) =>
    s.selectedBySession[expertSessionKey(sessionId)] ?? null,
  );
  const expertCreationMode = useExpertSessionStore((s) =>
    s.creationBySession[expertSessionKey(sessionId)] ?? null,
  );
  const clearExpertTeamCreationMode = useExpertSessionStore((s) => s.clearExpertTeamCreationMode);

  const sendingRef = useRef(false);

  // Track latest values for draft save-on-unmount (avoids stale closures)
  const inputRef = useRef(input);
  const attachmentsRef = useRef(attachments);
  inputRef.current = input;
  attachmentsRef.current = attachments;

  const draftKey = sessionId ?? "__new__";

  // Restore draft on mount (keyed by draftKey)
  useEffect(() => {
    const drafts = loadDrafts();
    const saved = drafts.get(draftKey);
    if (saved) {
      setInput(saved.input);
      setAttachments(saved.attachments);
      deleteDraft(draftKey);
    }
    // Save draft on unmount
    return () => {
      const currentInput = inputRef.current;
      const currentAttachments = attachmentsRef.current;
      if (currentInput.trim() || currentAttachments.length > 0) {
        saveDraft(draftKey, {
          input: currentInput,
          attachments: currentAttachments,
          savedAt: Date.now(),
        });
      }
    };
  }, [draftKey]);

  // @mention state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);

  const hasWorkspace = !!directory && directory !== ".";

  const globalWorkspace = useSettingsStore((s) => s.workspaceDirectory);
  const effectiveWorkspace = hasWorkspace ? directory : globalWorkspace;
  const { isIndexing } = useIndexStatus(effectiveWorkspace, sessionId);
  const formSession = useChatSession(sessionId ?? null);
  const compactingLabel = useMemo(() => {
    for (let i = formSession.streamingParts.length - 1; i >= 0; i -= 1) {
      const part = formSession.streamingParts[i];
      if (part.type !== "compaction" || part.compactionStatus !== "in_progress") continue;
      const activePhase = part.phases?.find((phase) => phase.status === "started");
      if (!activePhase) return null;
      if (activePhase.phase === "prune") return "prune";
      if (activePhase.phase === "summarize" && activePhase.chars && activePhase.chars > 0) {
        return `summarize:${activePhase.chars}`;
      }
      return "summarize";
    }
    return null;
  }, [formSession.streamingParts]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    try {
      const results = await Promise.all(
        Array.from(files).map((f) => uploadFile(f))
      );
      setAttachments((prev) => {
        const { merged, duplicateCount } = mergeAttachments(prev, results);
        if (duplicateCount > 0) {
          toast.info(t('duplicateFilesSkipped', { count: duplicateCount }));
        }
        return merged;
      });
      // Ingest into FTS index immediately for existing sessions
      if (sessionId && effectiveWorkspace && results.length > 0) {
        ingestFiles(sessionId, effectiveWorkspace, results.map((r) => r.path));
      }
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error(t('failedUpload'));
    } finally {
      setUploading(false);
    }
  }, [effectiveWorkspace, sessionId, t]);

  const handleSend = useCallback(async () => {
    if (sendingRef.current || (!input.trim() && attachments.length === 0) || isGenerating || isCompacting) return;
    sendingRef.current = true;
    try {
      const text = input;
      const files = attachments;
      setInput("");
      setAttachments([]);
      // Clear refs immediately so unmount cleanup won't save stale draft
      inputRef.current = "";
      attachmentsRef.current = [];
      setMentionActive(false);
      if (ref.current) {
        ref.current.style.height = "auto";
      }
      const skillNames = [
        selectedSkill?.trim(),
        expertCreationMode?.skill,
      ].filter((skill): skill is string => !!skill);
      const activeSkills = skillNames.length > 0 ? Array.from(new Set(skillNames)) : undefined;
      const result = await onSend(
        text,
        files.length > 0 ? files : undefined,
        activeSkills || expertCreationMode
          ? {
              skills: activeSkills,
              mode: expertCreationMode ? "expert_team_creation" : undefined,
            }
          : undefined,
      );
      // Restore input if send failed
      if (result === false) {
        setInput(text);
        setAttachments(files);
      } else {
        deleteDraft(draftKey);
      }
    } finally {
      sendingRef.current = false;
    }
  }, [input, attachments, isGenerating, isCompacting, onSend, ref, draftKey, selectedSkill, expertCreationMode]);

  const handleBrowse = useCallback(async () => {
    setUploading(true);
    try {
      const results = await browseFiles();
      if (results.length > 0) {
        setAttachments((prev) => {
          const { merged, duplicateCount } = mergeAttachments(prev, results);
          if (duplicateCount > 0) {
            toast.info(t('duplicateFilesSkipped', { count: duplicateCount }));
          }
          return merged;
        });
        // Ingest into FTS index immediately for existing sessions
        if (sessionId && effectiveWorkspace) {
          ingestFiles(sessionId, effectiveWorkspace, results.map((r) => r.path));
        }
      }
    } catch (err) {
      console.error("Browse failed, falling back to browser picker:", err);
      fileInputRef.current?.click();
    } finally {
      setUploading(false);
    }
  }, [effectiveWorkspace, sessionId, t]);

  const handleRemoveAttachment = useCallback((fileId: string) => {
    setAttachments((prev) => prev.filter((a) => a.file_id !== fileId));
  }, []);

  // Handle @mention file selection
  const handleMentionSelect = useCallback(async (result: FileSearchResult) => {
    // Replace @query with @filename in the input
    const before = input.slice(0, mentionStartIndex);
    const after = input.slice(mentionStartIndex + 1 + mentionQuery.length);
    const newInput = `${before}@${result.name} ${after}`;
    setInput(newInput);
    setMentionActive(false);

    // Attach the file
    try {
      const attached = await attachByPath([result.absolute_path]);
      if (attached.length > 0) {
        setAttachments((prev) => {
          const { merged, duplicateCount } = mergeAttachments(prev, attached);
          if (duplicateCount > 0) {
            toast.info(t('duplicateFilesSkipped', { count: duplicateCount }));
          }
          return merged;
        });
        // Ingest into FTS index immediately for existing sessions
        if (sessionId && effectiveWorkspace) {
          ingestFiles(sessionId, effectiveWorkspace, attached.map((a) => a.path));
        }
      }
    } catch (err) {
      console.error("Failed to attach file:", err);
    }

    // Refocus and resize
    requestAnimationFrame(() => {
      ref.current?.focus();
      resize();
    });
  }, [input, mentionStartIndex, mentionQuery, t, ref, resize, sessionId, effectiveWorkspace]);

  const handleMentionClose = useCallback(() => {
    setMentionActive(false);
  }, []);

  // Handle input changes — detect @mention trigger
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart ?? value.length;
      setInput(value);
      resize();

      if (!hasWorkspace) {
        if (mentionActive) setMentionActive(false);
        return;
      }

      const mention = detectMention(value, cursorPos);
      if (mention.active) {
        setMentionActive(true);
        setMentionQuery(mention.query);
        setMentionStartIndex(mention.startIndex);
      } else {
        if (mentionActive) setMentionActive(false);
      }
    },
    [hasWorkspace, mentionActive, resize],
  );

  // Also check mention state on cursor movement (click, arrow keys)
  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      if (!hasWorkspace) return;
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart ?? 0;
      const mention = detectMention(textarea.value, cursorPos);
      if (mention.active) {
        setMentionActive(true);
        setMentionQuery(mention.query);
        setMentionStartIndex(mention.startIndex);
      } else {
        if (mentionActive) setMentionActive(false);
      }
    },
    [hasWorkspace, mentionActive],
  );

  // Watch for "Try fixing" requests from artifact renderers
  const fixRequest = useArtifactStore((s) => s.fixRequest);
  const clearFixRequest = useArtifactStore((s) => s.clearFixRequest);

  useEffect(() => {
    if (!fixRequest) return;
    setInput(fixRequest);
    clearFixRequest();
    // Focus the textarea
    requestAnimationFrame(() => {
      ref.current?.focus();
      resize();
    });
  }, [fixRequest, clearFixRequest, ref, resize]);

  const suggestions = attachmentSuggestions(attachments, t);
  const selectedModelInfo = useMemo(
    () =>
      providerModels.find(
        (model) =>
          model.id === selectedModel &&
          (!selectedProviderId || model.provider_id === selectedProviderId),
      ) ?? providerModels.find((model) => model.id === selectedModel),
    [providerModels, selectedModel, selectedProviderId],
  );
  const modelCostHint = useMemo(() => {
    if (!selectedModelInfo) return null;
    if (selectedModelInfo.provider_id === "ollama") return "Local";

    const inputPrice = selectedModelInfo.pricing.prompt || 0;
    const outputPrice = selectedModelInfo.pricing.completion || 0;
    if (inputPrice <= 0 && outputPrice <= 0) return "Free";

    const inputTokens = estimateTextTokens(input);
    const inputCost = inputTokens * inputPrice / 1_000_000;
    const inRate = formatCreditsPerM(usdToCreditsPerM(inputPrice));
    const outRate = formatCreditsPerM(usdToCreditsPerM(outputPrice));

    if (inputTokens > 0) {
      return `Est. input ${formatEstimatedUsd(inputCost)} · out ${outRate}`;
    }
    return `In ${inRate} · out ${outRate}`;
  }, [input, selectedModelInfo]);
  const compactingStatusText = useMemo(() => {
    if (!isCompacting) return null;
    if (!compactingLabel) return t("contextCompactingNow");
    if (compactingLabel === "prune") return t("contextCompactingPrune");
    if (compactingLabel === "summarize") return t("contextCompactingSummarize");
    if (compactingLabel.startsWith("summarize:")) {
      const chars = Number(compactingLabel.split(":")[1] || 0);
      return t("contextCompactingSummarizeProgress", { chars });
    }
    return t("contextCompactingNow");
  }, [compactingLabel, isCompacting, t]);

  const isInputDisabled = isGenerating || isCompacting || noModelsAvailable;
  const isLanding = variant === "landing";
  const canSend =
    (input.trim().length > 0 || attachments.length > 0) &&
    !isIndexing &&
    !isCompacting &&
    !noModelsAvailable;
  const isBusy = isGenerating || isCompacting;
  const resolvedPlaceholder = noModelsAvailable
    ? t("noModelPlaceholder")
    : expertCreationMode
      ? "描述要创建的专家团场景、成员职责、任务流程和最终交付物"
    : placeholder ?? (hasWorkspace ? "Ask Codata to query, chart, explain, or create an artifact..." : "Ask Codata to query, chart, explain, or create an artifact...");
  const accessibilityLabel = isLanding
    ? hasWorkspace ? t("placeholder") + t("placeholderMention") : t("placeholder")
    : undefined;

  return (
    <div className={cn(isLanding ? "px-0 pb-0" : "px-5 pb-5", className)}>
      <div className={cn("mx-auto", isLanding ? "max-w-none" : "max-w-5xl")}>
        <div
          className={cn(
            "relative border transition-all duration-200",
            isLanding
              ? "rounded-[28px] border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[0_18px_50px_-38px_rgba(26,28,31,0.45)] focus-within:border-[var(--border-heavy)] focus-within:shadow-[0_24px_70px_-44px_rgba(26,28,31,0.55)]"
              : "data-agent-panel rounded-lg border-[var(--border-default)] focus-within:border-[var(--border-heavy)] focus-within:shadow-[var(--shadow-md)]",
            isDragOver && "ring-1 ring-[var(--border-heavy)]",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer.files.length > 0) {
              handleFiles(e.dataTransfer.files);
            }
          }}
        >
          {/* @mention popup — positioned above the form */}
          {hasWorkspace && (
            <FileMentionPopup
              query={mentionQuery}
              directory={directory!}
              onSelect={handleMentionSelect}
              onClose={handleMentionClose}
              visible={mentionActive}
            />
          )}

          {/* Inner panel — lighter pill holding textarea + action bar.
              Fully rounded so the bottom corners curve inward, letting the
              darker outer frame the pill on all sides. */}
          <div className={cn(isLanding ? "rounded-[28px] bg-transparent" : "rounded-lg bg-[var(--surface-primary)]")}>
          {/* Top section: file chips + textarea */}
          <div className={cn(isLanding ? "px-5 pt-6 pb-3 sm:px-7" : "px-4 pt-3 pb-2")}>
            {/* Skill and file chips */}
            {(selectedSkill || expertCreationMode || attachments.length > 0 || uploading) && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                {selectedSkill && (
                  <div
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
                    title={selectedSkill}
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--brand-primary)]" />
                    <span className="shrink-0">{t("selectedSkillChip")}</span>
                    <span className="min-w-0 max-w-[220px] truncate text-[var(--text-primary)]">
                      {selectedSkill}
                    </span>
                  </div>
                )}
                {expertCreationMode && (
                  <div
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand-primary)]/25 bg-[var(--brand-primary)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--brand-primary)]"
                    title={expertCreationMode.description || expertCreationMode.title}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span className="shrink-0">{expertCreationMode.title}</span>
                    <span className="min-w-0 max-w-[260px] truncate text-[var(--text-primary)]">
                      {CREATE_EXPERT_TEAMS_SKILL}
                    </span>
                  </div>
                )}
                {attachments.map((att) => (
                  <FileChip
                    key={att.file_id}
                    file={att}
                    onRemove={() => handleRemoveAttachment(att.file_id)}
                  />
                ))}
                {uploading && (
                  <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                    <span className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
                    {t('uploading')}
                  </div>
                )}
              </div>
            )}

            <ChatTextarea
              ref={ref}
              value={input}
              onChange={handleInputChange}
              onSelect={handleSelect}
              onSubmit={handleSend}
              mentionActive={mentionActive}
              placeholder={resolvedPlaceholder}
              aria-label={accessibilityLabel}
              className={cn(
                "max-h-[200px]",
                isLanding
                  ? "min-h-[52px] py-0 text-ui-md placeholder:text-[var(--text-tertiary)]"
                  : "min-h-[44px] py-2 text-ui-body placeholder:text-[var(--text-tertiary)]",
              )}
              disabled={isInputDisabled}
            />

            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput((prev) => (prev ? `${prev}\n${s}` : s));
                      requestAnimationFrame(() => ref.current?.focus());
                    }}
                    className="rounded-full border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-heavy)] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

          </div>

          {/* Bottom action bar */}
          <div
            className={cn(
              "flex items-center gap-2 border-t border-[var(--border-subtle)]",
              isLanding
                ? "min-h-16 flex-wrap px-4 pb-4 sm:flex-nowrap sm:px-6"
                : "px-3 py-2",
            )}
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />

            <button
                type="button"
                disabled={isInputDisabled}
                className={cn(
                  "shrink-0 flex items-center justify-center h-8 w-8 transition-colors text-[var(--text-secondary)]",
                  isLanding
                    ? "rounded-xl hover:bg-[var(--surface-secondary)]"
                    : "rounded-full hover:bg-[var(--surface-tertiary)]",
                )}
                aria-label={t('attachFile')}
                onClick={handleBrowse}
              >
                <Plus className="h-4 w-4" />
              </button>

            {isLanding && (
              <div className={cn("min-w-0 shrink-0", isInputDisabled && "pointer-events-none opacity-50")}>
                <HeaderModelDropdown />
              </div>
            )}

            <div className={cn(isInputDisabled && "pointer-events-none opacity-50")}>
              <AgentToggle landing={isLanding} />
            </div>

            <div className={cn(isInputDisabled && "pointer-events-none opacity-50")}>
              <ExpertTeamSelector
                sessionKey={expertSessionKey(sessionId)}
                selectedTeam={selectedExpertTeam}
                disabled={isInputDisabled}
                landing={isLanding}
              />
            </div>

            {isLanding && (
              <div className={cn("min-w-0", isInputDisabled && "pointer-events-none opacity-50")}>
                <WorkspaceToggle sessionId={sessionId} directory={directory} isIndexing={isIndexing} />
              </div>
            )}

            <div className="min-w-2 flex-1" />

            {compactingStatusText && (
              <div className="mr-1 max-w-[220px] truncate text-[12px] font-medium text-[var(--text-secondary)]">
                {compactingStatusText}
              </div>
            )}

            {modelCostHint && !compactingStatusText && (
              <div
                className="mr-1 max-w-[260px] truncate text-[11px] font-medium text-[var(--text-tertiary)]"
                title={modelCostHint}
              >
                {modelCostHint}
              </div>
            )}

            {isLanding ? (
              <button
                type="button"
                onClick={isBusy ? onStop : handleSend}
                disabled={!isBusy && !canSend}
                className="ml-auto inline-flex h-10 min-w-[96px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--text-primary)] px-4 text-ui-sm font-semibold text-[var(--surface-primary)] transition-all hover:opacity-90 active:scale-[0.98] disabled:bg-[var(--surface-tertiary)] disabled:text-[var(--text-tertiary)] disabled:opacity-100"
                aria-label={isBusy ? t("stopAction") : t("sendAction")}
              >
                {isBusy ? (
                  <>
                    <Square className="h-3.5 w-3.5 fill-current" />
                    {t("stopAction")}
                  </>
                ) : (
                  <>
                    {t("landingStart")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            ) : (
              <ChatActions
                isBusy={isBusy}
                canSend={canSend}
                onSend={handleSend}
                onStop={onStop}
              />
            )}
          </div>
          </div>

          {/* Context row — outer layer, lighter bg, visually wraps the inner panel */}
          {!isLanding && (
            <div className={cn(
            "flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)]/70 px-3 py-2",
            isInputDisabled && "pointer-events-none opacity-50",
          )}>
            <WorkspaceToggle sessionId={sessionId} directory={directory} isIndexing={isIndexing} />
            {expertCreationMode && (
              <div
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand-primary)]/25 bg-[var(--brand-primary)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--brand-primary)]"
                title={expertCreationMode.description || expertCreationMode.title}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span className="shrink-0">当前模式</span>
                <span className="min-w-0 max-w-[260px] truncate text-[var(--text-primary)]">
                  {expertCreationMode.title}
                </span>
                <button
                  type="button"
                  className="ml-0.5 rounded-full p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                  onClick={() => clearExpertTeamCreationMode(expertSessionKey(sessionId))}
                  aria-label="退出专家团创建模式"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          )}
        </div>
        {isLanding && expertCreationMode && (
          <div className="mt-2 flex justify-start px-2">
            <div
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand-primary)]/25 bg-[var(--surface-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--brand-primary)] shadow-[var(--shadow-sm)]"
              title={expertCreationMode.description || expertCreationMode.title}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">当前模式</span>
              <span className="min-w-0 max-w-[260px] truncate text-[var(--text-primary)]">
                {expertCreationMode.title}
              </span>
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => clearExpertTeamCreationMode(expertSessionKey(sessionId))}
                aria-label="退出专家团创建模式"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Dropdown mode selector: Plan / Ask / Auto — inspired by Claude Code VS Code extension. */
function AgentToggle({ landing = false }: { landing?: boolean }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const workMode = useSettingsStore((s) => s.workMode);
  const setWorkMode = useSettingsStore((s) => s.setWorkMode);

  useEffect(() => {
    setMounted(true);
  }, []);

  const modes = [
    { key: "plan" as const, label: t("modePlan"), desc: t("modeDesc_plan") },
    { key: "ask" as const, label: t("modeAsk"), desc: t("modeDesc_ask") },
    { key: "auto" as const, label: t("modeAuto"), desc: t("modeDesc_auto") },
  ];

  const active = modes.find((m) => m.key === workMode) ?? modes[2];

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[var(--text-primary)] opacity-70",
          landing ? "rounded-xl bg-transparent" : "rounded-full bg-[var(--surface-tertiary)]",
        )}
      >
        {landing && <AtSign className="h-4 w-4 text-[var(--text-tertiary)]" />}
        <span>{active.label}</span>
        <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-colors text-[var(--text-primary)]",
            landing
              ? "rounded-xl bg-transparent hover:bg-[var(--surface-secondary)]"
              : "rounded-full bg-[var(--surface-tertiary)] hover:bg-[var(--surface-tertiary)]/80",
          )}
        >
          {landing && <AtSign className="h-4 w-4 text-[var(--text-tertiary)]" />}
          <span>{active.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-1.5">
        {modes.map((m) => {
          const isActive = workMode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => { setWorkMode(m.key); setOpen(false); }}
              className={cn(
                "w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                isActive ? "bg-[var(--surface-secondary)]" : "hover:bg-[var(--surface-secondary)]",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-primary)]">{m.label}</div>
                <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5 leading-snug">{m.desc}</div>
              </div>
              {isActive && <Check className="h-4 w-4 shrink-0 mt-0.5 text-[var(--text-primary)]" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export const ChatForm = memo(ChatFormInner);
