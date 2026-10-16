"""Tests for session file visibility classification."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.models.message import Part
from app.session.manager import create_message, create_part, create_session
from app.models.session_file import SessionFile
from app.utils.id import generate_ulid

pytestmark = pytest.mark.asyncio


class TestSessionFilesVisibility:
    async def test_present_file_overrides_write_as_deliverable(self, app_client, session_factory, tmp_path: Path):
        async with session_factory() as db:
            async with db.begin():
                session = await create_session(db, title="Files", directory=str(tmp_path))
                msg = await create_message(db, session_id=session.id, data={"role": "assistant"})
                file_path = tmp_path / "article.md"
                file_path.write_text("# draft", encoding="utf-8")
                db.add(
                    SessionFile(
                        id=generate_ulid(),
                        session_id=session.id,
                        file_path=str(file_path),
                        file_name=file_path.name,
                        tool_id="write",
                        file_type="generated",
                    )
                )
                await create_part(
                    db,
                    message_id=msg.id,
                    session_id=session.id,
                    data={
                        "type": "tool",
                        "tool": "present_file",
                        "call_id": "call-1",
                        "state": {
                            "status": "completed",
                            "input": {"file_path": str(file_path)},
                            "output": f"Presented {file_path}",
                            "metadata": {"file_path": str(file_path)},
                            "title": file_path.name,
                            "time_start": None,
                            "time_end": None,
                            "time_compacted": None,
                        },
                    },
                )

        resp = await app_client.get(f"/api/sessions/{session.id}/files")
        assert resp.status_code == 200
        data = resp.json()
        assert data["files"][0]["visibility"] == "deliverable"
        assert data["deliverable_files"][0]["path"] == str(file_path.resolve())

