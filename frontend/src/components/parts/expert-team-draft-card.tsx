"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, Loader2, Users, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import {
  EXPERT_TEAM_CREATION_ACCESS_MESSAGE,
  EXPERT_TEAM_ACCOUNT_ROUTE,
  canCreateExpertTeamWithProvider,
  expertTeamAccessRedirectFromError,
} from "@/lib/expert-team-access";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { ExpertTeamConfig } from "@/types/expert-teams";
import type { ExpertTeamDetailResponse } from "@/types/expert-teams";
import type { ToolPart } from "@/types/message";

interface ExpertTeamDraftPayload {
  saved?: boolean;
  team_id?: string;
  team?: ExpertTeamConfig;
  validation_errors?: string[];
  explanation?: string;
  role_choices?: Array<{ member_id?: string; role_ref?: string; reason?: string }>;
  warnings?: string[];
  cost_level?: string | null;
}

interface ExpertTeamDraftCardProps {
  data: ToolPart;
}

function parseDraft(output: string | null): ExpertTeamDraftPayload | null {
  if (!output) return null;
  try {
    const payload = JSON.parse(output) as ExpertTeamDraftPayload;
    if (!payload || typeof payload !== "object" || !payload.team) return null;
    return payload;
  } catch {
    return null;
  }
}

function costLevelText(level?: string | null): string {
  if (level === "low") return "低消耗";
  if (level === "high") return "高消耗";
  return "中等消耗";
}

export function isExpertTeamDraftTool(part: ToolPart): boolean {
  return part.tool === "create_expert_teams" && !!parseDraft(part.state.output);
}

export function ExpertTeamDraftCard({ data }: ExpertTeamDraftCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const draft = useMemo(() => parseDraft(data.state.output), [data.state.output]);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);

  if (!draft?.team) return null;
  const team = draft.team;
  const alreadySaved = saved || !!draft.saved;
  const hasValidationErrors = (draft.validation_errors?.length ?? 0) > 0;
  const creationProviderId = selectedProviderId;
  const creationModel = selectedModel;
  const canSave = canCreateExpertTeamWithProvider(activeProvider, creationProviderId);

  const save = async () => {
    if (alreadySaved || saving || hasValidationErrors) return;
    if (!canSave) {
      toast.warning(EXPERT_TEAM_CREATION_ACCESS_MESSAGE, { duration: 6000 });
      router.push(EXPERT_TEAM_ACCOUNT_ROUTE);
      return;
    }
    setSaving(true);
    try {
      await api.post<ExpertTeamDetailResponse>(API.EXPERT_TEAMS.CREATE, {
        team,
        model: creationModel,
        provider_id: creationProviderId,
      });
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.expertTeams.all });
      toast.success("专家团已保存");
    } catch (err) {
      const redirect = expertTeamAccessRedirectFromError(err);
      if (redirect) {
        toast.warning(EXPERT_TEAM_CREATION_ACCESS_MESSAGE, { duration: 6000 });
        router.push(redirect);
        return;
      }
      toast.error(apiErrorMessage(err, "保存专家团失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
      {/* Header Section - Enhanced hierarchy */}
      <div className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary)]/10">
          <Users className="h-5.5 w-5.5 text-[var(--brand-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5 mb-2">
            <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{team.name}</h3>
            <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-1 text-ui-2xs font-medium text-[var(--text-secondary)]">
              {costLevelText(draft.cost_level)}
            </span>
            {alreadySaved && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-success)]/10 px-2 py-1 text-ui-2xs font-medium text-[var(--color-success)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已保存
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{team.description}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[team.category, ...team.tags].filter(Boolean).slice(0, 6).map((tag) => (
              <span key={tag} className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1 text-ui-2xs text-[var(--text-secondary)]">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {hasValidationErrors && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--color-warning)]/5 px-5 py-3">
          <div className="mb-2 text-sm font-medium text-[var(--color-warning)]">验证错误</div>
          <div className="space-y-1.5">
            {draft.validation_errors?.map((error, index) => (
              <div key={`${error}-${index}`} className="text-ui-2xs leading-relaxed text-[var(--text-secondary)]">
                {error}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Section - Better layout */}
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
        {/* Members Section */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--brand-primary)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">专家成员</span>
          </div>
          <div className="space-y-2.5">
            {team.members.slice(0, 5).map((member) => (
              <div key={member.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 py-3">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-primary)]/10">
                    <Bot className="h-4 w-4 text-[var(--brand-primary)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{member.name}</div>
                    <div className="truncate text-ui-2xs text-[var(--text-tertiary)]">{member.role_ref || member.role}</div>
                  </div>
                </div>
                <p className="line-clamp-2 text-sm leading-relaxed text-[var(--text-secondary)]">{member.goal}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tasks Section */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Workflow className="h-4 w-4 text-[var(--brand-primary)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">任务流程</span>
          </div>
          <div className="space-y-2.5">
            {team.tasks.slice(0, 6).map((task, index) => {
              const member = team.members.find((item) => item.id === task.member);
              return (
                <div key={task.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 py-3">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-ui-2xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{task.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-ui-2xs text-[var(--text-tertiary)]">
                    <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-0.5">
                      {member?.name ?? task.member}
                    </span>
                    {(task.depends_on?.length || task.context.length) ? (
                      <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-0.5">
                        依赖 {(task.depends_on ?? task.context).join(", ")}
                      </span>
                    ) : null}
                    {task.output ? (
                      <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-0.5">
                        输出 {task.output}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Explanation Section */}
      {(draft.explanation || draft.warnings?.length || draft.role_choices?.length) && (
        <div className="border-t border-[var(--border-subtle)] px-5 py-4">
          {draft.explanation && (
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{draft.explanation}</p>
          )}
          {draft.role_choices && draft.role_choices.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.role_choices.slice(0, 6).map((choice, index) => (
                <span
                  key={`${choice.member_id}-${index}`}
                  className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1 text-ui-2xs text-[var(--text-tertiary)]"
                  title={choice.reason}
                >
                  {choice.member_id}: {choice.role_ref}
                </span>
              ))}
            </div>
          )}
          {draft.warnings && draft.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {draft.warnings.map((warning, index) => (
                <div key={`${warning}-${index}`} className="text-ui-2xs leading-relaxed text-[var(--color-warning)]">
                  {warning}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer Section */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-4">
        <div className="text-sm text-[var(--text-tertiary)]">
          {team.members.length} 位专家 · {team.tasks.length} 个任务 · ID: {draft.team_id || team.id}
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={alreadySaved || saving || hasValidationErrors}
          className={cn("gap-2 font-medium", alreadySaved && "pointer-events-none opacity-80")}
          title={canSave ? undefined : "保存专家团需要先在设置中选择模型提供商"}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {alreadySaved ? "已保存" : hasValidationErrors ? "存在验证错误" : "保存专家团"}
        </Button>
      </div>
    </div>
  );
}
