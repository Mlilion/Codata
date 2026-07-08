"""Tests for authoring a custom skill via POST /api/skills."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.dependencies import get_skill_registry, set_skill_registry
from app.skill.registry import SkillRegistry

pytestmark = pytest.mark.asyncio


def _use_real_registry(app_client, skills_root: Path, monkeypatch):
    """Point the app + endpoint at a real registry writing into a tmp dir."""
    from app.api import skills as skills_api

    monkeypatch.setattr(skills_api, "_global_skills_dir", lambda: skills_root)
    reg = SkillRegistry(global_dir=skills_root) if _accepts_global_dir() else SkillRegistry()
    reg.scan()
    app_client.app.dependency_overrides[get_skill_registry] = lambda: reg
    app_client.app.state.skill_registry = reg
    set_skill_registry(reg)
    return reg


def _accepts_global_dir() -> bool:
    import inspect
    return "global_dir" in inspect.signature(SkillRegistry.__init__).parameters


async def test_create_skill_writes_file(app_client, tmp_path, monkeypatch):
    skills_root = tmp_path / "skills"
    skills_root.mkdir()
    _use_real_registry(app_client, skills_root, monkeypatch)

    resp = await app_client.post(
        "/api/skills",
        json={
            "name": "渠道留存分析",
            "description": "分析各渠道的次日/7日留存,定位流失严重的渠道。",
            "instructions": "1. 用 run_query 查各渠道留存\n2. 用 chart_spec 出留存曲线\n3. 标注异常渠道",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    slug = body["slug"]

    skill_md = skills_root / slug / "SKILL.md"
    assert skill_md.exists()
    content = skill_md.read_text(encoding="utf-8")
    assert content.startswith("---")
    assert "name: 渠道留存分析" in content
    assert "run_query" in content


async def test_create_skill_conflict_without_overwrite(app_client, tmp_path, monkeypatch):
    skills_root = tmp_path / "skills"
    skills_root.mkdir()
    _use_real_registry(app_client, skills_root, monkeypatch)

    payload = {"name": "dup skill", "description": "d", "instructions": "x"}
    r1 = await app_client.post("/api/skills", json=payload)
    assert r1.status_code == 200
    r2 = await app_client.post("/api/skills", json=payload)
    assert r2.status_code == 409
    # overwrite succeeds
    r3 = await app_client.post("/api/skills", json={**payload, "overwrite": True})
    assert r3.status_code == 200


async def test_create_skill_requires_name_and_description(app_client, tmp_path, monkeypatch):
    skills_root = tmp_path / "skills"
    skills_root.mkdir()
    _use_real_registry(app_client, skills_root, monkeypatch)

    r = await app_client.post("/api/skills", json={"name": "  ", "description": "d", "instructions": "x"})
    assert r.status_code == 400
