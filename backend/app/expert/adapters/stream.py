"""Stream event adapter for expert team runs."""

from __future__ import annotations

from app.streaming.events import SSEEvent, STEP_FINISH, STEP_START, TEXT_DELTA, TOOL_RESULT, TOOL_START
from app.streaming.manager import GenerationJob


class ExpertStreamAdapter:
    """Publish expert team activity through the existing WorkCraft stream."""

    def __init__(self, job: GenerationJob) -> None:
        self._job = job

    def step_start(
        self,
        step: int,
        *,
        title: str,
        message_id: str | None = None,
        snapshot: dict | None = None,
    ) -> None:
        payload = {
            "session_id": self._job.session_id,
            "step": step,
            "title": title,
            "snapshot": snapshot or {},
        }
        if message_id:
            payload["message_id"] = message_id
        self._job.publish(
            SSEEvent(
                STEP_START,
                payload,
            )
        )

    def text(self, message_id: str, text: str) -> None:
        self._job.publish(
            SSEEvent(
                TEXT_DELTA,
                {
                    "session_id": self._job.session_id,
                    "message_id": message_id,
                    "text": text,
                },
            )
        )

    def tool_start(self, tool: str, call_id: str, arguments: dict, title: str | None = None) -> None:
        self._job.publish(
            SSEEvent(
                TOOL_START,
                {
                    "session_id": self._job.session_id,
                    "tool": tool,
                    "call_id": call_id,
                    "arguments": arguments,
                    "title": title,
                },
            )
        )

    def tool_result(
        self,
        tool: str,
        call_id: str,
        output: str,
        *,
        title: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        self._job.publish(
            SSEEvent(
                TOOL_RESULT,
                {
                    "session_id": self._job.session_id,
                    "tool": tool,
                    "call_id": call_id,
                    "output": output,
                    "title": title,
                    "metadata": metadata or {},
                },
            )
        )

    def step_finish(
        self,
        *,
        reason: str,
        tokens: dict | None = None,
        cost: float = 0.0,
        message_id: str | None = None,
        snapshot: dict | None = None,
    ) -> None:
        payload = {
            "session_id": self._job.session_id,
            "reason": reason,
            "tokens": tokens or {},
            "cost": cost,
        }
        if message_id:
            payload["message_id"] = message_id
        if snapshot:
            payload["snapshot"] = snapshot
        self._job.publish(
            SSEEvent(
                STEP_FINISH,
                payload,
            )
        )
