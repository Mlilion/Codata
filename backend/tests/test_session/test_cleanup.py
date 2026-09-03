"""Tests for generation cleanup helpers."""

from __future__ import annotations

from sqlalchemy import select

import pytest

from app.models.message import Message
from app.session.manager import create_message, create_part, create_session
from app.session.processor import _delete_empty_assistant_messages

pytestmark = pytest.mark.asyncio


async def test_delete_empty_assistant_messages_removes_step_only_shells(session_factory):
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, title="cleanup")
            keep = await create_message(db, session_id=session.id, data={"role": "assistant"})
            await create_part(
                db,
                message_id=keep.id,
                session_id=session.id,
                data={"type": "text", "text": "done"},
            )
            drop = await create_message(db, session_id=session.id, data={"role": "assistant"})
            await create_part(
                db,
                message_id=drop.id,
                session_id=session.id,
                data={"type": "step-start", "step": 3},
            )
            sid = session.id
            keep_id = keep.id
            drop_id = drop.id

    await _delete_empty_assistant_messages(session_factory, sid)

    async with session_factory() as db:
        rows = (
            await db.execute(
                select(Message.id)
                .where(Message.session_id == sid)
                .order_by(Message.time_created)
            )
        ).scalars().all()

    assert keep_id in rows
    assert drop_id not in rows
