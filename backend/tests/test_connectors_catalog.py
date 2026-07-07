import json
from pathlib import Path


def test_datasage_seed_connector_present():
    path = Path(__file__).resolve().parents[1] / "app" / "data" / "connectors.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    assert "datasage" in catalog
    entry = catalog["datasage"]
    assert entry["category"] == "data"
    assert entry["name"]
    assert entry["description"]
    # url 存在但为空占位——datasage 地址因部署而异,由用户填写
    assert "url" in entry
