"""Question tool — ask the user a question and wait for response.

Actually blocks until the user responds via POST /api/chat/respond,
matching OpenCode's behavior. Degrades gracefully in headless/test mode.

Supports two modes:
- Legacy: single ``question`` + ``options`` (strings).
- Multi-question: ``questions`` array with tabs, radio/checkbox, preview.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)


class QuestionTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "question"

    @property
    def description(self) -> str:
        return (
            "Ask the user a question and wait for their response. "
            "Use this when you need clarification or user input to proceed. "
            "Supports single-question mode (question + options) or "
            "multi-question mode (questions array with tabs, radio/checkbox, and preview)."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                # Legacy single-question mode
                "question": {
                    "type": "string",
                    "description": "The question to ask the user (single-question mode)",
                },
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of choices for single-question mode",
                },
                # Multi-question mode
                "questions": {
                    "type": "array",
                    "description": "Array of 1-4 questions (multi-question mode with tab UI)",
                    "minItems": 1,
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The question text",
                            },
                            "header": {
                                "type": "string",
                                "description": "Tab label (max 12 chars)",
                                "maxLength": 12,
                            },
                            "options": {
                                "type": "array",
                                "description": "2-4 selectable options",
                                "minItems": 2,
                                "maxItems": 4,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {
                                            "type": "string",
                                            "description": "Display text for this option",
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "Explanation of what this option means",
                                        },
                                        "preview": {
                                            "type": "string",
                                            "description": "Optional preview content (markdown) shown in side panel",
                                        },
                                    },
                                    "required": ["label"],
                                },
                            },
                            "multiSelect": {
                                "type": "boolean",
                                "description": "true = checkboxes (multiple answers), false = radio (single answer)",
                                "default": False,
                            },
                        },
                        "required": ["question", "header"],
                    },
                },
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        questions = args.get("questions")
        is_multi = isinstance(questions, list) and len(questions) > 0

        # Legacy fields
        question = args.get("question", "")
        options = args.get("options", [])

        # Access the GenerationJob for wait_for_response
        job = getattr(ctx, "_job", None)

        # Publish question event to SSE stream
        if ctx._publish_fn:
            payload: dict[str, Any] = {
                "call_id": ctx.call_id,
                "session_id": ctx.session_id,
            }
            if is_multi:
                payload["questions"] = questions
            else:
                payload["question"] = question
                payload["options"] = options
            ctx._publish_fn("question", payload)

        # If no job context or not interactive — degrade gracefully
        summary = (
            f"[Multi-question] {len(questions)} questions"
            if is_multi
            else f"Question asked: {question}"
        )
        if job is None or not job.interactive:
            return ToolResult(
                output=f"[No user connected] {summary}",
                title="Question (no listener)",
                metadata={"questions": questions} if is_multi else {"question": question, "options": options},
            )

        # Block until user responds via POST /api/chat/respond
        try:
            response = await job.wait_for_response(ctx.call_id, timeout=300.0)

            if is_multi:
                # Multi-question response is JSON: Record<str, str>
                try:
                    answers = json.loads(str(response))
                    formatted = "\n".join(
                        f"Q: {q}\nA: {a}" for q, a in answers.items()
                    )
                except (json.JSONDecodeError, AttributeError):
                    answers = response
                    formatted = str(response)
                return ToolResult(
                    output=formatted,
                    title=f"User answered {len(answers) if isinstance(answers, dict) else 1} questions",
                    metadata={"questions": questions, "answers": answers},
                )
            else:
                return ToolResult(
                    output=str(response),
                    title=f"User answered: {str(response)[:100]}",
                    metadata={"question": question, "answer": response},
                )
        except TimeoutError:
            return ToolResult(
                output="(user did not respond within 5 minutes)",
                error="Question timed out — no response from user",
            )
