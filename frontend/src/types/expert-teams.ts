export interface ExpertMemberSummary {
  id: string;
  name: string;
  role: string;
  icon: string;
}

export interface ExpertTeamSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  process: "sequential" | "hierarchical" | "workflow";
  tags: string[];
  category: string;
  member_count: number;
  task_count: number;
  is_preset: boolean;
  editable: boolean;
  origin?: "preset" | "user" | "project" | "remote" | string;
  source?: string | null;
  remote_id?: string | null;
  remote_version?: string | null;
  remote_channel?: string | null;
  members: ExpertMemberSummary[];
}

export interface ExpertMemberConfig extends ExpertMemberSummary {
  goal: string;
  backstory: string;
  role_ref?: string | null;
  role_source?: string | null;
  system_prompt?: string | null;
  model?: string | null;
  provider_id?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  tools: string[];
  skills: string[];
  connectors: string[];
  color?: string | null;
}

export interface ExpertInputConfig {
  name: string;
  description: string;
  required: boolean;
  default?: string | null;
  options?: Array<{
    label: string;
    description?: string;
    value?: string | null;
    preview?: string | null;
  }>;
}

export interface ExpertTaskLoopConfig {
  back_to: string;
  max_iterations: number;
  exit_condition: string;
}

export interface ExpertTaskConfig {
  id: string;
  name: string;
  description: string;
  task?: string | null;
  expected_output: string;
  member: string;
  context: string[];
  depends_on?: string[];
  depends_on_mode?: "all" | "any_completed";
  output?: string | null;
  context_policy?: "auto" | "explicit" | "dependencies" | "summary";
  context_max_chars?: number;
  condition?: string | null;
  timeout_seconds?: number;
  retry_count?: number;
  max_tool_rounds?: number | null;
  output_schema?: Record<string, unknown> | null;
  loop?: ExpertTaskLoopConfig | null;
}

export type ExpertDeliverableType =
  | "markdown"
  | "html"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "image"
  | "video"
  | "code"
  | "artifact";

export type ExpertDeliverablePresentation = "artifact_panel" | "file_preview" | "both";

export interface ExpertDeliverableConfig {
  required: boolean;
  type: ExpertDeliverableType;
  title: string;
  filename_template?: string | null;
  source: string;
  presentation: ExpertDeliverablePresentation;
  tools: string[];
}

export interface ExpertFinalizationConfig {
  mode: "deliverable" | "coordinator" | "last_task" | "none";
  member?: string | null;
  tools: string[];
  deliverable?: ExpertDeliverableConfig | null;
}

export interface ExpertManagerConfig {
  member?: string | null;
  prompt: string;
  submode: "coordinated" | "autonomous";
}

export interface ExpertTeamConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  process: "sequential" | "hierarchical" | "workflow";
  concurrency: number;
  inputs: ExpertInputConfig[];
  tags: string[];
  category: string;
  members: ExpertMemberConfig[];
  tasks: ExpertTaskConfig[];
  skills: string[];
  connectors: string[];
  metadata: Record<string, unknown>;
  default_max_tool_rounds?: number;
  finalization?: ExpertFinalizationConfig;
  manager?: ExpertManagerConfig | null;
  max_delegations?: number;
  interaction_mode?: "auto" | "ask_first" | "off";
  max_clarifying_questions?: number;
  question_timeout_seconds?: number;
  on_question_timeout?: "continue_with_assumptions" | "fail_task";
  expert_output_style?: "concise" | "full";
  expert_visible_max_chars?: number;
  coordinator_visible_max_chars?: number;
  coordinator_context_policy?: "auto" | "explicit" | "dependencies" | "summary";
  coordinator_context_max_chars?: number;
  coordinator_prompt: string;
}

export interface ExpertTeamsResponse {
  teams: ExpertTeamSummary[];
}

export interface ExpertTeamDetailResponse {
  team: ExpertTeamConfig;
  is_preset: boolean;
  editable: boolean;
  origin?: "preset" | "user" | "project" | "remote" | string;
  source?: string | null;
  remote_id?: string | null;
  remote_version?: string | null;
  remote_channel?: string | null;
}

export interface ExpertTeamWriteRequest {
  team: ExpertTeamConfig;
  model?: string | null;
  provider_id?: string | null;
}

export interface GenerateExpertTeamRequest {
  prompt: string;
  category?: string | null;
  model?: string | null;
  provider_id?: string | null;
  role_limit?: number;
}

export interface GenerateExpertTeamResponse {
  team: ExpertTeamConfig;
  validation_errors: string[];
  explanation: string;
  role_choices: Array<{
    member_id: string;
    role_ref: string;
    reason: string;
  }>;
  warnings: string[];
  cost_level?: "low" | "medium" | "high" | string | null;
  model?: string | null;
  provider_id?: string | null;
}

export interface ValidateExpertTeamResponse {
  valid: boolean;
  errors: string[];
}

export interface SummonExpertTeamResponse {
  stream_id: string;
  session_id: string;
}

export interface ExpertRole {
  id: string;
  name: string;
  description: string;
  category: string;
  emoji?: string | null;
  tools?: string | null;
  source: string;
  system_prompt: string;
  metadata: Record<string, unknown>;
}

export interface ExpertRolesResponse {
  roles: ExpertRole[];
  source_dirs: string[];
  preferred_language: "zh" | string;
  active_language: "zh" | "en" | "mixed" | "none" | string;
  using_fallback: boolean;
  missing_preferred_dirs: string[];
}
