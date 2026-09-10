"""Stream integrity tests for partial provider responses."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.schemas.chat import PromptRequest
from app.session.manager import create_message, create_session, get_messages
from app.session.processor import SessionProcessor
from app.streaming.events import RETRY
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


def _prompt(session_factory, job):
    return SimpleNamespace(
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
        request=PromptRequest(session_id=job.session_id, text="hello", model="test-model"),
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


@pytest.mark.asyncio
async def test_processor_retries_provider_error_instead_of_persisting_partial_text(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, id="session-stream-error")
            assistant = await create_message(
                db,
                session_id=session.id,
                data={"role": "assistant", "agent": "build"},
            )

    attempts = 0

    async def fake_stream_llm(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield _Chunk("text-delta", {"text": "partial"})
            yield _Chunk("error", {"message": "connection reset"})
            return
        yield _Chunk("text-delta", {"text": "complete answer"})
        yield _Chunk("finish", {"reason": "stop"})

    monkeypatch.setattr("app.session.processor.stream_llm", fake_stream_llm)
    monkeypatch.setattr("app.session.processor.retry_delay", lambda *_args: 0)

    job = GenerationJob(stream_id="stream-error", session_id="session-stream-error")
    processor = SessionProcessor(_prompt(session_factory, job), [], assistant.id)

    assert await processor.process() == "stop"
    assert attempts == 2

    async with session_factory() as db:
        messages = await get_messages(db, "session-stream-error")

    stored = next(message for message in messages if message.id == assistant.id)
    texts = [
        part.data["text"]
        for part in stored.parts
        if part.data.get("type") == "text"
    ]
    assert texts == ["complete answer"]
    assert any(event.event == RETRY for event in job.events)


@pytest.mark.asyncio
async def test_processor_retries_stream_that_closes_without_finish_reason(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, id="session-stream-close")
            assistant = await create_message(
                db,
                session_id=session.id,
                data={"role": "assistant", "agent": "build"},
            )

    attempts = 0

    async def fake_stream_llm(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield _Chunk("text-delta", {"text": "partial"})
            return
        yield _Chunk("text-delta", {"text": "complete answer"})
        yield _Chunk("finish", {"reason": "stop"})

    monkeypatch.setattr("app.session.processor.stream_llm", fake_stream_llm)
    monkeypatch.setattr("app.session.processor.retry_delay", lambda *_args: 0)

    job = GenerationJob(stream_id="stream-close", session_id="session-stream-close")
    processor = SessionProcessor(_prompt(session_factory, job), [], assistant.id)

    assert await processor.process() == "stop"
    assert attempts == 2

    async with session_factory() as db:
        messages = await get_messages(db, "session-stream-close")

    stored = next(message for message in messages if message.id == assistant.id)
    texts = [
        part.data["text"]
        for part in stored.parts
        if part.data.get("type") == "text"
    ]
    assert texts == ["complete answer"]
