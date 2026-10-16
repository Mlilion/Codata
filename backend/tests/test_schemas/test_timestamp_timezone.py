from __future__ import annotations

from datetime import datetime

from app.schemas.message import MessageResponse, PartResponse
from app.schemas.session import SessionResponse


def test_session_response_marks_naive_sqlite_timestamps_as_utc():
    response = SessionResponse(
        id="s",
        time_created=datetime(2026, 9, 16, 8, 27),
        time_updated=datetime(2026, 9, 16, 8, 28),
    )
    payload = response.model_dump(mode="json")
    assert payload["time_created"].endswith("Z")
    assert payload["time_updated"].endswith("Z")


def test_message_and_part_responses_mark_naive_timestamps_as_utc():
    part = PartResponse(
        id="p",
        message_id="m",
        session_id="s",
        time_created=datetime(2026, 9, 16, 8, 27),
        data={"type": "text", "text": "answer"},
    )
    message = MessageResponse(
        id="m",
        session_id="s",
        time_created=datetime(2026, 9, 16, 8, 27),
        data={"role": "assistant"},
        parts=[part],
    )
    payload = message.model_dump(mode="json")
    assert payload["time_created"].endswith("Z")
    assert payload["parts"][0]["time_created"].endswith("Z")
