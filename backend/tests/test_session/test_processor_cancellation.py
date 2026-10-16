"""Cancellation persistence tests for the session processor."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.schemas.chat import PromptRequest
from app.session.manager import create_message, create_session, get_messages
from app.session.processor import SessionProcessor
from app.streaming.events import STEP_FINISH
from app.streaming.manager import GenerationJob


class _Chunk:
    def __init__(self, chunk_type: str, data: dict):
        self.type = chunk_type
        self.data = data


class _Provider:
    id = "test-provider"


class _Agent:
    name = "build"


class _ToolRegistry:
    def get(self, _name: str):
        return None


@pytest.mark.asyncio
async def test_processor_persists_partial_text_and_aborted_finish_when_cancelled(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, id="session-cancel")
            assistant = await create_message(
                db,
                session_id=session.id,
                data={
                    "role": "assistant",
                    "agent": "build",
                    "model_id": "test-model",
                    "provider_id": "test-provider",
                },
            )

    async def fake_stream_llm(*_args, **_kwargs):
        yield _Chunk("text-delta", {"text": "partial answer"})
        raise asyncio.CancelledError()

    monkeypatch.setattr("app.session.processor.stream_llm", fake_stream_llm)

    job = GenerationJob(stream_id="stream-cancel", session_id="session-cancel")
    prompt = SimpleNamespace(
        job=job,
        step=1,
        session_factory=session_factory,
        provider=_Provider(),
        model_id="test-model",
        model_info=None,
        system_prompt="",
        agent=_Agent(),
        tool_registry=_ToolRegistry(),
        discovered_tools=[],
        request=PromptRequest(session_id="session-cancel", text="hello", model="test-model"),
        merged_permissions=[],
        workspace=None,
        index_manager=None,
        provider_registry=None,
        agent_registry=None,
        expert_team_registry=None,
        expert_role_registry=None,
        skill_registry=None,
        current_todos=[],
        total_cost=0.0,
    )

    processor = SessionProcessor(
        prompt,
        [{"role": "user", "content": "hello"}],
        assistant.id,
    )

    with pytest.raises(asyncio.CancelledError):
        await processor.process()

    async with session_factory() as db:
        messages = await get_messages(db, "session-cancel")

    stored_assistant = next(msg for msg in messages if msg.id == assistant.id)
    text_parts = [part for part in stored_assistant.parts if part.data.get("type") == "text"]
    finish_parts = [
        part for part in stored_assistant.parts if part.data.get("type") == "step-finish"
    ]

    assert [part.data.get("text") for part in text_parts] == ["partial answer"]
    assert finish_parts[-1].data.get("reason") == "aborted"
    assert any(
        event.event == STEP_FINISH
        and event.data.get("message_id") == assistant.id
        and event.data.get("reason") == "aborted"
        for event in job.events
    )
