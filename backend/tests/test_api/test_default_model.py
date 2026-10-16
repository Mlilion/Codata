"""API tests for the default-model config endpoints.

These endpoints persist to a ``.env`` file in the current working directory,
so every test chdirs into a tmp path first to avoid touching the real one.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


@pytest.mark.asyncio
async def test_get_default_model_empty(app_client, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    resp = await app_client.get("/api/config/default-model")
    assert resp.status_code == 200
    assert resp.json() == {"model": None, "provider_id": None}


@pytest.mark.asyncio
async def test_set_and_get_default_model(app_client, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    # Registry says the model is available.
    app_client.app.state.provider_registry.resolve_model.return_value = (
        MagicMock(),
        MagicMock(),
    )

    resp = await app_client.put(
        "/api/config/default-model",
        json={"model": "some-model", "provider_id": "custom_a"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"model": "some-model", "provider_id": "custom_a"}

    # Persisted to .env in the tmp cwd.
    env = (tmp_path / ".env").read_text()
    assert "CODATA_DEFAULT_MODEL='some-model'" in env
    assert "CODATA_DEFAULT_PROVIDER_ID='custom_a'" in env

    # And readable back.
    got = await app_client.get("/api/config/default-model")
    assert got.json() == {"model": "some-model", "provider_id": "custom_a"}


@pytest.mark.asyncio
async def test_set_rejects_unavailable_model(app_client, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    app_client.app.state.provider_registry.resolve_model.return_value = None

    resp = await app_client.put(
        "/api/config/default-model",
        json={"model": "ghost-model", "provider_id": "custom_a"},
    )
    assert resp.status_code == 400
    # Nothing persisted.
    assert not (tmp_path / ".env").exists() or "ghost-model" not in (
        tmp_path / ".env"
    ).read_text()


@pytest.mark.asyncio
async def test_clear_default_model(app_client, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    app_client.app.state.provider_registry.resolve_model.return_value = (
        MagicMock(),
        MagicMock(),
    )
    await app_client.put(
        "/api/config/default-model",
        json={"model": "some-model", "provider_id": "custom_a"},
    )

    resp = await app_client.put("/api/config/default-model", json={"model": None})
    assert resp.status_code == 200
    assert resp.json() == {"model": None, "provider_id": None}

    got = await app_client.get("/api/config/default-model")
    assert got.json() == {"model": None, "provider_id": None}
