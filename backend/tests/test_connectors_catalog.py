import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "data"


def test_connector_catalog_has_no_preconfigured_services():
    catalog = json.loads((DATA_DIR / "connectors.json").read_text(encoding="utf-8"))
    assert catalog == {}


def test_data_plugin_has_no_preconfigured_services():
    config = json.loads(
        (DATA_DIR / "plugins" / "data" / ".mcp.json").read_text(encoding="utf-8")
    )
    assert config == {"mcpServers": {}}
