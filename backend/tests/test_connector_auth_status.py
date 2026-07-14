"""A connector that requires a token must not report `connected` until a
token is actually stored — even if the MCP transport handshake succeeds
without one.

Regression: datasage's /mcp endpoint completes the MCP initialize +
list_tools handshake WITHOUT a token (it defers auth to tool-call time), so
`client.connect()` succeeded and status() reported `connected`. The user saw
a green "connected" dot but every execute_sql call failed with "can't reach
datasage MCP". The fix: connectors carry an `auth` mode, and status()
downgrades a token-required connector to `needs_auth` when no token is stored.
"""

import tempfile

from app.connector.model import ConnectorInfo
from app.connector.registry import ConnectorRegistry
from app.mcp.token_store import McpTokenStore


def _fresh_registry() -> ConnectorRegistry:
    tmp = tempfile.mkdtemp()
    return ConnectorRegistry(project_dir=tmp)


class _FakeManager:
    """Minimal McpManager stand-in: fixed runtime status + a real token store."""

    def __init__(self, status_by_id: dict, project_dir: str):
        self._status = status_by_id
        self._token_store = McpTokenStore(project_dir)

    def status(self) -> dict:
        return self._status


def _store_token(store: McpTokenStore, connector_id: str) -> None:
    store.save(
        connector_id,
        type("T", (), {
            "access_token": "codata_key_abc",
            "refresh_token": None,
            "expires_at": 0,
            "token_type": "Bearer",
            "scope": "",
        })(),
    )


def test_datasage_seed_declares_token_auth():
    reg = _fresh_registry()
    reg._register_seed_connectors()
    conn = reg.get("datasage")
    assert conn is not None
    # datasage authenticates with an MCP Key token, not OAuth.
    assert conn.auth == "token"


def test_token_connector_without_token_reports_needs_auth():
    """Transport says 'connected', but no token stored → status is needs_auth."""
    reg = _fresh_registry()
    reg._register_seed_connectors()
    reg.get("datasage").enabled = True

    # MCP transport handshake succeeded (datasage allows unauthenticated
    # initialize/list_tools), so the runtime reports 'connected'.
    reg._mcp_manager = _FakeManager(
        {"datasage": {"status": "connected", "tools": 5, "error": None}},
        reg._project_dir,
    )

    entry = reg.status()["datasage"]
    assert entry["status"] == "needs_auth"
    assert entry["connected"] is False


def test_token_connector_with_token_reports_connected():
    """Once a token is stored, a connected transport is truly connected."""
    reg = _fresh_registry()
    reg._register_seed_connectors()
    reg.get("datasage").enabled = True

    mgr = _FakeManager(
        {"datasage": {"status": "connected", "tools": 5, "error": None}},
        reg._project_dir,
    )
    _store_token(mgr._token_store, "datasage")
    reg._mcp_manager = mgr

    entry = reg.status()["datasage"]
    assert entry["status"] == "connected"
    assert entry["connected"] is True


def test_oauth_connector_unaffected():
    """A non-token (oauth) connector keeps reporting whatever the transport says."""
    reg = _fresh_registry()
    reg._connectors["slack"] = ConnectorInfo(
        id="slack", name="Slack", url="https://mcp.slack.com/mcp",
        type="remote", description="", category="communication",
        enabled=True, auth="oauth",
    )
    reg._mcp_manager = _FakeManager(
        {"slack": {"status": "connected", "tools": 3, "error": None}},
        reg._project_dir,
    )
    entry = reg.status()["slack"]
    assert entry["status"] == "connected"
    assert entry["connected"] is True
