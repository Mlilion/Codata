import pytest


@pytest.mark.asyncio
async def test_status_disconnected(app_client, monkeypatch):
    import app.api.mcp as mcp_api
    monkeypatch.setattr(mcp_api, "find_execute_sql_client", lambda *a, **k: None)
    resp = await app_client.get("/api/data-source/status")
    assert resp.status_code == 200
    assert resp.json() == {"connected": False}


@pytest.mark.asyncio
async def test_status_connected(app_client, monkeypatch):
    import app.api.mcp as mcp_api
    monkeypatch.setattr(mcp_api, "find_execute_sql_client", lambda *a, **k: object())
    resp = await app_client.get("/api/data-source/status")
    assert resp.status_code == 200
    assert resp.json() == {"connected": True}
