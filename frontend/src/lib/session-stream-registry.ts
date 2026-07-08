"use client";

import type { QueryClient, InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import { SSEClient, type SSEConnectionStatus } from "@/lib/sse";
import { API, IS_DESKTOP, getBackendToken, getBackendUrl, queryKeys } from "@/lib/constants";
import { isRemoteMode } from "@/lib/remote-connection";
import { desktopAPI } from "@/lib/tauri-api";
import { api } from "@/lib/api";
import { SSE_EVENTS } from "@/types/streaming";
import { notifyBackgroundFinish } from "@/lib/background-notify";
import { artifactTypeFromExtension, languageFromExtension } from "@/lib/artifacts";
import { useChatStore } from "@/stores/chat-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useWorkspaceStore, type WorkspaceTodo, type WorkspaceFile } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { SessionResponse } from "@/types/session";
import type { ArtifactType } from "@/types/artifact";
import type { FilePart, MessageResponse, PaginatedMessages } from "@/types/message";

const PROGRESSIVE_BUFFER_INTERVAL_MS = 60;
const FILE_RESULT_TOOLS = new Set([
  "write",
  "edit",
  "bash",
  "artifact",
  "present_file",
]);
const FILE_PATH_FALLBACK_TOOLS = new Set(["present_file"]);

type GeneratedFile = Pick<FilePart, "name" | "path" | "size" | "mime_type"> & {
  file_id?: string;
  source?: FilePart["source"];
  content_hash?: string;
  relative_path?: string;
};

type SessionWorkspaceFile = {
  name: string;
  path: string;
  type: string;
  tool?: string;
  visibility?: WorkspaceFile["visibility"];
  relative_path?: string;
};

function normalizeWorkspaceFile(file: SessionWorkspaceFile): WorkspaceFile {
  return {
    name: file.name,
    path: file.path,
    type: file.type as WorkspaceFile["type"],
    tool: file.tool,
    visibility: file.visibility,
    relative_path: file.relative_path,
  };
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function isGeneratedFile(value: unknown): value is GeneratedFile {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.path === "string" && item.path.trim().length > 0;
}

function normalizeGeneratedFile(item: GeneratedFile): GeneratedFile {
  return {
    file_id: item.file_id,
    name: item.name || basename(item.path),
    path: item.path,
    size: typeof item.size === "number" ? item.size : 0,
    mime_type: item.mime_type || "application/octet-stream",
    source: item.source,
    content_hash: item.content_hash,
    relative_path: item.relative_path,
  };
}

function filesFromToolMetadata(
  metadata?: Record<string, unknown> | null,
  tool?: string | null,
): GeneratedFile[] {
  if (!metadata) return [];

  const candidates = [metadata.generated_files, metadata.attachments].find(Array.isArray);
  if (Array.isArray(candidates)) {
    return candidates
      .filter(isGeneratedFile)
      .map(normalizeGeneratedFile);
  }

  if (tool && FILE_PATH_FALLBACK_TOOLS.has(tool) && typeof metadata.file_path === "string" && metadata.file_path.trim()) {
    const path = metadata.file_path;
    return [{
      file_id: typeof metadata.file_id === "string" ? metadata.file_id : undefined,
      name: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title : basename(path),
      path,
      size: typeof metadata.size === "number" ? metadata.size : 0,
      mime_type: typeof metadata.mime_type === "string" ? metadata.mime_type : "application/octet-stream",
    }];
  }

  if (Array.isArray(metadata.generated_images)) {
    return metadata.generated_images
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .map((path) => ({
        name: basename(path),
        path,
        size: 0,
        mime_type: "image/png",
      }));
  }

  return [];
}

function openGeneratedFileArtifacts(callId: string, files: GeneratedFile[]): void {
  const artifactStore = useArtifactStore.getState();
  for (const file of files) {
    const artifactType = artifactTypeFromExtension(file.path);
    artifactStore.openArtifact({
      id: `tool-file-${file.file_id || file.path || callId}`,
      type: artifactType ?? "file-preview",
      title: file.name || basename(file.path),
      content: "",
      language: artifactType === "code" ? languageFromExtension(file.path) : undefined,
      filePath: file.path,
    });
  }
}

class ProgressiveBuffer {
  private pending = "";
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(private appendFn: (text: string) => void) {}

  push(text: string) {
    this.pending += text;
    if (!this.timerId) {
      this.timerId = setTimeout(this.flushPending, PROGRESSIVE_BUFFER_INTERVAL_MS);
    }
  }

  flush() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.pending) {
      this.appendFn(this.pending);
      this.pending = "";
    }
  }

  dispose() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pending = "";
  }

  private flushPending = () => {
    if (!this.pending) {
      this.timerId = null;
      return;
    }
    const chunk = this.pending;
    this.pending = "";
    this.timerId = null;
    this.appendFn(chunk);
  };
}

interface StreamInstance {
  sessionId: string;
  streamId: string;
  client: SSEClient;
  textBuffer: ProgressiveBuffer;
  reasoningBuffer: ProgressiveBuffer;
  stepFinishTimer: ReturnType<typeof setTimeout> | null;
  idleCheckTimer: ReturnType<typeof setInterval> | null;
  mobilePauseTimer: ReturnType<typeof setTimeout> | null;
  lastEventTimestamp: number;
}

const instances = new Map<string, StreamInstance>();

let queryClientRef: QueryClient | null = null;
let globalListenersInstalled = false;
let unlistenBackendRestarting: (() => void) | null = null;
let unlistenBackendRestarted: (() => void) | null = null;
let unlistenVisibilityChange: (() => void) | null = null;

export function setStreamRegistryQueryClient(qc: QueryClient): void {
  queryClientRef = qc;
}

export function isStreamActive(sessionId: string): boolean {
  return instances.has(sessionId);
}

export function getActiveStreamId(sessionId: string): string | null {
  return instances.get(sessionId)?.streamId ?? null;
}

export function stopStream(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  disposeInstance(instance);
  instances.delete(sessionId);
  if (instances.size === 0) {
    useConnectionStore.getState().setStatus("idle");
  }
}

function disposeInstance(instance: StreamInstance): void {
  if (instance.idleCheckTimer) {
    clearInterval(instance.idleCheckTimer);
    instance.idleCheckTimer = null;
  }
  if (instance.mobilePauseTimer) {
    clearTimeout(instance.mobilePauseTimer);
    instance.mobilePauseTimer = null;
  }
  if (instance.stepFinishTimer) {
    clearTimeout(instance.stepFinishTimer);
    instance.stepFinishTimer = null;
  }
  const isGenerating = useChatStore.getState().sessions[instance.sessionId]?.isGenerating;
  if (isGenerating) {
    instance.textBuffer.flush();
    instance.reasoningBuffer.flush();
  }
  instance.textBuffer.dispose();
  instance.reasoningBuffer.dispose();
  instance.client.close();
}

export async function startStream(sessionId: string, streamId: string): Promise<void> {
  const existing = instances.get(sessionId);
  if (existing) {
    if (existing.streamId === streamId) return;
    stopStream(sessionId);
  }

  if (IS_DESKTOP) {
    await Promise.all([getBackendUrl(), getBackendToken()]);
  }

  ensureGlobalListeners();

  const store = useChatStore;
  const connectionStore = useConnectionStore;
  const textBuffer = new ProgressiveBuffer((text) => {
    store.getState().appendTextDelta(sessionId, text);
  });
  const reasoningBuffer = new ProgressiveBuffer((text) => {
    store.getState().appendReasoningDelta(sessionId, text);
  });

  const waitForNextPaint = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

  const currentStreamCallIds = () => {
    const bucket = store.getState().sessions[sessionId];
    const ids = new Set<string>();
    for (const part of bucket?.streamingParts ?? []) {
      if (part.type === "tool" && part.call_id) ids.add(part.call_id);
    }
    return ids;
  };

  const hasRunningStreamingTool = (): boolean => {
    const bucket = store.getState().sessions[sessionId];
    return (bucket?.streamingParts ?? []).some((part) => {
      if (part.type !== "tool") return false;
      return part.state.status === "running" || part.state.status === "pending";
    });
  };

  const canFinalizeFromStreamingParts = (): boolean => {
    const bucket = store.getState().sessions[sessionId];
    const parts = bucket?.streamingParts ?? [];
    if (hasRunningStreamingTool()) return false;

    return parts.some((part) => {
      if (part.type !== "step-finish") return false;
      return part.reason !== "tool_use";
    });
  };

  const canFinalizeFromMessage = (message: MessageResponse | undefined, callIds: Set<string>): boolean => {
    if (!message || message.data.role !== "assistant") return false;
    const hasCurrentTool = message.parts.some((part) => {
      if (part.data.type !== "tool") return false;
      return callIds.has(part.data.call_id);
    });
    if (callIds.size > 0 && !hasCurrentTool) return false;

    const hasRunningTool = message.parts.some((part) => {
      if (part.data.type !== "tool") return false;
      if (callIds.size > 0 && !callIds.has(part.data.call_id)) return false;
      return part.data.state.status === "running" || part.data.state.status === "pending";
    });
    if (hasRunningTool) return false;

    return message.parts.some((part) => {
      if (part.data.type !== "step-finish") return false;
      if (callIds.size > 0 && !hasCurrentTool) return false;
      return part.data.reason !== "tool_use";
    });
  };

  const canFinalizeFromCache = (sid: string) => {
    if (hasRunningStreamingTool()) return false;
    if (canFinalizeFromStreamingParts()) return true;
    const qc = queryClientRef;
    if (!qc) return false;
    const callIds = currentStreamCallIds();
    const data = qc.getQueryData<InfiniteData<PaginatedMessages>>(
      queryKeys.messages.list(sid),
    );
    return data?.pages.some((page) =>
      page.messages.some((message) => canFinalizeFromMessage(message, callIds)),
    ) ?? false;
  };

  const canFinalizeFromPayload = (messages: PaginatedMessages | null | undefined) => {
    if (hasRunningStreamingTool()) return false;
    if (canFinalizeFromStreamingParts()) return true;
    const callIds = currentStreamCallIds();
    return messages?.messages.some((message) => canFinalizeFromMessage(message, callIds)) ?? false;
  };

  const finishFromDatabase = async (sid: string) => {
    textBuffer.flush();
    reasoningBuffer.flush();
    const qc = queryClientRef;
    if (qc) {
      await qc.invalidateQueries({ queryKey: queryKeys.messages.list(sid) });
      await waitForNextPaint();
    }

    try {
      const activeJobs = await api.get<Array<{ stream_id: string; session_id: string }>>(
        API.CHAT.ACTIVE,
      );
      const ourStreamId = store.getState().sessions[sid]?.streamId;
      const stillActive = activeJobs.some(
        (job) =>
          job.session_id === sid &&
          (!ourStreamId || job.stream_id === ourStreamId),
      );
      if (stillActive) return false;
    } catch {
      // Fall through to DB heuristic.
    }

    if (!canFinalizeFromCache(sid)) {
      try {
        const latestPage = await api.get<PaginatedMessages>(API.MESSAGES.LIST(sid, 50, -1));
        if (qc) {
          qc.setQueryData<InfiniteData<PaginatedMessages>>(
            queryKeys.messages.list(sid),
            (old) => {
              if (!old) return { pages: [latestPage], pageParams: [-1] };
              return { ...old, pages: [...old.pages.slice(0, -1), latestPage] };
            },
          );
        }
        if (!canFinalizeFromPayload(latestPage)) return false;
      } catch {
        return false;
      }
    }

    store.getState().finishGeneration(sid);
    if (instances.size === 0) connectionStore.getState().setStatus("idle");
    const workspace = useWorkspaceStore.getState();
    if (
      workspace.todos.length > 0 &&
      workspace.todos.every((todo) => todo.status === "completed")
    ) {
      workspace.collapseSection("progress");
    }
    if (qc) qc.invalidateQueries({ queryKey: queryKeys.sessions.all });
    return true;
  };

  const client = new SSEClient({
    url: API.CHAT.STREAM(streamId),
    urlProvider: () => API.CHAT.STREAM(streamId),
    initialLastEventId: 0,
    onEvent: () => {
      const inst = instances.get(sessionId);
      if (inst) inst.lastEventTimestamp = Date.now();
    },
    onStatusChange: (status) => {
      connectionStore.getState().setStatus(status);
      if (status === "disconnected") {
        toast.error("Connection lost. Response may be incomplete.");
        (async () => {
          try {
            const finished = await finishFromDatabase(sessionId);
            if (finished) {
              stopStream(sessionId);
              return;
            }
          } finally {
            store.getState().finishGeneration(sessionId);
            stopStream(sessionId);
          }
        })();
      }
    },
  });

  const instance: StreamInstance = {
    sessionId,
    streamId,
    client,
    textBuffer,
    reasoningBuffer,
    stepFinishTimer: null,
    idleCheckTimer: null,
    mobilePauseTimer: null,
    lastEventTimestamp: Date.now(),
  };

  const cancelPendingStepFinish = () => {
    if (instance.stepFinishTimer) {
      clearTimeout(instance.stepFinishTimer);
      instance.stepFinishTimer = null;
    }
  };

  const refreshWorkspaceFiles = () => {
    api.get<{ files: SessionWorkspaceFile[] }>(
      API.SESSIONS.FILES(sessionId),
    ).then((res) => {
      if (res.files) {
        useWorkspaceStore.getState().setWorkspaceFiles(
          res.files.map(normalizeWorkspaceFile),
        );
      }
    }).catch((e) => console.warn("[stream-registry] Failed to refresh workspace files:", e));
  };

  client.on(SSE_EVENTS.MODEL_LOADING, () => {
    store.getState().setModelLoading(sessionId, true);
  });

  client.on(SSE_EVENTS.TEXT_DELTA, (data) => {
    cancelPendingStepFinish();
    const bucket = store.getState().sessions[sessionId];
    if (bucket?.isModelLoading) store.getState().setModelLoading(sessionId, false);
    if (data.text) textBuffer.push(data.text);
  });

  client.on(SSE_EVENTS.REASONING_DELTA, (data) => {
    cancelPendingStepFinish();
    if (data.text) reasoningBuffer.push(data.text);
  });

  client.on(SSE_EVENTS.TOOL_START, (data) => {
    cancelPendingStepFinish();
    if (data.tool && data.call_id) {
      store.getState().addToolStart(
        sessionId,
        data.tool,
        data.call_id,
        data.arguments ?? {},
        data.title,
      );

      if (data.tool === "artifact" && data.arguments) {
        const args = data.arguments as Record<string, string>;
        const command = args.command || "create";
        if (command === "create" && args.type && args.title && args.content) {
          useArtifactStore.getState().openArtifact({
            id: data.call_id,
            type: args.type as ArtifactType,
            title: args.title,
            content: args.content,
            language: args.language,
            identifier: args.identifier,
          });
        }
      }
    }
  });

  client.on(SSE_EVENTS.TOOL_RESULT, (data) => {
    cancelPendingStepFinish();
    if (!data.call_id) return;
    store.getState().setToolResult(
      sessionId,
      data.call_id,
      data.output ?? "",
      data.title,
      data.metadata,
    );

    if (data.tool === "todo" && data.metadata) {
      const meta = data.metadata as { todos?: Array<{ content: string; status: string; activeForm?: string }> };
      if (meta.todos) {
        useWorkspaceStore.getState().setTodos(meta.todos as WorkspaceTodo[]);
        const ws = useWorkspaceStore.getState();
        if (!ws.isOpen) ws.open();
        ws.expandSection("progress");
      }
    }

    const generatedFiles = filesFromToolMetadata(data.metadata, data.tool);
    if (generatedFiles.length > 0) {
      store.getState().addFileParts(sessionId, generatedFiles);
      openGeneratedFileArtifacts(data.call_id, generatedFiles);
    }

    // Codata data results (SQL / indicator / chart) render inline as a data
    // card in the message thread (see DataResultCard). We deliberately do NOT
    // auto-open the right panel — the user promotes a card with its ↗ button.

    if (data.tool && FILE_RESULT_TOOLS.has(data.tool)) {
      refreshWorkspaceFiles();
    }

    if (data.tool === "artifact" && data.metadata) {
      const meta = data.metadata as Record<string, string>;
      if (
        (meta.command === "update" || meta.command === "rewrite") &&
        meta.content &&
        meta.identifier
      ) {
        useArtifactStore.getState().openArtifact({
          id: data.call_id,
          type: (meta.type || "code") as ArtifactType,
          title: meta.title || "Untitled",
          content: meta.content,
          language: meta.language,
          identifier: meta.identifier,
        });
      }
    }

    // build_report returns the rendered HTML report as an artifact via metadata
    // (structured-data-in, HTML-out) — open it in the preview panel.
    if (data.tool === "build_report" && data.metadata) {
      const meta = data.metadata as Record<string, string>;
      if (meta.content && meta.identifier) {
        useArtifactStore.getState().openArtifact({
          id: data.call_id,
          type: (meta.type || "html") as ArtifactType,
          title: meta.title || "数据分析报告",
          content: meta.content,
          identifier: meta.identifier,
          filePath: meta.file_path || undefined,
        });
      }
    }
  });

  client.on(SSE_EVENTS.TOOL_METADATA, (data) => {
    cancelPendingStepFinish();
    if (!data.call_id) return;
    const status = typeof data.metadata?.status === "string" ? data.metadata.status : "";
    const stage = typeof data.metadata?.stage === "string" ? data.metadata.stage : "";
    const message = typeof data.metadata?.message === "string" ? data.metadata.message : "";
    const progress = typeof data.metadata?.progress === "number" ? `${Math.round(data.metadata.progress)}%` : "";
    const output =
      [stage, progress, message].filter(Boolean).join(" · ") ||
      (data.title ? String(data.title) : null);
    store.getState().updateToolProgress(sessionId, data.call_id, data.title, data.metadata, output);
    if (status === "running" || status === "queued") {
      const ws = useWorkspaceStore.getState();
      if (ws.workspaceFiles.length > 0) ws.setWorkspaceFiles([...ws.workspaceFiles]);
    }
  });

  client.on(SSE_EVENTS.TOOL_ERROR, (data) => {
    cancelPendingStepFinish();
    if (data.call_id) {
      store.getState().setToolError(
        sessionId,
        data.call_id,
        data.output ?? data.error_message ?? "Error",
        data.title,
        data.metadata,
      );
      const generatedFiles = filesFromToolMetadata(data.metadata, data.tool);
      if (generatedFiles.length > 0) {
        store.getState().addFileParts(sessionId, generatedFiles);
        openGeneratedFileArtifacts(data.call_id, generatedFiles);
      }
      if (data.tool && FILE_RESULT_TOOLS.has(data.tool)) {
        refreshWorkspaceFiles();
      }
    }
  });

  client.on(SSE_EVENTS.STEP_START, (data) => {
    cancelPendingStepFinish();
    store.getState().addStepStart(sessionId, data.step ?? 0, data.snapshot ?? null);
  });

  client.on(SSE_EVENTS.STEP_FINISH, (data, id) => {
    store.getState().addStepFinish(
      sessionId,
      data.reason ?? "stop",
      data.tokens ?? {},
      data.cost ?? 0,
      data.total_cost ?? null,
      id ?? null,
      data.snapshot ?? null,
    );

    const terminalReasons = new Set(["stop", "length", "error", "aborted", "done"]);
    const isTerminalStep = terminalReasons.has(data.reason ?? "");
    if (!isTerminalStep) {
      cancelPendingStepFinish();
      return;
    }
    cancelPendingStepFinish();
    instance.stepFinishTimer = setTimeout(async () => {
      instance.stepFinishTimer = null;
      if (!store.getState().sessions[sessionId]?.isGenerating) return;

      const finished = await finishFromDatabase(sessionId);
      if (finished) {
        stopStream(sessionId);
        return;
      }

      instance.stepFinishTimer = setTimeout(async () => {
        instance.stepFinishTimer = null;
        if (!store.getState().sessions[sessionId]?.isGenerating) return;
        console.warn("SSE safety net: forcing finishGeneration after step_finish timeout");
        try {
          const finishedAfterWait = await finishFromDatabase(sessionId);
          if (finishedAfterWait) {
            stopStream(sessionId);
            return;
          }
        } finally {
          store.getState().finishGeneration(sessionId);
        }
        stopStream(sessionId);
      }, 8_000);
    }, 1_200);
  });

  client.on(SSE_EVENTS.COMPACTION_START, (data) => {
    store.getState().startCompaction(sessionId, data.phases ?? ["prune", "summarize"]);
  });
  client.on(SSE_EVENTS.COMPACTION_PHASE, (data) => {
    if (data.phase && data.status) {
      store.getState().updateCompactionPhase(sessionId, data.phase, data.status);
    }
  });
  client.on(SSE_EVENTS.COMPACTION_PROGRESS, (data) => {
    if (data.phase && data.chars != null) {
      store.getState().updateCompactionProgress(sessionId, data.phase, data.chars);
    }
  });
  client.on(SSE_EVENTS.COMPACTED, (data) => {
    store.getState().addCompaction(sessionId, true);
    if (data.summary_created) toast.success("Context compacted");
  });

  client.on(SSE_EVENTS.PERMISSION_REQUEST, (data) => {
    if (!data.call_id) return;
    const workMode = useSettingsStore.getState().workMode;
    if (workMode === "auto") {
      api.post(API.CHAT.RESPOND, {
        stream_id: streamId,
        call_id: data.call_id,
        response: true,
      }).catch((e) => console.warn("[stream-registry] Failed to auto-approve permission:", e));
      return;
    }
    store.getState().setPermissionRequest(sessionId, {
      callId: data.call_id,
      toolCallId: data.tool_call_id,
      tool: data.tool ?? data.permission ?? "",
      permission: data.permission ?? "",
      patterns: data.patterns ?? [],
      arguments: data.arguments ?? {},
      message: data.message,
      argumentsTruncated: data.arguments_truncated ?? false,
    });
  });

  client.on(SSE_EVENTS.QUESTION, (data) => {
    if (!data.call_id) return;
    store.getState().setQuestion(sessionId, {
      callId: data.call_id,
      tool: data.tool ?? "question",
      arguments: data.arguments ?? { question: data.question, options: data.options, questions: data.questions },
    });
  });

  client.on(SSE_EVENTS.PERMISSION_RESOLVED, (data) => {
    const pending = store.getState().sessions[sessionId]?.pendingPermission;
    if (pending && data.call_id === pending.callId) {
      store.getState().clearPermissionRequest(sessionId);
    }
  });

  client.on(SSE_EVENTS.QUESTION_RESOLVED, (data) => {
    const pending = store.getState().sessions[sessionId]?.pendingQuestion;
    if (pending && data.call_id === pending.callId) {
      store.getState().clearQuestion(sessionId);
    }
  });

  client.on(SSE_EVENTS.PLAN_REVIEW, (data) => {
    if (!data.call_id) return;
    const reviewData = {
      callId: data.call_id,
      title: data.title ?? "Plan",
      plan: data.plan ?? "",
      filesToModify: data.files_to_modify ?? [],
    };
    store.getState().setPlanReview(sessionId, reviewData);
    try {
      const { usePlanReviewStore } = require("@/stores/plan-review-store");
      usePlanReviewStore.getState().openReview(reviewData);
    } catch {
      // Store may not be available during SSR.
    }
  });

  client.on(SSE_EVENTS.TITLE_UPDATE, (data) => {
    if (!data.title) return;
    const qc = queryClientRef;
    if (!qc) return;
    qc.setQueryData<InfiniteData<SessionResponse[]>>(
      queryKeys.sessions.all,
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((s) => (s.id === sessionId ? { ...s, title: data.title! } : s)),
          ),
        };
      },
    );
    qc.setQueryData<SessionResponse>(
      queryKeys.sessions.detail(sessionId),
      (old) => (old ? { ...old, title: data.title! } : old),
    );
  });

  client.on("heartbeat", () => {
    // No-op.
  });

  client.on(SSE_EVENTS.DESYNC, () => {
    const qc = queryClientRef;
    if (qc) qc.invalidateQueries({ queryKey: queryKeys.messages.list(sessionId) });
  });

  client.on(SSE_EVENTS.COMPACTION_ERROR, (data) => {
    toast.warning(data.error_message || "Context compression failed. Consider starting a new chat.");
  });

  client.on(SSE_EVENTS.DONE, async () => {
    cancelPendingStepFinish();
    textBuffer.flush();
    reasoningBuffer.flush();
    try {
      await finishFromDatabase(sessionId);
    } finally {
      store.getState().finishGeneration(sessionId);
    }
    const qc = queryClientRef;
    if (qc) {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.messages.list(sessionId) });
      }, 500);
      qc.invalidateQueries({ queryKey: queryKeys.sessions.all });
      qc.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
    }
    maybeNotifyFinish(sessionId, "done");
    stopStream(sessionId);
  });

  const handleAgentError = async (data: { error_message?: string | null }) => {
    const message = data.error_message ?? "Unknown stream error";
    const contextLimitError = /maximum context length|requested about/i.test(message);
    if (contextLimitError) {
      toast.error("Context too long for this model. Start a new chat or shorten the conversation.");
    } else {
      toast.error(message);
    }
    console.warn("SSE agent error:", message);
    textBuffer.flush();
    reasoningBuffer.flush();
    try {
      await finishFromDatabase(sessionId);
    } finally {
      store.getState().finishGeneration(sessionId);
    }
    const qc = queryClientRef;
    if (qc) {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.messages.list(sessionId) });
      }, 500);
      qc.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
    }
    maybeNotifyFinish(sessionId, "error", message);
    stopStream(sessionId);
  };
  client.on(SSE_EVENTS.AGENT_ERROR, handleAgentError);
  client.on(SSE_EVENTS.ERROR, handleAgentError);

  client.connect();

  const IDLE_RECOVERY_MS = 15_000;
  const IDLE_CHECK_INTERVAL_MS = 5_000;
  instance.idleCheckTimer = setInterval(async () => {
    if (!store.getState().sessions[sessionId]?.isGenerating) {
      if (instance.idleCheckTimer) {
        clearInterval(instance.idleCheckTimer);
        instance.idleCheckTimer = null;
      }
      return;
    }
    if (instance.lastEventTimestamp > 0 && Date.now() - instance.lastEventTimestamp > IDLE_RECOVERY_MS) {
      console.warn(`SSE idle recovery for ${sessionId}: no events for 15s, attempting DB recovery`);
      const finished = await finishFromDatabase(sessionId);
      if (finished) {
        stopStream(sessionId);
        return;
      }
      instance.lastEventTimestamp = Date.now();
      client.checkHealth();
    }
  }, IDLE_CHECK_INTERVAL_MS);

  instances.set(sessionId, instance);
}

function ensureGlobalListeners(): void {
  if (globalListenersInstalled) return;
  globalListenersInstalled = true;

  if (IS_DESKTOP) {
    unlistenBackendRestarting = desktopAPI.onBackendRestarting(() => {
      for (const inst of instances.values()) inst.client.pauseReconnect();
    });
    unlistenBackendRestarted = desktopAPI.onBackendRestart(() => {
      for (const inst of instances.values()) inst.client.resumeReconnect();
    });
  }

  const handleVisibilityChange = () => {
    for (const inst of instances.values()) {
      if (!storeIsGenerating(inst.sessionId)) continue;

      if (document.visibilityState === "visible") {
        if (inst.mobilePauseTimer) {
          clearTimeout(inst.mobilePauseTimer);
          inst.mobilePauseTimer = null;
        }
        inst.client.resumeReconnect();
        inst.client.checkHealth();
      } else if (isRemoteMode()) {
        inst.mobilePauseTimer = setTimeout(() => {
          inst.client.pauseReconnect();
          inst.mobilePauseTimer = null;
        }, 30_000);
      }
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  unlistenVisibilityChange = () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}

function storeIsGenerating(sessionId: string): boolean {
  return useChatStore.getState().sessions[sessionId]?.isGenerating ?? false;
}

function maybeNotifyFinish(sessionId: string, kind: "done" | "error", errorMessage?: string): void {
  const focusedSessionId = useChatStore.getState().focusedSessionId;
  if (focusedSessionId === sessionId && typeof document !== "undefined" && !document.hidden) {
    return;
  }
  const qc = queryClientRef;
  const session = qc?.getQueryData<SessionResponse>(queryKeys.sessions.detail(sessionId));
  const sessionTitle = session?.title?.trim() || "Background task";
  const title = kind === "done"
    ? `${sessionTitle} finished`
    : `${sessionTitle} stopped`;
  const body = kind === "done"
    ? "Click to open the conversation."
    : (errorMessage ?? "Click to open the conversation.");
  void notifyBackgroundFinish({ sessionId, title, body, kind });
}

export function disposeAllStreams(): void {
  for (const inst of instances.values()) disposeInstance(inst);
  instances.clear();
  unlistenBackendRestarting?.();
  unlistenBackendRestarted?.();
  unlistenVisibilityChange?.();
  unlistenBackendRestarting = null;
  unlistenBackendRestarted = null;
  unlistenVisibilityChange = null;
  globalListenersInstalled = false;
}

export type _SSEStatus = SSEConnectionStatus;
