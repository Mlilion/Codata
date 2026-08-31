import { hasCodataResult } from "@/lib/codata-artifact";
import type { MessageResponse, PartData, ToolPart } from "@/types/message";

const USER_VISIBLE_TOOLS = new Set(["artifact", "present_file", "submit_plan"]);
const GENERATED_FILE_TOOLS = new Set(["write", "edit", "code_execute"]);
const USER_FACING_FILE_EXTENSIONS = new Set([
  ".csv",
  ".docx",
  ".gif",
  ".html",
  ".htm",
  ".jpeg",
  ".jpg",
  ".md",
  ".mdx",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".svg",
  ".tsv",
  ".txt",
  ".xls",
  ".xlsx",
  ".mov",
  ".mp4",
  ".webm",
  ".webp",
]);
const NON_USER_FACING_FILE_HINTS = ["helper", "scratch", "temp", "tmp", "script"];

interface HandoffOptions {
  currentAssistantMessageIds: Set<string>;
  currentToolCallIds: Set<string>;
}

function fileExtension(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = filePath.slice(lastSlash + 1);
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function isUserFacingGeneratedFile(filePath: string): boolean {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = filePath.slice(lastSlash + 1).toLowerCase();
  if (!USER_FACING_FILE_EXTENSIONS.has(fileExtension(filePath))) return false;
  return !NON_USER_FACING_FILE_HINTS.some((hint) => fileName.includes(hint));
}

function toolHasVisibleOutput(part: ToolPart): boolean {
  if (part.state.status === "running" || part.state.status === "pending") return false;
  if (USER_VISIBLE_TOOLS.has(part.tool)) return true;
  if (hasCodataResult(part.state.metadata)) return true;

  const metadata = (part.state.metadata ?? {}) as Record<string, unknown>;
  if (GENERATED_FILE_TOOLS.has(part.tool)) {
    if (typeof metadata.file_path === "string" && isUserFacingGeneratedFile(metadata.file_path)) {
      return true;
    }
    if (Array.isArray(metadata.written_files)) {
      return metadata.written_files.some(
        (filePath) => typeof filePath === "string" && isUserFacingGeneratedFile(filePath),
      );
    }
  }

  return false;
}

function partHasVisibleOutput(part: PartData): boolean {
  switch (part.type) {
    case "text":
      return part.text.trim().length > 0;
    case "file":
    case "compaction":
    case "subtask":
      return true;
    case "tool":
      return toolHasVisibleOutput(part);
    default:
      return false;
  }
}

function isCurrentAssistantMessage(message: MessageResponse, options: HandoffOptions): boolean {
  if (message.data.role !== "assistant" || message.data.hidden) return false;

  if (options.currentAssistantMessageIds.size > 0) {
    return options.currentAssistantMessageIds.has(message.id);
  }

  if (options.currentToolCallIds.size > 0) {
    return message.parts.some((part) => {
      if (part.data.type !== "tool") return false;
      return options.currentToolCallIds.has(part.data.call_id);
    });
  }

  return false;
}

export function canFinalizeMessageHandoff(
  message: MessageResponse | undefined,
  options: HandoffOptions,
): boolean {
  if (!message || !isCurrentAssistantMessage(message, options)) return false;

  const hasCurrentTool = message.parts.some((part) => {
    if (part.data.type !== "tool") return false;
    return options.currentToolCallIds.has(part.data.call_id);
  });
  if (options.currentToolCallIds.size > 0 && !hasCurrentTool) return false;

  const hasRunningTool = message.parts.some((part) => {
    if (part.data.type !== "tool") return false;
    if (
      options.currentToolCallIds.size > 0 &&
      !options.currentToolCallIds.has(part.data.call_id)
    ) {
      return false;
    }
    return part.data.state.status === "running" || part.data.state.status === "pending";
  });
  if (hasRunningTool) return false;

  const hasTerminalFinish = message.parts.some((part) => {
    if (part.data.type !== "step-finish") return false;
    return part.data.reason !== "tool_use";
  });
  if (!hasTerminalFinish) return false;

  return message.parts.some((part) => partHasVisibleOutput(part.data));
}

export function canFinalizeMessagesHandoff(
  messages: MessageResponse[] | undefined,
  options: HandoffOptions,
): boolean {
  const currentMessages = (messages ?? []).filter((message) =>
    isCurrentAssistantMessage(message, options),
  );
  if (currentMessages.length === 0) return false;

  const hasCurrentTool = currentMessages.some((message) =>
    message.parts.some((part) => {
      if (part.data.type !== "tool") return false;
      return options.currentToolCallIds.has(part.data.call_id);
    }),
  );
  if (options.currentToolCallIds.size > 0 && !hasCurrentTool) return false;

  const hasRunningTool = currentMessages.some((message) =>
    message.parts.some((part) => {
      if (part.data.type !== "tool") return false;
      if (
        options.currentToolCallIds.size > 0 &&
        !options.currentToolCallIds.has(part.data.call_id)
      ) {
        return false;
      }
      return part.data.state.status === "running" || part.data.state.status === "pending";
    }),
  );
  if (hasRunningTool) return false;

  const hasTerminalFinish = currentMessages.some((message) =>
    message.parts.some((part) => {
      if (part.data.type !== "step-finish") return false;
      return part.data.reason !== "tool_use";
    }),
  );
  if (!hasTerminalFinish) return false;

  return currentMessages.some((message) =>
    message.parts.some((part) => partHasVisibleOutput(part.data)),
  );
}
