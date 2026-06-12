import importlib.util
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("mcp") is None,
    reason="app API test dependencies require optional mcp package",
)


def _video_registry(tmp_path: Path):
    from app.expert.registry import ExpertTeamRegistry

    registry = ExpertTeamRegistry(
        presets_dir=Path(__file__).resolve().parents[2] / "app" / "expert" / "presets",
        user_dir=tmp_path / "user-teams",
    )
    registry.scan()
    return registry


@pytest.mark.asyncio
async def test_video_expert_team_is_listed_but_not_summonable(app_client, tmp_path) -> None:
    from app.dependencies import set_expert_team_registry

    registry = _video_registry(tmp_path)
    app_client.app.state.expert_team_registry = registry
    set_expert_team_registry(registry)

    listing = await app_client.get("/api/expert-teams")
    assert listing.status_code == 200
    assert any(team["id"] == "video-production" for team in listing.json()["teams"])

    summon = await app_client.post("/api/expert-teams/video-production/summon", json={"input": "生成视频"})
    assert summon.status_code == 403
    assert "即将上线" in summon.json()["detail"]

    resume = await app_client.post(
        "/api/expert-teams/video-production/sessions/session-1/resume",
        json={"from_task_id": "render"},
    )
    assert resume.status_code == 403
    assert "暂不开放" in resume.json()["detail"]
