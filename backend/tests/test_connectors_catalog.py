import json
from pathlib import Path


def _load_catalog() -> dict:
    path = Path(__file__).resolve().parents[1] / "app" / "data" / "connectors.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_no_datasage_seed_connector():
    """The shipped catalog must not carry the company-internal datasage seed.

    datasage (and its flow.chat URL) was a company-specific default. Users who
    need it can add it as a custom connector — nothing should be pre-wired.
    """
    catalog = _load_catalog()
    assert "datasage" not in catalog


def test_catalog_free_of_company_bound_urls():
    """No catalog entry may hardcode the company datasage endpoint."""
    catalog = _load_catalog()
    for connector_id, entry in catalog.items():
        for value in (entry.get("url", ""), entry.get("description", "")):
            assert "datasage.flow.chat" not in value, (
                f"connector '{connector_id}' still references the company datasage endpoint"
            )


def test_catalog_entries_well_formed():
    catalog = _load_catalog()
    assert catalog, "connector catalog must not be empty"
    for connector_id, entry in catalog.items():
        assert entry.get("name"), f"connector '{connector_id}' missing name"
        assert entry.get("description"), f"connector '{connector_id}' missing description"
        assert entry.get("category"), f"connector '{connector_id}' missing category"
