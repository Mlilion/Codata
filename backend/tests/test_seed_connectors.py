"""Seed connectors: catalog entries flagged `seed` should register into the
ConnectorRegistry so they surface as cards and can be connected.

We call `_register_seed_connectors()` directly (NOT startup(), which tries to
connect MCP servers over the network).
"""

import tempfile

import pytest

from app.connector.model import ConnectorInfo
from app.connector.registry import ConnectorRegistry


def _fresh_registry() -> ConnectorRegistry:
    # Isolate persistence to a throwaway dir so we don't touch real user state.
    tmp = tempfile.mkdtemp()
    return ConnectorRegistry(project_dir=tmp)


# A synthetic empty-url remote seed used to exercise the "claim placeholder"
# mechanism without depending on any real catalog entry (the shipped catalog
# has no empty-url seed right now — datasage carries a preset URL and the
# feishu knowledge-base seed is currently hidden). Injecting it into the
# registry's catalog keeps these mechanism tests independent of product data.
_TEST_SEED_ID = "test-empty-seed"
_TEST_SEED_CATALOG = {
    "name": "Test Empty Seed",
    "url": "",
    "description": "empty-url remote seed for tests",
    "category": "custom",
    "seed": True,
}


def _registry_with_test_seed() -> ConnectorRegistry:
    reg = _fresh_registry()
    reg._catalog[_TEST_SEED_ID] = dict(_TEST_SEED_CATALOG)
    return reg


def test_seed_registers_datasage():
    reg = _fresh_registry()
    assert reg.get("datasage") is None  # not present before seeding

    reg._register_seed_connectors()

    conn = reg.get("datasage")
    assert conn is not None
    assert conn.category == "data"
    assert conn.source == "builtin"
    assert conn.url == "https://datasage.flow.chat/mcp"
    assert conn.type == "remote"


def test_seed_appears_in_status():
    reg = _fresh_registry()
    reg._register_seed_connectors()

    status = reg.status()
    assert "datasage" in status
    entry = status["datasage"]
    assert entry["category"] == "data"
    assert entry["source"] == "builtin"
    assert entry["url"] == "https://datasage.flow.chat/mcp"


def test_seed_does_not_overwrite_existing_connector():
    """A user custom connector with the same id must win over an empty-url seed.

    Uses a synthetic empty-url seed (see _TEST_SEED_CATALOG), so register_custom
    is allowed to claim the placeholder.
    """
    reg = _registry_with_test_seed()
    reg.register_custom(
        id=_TEST_SEED_ID,
        name="My seed",
        url="https://my.example/mcp",
        description="custom",
        category="custom",
    )

    reg._register_seed_connectors()

    conn = reg.get(_TEST_SEED_ID)
    assert conn is not None
    # Claiming an empty-url seed keeps it a builtin (URL just filled in).
    assert conn.source == "builtin"
    assert conn.url == "https://my.example/mcp"


def test_user_can_claim_empty_url_seed():
    """After seeding, a user submitting a real URL claims the seed placeholder.

    Claiming only fills in the URL — the connector stays a builtin (no
    "custom" badge), it is not demoted to a user custom connector.
    """
    reg = _registry_with_test_seed()
    reg._register_seed_connectors()
    assert reg.get(_TEST_SEED_ID).url == ""

    conn = reg.register_custom(
        id=_TEST_SEED_ID,
        name="seed",
        url="https://prod.example/mcp",
        category="custom",
    )

    assert conn.source == "builtin"
    assert conn.url == "https://prod.example/mcp"
    assert reg.get(_TEST_SEED_ID).url == "https://prod.example/mcp"


def test_claimed_seed_stays_builtin_after_restart():
    """A claimed seed persists as custom state on disk, but restoring it on the
    next startup must recognise the seed id and keep it a builtin.
    """
    tmp = tempfile.mkdtemp()
    reg = ConnectorRegistry(project_dir=tmp)
    reg._catalog[_TEST_SEED_ID] = dict(_TEST_SEED_CATALOG)
    reg._register_seed_connectors()
    reg.register_custom(
        id=_TEST_SEED_ID,
        name="seed",
        url="https://prod.example/mcp",
        category="custom",
    )

    # New registry over the same project dir → replays persisted state.
    reg2 = ConnectorRegistry(project_dir=tmp)
    reg2._catalog[_TEST_SEED_ID] = dict(_TEST_SEED_CATALOG)
    for custom in reg2._persisted_state.get("custom", []):
        cid = custom.get("id", "")
        if cid and cid not in reg2._connectors:
            is_seed = bool(reg2._catalog.get(cid, {}).get("seed"))
            reg2._connectors[cid] = ConnectorInfo(
                id=cid,
                name=custom.get("name", cid),
                url=custom.get("url", ""),
                type="remote",
                description=custom.get("description", ""),
                category=custom.get("category", "custom"),
                enabled=cid in reg2._persisted_state.get("enabled", []),
                source="builtin" if is_seed else "custom",
            )
    reg2._register_seed_connectors()

    conn = reg2.get(_TEST_SEED_ID)
    assert conn.source == "builtin"
    assert conn.url == "https://prod.example/mcp"


def test_local_builtin_cannot_be_claimed():
    """A LOCAL builtin (google-workspace, ms365, pubmed) has an empty url too,
    but connects by command — it must NOT be claimable/overwritable via
    register_custom. Only a REMOTE seed placeholder can be claimed.
    """
    reg = _fresh_registry()
    # Present google-workspace as a local builtin (type="local", source="builtin").
    reg._connectors["google-workspace"] = ConnectorInfo(
        id="google-workspace",
        name="Google Workspace",
        url="",  # local builtins have empty url
        type="local",
        description="Google Workspace (local)",
        category="productivity",
        source="builtin",
    )

    with pytest.raises(ValueError):
        reg.register_custom(
            id="google-workspace",
            name="Hijacked",
            url="https://evil.example/mcp",
            category="custom",
        )

    # Original local builtin is untouched.
    conn = reg.get("google-workspace")
    assert conn.type == "local"
    assert conn.source == "builtin"
    assert conn.url == ""


def test_seed_is_idempotent():
    reg = _fresh_registry()
    reg._register_seed_connectors()
    reg._register_seed_connectors()

    conn = reg.get("datasage")
    assert conn is not None
    assert conn.source == "builtin"
