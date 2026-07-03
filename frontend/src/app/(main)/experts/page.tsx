"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Database,
  FileText,
  Globe2,
  Info,
  Layers,
  Loader2,
  Package,
  Pencil,
  PenTool,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  Zap,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCreateExpertTeam,
  useDeleteExpertTeam,
  useExpertRoles,
  useExpertTeamDetail,
  useExpertTeams,
  useUpdateExpertTeam,
} from "@/hooks/use-expert-teams";
import { useCreateSession } from "@/hooks/use-sessions";
import { queryKeys } from "@/lib/constants";
import {
  EXPERT_TEAM_CREATION_ACCESS_MESSAGE,
  EXPERT_TEAM_ACCOUNT_ROUTE,
  canCreateExpertTeamWithProvider,
  expertTeamAccessRedirectFromError,
} from "@/lib/expert-team-access";
import { getChatRoute } from "@/lib/routes";
import { useExpertSessionStore } from "@/stores/expert-session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import type {
  ExpertDeliverableConfig,
  ExpertDeliverablePresentation,
  ExpertDeliverableType,
  ExpertFinalizationConfig,
  ExpertManagerConfig,
  ExpertMemberConfig,
  ExpertMemberSummary,
  ExpertRole,
  ExpertTaskConfig,
  ExpertTeamConfig,
  ExpertTeamSummary,
} from "@/types/expert-teams";
import type { SessionResponse } from "@/types/session";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORIES = ["全部", "内容创作", "技术工程", "办公文档", "研究咨询", "设计创意"];

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  code: Code2,
  "bar-chart-2": Database,
  "pen-tool": PenTool,
  users: Users,
  "file-text": FileText,
};

const DEFAULT_COORDINATOR_PROMPT =
  "你是专家团协调者。请综合每位专家的输出，形成面向用户的最终答复，保留关键细节、解决冲突，并给出清晰的下一步建议。";
const DEFAULT_MANAGER_PROMPT =
  "你是这个专家团的总控专家。请先判断任务如何拆解，再把具体工作委派给合适成员；必要时向成员追问补充信息，最后综合所有成员产出，形成面向用户的最终答复。";
const VIDEO_EXPERT_TEAM_ID = "video-production";
const VIDEO_EXPERT_TEAM_ENABLED = false;

const EMPTY_TEAMS: ExpertTeamSummary[] = [];
const EMPTY_ROLES: ExpertRole[] = [];
const DELIVERABLE_TYPES: Array<{ value: ExpertDeliverableType; label: string }> = [
  { value: "markdown", label: "Markdown 文档" },
  { value: "html", label: "HTML 网页" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word 文档" },
  { value: "xlsx", label: "Excel 表格" },
  { value: "pptx", label: "PPT 演示" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "code", label: "代码产物" },
  { value: "artifact", label: "Artifact 面板" },
];

const DELIVERABLE_PRESENTATIONS: Array<{ value: ExpertDeliverablePresentation; label: string }> = [
  { value: "both", label: "文件 + 面板" },
  { value: "file_preview", label: "文件预览" },
  { value: "artifact_panel", label: "产物面板" },
];

type EditorStep = "basics" | "members" | "workflow" | "delivery";

const EDITOR_STEPS: Array<{ id: EditorStep; title: string; description: string; Icon: ComponentType<{ className?: string }> }> = [
  { id: "basics", title: "基础", description: "用途和执行方式", Icon: Info },
  { id: "members", title: "专家", description: "谁来完成工作", Icon: Users },
  { id: "workflow", title: "流程", description: "任务如何交接", Icon: Workflow },
  { id: "delivery", title: "交付", description: "最终产物规则", Icon: Package },
];

function teamIcon(name: string) {
  return ICONS[name] ?? Users;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function variableId(value: string) {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!id) return "";
  return /^[0-9]/.test(id) ? `result_${id}` : id;
}

function splitList(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function joinList(value: string[]): string {
  return value.join(", ");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function teamOriginLabel(team: Pick<ExpertTeamSummary, "is_preset" | "editable" | "origin">) {
  if (team.origin === "remote") return "远程订阅";
  if (team.origin === "project") return "项目";
  if (team.is_preset) return "预设";
  return "自定义";
}

function teamProcessLabel(process: ExpertTeamSummary["process"]) {
  if (process === "hierarchical") return "统筹调度";
  if (process === "workflow") return "工作流";
  if (process === "sequential") return "顺序";
  return "普通";
}

function teamProcessDescription(process: ExpertTeamSummary["process"]) {
  if (process === "hierarchical") return "总控专家先拆解任务，再动态委派给合适成员";
  if (process === "workflow") return "按依赖图执行，支持并发步骤";
  if (process === "sequential") return "按任务顺序逐步执行";
  return "按普通专家团流程执行";
}

function isVideoExpertTeam(team: Pick<ExpertTeamSummary, "id">) {
  return team.id === VIDEO_EXPERT_TEAM_ID;
}

function isExpertTeamComingSoon(team: Pick<ExpertTeamSummary, "id">) {
  return isVideoExpertTeam(team) && !VIDEO_EXPERT_TEAM_ENABLED;
}

function processHelpText(process: ExpertTeamConfig["process"]) {
  if (process === "hierarchical") return "适合复杂、不确定、步骤需要边做边调整的任务。总控专家会先判断怎么拆解，再把工作派给合适成员并汇总结果。";
  if (process === "workflow") return "适合固定步骤，有依赖关系，部分任务可以并行。";
  return "适合线性任务，按步骤逐个执行。";
}

function stripTemplateSyntax(value: string): string {
  return value
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\{input\}/g, "")
    .replace(/\s+/g, " ")
    .replace(/[：:]\s*([。；;,.，、]|$)/g, "$1")
    .trim();
}

function compactSentence(value: string, fallback: string, limit = 72): string {
  const cleaned = stripTemplateSyntax(value);
  if (!cleaned) return fallback;
  const firstSentence = cleaned.split(/[。！？!?\n]/).map((item) => item.trim()).find(Boolean) ?? cleaned;
  if (firstSentence.length <= limit) return firstSentence;
  return `${firstSentence.slice(0, limit - 1).trimEnd()}…`;
}

function taskDisplaySummary(task: ExpertTaskConfig, member?: ExpertMemberConfig): string {
  return compactSentence(
    task.expected_output || task.description || task.task || "",
    `${member?.name ?? "专家"}负责完成「${task.name}」这一步。`,
  );
}

function memberDisplaySummary(member: ExpertMemberConfig | ExpertMemberSummary): string {
  const goal = typeof (member as { goal?: unknown }).goal === "string" ? String((member as { goal?: unknown }).goal) : "";
  const backstory = typeof (member as { backstory?: unknown }).backstory === "string" ? String((member as { backstory?: unknown }).backstory) : "";
  return compactSentence(goal || backstory, `负责${member.role || "对应专业任务"}。`);
}

function deliverableTypeLabel(type: ExpertDeliverableType) {
  return DELIVERABLE_TYPES.find((item) => item.value === type)?.label ?? type;
}

function cloneTeamForCustom(team: ExpertTeamConfig): ExpertTeamConfig {
  return {
    ...team,
    id: `${team.id}-copy`,
    name: `${team.name} 副本`,
    metadata: {},
  };
}

function defaultDeliverableTools(type: ExpertDeliverableType, presentation: ExpertDeliverablePresentation = "both"): string[] {
  const tools: string[] = [];
  if (type === "video") {
    tools.push("present_file");
  }
  if (type === "artifact" || presentation === "artifact_panel" || presentation === "both") {
    tools.push("artifact");
  }
  if (["markdown", "html", "pdf", "docx", "xlsx", "pptx", "code"].includes(type) || presentation === "file_preview" || presentation === "both") {
    tools.push("write", "present_file");
  }
  if (["pdf", "docx", "xlsx", "pptx"].includes(type)) {
    tools.push("code_execute");
  }
  return Array.from(new Set(tools.length > 0 ? tools : ["write", "present_file"]));
}

function defaultDeliverableFilename(type: ExpertDeliverableType): string | null {
  const extensions: Partial<Record<ExpertDeliverableType, string>> = {
    markdown: "final-deliverable.md",
    html: "final-deliverable.html",
    pdf: "final-deliverable.pdf",
    docx: "final-deliverable.docx",
    xlsx: "final-deliverable.xlsx",
    pptx: "final-deliverable.pptx",
    code: "final-deliverable.md",
  };
  return extensions[type] ?? null;
}

function createDefaultDeliverable(type: ExpertDeliverableType = "markdown"): ExpertDeliverableConfig {
  const presentation: ExpertDeliverablePresentation = type === "artifact" ? "artifact_panel" : type === "html" || type === "code" ? "both" : "file_preview";
  return {
    required: true,
    type,
    title: type === "video" ? "最终视频" : type === "html" ? "最终网页" : "最终产物",
    filename_template: defaultDeliverableFilename(type),
    source: "last_task",
    presentation,
    tools: defaultDeliverableTools(type, presentation),
  };
}

function normalizeDeliverable(deliverable?: ExpertDeliverableConfig | null): ExpertDeliverableConfig {
  if (!deliverable) return createDefaultDeliverable();
  const type = deliverable.type ?? "markdown";
  const presentation = deliverable.presentation ?? (type === "artifact" ? "artifact_panel" : "file_preview");
  return {
    required: deliverable.required ?? true,
    type,
    title: deliverable.title?.trim() || "最终产物",
    filename_template: deliverable.filename_template?.trim() || null,
    source: deliverable.source?.trim() || "last_task",
    presentation,
    tools: deliverable.tools?.length ? deliverable.tools : defaultDeliverableTools(type, presentation),
  };
}

function createDefaultFinalization(mode: ExpertFinalizationConfig["mode"] = "deliverable"): ExpertFinalizationConfig {
  return {
    mode,
    member: null,
    tools: [],
    deliverable: createDefaultDeliverable(),
  };
}

function createDefaultManager(member?: string | null): ExpertManagerConfig {
  return {
    member: member || null,
    prompt: DEFAULT_MANAGER_PROMPT,
    submode: "coordinated",
  };
}

function createBlankTeam(): ExpertTeamConfig {
  return {
    id: "",
    name: "",
    description: "",
    icon: "users",
    version: "1.0",
    process: "workflow",
    concurrency: 2,
    inputs: [],
    tags: [],
    category: "技术工程",
    members: [
      {
        id: "planner",
        name: "规划专家",
        role: "任务规划专家",
        goal: "拆解目标、明确步骤、识别约束。",
        backstory: "",
        tools: ["read", "grep", "skill"],
        skills: [],
        connectors: [],
        icon: "bot",
      },
      {
        id: "executor",
        name: "执行专家",
        role: "执行落地专家",
        goal: "基于规划完成核心分析或实施建议。",
        backstory: "",
        tools: ["read", "grep", "write", "edit", "bash", "skill"],
        skills: [],
        connectors: [],
        icon: "bot",
      },
    ],
    tasks: [
      {
        id: "plan",
        name: "任务拆解",
        description: "分析用户任务：{input}\n输出目标、约束、执行步骤和需要注意的风险。",
        task: "分析用户任务：{{user_input}}\n输出目标、约束、执行步骤和需要注意的风险。",
        expected_output: "清晰的任务拆解。",
        member: "planner",
        context: [],
        depends_on: [],
        depends_on_mode: "all",
        context_policy: "auto",
        context_max_chars: 12000,
        output: "plan_result",
        timeout_seconds: 300,
        retry_count: 1,
      },
      {
        id: "execute",
        name: "执行建议",
        description: "基于任务拆解，给出可执行的处理结果或实施建议。",
        task: "基于任务拆解，给出可执行的处理结果或实施建议。\n\n任务拆解：\n{{plan_result}}",
        expected_output: "可直接交付给用户的结果。",
        member: "executor",
        context: ["plan"],
        depends_on: ["plan"],
        depends_on_mode: "all",
        context_policy: "auto",
        context_max_chars: 12000,
        output: "execution_result",
        timeout_seconds: 300,
        retry_count: 1,
      },
    ],
    skills: [],
    connectors: [],
    metadata: {},
    default_max_tool_rounds: 6,
    expert_output_style: "concise",
    expert_visible_max_chars: 1800,
    coordinator_visible_max_chars: 2400,
    finalization: createDefaultFinalization("deliverable"),
    manager: null,
    max_delegations: 12,
    coordinator_context_policy: "summary",
    coordinator_context_max_chars: 24000,
    coordinator_prompt: DEFAULT_COORDINATOR_PROMPT,
  };
}

function normalizeTeamForSave(team: ExpertTeamConfig): ExpertTeamConfig {
  const process = team.process ?? "workflow";
  const tasks = team.tasks.map((task) => {
    const taskText = task.task || task.description;
    const dependsOn = task.depends_on ?? task.context ?? [];
    return {
      ...task,
      description: taskText,
      task: taskText,
      context: dependsOn,
      depends_on: dependsOn,
      depends_on_mode: task.depends_on_mode ?? "all",
      output: task.output || null,
      context_policy: task.context_policy ?? "auto",
      context_max_chars: task.context_max_chars ?? 12000,
      condition: task.condition || null,
      timeout_seconds: task.timeout_seconds ?? 300,
      retry_count: task.retry_count ?? 1,
      loop: task.loop ?? null,
    };
  });
  const finalization = team.finalization ?? createDefaultFinalization("deliverable");
  const manager = process === "hierarchical"
    ? {
        ...(team.manager ?? createDefaultManager()),
        member: team.manager?.member || null,
        prompt: team.manager?.prompt?.trim() || DEFAULT_MANAGER_PROMPT,
        submode: team.manager?.submode ?? "coordinated",
      }
    : null;
  return {
    ...team,
    process,
    concurrency: team.concurrency ?? 1,
    inputs: team.inputs ?? [],
    default_max_tool_rounds: team.default_max_tool_rounds ?? 6,
    expert_output_style: team.expert_output_style === "full" ? "full" : "concise",
    expert_visible_max_chars: clampNumber(team.expert_visible_max_chars, 1800, 500, 20000),
    coordinator_visible_max_chars: clampNumber(team.coordinator_visible_max_chars, 2400, 500, 30000),
    finalization: {
      ...finalization,
      member: finalization.member || null,
      tools: finalization.tools ?? [],
      deliverable: normalizeDeliverable(finalization.deliverable),
    },
    manager,
    max_delegations: Math.max(1, Math.min(50, team.max_delegations ?? 12)),
    coordinator_context_policy: team.coordinator_context_policy ?? "summary",
    coordinator_context_max_chars: team.coordinator_context_max_chars ?? 24000,
    members: team.members.map((member) => ({
      ...member,
      role_ref: member.role_ref || null,
      role_source: member.role_source || null,
      system_prompt: member.system_prompt || null,
      temperature: member.temperature ?? null,
      max_tokens: member.max_tokens ?? null,
    })),
    tasks,
  };
}

export default function ExpertsPage() {
  const router = useRouter();
  const { data, isLoading } = useExpertTeams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [selected, setSelected] = useState<ExpertTeamSummary | null>(null);
  const [editing, setEditing] = useState<{ team: ExpertTeamConfig; mode: "create" | "edit" } | null>(null);
  const createSession = useCreateSession();
  const settings = useSettingsStore();
  const queryClient = useQueryClient();
  const creationProviderId = settings.selectedProviderId;
  const creationModel = settings.selectedModel;
  const canCreateExpertTeam = canCreateExpertTeamWithProvider(settings.activeProvider, creationProviderId);
  const redirectToExpertTeamAccount = () => {
    toast.warning(EXPERT_TEAM_CREATION_ACCESS_MESSAGE, {
      duration: 6000,
      action: {
        label: "去模型设置",
        onClick: () => router.push(EXPERT_TEAM_ACCOUNT_ROUTE),
      },
    });
    router.push(EXPERT_TEAM_ACCOUNT_ROUTE);
  };

  const teams = data?.teams ?? EMPTY_TEAMS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter((team) => {
      const matchesCategory = category === "全部" || team.category === category || team.tags.includes(category);
      const matchesQuery =
        !q ||
        team.name.toLowerCase().includes(q) ||
        team.description.toLowerCase().includes(q) ||
        team.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        team.members.some((member) => member.name.toLowerCase().includes(q) || member.role.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [category, query, teams]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-chat)]">
      {/* Header Section - Enhanced hierarchy */}
      <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)]">
        <div className="px-5 py-5 lg:px-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" asChild>
                  <Link href="/c/new">
                    <ArrowLeft className="h-4.5 w-4.5" />
                  </Link>
                </Button>
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
                    <Users className="h-5 w-5 text-[var(--text-secondary)]" />
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">专家团</h1>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                配置多位专家、任务顺序和上下文传递，由协调者汇总最终结果
              </p>
            </div>

            <div className="flex w-full flex-col gap-2.5 sm:flex-row xl:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索专家团或专家"
                  className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] pl-10 pr-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                />
              </div>
              <Button
                onClick={() => {
                  if (!canCreateExpertTeam) {
                    redirectToExpertTeamAccount();
                    return;
                  }
                  setEditing({ team: createBlankTeam(), mode: "create" });
                }}
                className="h-10 gap-1.5 bg-[var(--text-primary)] font-medium text-[var(--surface-primary)] hover:bg-[var(--text-secondary)]"
                title={canCreateExpertTeam ? undefined : "创建自己的专家团需要先在设置中选择模型提供商"}
              >
                <Plus className="h-3.5 w-3.5" />
                新建专家团
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  if (!canCreateExpertTeam) {
                    redirectToExpertTeamAccount();
                    return;
                  }
                  try {
                    const session = await createSession.mutateAsync({
                      directory: settings.workspaceDirectory,
                      title: "AI 创建专家团",
                    });
                    useExpertSessionStore.getState().setExpertTeamCreationMode(session.id, {
                      model: creationModel,
                      providerId: creationProviderId,
                    });
                    queryClient.setQueryData<SessionResponse>(queryKeys.sessions.detail(session.id), session);
                    router.push(getChatRoute(session.id));
                  } catch (err) {
                    const redirect = expertTeamAccessRedirectFromError(err);
                    if (redirect) {
                      toast.warning(EXPERT_TEAM_CREATION_ACCESS_MESSAGE, { duration: 6000 });
                      router.push(redirect);
                      return;
                    }
                    toast.error(err instanceof Error ? err.message : "创建专家团会话失败");
                  }
                }}
                disabled={createSession.isPending}
                className="h-10 gap-1.5 font-medium"
                title={canCreateExpertTeam ? undefined : "AI 创建专家团需要先在设置中选择模型提供商"}
              >
                {createSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI 创建
              </Button>
            </div>
          </div>

          {/* Category tabs - Cleaner design */}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={cn(
                  "h-9 shrink-0 rounded-lg px-3.5 text-sm font-medium transition-colors cursor-pointer",
                  category === item
                    ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] shadow-[var(--sidebar-active-shadow)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content - Better grid layout */}
      <div className="flex-1 overflow-y-auto bg-[var(--surface-chat)] px-5 py-6 lg:px-7 scrollbar-auto">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-52 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--surface-tertiary)]">
              <Sparkles className="h-8 w-8 text-[var(--text-tertiary)]" />
            </div>
            <p className="text-base font-medium text-[var(--text-secondary)]">未找到专家团</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((team) => (
              <ExpertTeamCard
                key={team.id}
                team={team}
                onClick={() => setSelected(team)}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <ExpertTeamModal
          team={selected}
          onClose={() => setSelected(null)}
          onEdit={(teamConfig) => {
            setSelected(null);
            setEditing({ team: teamConfig, mode: "edit" });
          }}
          onCopy={(teamConfig) => {
            setSelected(null);
            setEditing({ team: teamConfig, mode: "create" });
          }}
          onLoaded={(sessionId) => {
            router.push(getChatRoute(sessionId));
          }}
        />
      )}

      {editing && (
        <ExpertTeamEditor
          initialTeam={editing.team}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          model={creationModel}
          providerId={creationProviderId}
          onAccessDenied={(redirect) => {
            toast.warning(EXPERT_TEAM_CREATION_ACCESS_MESSAGE, { duration: 6000 });
            router.push(redirect);
          }}
        />
      )}

    </div>
  );
}

function ExpertTeamCard({ team, onClick }: { team: ExpertTeamSummary; onClick: () => void }) {
  const Icon = teamIcon(team.icon);
  const isRemote = team.origin === "remote";
  const comingSoon = isExpertTeamComingSoon(team);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[160px] flex-col rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3.5 text-left transition-colors cursor-pointer hover:border-[var(--border-hover)] hover:bg-[var(--surface-secondary)]"
    >
      {/* Card Header - Compact */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-tertiary)] transition-colors group-hover:bg-[var(--sidebar-active)]">
          <Icon className="h-5 w-5 text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{team.name}</h2>
            <span className="shrink-0 rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs font-medium text-[var(--text-secondary)]">
              {teamOriginLabel(team)}
            </span>
            <span
              className="shrink-0 rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]"
              title={teamProcessDescription(team.process)}
            >
              {teamProcessLabel(team.process)}
            </span>
            {isRemote && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-tertiary)]">
                <Globe2 className="h-3 w-3" />
                只读
              </span>
            )}
            {comingSoon && (
              <span className="shrink-0 rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] px-1.5 py-0.5 text-ui-3xs font-medium text-[var(--text-tertiary)]">
                即将上线
              </span>
            )}
          </div>
          {isRemote && team.remote_version && (
            <div className="mb-1 text-ui-3xs text-[var(--text-tertiary)]">
              v{team.remote_version}{team.remote_channel ? ` · ${team.remote_channel}` : ""}
            </div>
          )}
          {/* Tags - Compact */}
          <div className="flex flex-wrap gap-1">
            {team.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-3xs text-[var(--text-secondary)]">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Description - Compact */}
      <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--text-secondary)]">{team.description}</p>

      {/* Stats - Compact */}
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-tertiary)] px-2 py-1.5">
          <Bot className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-ui-2xs font-medium text-[var(--text-secondary)]">{team.member_count} 位专家</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-tertiary)] px-2 py-1.5">
          <Workflow className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-ui-2xs font-medium text-[var(--text-secondary)]">{team.task_count} 个步骤</span>
        </div>
      </div>

      {/* Member avatars - Compact */}
      <div className="flex -space-x-1.5">
        {team.members.slice(0, 4).map((member) => (
          <div
            key={member.id}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--surface-primary)] bg-[var(--surface-tertiary)] transition-colors group-hover:border-[var(--surface-secondary)]"
          >
            <Bot className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </div>
        ))}
        {team.members.length > 4 && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--surface-primary)] bg-[var(--surface-tertiary)] text-ui-2xs font-medium text-[var(--text-tertiary)] transition-colors group-hover:border-[var(--surface-secondary)]">
            +{team.members.length - 4}
          </div>
        )}
      </div>
    </button>
  );
}

function ExpertTeamModal({
  team,
  onClose,
  onEdit,
  onCopy,
  onLoaded,
}: {
  team: ExpertTeamSummary;
  onClose: () => void;
  onEdit: (team: ExpertTeamConfig) => void;
  onCopy: (team: ExpertTeamConfig) => void;
  onLoaded: (sessionId: string) => void;
}) {
  const { data } = useExpertTeamDetail(team.id);
  const deleteTeam = useDeleteExpertTeam();
  const createSession = useCreateSession();
  const queryClient = useQueryClient();
  const settings = useSettingsStore();
  const detail = data?.team;
  const editable = data?.editable ?? team.editable;
  const origin = data?.origin ?? team.origin;
  const isRemote = origin === "remote";
  const remoteVersion = data?.remote_version ?? team.remote_version;
  const remoteChannel = data?.remote_channel ?? team.remote_channel;
  const comingSoon = isExpertTeamComingSoon(team);

  const start = async () => {
    if (comingSoon) return;
    try {
      const session = await createSession.mutateAsync({
        directory: settings.workspaceDirectory,
        title: `专家团：${team.name}`,
      });
      useExpertSessionStore.getState().setSelectedExpertTeam(session.id, {
        id: team.id,
        name: team.name,
        description: team.description,
      });
      queryClient.setQueryData<SessionResponse>(queryKeys.sessions.detail(session.id), session);
      onLoaded(session.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载专家团失败");
    }
  };

  const remove = async () => {
    if (!editable) return;
    if (!window.confirm(`确定删除专家团「${team.name}」吗？`)) return;
    try {
      await deleteTeam.mutateAsync(team.id);
      toast.success("专家团已删除");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除专家团失败");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
        {/* Modal Header - Enhanced design */}
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-primary)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2.5 mb-2">
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">{team.name}</h2>
                <span className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1 text-ui-2xs font-medium text-[var(--text-secondary)]">
                  {teamOriginLabel({ ...team, origin })}
                </span>
                <span
                  className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1 text-ui-2xs text-[var(--text-secondary)]"
                  title={teamProcessDescription(detail?.process ?? team.process)}
                >
                  {teamProcessLabel(detail?.process ?? team.process)}
                </span>
                {!editable && (
                  <span className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-ui-2xs text-[var(--text-tertiary)]">
                    只读
                  </span>
                )}
                {comingSoon && (
                  <span className="rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1 text-ui-2xs font-medium text-[var(--text-tertiary)]">
                    即将上线
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{team.description}</p>
              {detail?.skills && detail.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-1 text-ui-3xs text-[var(--text-tertiary)]">
                    skills · {detail.skills.slice(0, 4).join(", ")}
                  </span>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-1 text-ui-3xs text-[var(--text-tertiary)]">
                  {detail?.process === "hierarchical" ? "总控专家拆解任务并动态委派成员" : detail?.process === "workflow" ? `工作流 · 并发 ${detail.concurrency}` : detail?.process === "sequential" ? "顺序执行" : "普通专家团流程"}
                </span>
              </div>
              {isRemote && (
                <div className="mt-3 flex flex-wrap items-center gap-2.5 text-ui-2xs text-[var(--text-tertiary)]">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1.5">
                    <Globe2 className="h-3.5 w-3.5" />
                    远程 manifest
                  </span>
                  {remoteVersion && (
                    <span className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1.5">
                      版本 v{remoteVersion}
                    </span>
                  )}
                  {remoteChannel && (
                    <span className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1.5">
                      渠道 {remoteChannel}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Tags - Enhanced */}
          <div className="mt-4 flex flex-wrap gap-2">
            {team.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-[var(--surface-tertiary)] px-2.5 py-1 text-ui-2xs text-[var(--text-secondary)]">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Modal Content - Compact layout */}
        <div className="flex-1 overflow-y-auto bg-[var(--surface-chat)] px-5 py-4">
          {/* Workflow Section */}
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-[var(--text-tertiary)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">协作流程</h3>
              </div>
              <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-0.5 text-ui-2xs text-[var(--text-tertiary)]">
                {detail?.process === "workflow"
                  ? `工作流 · 并发 ${detail.concurrency}`
                  : detail?.process === "hierarchical"
                    ? "统筹调度 · 总控专家派发任务"
                    : "按顺序执行"}，最终由协调者汇总
              </span>
            </div>
            <div className="space-y-2">
              {(detail?.tasks ?? []).map((task, index) => {
                const member = detail?.members.find((item) => item.id === task.member);
                return (
                  <div key={task.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--surface-tertiary)] text-ui-3xs font-semibold text-[var(--text-secondary)]">
                        {index + 1}
                      </span>
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{task.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-ui-3xs text-[var(--text-tertiary)]">
                      <span className="rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5">
                        {member?.name ?? task.member} · {member?.role ?? "专家"}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-ui-2xs leading-5 text-[var(--text-secondary)]">
                      {taskDisplaySummary(task, member)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Members Section - Compact grid */}
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--text-tertiary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">专家成员</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(detail?.members ?? team.members).map((member) => {
                const summary = memberDisplaySummary(member);
                return (
                  <div key={member.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-tertiary)]">
                        <Bot className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">{member.name}</div>
                        <div className="truncate text-ui-3xs text-[var(--text-tertiary)]">{member.role}</div>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-ui-2xs leading-5 text-[var(--text-secondary)]">{summary}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Help text - Compact */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">
            {comingSoon
              ? "视频生成专家团正在准备中，本版本暂不开放使用。"
              : "点击召唤后会创建一个新会话，并在会话输入框中标记当前使用的专家团。"}
          </div>
        </div>

        {/* Modal Footer - Enhanced */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-primary)] px-6 py-4">
          <div className="flex items-center gap-2 text-ui-2xs text-[var(--text-tertiary)]">
            <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
            {comingSoon ? "该专家团暂未开放召唤" : "输出会进入一个新的 Codata 会话"}
          </div>
          <div className="flex items-center gap-2.5">
            {editable && detail && (
              <>
                <Button variant="outline" onClick={() => onEdit(detail)} className="gap-2 font-medium">
                  <Pencil className="h-4 w-4" />
                  修改
                </Button>
                <Button variant="outline" onClick={remove} disabled={deleteTeam.isPending} className="gap-2 font-medium">
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              </>
            )}
            {detail && !editable && !comingSoon && (
              <Button variant="outline" onClick={() => onCopy(cloneTeamForCustom(detail))} className="gap-2 font-medium">
                <Copy className="h-4 w-4" />
                复制为自定义
              </Button>
            )}
            <Button onClick={start} disabled={comingSoon || createSession.isPending} className="gap-2 font-medium">
              {createSession.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {comingSoon ? "即将上线" : "召唤"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpertTeamEditor({
  initialTeam,
  mode,
  onClose,
  onSaved,
  model,
  providerId,
  onAccessDenied,
}: {
  initialTeam: ExpertTeamConfig;
  mode: "create" | "edit";
  onClose: () => void;
  onSaved: () => void;
  model?: string | null;
  providerId?: string | null;
  onAccessDenied: (redirect: string) => void;
}) {
  const [team, setTeam] = useState<ExpertTeamConfig>(initialTeam);
  const [activeStep, setActiveStep] = useState<EditorStep>("basics");
  const createTeam = useCreateExpertTeam();
  const updateTeam = useUpdateExpertTeam();
  const existingId = mode === "edit";
  const saving = createTeam.isPending || updateTeam.isPending;
  const isHierarchical = team.process === "hierarchical";
  const managerConfig = team.manager ?? createDefaultManager();
  const finalizationConfig = team.finalization ?? createDefaultFinalization("deliverable");
  const deliverableConfig = normalizeDeliverable(finalizationConfig.deliverable);
  const autonomousHierarchical = isHierarchical && managerConfig.submode === "autonomous";
  const activeStepIndex = EDITOR_STEPS.findIndex((step) => step.id === activeStep);
  const canGoBack = activeStepIndex > 0;
  const canGoNext = activeStepIndex >= 0 && activeStepIndex < EDITOR_STEPS.length - 1;
  const goBack = () => {
    if (canGoBack) setActiveStep(EDITOR_STEPS[activeStepIndex - 1].id);
  };
  const goNext = () => {
    if (canGoNext) setActiveStep(EDITOR_STEPS[activeStepIndex + 1].id);
  };

  const setField = <K extends keyof ExpertTeamConfig>(key: K, value: ExpertTeamConfig[K]) => {
    setTeam((prev) => ({ ...prev, [key]: value }));
  };

  const setProcess = (process: ExpertTeamConfig["process"]) => {
    setTeam((prev) => {
      if (process === "hierarchical") {
        return {
          ...prev,
          process,
          manager: prev.manager ?? createDefaultManager(),
          max_delegations: prev.max_delegations ?? 12,
          finalization: prev.process === "hierarchical"
            ? (prev.finalization ?? createDefaultFinalization("deliverable"))
            : createDefaultFinalization("deliverable"),
        };
      }
      return {
        ...prev,
        process,
        manager: null,
        finalization: prev.finalization ?? createDefaultFinalization("deliverable"),
      };
    });
  };

  const setManagerField = <K extends keyof ExpertManagerConfig>(key: K, value: ExpertManagerConfig[K]) => {
    setTeam((prev) => ({
      ...prev,
      manager: {
        ...(prev.manager ?? createDefaultManager()),
        [key]: value,
      },
    }));
  };

  const setFinalizationField = <K extends keyof ExpertFinalizationConfig>(key: K, value: ExpertFinalizationConfig[K]) => {
    setTeam((prev) => ({
      ...prev,
      finalization: {
        ...(prev.finalization ?? createDefaultFinalization("deliverable")),
        [key]: value,
      },
    }));
  };

  const setDeliverableField = <K extends keyof ExpertDeliverableConfig>(key: K, value: ExpertDeliverableConfig[K]) => {
    setTeam((prev) => {
      const finalization = prev.finalization ?? createDefaultFinalization("deliverable");
      const current = normalizeDeliverable(finalization.deliverable);
      const nextDeliverable = { ...current, [key]: value };
      if (key === "type") {
        const nextType = value as ExpertDeliverableType;
        const nextPresentation: ExpertDeliverablePresentation =
          nextType === "artifact" ? "artifact_panel" : nextType === "html" || nextType === "code" ? "both" : "file_preview";
        nextDeliverable.presentation = nextPresentation;
        nextDeliverable.filename_template = defaultDeliverableFilename(nextType);
        nextDeliverable.tools = defaultDeliverableTools(nextType, nextPresentation);
      }
      if (key === "presentation") {
        nextDeliverable.tools = defaultDeliverableTools(nextDeliverable.type, value as ExpertDeliverablePresentation);
      }
      return {
        ...prev,
        finalization: {
          ...finalization,
          deliverable: nextDeliverable,
        },
      };
    });
  };

  const setMembers = (members: ExpertMemberConfig[]) => {
    setTeam((prev) => {
      const memberIds = new Set(members.map((member) => member.id));
      const manager = prev.manager
        ? {
            ...prev.manager,
            member: prev.manager.member && memberIds.has(prev.manager.member) ? prev.manager.member : null,
          }
        : prev.manager;
      const finalization = prev.finalization
        ? {
            ...prev.finalization,
            member: prev.finalization.member && memberIds.has(prev.finalization.member) ? prev.finalization.member : null,
          }
        : prev.finalization;
      const tasks = prev.tasks.map((task) => ({
        ...task,
        member: memberIds.has(task.member) ? task.member : members[0]?.id ?? "",
      }));
      return { ...prev, members, manager, finalization, tasks };
    });
  };

  const save = async () => {
    const id = slugify(team.id || team.name);
    if (!id || !team.name.trim()) {
      toast.error("请填写专家团名称和有效 ID");
      return;
    }
    if (team.members.length === 0) {
      toast.error("至少需要一位专家");
      return;
    }
    if (!autonomousHierarchical && team.tasks.length === 0) {
      toast.error(isHierarchical ? "协同统筹模式至少需要一个建议任务" : "至少需要一个任务");
      return;
    }
    if (isHierarchical && managerConfig.member && !team.members.some((member) => member.id === managerConfig.member)) {
      toast.error("总控专家不存在");
      return;
    }
    if (finalizationConfig.member && !team.members.some((member) => member.id === finalizationConfig.member)) {
      toast.error("最终交付成员不存在");
      return;
    }
    if (finalizationConfig.mode === "deliverable" && !deliverableConfig.tools.length) {
      toast.error("产物交付至少需要一个工具");
      return;
    }

    const normalized = normalizeTeamForSave({ ...team, id, name: team.name.trim() });
    try {
      if (existingId) {
        await updateTeam.mutateAsync({ team: normalized, model, provider_id: providerId });
      } else {
        await createTeam.mutateAsync({ team: normalized, model, provider_id: providerId });
      }
      toast.success("专家团已保存");
      onSaved();
    } catch (err) {
      const redirect = expertTeamAccessRedirectFromError(err);
      if (redirect) {
        onAccessDenied(redirect);
        return;
      }
      toast.error(err instanceof Error ? err.message : "保存专家团失败");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
        {/* Editor Header */}
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-primary)] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
              <Users className="h-5 w-5 text-[var(--text-secondary)]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                {existingId ? "修改专家团" : "新建专家团"}
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                配置专家成员、任务顺序、上下文传递和最终汇总规则
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-primary)] px-5 py-3">
          <div className="grid gap-2 sm:grid-cols-4">
            {EDITOR_STEPS.map((step, index) => {
              const StepIcon = step.Icon;
              const active = activeStep === step.id;
              const completed = index < activeStepIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStep(step.id)}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-lg border px-3 text-left transition-colors cursor-pointer",
                    active
                      ? "border-[var(--border-heavy)] bg-[var(--sidebar-active)] shadow-[var(--sidebar-active-shadow)]"
                      : "border-[var(--border-subtle)] bg-[var(--surface-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-tertiary)]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      active || completed
                        ? "bg-[var(--text-primary)] text-[var(--surface-primary)]"
                        : "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]",
                    )}
                  >
                    {completed ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">{step.title}</span>
                    <span className="block truncate text-ui-2xs text-[var(--text-tertiary)]">{step.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto bg-[var(--surface-chat)] px-4 py-4 sm:px-5 sm:py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              {activeStep === "basics" && (
                <section className="space-y-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">基本信息</h3>
                        <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-secondary)]">
                          先定义这个专家团解决什么问题，以及运行时采用哪种协作模式。
                        </p>
                      </div>
                      <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-1 text-ui-3xs font-medium text-[var(--text-secondary)]">
                        必填
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <Field label="名称" required>
                        <Input value={team.name} onChange={(event) => setField("name", event.target.value)} placeholder="软件开发专家团" />
                      </Field>
                      <Field label="ID" required>
                        <Input
                          value={team.id}
                          onChange={(event) => setField("id", slugify(event.target.value))}
                          onBlur={() => setField("id", slugify(team.id || team.name))}
                          placeholder="software-team"
                          disabled={existingId}
                        />
                      </Field>
                      <Field label="分类">
                        <Input value={team.category} onChange={(event) => setField("category", event.target.value)} placeholder="技术工程" />
                      </Field>
                      <Field label="执行模式">
                        <select
                          value={team.process}
                          onChange={(event) => setProcess(event.target.value as ExpertTeamConfig["process"])}
                          className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                        >
                          <option value="workflow">工作流</option>
                          <option value="sequential">顺序</option>
                          <option value="hierarchical">统筹调度</option>
                        </select>
                      </Field>
                      <Field label="最大并发">
                        <Input
                          type="number"
                          min={1}
                          max={8}
                          value={team.concurrency}
                          onChange={(event) => setField("concurrency", Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
                        />
                      </Field>
                      <Field label="标签">
                        <Input value={joinList(team.tags)} onChange={(event) => setField("tags", splitList(event.target.value))} placeholder="软件开发, 架构设计" />
                      </Field>
                    </div>
                    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 text-ui-2xs leading-5 text-[var(--text-secondary)]">
                      {processHelpText(team.process)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                    <Field label="描述">
                      <textarea
                        value={team.description}
                        onChange={(event) => setField("description", event.target.value)}
                        className="min-h-24 w-full resize-none rounded-lg border border-[var(--border-default)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                        placeholder="说明这个专家团适合处理什么任务，用户什么时候应该使用它"
                      />
                    </Field>
                  </div>

                  {isHierarchical && (
                    <AdvancedSection title="统筹调度设置">
                      <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-tertiary)] px-3 py-2 text-ui-2xs leading-5 text-[var(--text-secondary)]">
                        总控专家会在运行时规划、委派和汇总任务。新手可以保持自动总控，只有需要固定某位专家负责调度时再指定成员。
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label="总控成员">
                          <select
                            value={managerConfig.member ?? ""}
                            onChange={(event) => setManagerField("member", event.target.value || null)}
                            className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                          >
                            <option value="">自动选择总控</option>
                            {team.members.map((member) => (
                              <option key={member.id} value={member.id}>{member.name || member.id}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="调度方式">
                          <select
                            value={managerConfig.submode}
                            onChange={(event) => setManagerField("submode", event.target.value as ExpertManagerConfig["submode"])}
                            className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                          >
                            <option value="coordinated">按预设任务协同</option>
                            <option value="autonomous">运行时自主委派</option>
                          </select>
                        </Field>
                        <Field label="最大委派次数">
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            value={team.max_delegations ?? 12}
                            onChange={(event) => setField("max_delegations", Math.max(1, Math.min(50, Number(event.target.value) || 12)))}
                          />
                        </Field>
                        <Field label="总控提示词" className="sm:col-span-2 lg:col-span-3">
                          <textarea
                            value={managerConfig.prompt}
                            onChange={(event) => setManagerField("prompt", event.target.value)}
                            className="min-h-28 w-full resize-none rounded-lg border border-[var(--border-default)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                          />
                        </Field>
                      </div>
                    </AdvancedSection>
                  )}

                  <AdvancedSection title="高级运行设置">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="聊天输出风格">
                        <select
                          value={team.expert_output_style ?? "concise"}
                          onChange={(event) => setField("expert_output_style", event.target.value as ExpertTeamConfig["expert_output_style"])}
                          className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                        >
                          <option value="concise">简洁摘要</option>
                          <option value="full">完整输出</option>
                        </select>
                      </Field>
                      <Field label="默认工具轮数">
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={team.default_max_tool_rounds ?? 6}
                          onChange={(event) => setField("default_max_tool_rounds", Math.max(1, Math.min(30, Number(event.target.value) || 6)))}
                        />
                      </Field>
                      <Field label="专家可见字数">
                        <Input
                          type="number"
                          min={500}
                          max={20000}
                          value={team.expert_visible_max_chars ?? 1800}
                          onChange={(event) => setField("expert_visible_max_chars", clampNumber(event.target.value, 1800, 500, 20000))}
                        />
                      </Field>
                      <Field label="协调者可见字数">
                        <Input
                          type="number"
                          min={500}
                          max={30000}
                          value={team.coordinator_visible_max_chars ?? 2400}
                          onChange={(event) => setField("coordinator_visible_max_chars", clampNumber(event.target.value, 2400, 500, 30000))}
                        />
                      </Field>
                    </div>
                  </AdvancedSection>
                </section>
              )}

              {activeStep === "members" && (
                <MemberEditor members={team.members} onChange={setMembers} />
              )}

              {activeStep === "workflow" && (
                <TaskEditor
                  members={team.members}
                  tasks={team.tasks}
                  allowEmpty={autonomousHierarchical}
                  onChange={(tasks) => setField("tasks", tasks)}
                />
              )}

              {activeStep === "delivery" && (
                <section className="space-y-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">最终交付</h3>
                        <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-secondary)]">
                          专家团最后一步应交付可打开、可预览、可复用的产物，而不是只返回一段文本。
                        </p>
                      </div>
                      <Package className="h-5 w-5 text-[var(--text-tertiary)]" />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="收尾模式">
                        <select
                          value={finalizationConfig.mode}
                          onChange={(event) => setFinalizationField("mode", event.target.value as ExpertFinalizationConfig["mode"])}
                          className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                        >
                          <option value="deliverable">交付产物</option>
                          <option value="coordinator">协调者汇总</option>
                          <option value="last_task">最后任务输出</option>
                          <option value="none">不收尾</option>
                        </select>
                      </Field>

                      {finalizationConfig.mode === "deliverable" ? (
                        <>
                          <Field label="产物类型">
                            <select
                              value={deliverableConfig.type}
                              onChange={(event) => setDeliverableField("type", event.target.value as ExpertDeliverableType)}
                              className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                            >
                              {DELIVERABLE_TYPES.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="产物标题">
                            <Input
                              value={deliverableConfig.title}
                              onChange={(event) => setDeliverableField("title", event.target.value)}
                              placeholder="最终产物"
                            />
                          </Field>
                          <Field label="展示方式">
                            <select
                              value={deliverableConfig.presentation}
                              onChange={(event) => setDeliverableField("presentation", event.target.value as ExpertDeliverablePresentation)}
                              className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                            >
                              {DELIVERABLE_PRESENTATIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                              ))}
                            </select>
                          </Field>
                          <label className="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={deliverableConfig.required}
                              onChange={(event) => setDeliverableField("required", event.target.checked)}
                              className="h-4 w-4 rounded border-[var(--border-default)] accent-[var(--text-primary)]"
                            />
                            交付为必选项
                          </label>
                        </>
                      ) : (
                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 text-ui-2xs leading-5 text-[var(--text-secondary)] sm:col-span-2">
                          当前模式不会强制生成文件产物。只有少数轻量问答场景建议使用，正式专家团建议保持“交付产物”。
                        </div>
                      )}
                    </div>
                  </div>

                  {finalizationConfig.mode === "deliverable" && (
                    <AdvancedSection title="产物高级设置">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="文件名模板">
                          <Input
                            value={deliverableConfig.filename_template ?? ""}
                            onChange={(event) => setDeliverableField("filename_template", event.target.value || null)}
                            placeholder="final-deliverable.md"
                          />
                        </Field>
                        <Field label="产物来源">
                          <Input
                            value={deliverableConfig.source}
                            onChange={(event) => setDeliverableField("source", event.target.value)}
                            placeholder="last_task"
                          />
                        </Field>
                        <Field label="产物工具" className="sm:col-span-2">
                          <Input
                            value={joinList(deliverableConfig.tools)}
                            onChange={(event) => setDeliverableField("tools", splitList(event.target.value))}
                            placeholder="write, present_file"
                          />
                        </Field>
                      </div>
                    </AdvancedSection>
                  )}

                  <AdvancedSection title="协调者和上下文">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {finalizationConfig.mode !== "deliverable" && (
                        <>
                          <Field label="收尾成员">
                            <select
                              value={finalizationConfig.member ?? ""}
                              onChange={(event) => setFinalizationField("member", event.target.value || null)}
                              className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                            >
                              <option value="">默认协调者</option>
                              {team.members.map((member) => (
                                <option key={member.id} value={member.id}>{member.name || member.id}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="收尾工具">
                            <Input
                              value={joinList(finalizationConfig.tools)}
                              onChange={(event) => setFinalizationField("tools", splitList(event.target.value))}
                              placeholder="read, write, edit"
                            />
                          </Field>
                        </>
                      )}
                      <Field label="协调者上下文">
                        <select
                          value={team.coordinator_context_policy ?? "summary"}
                          onChange={(event) => setField("coordinator_context_policy", event.target.value as ExpertTeamConfig["coordinator_context_policy"])}
                          className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                        >
                          <option value="summary">摘要</option>
                          <option value="dependencies">完整输出</option>
                          <option value="explicit">不自动追加</option>
                          <option value="auto">自动</option>
                        </select>
                      </Field>
                      <Field label="上下文上限">
                        <Input
                          type="number"
                          min={1000}
                          max={200000}
                          value={team.coordinator_context_max_chars ?? 24000}
                          onChange={(event) => setField("coordinator_context_max_chars", Math.max(1000, Math.min(200000, Number(event.target.value) || 24000)))}
                        />
                      </Field>
                      <Field label="协调者提示词" className="sm:col-span-2">
                        <textarea
                          value={team.coordinator_prompt}
                          onChange={(event) => setField("coordinator_prompt", event.target.value)}
                          className="min-h-28 w-full resize-none rounded-lg border border-[var(--border-default)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                        />
                      </Field>
                    </div>
                  </AdvancedSection>
                </section>
              )}
            </div>
            <ExpertTeamEditorSummary
              team={team}
              deliverable={deliverableConfig}
              manager={managerConfig}
              activeStep={activeStep}
              onStepChange={setActiveStep}
            />
          </div>
        </div>

        {/* Editor Footer */}
        <div className="flex flex-col-reverse gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-primary)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={goBack} disabled={!canGoBack} className="flex-1 font-medium sm:flex-none">上一步</Button>
            <Button variant="outline" onClick={goNext} disabled={!canGoNext} className="flex-1 font-medium sm:flex-none">下一步</Button>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1 font-medium sm:flex-none">取消</Button>
            <Button onClick={save} disabled={saving} className="flex-1 gap-2 font-medium sm:flex-none">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
        {required && <span className="ml-1 text-[var(--color-destructive)]">*</span>}
      </span>
      {children}
    </label>
  );
}

function AdvancedSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left cursor-pointer"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
          <Settings2 className="h-4 w-4 text-[var(--text-tertiary)]" />
          {title}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-[var(--text-tertiary)] transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-[var(--border-subtle)] px-3 py-3">{children}</div>}
    </section>
  );
}

function ExpertTeamEditorSummary({
  team,
  deliverable,
  manager,
  activeStep,
  onStepChange,
}: {
  team: ExpertTeamConfig;
  deliverable: ExpertDeliverableConfig;
  manager: ExpertManagerConfig;
  activeStep: EditorStep;
  onStepChange: (step: EditorStep) => void;
}) {
  const processLabel = teamProcessLabel(team.process);
  const processDetail = team.process === "hierarchical"
    ? manager.submode === "autonomous"
      ? "总控自主委派"
      : "总控按预设协同"
    : processLabel;
  const deliveryLabel = team.finalization?.mode === "deliverable"
    ? deliverableTypeLabel(deliverable.type)
    : team.finalization?.mode ?? "deliverable";
  const checks = [
    { label: "基础信息", done: Boolean(team.name.trim() && slugify(team.id || team.name)), step: "basics" as const },
    { label: "专家成员", done: team.members.length > 0, step: "members" as const },
    { label: "任务流程", done: team.process === "hierarchical" && manager.submode === "autonomous" ? true : team.tasks.length > 0, step: "workflow" as const },
    {
      label: "最终交付",
      done: team.finalization?.mode === "deliverable"
        ? Boolean(deliverable.title.trim() && deliverable.tools.length)
        : Boolean(team.finalization?.mode),
      step: "delivery" as const,
    },
  ];

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-0 space-y-3">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--text-tertiary)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">配置摘要</h3>
          </div>
          <div className="space-y-2 text-ui-2xs">
            <SummaryRow label="执行模式" value={processDetail} />
            <SummaryRow label="专家数量" value={`${team.members.length} 位`} />
            <SummaryRow label="任务步骤" value={`${team.tasks.length} 步`} />
            <SummaryRow label="最终交付" value={deliveryLabel} />
          </div>
          <div className="mt-3 rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-ui-2xs leading-5 text-[var(--text-secondary)]">
            {processHelpText(team.process)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
          <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">完成检查</div>
          <div className="space-y-1">
            {checks.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onStepChange(item.step)}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-ui-2xs transition-colors cursor-pointer",
                  activeStep === item.step ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] shadow-[var(--sidebar-active-shadow)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    item.done
                      ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-primary)]"
                      : "border-[var(--border-default)] text-[var(--text-tertiary)]",
                  )}
                >
                  {item.done ? <Check className="h-3 w-3" /> : null}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--surface-secondary)] px-2.5 py-2">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className="truncate font-medium text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function MemberEditor({
  members,
  onChange,
}: {
  members: ExpertMemberConfig[];
  onChange: (members: ExpertMemberConfig[]) => void;
}) {
  const { data: roleData } = useExpertRoles();
  const [roleQuery, setRoleQuery] = useState("");
  const roles = roleData?.roles ?? EMPTY_ROLES;
  const roleLibraryLabel = roleData?.active_language === "zh"
    ? "agency-agents-zh 中文角色库"
    : roleData?.active_language === "en"
      ? "agency-agents 英文兜底库"
      : roleData?.active_language === "mixed"
        ? "混合角色库"
        : "未加载角色库";
  const roleLibraryHint = roleData?.using_fallback
    ? "未检测到 agency-agents-zh，当前显示英文兜底角色。"
    : roleData?.active_language === "zh"
      ? `已加载 ${roles.length} 个中文角色`
      : "请安装或配置 agency-agents-zh 后刷新。";
  const roleSourceText = roleData?.source_dirs?.[0]
    ? roleData.source_dirs[0]
    : roleData?.missing_preferred_dirs?.[0] ?? "未发现角色库目录";
  const visibleRoles = useMemo(() => {
    const q = roleQuery.trim().toLowerCase();
    if (!q) return roles.slice(0, 12);
    return roles
      .filter((role) =>
        role.id.toLowerCase().includes(q) ||
        role.name.toLowerCase().includes(q) ||
        role.description.toLowerCase().includes(q) ||
        role.category.toLowerCase().includes(q),
      )
      .slice(0, 16);
  }, [roleQuery, roles]);

  const update = (index: number, patch: Partial<ExpertMemberConfig>) => {
    onChange(members.map((member, idx) => idx === index ? { ...member, ...patch } : member));
  };

  const applyRole = (index: number, role: ExpertRole) => {
    const current = members[index];
    update(index, {
      id: current.id || slugify(role.id.split("/").pop() || role.name),
      name: role.name,
      role: role.name,
      goal: role.description || current.goal,
      backstory: current.backstory,
      role_ref: role.id,
      role_source: role.source,
      system_prompt: role.system_prompt,
    });
  };

  const add = () => {
    const next = members.length + 1;
    onChange([
      ...members,
      {
        id: `expert-${next}`,
        name: `专家 ${next}`,
        role: "领域专家",
        goal: "完成分配给自己的专业任务。",
        backstory: "",
        role_ref: null,
        role_source: null,
        system_prompt: null,
        tools: ["read", "skill"],
        skills: [],
        connectors: [],
        icon: "bot",
      },
    ]);
  };

  return (
    <section>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-5 w-5 text-[var(--text-tertiary)]" />
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">专家成员</h3>
            <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-secondary)]">
              先定义每位专家的身份和职责；工具、模型、角色库可以在高级能力中配置。
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={add} className="gap-2 font-medium">
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
      <div className="space-y-3">
        {members.map((member, index) => (
          <div key={`${member.id}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-tertiary)]">
                  <Bot className="h-4.5 w-4.5 text-[var(--text-secondary)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">{member.name || member.id}</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 cursor-pointer"
                onClick={() => onChange(members.filter((_, idx) => idx !== index))}
                disabled={members.length <= 1}
                aria-label="删除专家"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="专家 ID">
                <Input value={member.id} onChange={(event) => update(index, { id: slugify(event.target.value) })} placeholder="expert-id" />
              </Field>
              <Field label="专家名称">
                <Input value={member.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="专家名称" />
              </Field>
              <Field label="角色">
                <Input value={member.role} onChange={(event) => update(index, { role: event.target.value })} placeholder="如：需求分析专家" />
              </Field>
              <Field label="职责目标">
                <textarea
                  value={member.goal}
                  onChange={(event) => update(index, { goal: event.target.value })}
                  className="min-h-20 w-full resize-none rounded-lg border border-[var(--border-default)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                  placeholder="这个专家负责什么"
                />
              </Field>
            </div>

            {/* Role Library Section */}
            <AdvancedSection title="角色库和高级能力">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-secondary)]">角色库</div>
                    <div className="truncate text-ui-2xs text-[var(--text-tertiary)]">
                      {member.role_ref ? member.role_ref : "未套用角色库"}
                    </div>
                  </div>
                  {member.role_ref && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update(index, { role_ref: null, role_source: null, system_prompt: null })}
                      className="cursor-pointer"
                    >
                      清除
                    </Button>
                  )}
                </div>

                <div
                  className={cn(
                    "mb-3 rounded-lg px-3 py-2.5 text-ui-2xs",
                    roleData?.using_fallback
                      ? "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "border border-[var(--border-subtle)] bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--text-secondary)]">{roleLibraryLabel}</span>
                    <span className="shrink-0">{roles.length} 个角色</span>
                  </div>
                  <div className="truncate">{roleLibraryHint}</div>
                  <div className="mt-1 truncate">{roleSourceText}</div>
                </div>

                <Input
                  value={roleQuery}
                  onChange={(event) => setRoleQuery(event.target.value)}
                  placeholder="搜索中文角色、分类或能力"
                />
                <div className="mt-2.5 max-h-44 space-y-1.5 overflow-y-auto scrollbar-auto">
                  {visibleRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => applyRole(index, role)}
                      className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--surface-tertiary)] cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{role.emoji || "•"}</span>
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{role.name}</span>
                        <span className="shrink-0 text-ui-2xs text-[var(--text-tertiary)]">{role.category}</span>
                      </div>
                      <div className="mt-1 truncate text-ui-2xs text-[var(--text-tertiary)]">{role.id}</div>
                    </button>
                  ))}
                  {visibleRoles.length === 0 && (
                    <div className="px-3 py-2 text-sm text-[var(--text-tertiary)]">未找到角色</div>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="工具">
                  <Input value={joinList(member.tools)} onChange={(event) => update(index, { tools: splitList(event.target.value) })} placeholder="read, grep, skill" />
                </Field>
                <Field label="模型 ID">
                  <Input value={member.model ?? ""} onChange={(event) => update(index, { model: event.target.value || null })} placeholder="可选模型 ID" />
                </Field>
                <Field label="Provider">
                  <Input value={member.provider_id ?? ""} onChange={(event) => update(index, { provider_id: event.target.value || null })} placeholder="可选模型 provider" />
                </Field>
                <Field label="Skills">
                  <Input value={joinList(member.skills)} onChange={(event) => update(index, { skills: splitList(event.target.value) })} placeholder="技能 ID" />
                </Field>
                <Field label="MCP 连接器">
                  <Input value={joinList(member.connectors)} onChange={(event) => update(index, { connectors: splitList(event.target.value) })} placeholder="MCP 连接器 ID" />
                </Field>
                <Field label="系统提示词" className="sm:col-span-2">
                  <textarea
                    value={member.system_prompt ?? ""}
                    onChange={(event) => update(index, { system_prompt: event.target.value || null })}
                    className="min-h-24 w-full resize-none rounded-lg border border-[var(--border-default)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                    placeholder="可选：角色系统提示词快照"
                  />
                </Field>
              </div>
            </AdvancedSection>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskEditor({
  members,
  tasks,
  allowEmpty = false,
  onChange,
}: {
  members: ExpertMemberConfig[];
  tasks: ExpertTaskConfig[];
  allowEmpty?: boolean;
  onChange: (tasks: ExpertTaskConfig[]) => void;
}) {
  const update = (index: number, patch: Partial<ExpertTaskConfig>) => {
    onChange(tasks.map((task, idx) => {
      if (idx !== index) return task;
      const next = { ...task, ...patch };
      if ("task" in patch && patch.task !== undefined) next.description = patch.task ?? "";
      if ("description" in patch && patch.description !== undefined) next.task = patch.description;
      if ("depends_on" in patch && patch.depends_on) next.context = patch.depends_on;
      if ("context" in patch && patch.context) next.depends_on = patch.context;
      return next;
    }));
  };

  const add = () => {
    const next = tasks.length + 1;
    onChange([
      ...tasks,
      {
        id: `task-${next}`,
        name: `任务 ${next}`,
        description: "基于用户输入和前序上下文完成该步骤。",
        task: "基于用户输入和前序上下文完成该步骤。",
        expected_output: "结构化输出。",
        member: members[0]?.id ?? "",
        context: tasks.length > 0 ? [tasks[tasks.length - 1].id] : [],
        depends_on: tasks.length > 0 ? [tasks[tasks.length - 1].id] : [],
        depends_on_mode: "all",
        context_policy: "auto",
        context_max_chars: 12000,
        output: `task_${next}_result`,
        condition: null,
        timeout_seconds: 300,
        retry_count: 1,
        loop: null,
      },
    ]);
  };

  const remove = (index: number) => {
    const removed = tasks[index];
    const nextTasks = tasks
      .filter((_, idx) => idx !== index)
      .map((task) => {
        const dependsOn = (task.depends_on ?? task.context ?? []).filter((dep) => dep !== removed.id);
        return {
          ...task,
          depends_on: dependsOn,
          context: dependsOn,
        };
      });
    onChange(nextTasks);
  };

  return (
    <section>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Workflow className="mt-0.5 h-5 w-5 text-[var(--text-tertiary)]" />
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">任务流程</h3>
            <p className="mt-1 text-ui-2xs leading-5 text-[var(--text-secondary)]">
              每一步选择负责人，填写要做什么；依赖决定执行顺序，输出变量给后续步骤引用。
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={add} className="gap-2 font-medium">
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
      <div className="space-y-3">
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-6 text-sm leading-6 text-[var(--text-secondary)]">
            当前没有预设任务。运行时自主委派模式会由总控专家根据用户目标动态分配任务。
          </div>
        )}
        {tasks.map((task, index) => (
          <div key={`${task.id}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-tertiary)] text-sm font-semibold text-[var(--text-secondary)]">
                  {index + 1}
                </span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">第 {index + 1} 步</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 cursor-pointer"
                onClick={() => remove(index)}
                disabled={!allowEmpty && tasks.length <= 1}
                aria-label="删除任务"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="任务 ID">
                <Input value={task.id} onChange={(event) => update(index, { id: slugify(event.target.value) })} placeholder="task-id" />
              </Field>
              <Field label="任务名称">
                <Input value={task.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="任务名称" />
              </Field>
              <Field label="负责人">
                <select
                  value={task.member}
                  onChange={(event) => update(index, { member: event.target.value })}
                  className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.name || member.id}</option>
                  ))}
                </select>
              </Field>
              <Field label="依赖任务">
                <Input
                  value={joinList(task.depends_on ?? task.context)}
                  onChange={(event) => update(index, { depends_on: splitList(event.target.value) })}
                  placeholder="多个 ID 用逗号分隔"
                />
              </Field>
              <Field label="输出变量" className="sm:col-span-2">
                <Input
                  value={task.output ?? ""}
                  onChange={(event) => update(index, { output: variableId(event.target.value) || null })}
                  placeholder="如 research_report"
                />
              </Field>
            </div>

            <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 text-ui-2xs leading-5 text-[var(--text-secondary)]">
              下游任务可用 <span className="font-medium text-[var(--text-primary)]">{`{{${task.output || "task_result"}}}`}</span> 引用这一步的输出。
            </div>

            <div className="mt-3 space-y-3">
              <Field label="任务说明">
                <textarea
                  value={task.task ?? task.description}
                  onChange={(event) => update(index, { task: event.target.value })}
                  className="min-h-24 w-full resize-none rounded-lg border border-[var(--border-default)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-heavy)]"
                  placeholder="任务说明，可使用 {{user_input}} 或上游输出变量"
                />
              </Field>
              <Field label="期望输出">
                <Input value={task.expected_output} onChange={(event) => update(index, { expected_output: event.target.value })} placeholder="如：结构化分析报告" />
              </Field>
            </div>

            <AdvancedSection title="任务高级设置">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="依赖完成规则">
                  <select
                    value={task.depends_on_mode ?? "all"}
                    onChange={(event) => update(index, { depends_on_mode: event.target.value as ExpertTaskConfig["depends_on_mode"] })}
                    className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                  >
                    <option value="all">所有依赖完成</option>
                    <option value="any_completed">任一依赖完成</option>
                  </select>
                </Field>
                <Field label="执行条件">
                  <Input
                    value={task.condition ?? ""}
                    onChange={(event) => update(index, { condition: event.target.value || null })}
                    placeholder='如 {{review}} contains 通过'
                  />
                </Field>
                <Field label="上下文策略">
                  <select
                    value={task.context_policy ?? "auto"}
                    onChange={(event) => update(index, { context_policy: event.target.value as ExpertTaskConfig["context_policy"] })}
                    className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
                  >
                    <option value="auto">自动上下文</option>
                    <option value="explicit">仅模板变量</option>
                    <option value="summary">依赖摘要</option>
                    <option value="dependencies">依赖完整输出</option>
                  </select>
                </Field>
                <Field label="上下文上限">
                  <Input
                    type="number"
                    min={500}
                    max={100000}
                    value={task.context_max_chars ?? 12000}
                    onChange={(event) => update(index, { context_max_chars: Math.max(500, Math.min(100000, Number(event.target.value) || 12000)) })}
                    placeholder="上下文字符上限"
                  />
                </Field>
                <Field label="超时秒数">
                  <Input
                    type="number"
                    min={1}
                    value={task.timeout_seconds ?? 300}
                    onChange={(event) => update(index, { timeout_seconds: Math.max(1, Number(event.target.value) || 300) })}
                    placeholder="超时秒数"
                  />
                </Field>
                <Field label="重试次数">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={task.retry_count ?? 1}
                    onChange={(event) => update(index, { retry_count: Math.max(0, Math.min(5, Number(event.target.value) || 0)) })}
                    placeholder="重试次数"
                  />
                </Field>
              </div>
            </AdvancedSection>
          </div>
        ))}
      </div>
    </section>
  );
}
