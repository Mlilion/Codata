"""Regression tests for Layer-3 context collapse and compaction prune cutoff.

Bug context: the old implementation "persisted" context collapse by deleting
the oldest DB message rows — its kept-count was measured in LLM-format
entries while the delete-count was applied to DB rows, so it silently ate the
persisted answer of the current turn (the visible reply disappeared once the
frontend refetched from the database). Collapse is now pure in-memory, and
``_phase1_prune`` protects whole user turns instead of a fixed row count.
"""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import select

from app.models.message import Message, Part
from app.session.microcompact import CONTEXT_SUMMARY_PREFIX, context_collapse


# ---------------------------------------------------------------------------
# Helpers (LLM-format messages)
# ---------------------------------------------------------------------------

def _user(text: str) -> dict[str, Any]:
    return {"role": "user", "content": text}


def _assistant(text: str = "", tool_calls: list | None = None) -> dict[str, Any]:
    msg: dict[str, Any] = {"role": "assistant", "content": text}
    if tool_calls is not None:
        msg["tool_calls"] = tool_calls
    return msg


def _tool(call_id: str, text: str = "result") -> dict[str, Any]:
    return {"role": "tool", "tool_call_id": call_id, "content": text}


def _calls(*ids: str) -> list[dict[str, Any]]:
    return [{"id": i, "function": {"name": "read"}} for i in ids]


# ---------------------------------------------------------------------------
# Helpers (DB rows)
# ---------------------------------------------------------------------------

# ~50k estimated tokens (Latin text: estimate_tokens = len // 4) — exhausts
# the 40k PROTECTED_TOKEN_BUDGET of _phase1_prune on the first occurrence.
_BIG_A = "a" * 200_000
_BIG_B = "b" * 200_000
_BIG_C = "c" * 200_000
_SMALL = "y" * 400


def _tool_part(output: str, call_id: str) -> dict[str, Any]:
    return {
        "type": "tool",
        "tool": "read",
        "call_id": call_id,
        "state": {"status": "completed", "input": {}, "output": output},
    }


async def _seed(
    db, session_id: str, rows: list[tuple[dict, list[dict]]], base: datetime
) -> list[str]:
    """Insert messages (with parts) using explicit ascending timestamps."""
    ids: list[str] = []
    for i, (data, parts) in enumerate(rows):
        when = base + timedelta(minutes=i)
        msg = Message(session_id=session_id, data=data, time_created=when)
        db.add(msg)
        await db.flush()
        for j, pdata in enumerate(parts):
            db.add(
                Part(
                    message_id=msg.id,
                    session_id=session_id,
                    data=pdata,
                    time_created=when + timedelta(seconds=j),
                )
            )
        ids.append(msg.id)
    await db.flush()
    return ids


async def _tool_states(db, session_id: str) -> dict[str, dict]:
    result = await db.execute(select(Part).where(Part.session_id == session_id))
    return {
        p.data["call_id"]: p.data["state"]
        for p in result.scalars().all()
        if p.data.get("type") == "tool"
    }


# ---------------------------------------------------------------------------
# context_collapse — pure in-memory contract
# ---------------------------------------------------------------------------

class TestContextCollapseInMemory:
    def test_short_history_untouched(self):
        msgs = [_user("a"), _assistant("b")] * 3  # 6 messages == min keep
        result, saved = context_collapse(msgs)
        assert result is msgs
        assert saved == 0

    def test_drops_oldest_and_inserts_boundary_without_mutation(self):
        msgs: list[dict[str, Any]] = []
        for i in range(6):
            msgs.append(_user(f"question {i} " + "x" * 400))
            msgs.append(_assistant(f"answer {i} " + "y" * 400))
        original = copy.deepcopy(msgs)

        result, saved = context_collapse(msgs, collapse_fraction=0.5)

        # The input list is never mutated — collapse must not touch stored
        # state, only the list used for the next LLM request.
        assert msgs == original

        assert saved > 0
        assert result[0]["role"] == "user"
        assert result[0]["content"].startswith("[Context collapsed:")
        # Most recent turn survives intact …
        assert result[-2]["content"].startswith("question 5")
        assert result[-1]["content"].startswith("answer 5")
        # … oldest turn is gone.
        assert all("question 0" not in str(m.get("content", "")) for m in result)

    def test_boundary_prefers_user_message(self):
        msgs: list[dict[str, Any]] = []
        for i in range(8):
            msgs.append(_user(f"q{i}"))
            msgs.append(_assistant(f"a{i}", tool_calls=_calls(f"c{i}")))
            msgs.append(_tool(f"c{i}", "r" * 100))
        result, saved = context_collapse(msgs, collapse_fraction=0.34)
        assert saved > 0
        # Clean turn cut: first message after the boundary marker is a user
        # message, so no assistant/tool pairing is split.
        assert result[1]["role"] == "user"

    def test_orphaned_tool_results_at_cut_are_dropped(self):
        # No user message inside the boundary scan window → the fallback cut
        # lands mid-turn, leaving tool results whose assistant message was
        # dropped. Those orphans must not survive (providers reject them).
        msgs = [
            _user("q0"),                                        # 0
            _assistant("a0", tool_calls=_calls("c0", "c1")),    # 1
            _tool("c0"),                                        # 2
            _tool("c1"),                                        # 3 ← fallback cut
            _assistant("a1", tool_calls=_calls("c2")),          # 4
            _tool("c2"),                                        # 5
            _user("q1"),                                        # 6
            _assistant("a1"),                                   # 7
            _user("q2"),                                        # 8
            _assistant("a2"),                                   # 9
            _user("q3"),                                        # 10
            _assistant("a3"),                                   # 11
        ]
        result, saved = context_collapse(msgs, collapse_fraction=0.25)
        assert saved > 0
        assert result[0]["content"].startswith("[Context collapsed:")
        assert result[1]["role"] == "assistant"
        kept_call_ids = {m.get("tool_call_id") for m in result if m.get("role") == "tool"}
        assert "c0" not in kept_call_ids
        assert "c1" not in kept_call_ids  # orphan stripped
        assert "c2" in kept_call_ids      # paired with kept assistant a1

    def test_leading_compaction_summary_is_never_dropped(self):
        anchor = _user(f"{CONTEXT_SUMMARY_PREFIX}\n\nGoal: finish the analysis")
        msgs: list[dict[str, Any]] = [anchor]
        for i in range(11):
            msgs.append(
                _assistant(f"step {i} " + "s" * 200) if i % 2 else _user(f"nudge {i}")
            )
        result, saved = context_collapse(msgs, collapse_fraction=0.8)
        assert saved > 0
        # The anchor summary is the only surviving memory of pre-compaction
        # history — it must stay at the head even under aggressive collapse.
        assert result[0] is anchor
        assert result[1]["content"].startswith("[Context collapsed:")

    def test_min_messages_to_keep_respected(self):
        msgs: list[dict[str, Any]] = []
        for i in range(10):
            msgs.append(_user(f"q{i}"))
            msgs.append(_assistant(f"a{i}"))
        result, saved = context_collapse(msgs, collapse_fraction=0.95)
        assert saved > 0
        # boundary marker + at least min_messages_to_keep kept
        assert len(result) >= 7


# ---------------------------------------------------------------------------
# _phase1_prune — protect whole real user turns
# ---------------------------------------------------------------------------

class TestPhase1PruneTurnProtection:
    @pytest.mark.asyncio
    async def test_prune_protects_last_two_real_user_turns(self, session_factory):
        from app.session.compaction import _phase1_prune
        from app.session.manager import create_session

        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        async with session_factory() as db:
            async with db.begin():
                session = await create_session(db, title="prune")
                sid = session.id
                await _seed(
                    db,
                    sid,
                    [
                        # --- Turn A (old → prunable) ---
                        ({"role": "user"}, []),
                        (
                            {"role": "assistant"},
                            [
                                _tool_part(_BIG_A, "a1"),   # exhausts budget → protected
                                _tool_part(_SMALL, "a2"),   # budget spent → pruned
                            ],
                        ),
                        # --- Turn B (2nd-to-last real turn → protected).
                        # A multi-step turn: several assistant rows per turn.
                        ({"role": "user"}, []),
                        ({"role": "assistant"}, [_tool_part(_BIG_B, "b1")]),
                        # System nudge — must NOT count as a user turn.
                        ({"role": "user", "system": True, "agent": "system"}, []),
                        ({"role": "assistant"}, [_tool_part(_BIG_C, "b2")]),
                        # --- Turn C (last real turn → protected) ---
                        ({"role": "user"}, []),
                        ({"role": "assistant"}, [_tool_part(_BIG_A + "z", "c1")]),
                    ],
                    base,
                )

        pruned = await _phase1_prune(sid, session_factory=session_factory)
        assert pruned == 1

        async with session_factory() as db:
            async with db.begin():
                states = await _tool_states(db, sid)

        # Turn A: first output protected by token budget, second pruned.
        assert states["a1"]["output"] == _BIG_A
        assert "time_compacted" not in states["a1"]
        assert states["a2"]["output"] == "[truncated]"
        assert states["a2"]["time_compacted"] == "auto"
        # Turns B and C stay fully intact even though the budget is exhausted
        # — the old row-count cutoff (len - 4) would have truncated b1/b2.
        for call_id, output in (("b1", _BIG_B), ("b2", _BIG_C), ("c1", _BIG_A + "z")):
            assert states[call_id]["output"] == output
            assert "time_compacted" not in states[call_id]

    @pytest.mark.asyncio
    async def test_single_turn_session_is_never_pruned(self, session_factory):
        from app.session.compaction import _phase1_prune
        from app.session.manager import create_session

        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        async with session_factory() as db:
            async with db.begin():
                session = await create_session(db, title="single-turn")
                sid = session.id
                await _seed(
                    db,
                    sid,
                    [
                        ({"role": "user"}, []),
                        (
                            {"role": "assistant"},
                            [_tool_part(_BIG_A, "s1"), _tool_part(_BIG_B, "s2")],
                        ),
                        ({"role": "assistant"}, [_tool_part(_BIG_C, "s3")]),
                        ({"role": "assistant"}, [_tool_part(_BIG_A + "w", "s4")]),
                        ({"role": "assistant"}, [_tool_part(_BIG_B + "w", "s5")]),
                    ],
                    base,
                )

        pruned = await _phase1_prune(sid, session_factory=session_factory)
        assert pruned == 0

        async with session_factory() as db:
            async with db.begin():
                states = await _tool_states(db, sid)
        assert all("time_compacted" not in s for s in states.values())
