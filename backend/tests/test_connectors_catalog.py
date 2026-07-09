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
    # 预置官方 MCP 地址:用户打开开关即可直接走 OAuth 授权,无需手填地址
    assert entry["url"] == "https://datasage.flow.chat/mcp"
    # seed 标记:让 datasage 作为种子连接器进入 registry、在目录中可见
    assert entry["seed"] is True
