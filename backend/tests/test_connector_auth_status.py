"""A connector that requires a token must not report `connected` until a
token is actually stored — even if the MCP transport handshake succeeds
without one.

Regression origin: a token-auth MCP endpoint (originally the datasage data
platform) completed the MCP initialize + list_tools handshake WITHOUT a token
(it defers auth to tool-call time), so `client.connect()` succeeded and
status() reported `connected`. The user saw a green "connected" dot but every
tool call failed with an auth error. The fix: connectors carry an `auth` mode,
and status() downgrades a token-required connector to `needs_auth` when no
token is stored.

The tests below use a synthetic token-auth seed so they no longer depend on
any shipped (company-specific) catalog entry.
"""

import tempfile

from app.connector.model import ConnectorInfo
from app.connector.registry import ConnectorRegistry
from app.mcp.token_store import McpTokenStore

_TOKEN_SEED_ID = "test-token-seed"
_TOKEN_SEED_CATALOG = {
    "name": "Test Token Connector",
    "url": "https://token.example/mcp",
    "description": "token-auth seed for tests",
    "category": "data",
    "auth": "token",
    "seed": True,
}


def _fresh_registry() -> ConnectorRegistry:
    tmp = tempfile.mkdtemp()
    reg = ConnectorRegistry(project_dir=tmp)
    reg._catalog[_TOKEN_SEED_ID] = dict(_TOKEN_SEED_CATALOG)
    return reg


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


def test_token_seed_declares_token_auth():
    reg = _fresh_registry()
    reg._register_seed_connectors()
    conn = reg.get(_TOKEN_SEED_ID)
    assert conn is not None
    # A token-auth connector authenticates with an MCP Key token, not OAuth.
    assert conn.auth == "token"


def test_token_connector_without_token_reports_needs_auth():
    """Transport says 'connected', but no token stored → status is needs_auth."""
    reg = _fresh_registry()
    reg._register_seed_connectors()
    reg.get(_TOKEN_SEED_ID).enabled = True

    # MCP transport handshake succeeded (the endpoint allows unauthenticated
    # initialize/list_tools), so the runtime reports 'connected'.
    reg._mcp_manager = _FakeManager(
        {_TOKEN_SEED_ID: {"status": "connected", "tools": 5, "error": None}},
        reg._project_dir,
    )

    entry = reg.status()[_TOKEN_SEED_ID]
    assert entry["status"] == "needs_auth"
    assert entry["connected"] is False


def test_token_connector_with_token_reports_connected():
    """Once a token is stored, a connected transport is truly connected."""
    reg = _fresh_registry()
    reg._register_seed_connectors()
    reg.get(_TOKEN_SEED_ID).enabled = True

    mgr = _FakeManager(
        {_TOKEN_SEED_ID: {"status": "connected", "tools": 5, "error": None}},
        reg._project_dir,
    )
    _store_token(mgr._token_store, _TOKEN_SEED_ID)
    reg._mcp_manager = mgr

    entry = reg.status()[_TOKEN_SEED_ID]
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
