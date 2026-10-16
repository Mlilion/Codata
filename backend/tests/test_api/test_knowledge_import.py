"""Tests for importing local files into the knowledge base."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.api import knowledge as knowledge_api
from app.knowledge import source_import
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


@pytest.mark.asyncio
async def test_import_creates_file_entry_and_schedules(app_client, monkeypatch, tmp_path):
    scheduled: dict[str, str] = {}
    monkeypatch.setattr(
        knowledge_api,
        "_schedule_ingest",
        lambda request, entry_id: scheduled.setdefault("id", entry_id),
    )

    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(source_import, "UPLOAD_DIR", uploads_dir)

    workspace = tmp_path / "workspace"
    source_dir = workspace / "docs"
    source_dir.mkdir(parents=True)
    source_file = source_dir / "note.md"
    source_file.write_text("# note\ncontent", encoding="utf-8")

    resp = await app_client.post(
        "/api/knowledge/import",
        json={
            "file_path": "docs/note.md",
            "workspace": str(workspace),
            "title": "Derived Note",
            "note": "from session",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source_type"] == "file"
    assert body["source_name"] == "note.md"
    assert body["title"] == "Derived Note"
    assert body["note"] == "from session"
    assert scheduled["id"] == body["id"]

    copied = Path(body["file_path"])
    assert copied.exists()
    assert copied.parent == uploads_dir.resolve()


@pytest.mark.asyncio
async def test_import_rejects_missing_file(app_client, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    resp = await app_client.post(
        "/api/knowledge/import",
        json={"file_path": "missing.md", "workspace": str(workspace)},
    )
    assert resp.status_code == 400
