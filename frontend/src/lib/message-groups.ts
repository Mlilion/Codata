import type { MessageResponse, PartData } from "@/types/message";

export type MessageGroup =
  | { kind: "user"; message: MessageResponse }
  | { kind: "assistant"; messages: MessageResponse[] };

function hasRenderableAssistantContent(msg: MessageResponse): boolean {
  return msg.parts.some(({ data }) => {
    switch (data.type) {
      case "text":
      case "reasoning":
        return data.text.trim().length > 0;
      case "tool":
      case "file":
      case "subtask":
      case "compaction":
        return true;
      case "step-start":
      case "step-finish":
        return data.snapshot?.mode === "expert-team";
      default:
        return false;
    }
  });
}

function isStandaloneAssistantMessage(msg: MessageResponse): boolean {
  const data = msg.data;
  return data.role === "assistant" && !data.hidden && (
    data.summary === true ||
    data.system === true ||
    msg.parts.some((part) => part.data.type === "compaction")
  );
}

export function groupMessages(messages: MessageResponse[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let assistantBatch: MessageResponse[] = [];

  const flushBatch = () => {
    if (assistantBatch.length > 0) {
      groups.push({ kind: "assistant", messages: assistantBatch });
      assistantBatch = [];
    }
  };

  for (const msg of messages) {
    if (msg.data.role === "assistant") {
      if (msg.data.hidden) continue;
      if (!hasRenderableAssistantContent(msg)) continue;
      if (isStandaloneAssistantMessage(msg)) {
        flushBatch();
        groups.push({ kind: "assistant", messages: [msg] });
        continue;
      }
      assistantBatch.push(msg);
      continue;
    }

    if (msg.data.role === "user" && msg.data.system) {
      continue;
    }

    flushBatch();
    groups.push({ kind: "user", message: msg });
  }

  flushBatch();
  return groups;
}

export function visibleAssistantGroupIndex(groups: MessageGroup[], group: MessageGroup): number | null {
  if (group.kind !== "assistant") return null;
  const index = groups.indexOf(group);
  return index >= 0 ? index : null;
}

export function hasVisibleMessageParts(parts: PartData[]): boolean {
  return parts.some((part) => {
    switch (part.type) {
      case "text":
        return part.text.trim().length > 0;
      case "reasoning":
      case "tool":
      case "file":
      case "subtask":
      case "compaction":
        return true;
      case "step-start":
      case "step-finish":
        return part.snapshot?.mode === "expert-team";
      default:
        return false;
    }
  });
}
