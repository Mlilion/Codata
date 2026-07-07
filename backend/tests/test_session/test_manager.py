"""Session manager tests (DB operations)."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.session.manager import (
    create_message,
    create_part,
    create_session,
    get_message_history_for_llm,
    get_messages,
    get_session,
    list_sessions,
    update_session_title,
)


class TestSessionManager:
    @pytest.mark.asyncio
    async def test_create_session(self, db: AsyncSession):
        session = await create_session(db, title="Test Session")
        assert session.id is not None
        assert session.title == "Test Session"

    @pytest.mark.asyncio
    async def test_get_session(self, db: AsyncSession):
        session = await create_session(db, title="Find Me")
        found = await get_session(db, session.id)
        assert found is not None
        assert found.title == "Find Me"

    @pytest.mark.asyncio
    async def test_get_nonexistent_session(self, db: AsyncSession):
        found = await get_session(db, "nonexistent-id")
        assert found is None

    @pytest.mark.asyncio
    async def test_list_sessions(self, db: AsyncSession):
        await create_session(db, title="S1")
        await create_session(db, title="S2")
        sessions = await list_sessions(db)
        assert len(sessions) >= 2

    @pytest.mark.asyncio
    async def test_list_sessions_app_mode_filter(self, db: AsyncSession):
        legacy = await create_session(db, title="legacy")  # app_mode NULL
        chat = await create_session(db, title="chat", app_mode=None)
        codata = await create_session(db, title="codata", app_mode="codata")

        codata_only = await list_sessions(db, app_mode="codata")
        ids = {s.id for s in codata_only}
        assert codata.id in ids
        assert legacy.id not in ids and chat.id not in ids

        chat_only = await list_sessions(db, app_mode="chat")
        ids = {s.id for s in chat_only}
        # Legacy (null) counts as chat; codata excluded.
        assert legacy.id in ids
        assert codata.id not in ids

        # No filter → everything.
        every = await list_sessions(db)
        ids = {s.id for s in every}
        assert {legacy.id, codata.id} <= ids

    @pytest.mark.asyncio
    async def test_backfill_expert_session_mode(self, session_factory):
        from app.main import _backfill_expert_session_mode

        async with session_factory() as db:
            async with db.begin():
                legacy_expert = await create_session(
                    db, title="expert legacy", slug="expert-team:data-analysis-report"
                )  # app_mode NULL
                plain_chat = await create_session(db, title="chat", slug="")
                already = await create_session(
                    db, title="expert tagged", slug="expert-team:funnel-conversion", app_mode="codata"
                )
            legacy_id, chat_id, already_id = legacy_expert.id, plain_chat.id, already.id

        await _backfill_expert_session_mode(session_factory)

        async with session_factory() as db:
            # Legacy expert-team session now tagged codata (leaves chat history).
            assert (await get_session(db, legacy_id)).app_mode == "codata"
            # Plain chat session untouched.
            assert (await get_session(db, chat_id)).app_mode is None
            # Already-tagged session unchanged.
            assert (await get_session(db, already_id)).app_mode == "codata"

    @pytest.mark.asyncio
    async def test_update_title(self, db: AsyncSession):
        session = await create_session(db, title="Old")
        await update_session_title(db, session.id, "New")
        updated = await get_session(db, session.id)
        assert updated.title == "New"


class TestMessageManager:
    @pytest.mark.asyncio
    async def test_create_message_and_part(self, db: AsyncSession):
        session = await create_session(db, title="Msg Test")
        msg = await create_message(db, session_id=session.id, data={"role": "user"})
        assert msg.id is not None

        part = await create_part(
            db, message_id=msg.id, session_id=session.id,
            data={"type": "text", "text": "hello"},
        )
        assert part.id is not None

    @pytest.mark.asyncio
    async def test_get_messages_with_parts(self, db: AsyncSession):
        session = await create_session(db, title="Parts Test")

        msg = await create_message(db, session_id=session.id, data={"role": "user"})
        await create_part(
            db, message_id=msg.id, session_id=session.id,
            data={"type": "text", "text": "hello"},
        )
        await create_part(
            db, message_id=msg.id, session_id=session.id,
            data={"type": "text", "text": "world"},
        )

        messages = await get_messages(db, session.id)
        assert len(messages) == 1
        assert len(messages[0].parts) == 2

    @pytest.mark.asyncio
    async def test_message_history_for_llm(self, db: AsyncSession):
        session = await create_session(db, title="LLM History")

        # User message
        user_msg = await create_message(db, session_id=session.id, data={"role": "user"})
        await create_part(
            db, message_id=user_msg.id, session_id=session.id,
            data={"type": "text", "text": "What is 2+2?"},
        )

        # Assistant message
        asst_msg = await create_message(db, session_id=session.id, data={"role": "assistant"})
        await create_part(
            db, message_id=asst_msg.id, session_id=session.id,
            data={"type": "text", "text": "4"},
        )

        history = await get_message_history_for_llm(db, session.id)
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[0]["content"] == "What is 2+2?"
        assert history[1]["role"] == "assistant"
        assert history[1]["content"] == "4"

    @pytest.mark.asyncio
    async def test_history_with_tool_calls(self, db: AsyncSession):
        session = await create_session(db, title="Tool History")

        # User message
        user_msg = await create_message(db, session_id=session.id, data={"role": "user"})
        await create_part(
            db, message_id=user_msg.id, session_id=session.id,
            data={"type": "text", "text": "Read test.py"},
        )

        # Assistant with tool call
        asst_msg = await create_message(db, session_id=session.id, data={"role": "assistant"})
        await create_part(
            db, message_id=asst_msg.id, session_id=session.id,
            data={"type": "text", "text": "Let me read that file."},
        )
        await create_part(
            db, message_id=asst_msg.id, session_id=session.id,
            data={
                "type": "tool", "tool": "read", "call_id": "call_1",
                "state": {
                    "status": "completed",
                    "input": {"file_path": "test.py"},
                    "output": "print('hello')",
                },
            },
        )

        history = await get_message_history_for_llm(db, session.id)
        # Should be: user, assistant (with tool_calls), tool result
        assert len(history) == 3
        assert history[0]["role"] == "user"
        assert history[1]["role"] == "assistant"
        assert "tool_calls" in history[1]
        assert history[2]["role"] == "tool"
        assert history[2]["content"] == "print('hello')"
