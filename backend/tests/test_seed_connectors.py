"""Seed connectors: catalog entries flagged `seed` should register into the
ConnectorRegistry so they surface as cards and can be connected.

We call `_register_seed_connectors()` directly (NOT startup(), which tries to
connect MCP servers over the network).
"""

import tempfile

from app.connector.registry import ConnectorRegistry


def _fresh_registry() -> ConnectorRegistry:
    # Isolate persistence to a throwaway dir so we don't touch real user state.
    tmp = tempfile.mkdtemp()
    return ConnectorRegistry(project_dir=tmp)


def test_seed_registers_datasage():
    reg = _fresh_registry()
    assert reg.get("datasage") is None  # not present before seeding

    reg._register_seed_connectors()

    conn = reg.get("datasage")
    assert conn is not None
    assert conn.category == "data"
    assert conn.source == "builtin"
    assert conn.url == ""
    assert conn.type == "remote"


def test_seed_appears_in_status():
    reg = _fresh_registry()
    reg._register_seed_connectors()

    status = reg.status()
    assert "datasage" in status
    entry = status["datasage"]
    assert entry["category"] == "data"
    assert entry["source"] == "builtin"
    assert entry["url"] == ""


def test_seed_does_not_overwrite_existing_connector():
    """A user custom connector with the same id must win over the seed."""
    reg = _fresh_registry()
    reg.register_custom(
        id="datasage",
        name="My datasage",
        url="https://my.datasage.example/mcp",
        description="custom",
        category="data",
    )

    reg._register_seed_connectors()

    conn = reg.get("datasage")
    assert conn is not None
    assert conn.source == "custom"
    assert conn.url == "https://my.datasage.example/mcp"


def test_user_can_claim_empty_url_seed():
    """After seeding, a user submitting a real URL claims the seed placeholder."""
    reg = _fresh_registry()
    reg._register_seed_connectors()
    assert reg.get("datasage").url == ""

    conn = reg.register_custom(
        id="datasage",
        name="datasage",
        url="https://prod.datasage.example/mcp",
        category="data",
    )

    assert conn.source == "custom"
    assert conn.url == "https://prod.datasage.example/mcp"
    assert reg.get("datasage").url == "https://prod.datasage.example/mcp"


def test_seed_is_idempotent():
    reg = _fresh_registry()
    reg._register_seed_connectors()
    reg._register_seed_connectors()

    conn = reg.get("datasage")
    assert conn is not None
    assert conn.source == "builtin"
