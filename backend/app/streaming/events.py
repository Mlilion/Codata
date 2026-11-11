"""SSE event types and encoding."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SSEEvent:
    """A single Server-Sent Event."""

    event: str  # event type name
    data: dict[str, Any] = field(default_factory=dict)
    id: int | None = None  # monotonic event ID for replay
    published_perf_ns: int | None = None

    def encode(self) -> str:
        """Encode as SSE wire format."""
        lines = []
        if self.id is not None:
            lines.append(f"id: {self.id}")
        lines.append(f"event: {self.event}")
        if self.published_perf_ns is not None:
            encoding_started = time.perf_counter_ns()
            encoded = json.dumps({k:v for k,v in self.data.items() if k != '_delivery'}, default=str)
            encoding_ms = (time.perf_counter_ns() - encoding_started) / 1_000_000
            # Ready-to-send, before ASGI/TCP. Do not label it as a wire timestamp.
            delivery = {'sent_epoch_ms': time.time() * 1000, 'encode_ms': encoding_ms,
                        'server_queue_ms': max(0, (encoding_started - self.published_perf_ns) / 1_000_000)}
            encoded = encoded[:-1] + ', "_delivery": ' + json.dumps(delivery) + '}' if encoded != '{}' else '{"_delivery": ' + json.dumps(delivery) + '}'
        else:
            encoded = json.dumps(self.data, default=str)
        lines.append(f"data: {encoded}")
        lines.append("")  # trailing newline
        return "\n".join(lines) + "\n"


# Event type constants — hyphen style, mirrors OpenCode's event names
TEXT_DELTA = "text-delta"
REASONING_DELTA = "reasoning-delta"
TOOL_START = "tool-call"        # renamed: was tool_start, matches OpenCode's "tool-call"
TOOL_RESULT = "tool-result"
TOOL_ERROR = "tool-error"
NEEDS_INTERACTIVE_AUTH = "needs-interactive-auth"
STEP_START = "step-start"
STEP_FINISH = "step-finish"
COMPACTED = "compacted"
COMPACTION_START = "compaction-start"
COMPACTION_PHASE = "compaction-phase"
COMPACTION_PROGRESS = "compaction-progress"
COMPACTION_ERROR = "compaction-error"
PERMISSION_REQUEST = "permission-request"
QUESTION = "question"
TITLE_UPDATE = "title-update"
RETRY = "retry"
DESYNC = "desync"
DONE = "done"
AGENT_ERROR = "agent-error"
PLAN_REVIEW = "plan-review"
MODEL_LOADING = "model-loading"
PERMISSION_RESOLVED = "permission-resolved"
QUESTION_RESOLVED = "question-resolved"
