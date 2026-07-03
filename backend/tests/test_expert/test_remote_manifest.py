import json
from pathlib import Path

import httpx
import pytest

from app.expert.models import ExpertTeamConfig
from app.expert.registry import ExpertTeamRegistry
from app.expert.remote_manifest import load_remote_expert_teams, refresh_remote_manifest_cache


def _team_payload(team_id: str, name: str = "远程专家团") -> dict:
    return {
        "id": team_id,
        "name": name,
        "description": "远程加载的专家团。",
        "process": "workflow",
        "members": [
            {"id": "planner", "name": "规划专家", "role": "规划", "goal": "拆解目标。"},
            {"id": "writer", "name": "写作专家", "role": "写作", "goal": "输出结果。"},
        ],
        "tasks": [
            {
                "id": "plan",
                "name": "规划",
                "member": "planner",
                "task": "分析 {{user_input}}",
                "expected_output": "清晰的计划。",
                "output": "plan_result",
            },
            {
                "id": "write",
                "name": "输出",
                "member": "writer",
                "depends_on": ["plan"],
                "context": ["plan"],
                "task": "根据 {{plan_result}} 输出最终建议。",
                "expected_output": "最终建议。",
                "output": "final_result",
            },
        ],
    }


def _manifest(*entries: dict) -> dict:
    return {
        "schema_version": "1.0",
        "tenant_id": "codata",
        "account_id": "acct-1",
        "etag": "test",
        "teams": list(entries),
    }


def _entry(remote_id: str, team_id: str, **overrides) -> dict:
    entry = {
        "remote_id": remote_id,
        "runtime_id": team_id,
        "version": "1.2.0",
        "channel": "stable",
        "license": {"status": "active", "features": ["summon", "resume"]},
        "visibility": {"listed": True, "category": "业务策略", "tags": ["远程"]},
        "team": _team_payload(team_id),
    }
    entry.update(overrides)
    return entry


def _write_manifest(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_remote_manifest_loads_authorized_listed_teams(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    _write_manifest(manifest_path, _manifest(_entry("research", "remote_research")))

    loaded = load_remote_expert_teams(manifest_path)

    assert len(loaded) == 1
    assert loaded[0].team.id == "remote_research"
    assert loaded[0].team.category == "业务策略"
    assert "远程" in loaded[0].team.tags
    assert loaded[0].metadata["editable"] is False
    assert loaded[0].metadata["origin"] == "remote"
    assert loaded[0].metadata["remote_version"] == "1.2.0"


def test_remote_manifest_skips_inactive_unlisted_and_invalid_entries(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    invalid_entry = _entry("invalid", "remote_invalid")
    invalid_entry["team"]["tasks"][1]["depends_on"] = ["missing"]
    _write_manifest(
        manifest_path,
        _manifest(
            _entry("active", "remote_active"),
            "not-an-object",
            _entry("inactive", "remote_inactive", license={"status": "expired"}),
            _entry("hidden", "remote_hidden", visibility={"listed": False}),
            invalid_entry,
        ),
    )

    loaded = load_remote_expert_teams(manifest_path)

    assert [item.team.id for item in loaded] == ["remote_active"]


def test_registry_does_not_load_remote_manifest_when_disabled(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    _write_manifest(manifest_path, _manifest(_entry("research", "remote_research")))
    registry = ExpertTeamRegistry(
        presets_dir=tmp_path / "presets",
        user_dir=tmp_path / "user-teams",
        remote_enabled=False,
        remote_manifest_path=manifest_path,
    )

    registry.scan()

    assert registry.get("remote_research") is None


def test_registry_loads_remote_teams_as_read_only(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    _write_manifest(manifest_path, _manifest(_entry("research", "remote_research")))
    registry = ExpertTeamRegistry(
        presets_dir=tmp_path / "presets",
        user_dir=tmp_path / "user-teams",
        remote_enabled=True,
        remote_manifest_path=manifest_path,
    )

    registry.scan()
    summaries = registry.list_teams()

    assert len(summaries) == 1
    assert summaries[0].id == "remote_research"
    assert summaries[0].is_preset is False
    assert summaries[0].editable is False
    assert summaries[0].origin == "remote"
    assert summaries[0].remote_id == "research"
    assert summaries[0].remote_version == "1.2.0"
    assert summaries[0].remote_channel == "stable"
    assert registry.metadata("remote_research")["remote"] is True
    with pytest.raises(ValueError, match="cannot be modified"):
        registry.save_user_team(registry.get_or_raise("remote_research"))
    with pytest.raises(ValueError, match="cannot be deleted"):
        registry.delete_user_team("remote_research")


def test_registry_keeps_local_team_when_remote_id_collides(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    registry = ExpertTeamRegistry(
        presets_dir=tmp_path / "presets",
        user_dir=tmp_path / "user-teams",
        remote_enabled=True,
        remote_manifest_path=manifest_path,
    )
    local_team = ExpertTeamConfig(**_team_payload("shared_team", name="本地专家团"))
    registry.save_user_team(local_team)
    _write_manifest(manifest_path, _manifest(_entry("remote-shared", "shared_team")))

    registry.scan()

    metadata = registry.metadata("shared_team")
    assert registry.get_or_raise("shared_team").name == "本地专家团"
    assert metadata.get("remote") is None
    assert metadata["editable"] is True


def test_registry_hot_reloads_remote_manifest_changes(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    _write_manifest(manifest_path, _manifest(_entry("one", "remote_one")))
    registry = ExpertTeamRegistry(
        presets_dir=tmp_path / "presets",
        user_dir=tmp_path / "user-teams",
        remote_enabled=True,
        remote_manifest_path=manifest_path,
    )

    registry.scan()
    assert registry.get("remote_one") is not None

    _write_manifest(manifest_path, _manifest(_entry("two", "remote_two")))
    _write_manifest(
        manifest_path,
        _manifest(_entry("two", "remote_two"), _entry("three", "remote_three")),
    )

    assert registry.get("remote_two") is not None
    assert registry.get("remote_one") is None


def test_remote_manifest_cache_fetches_and_uses_etag(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_path = tmp_path / "cache" / "manifest.json"
    seen_headers: list[dict[str, str]] = []
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(dict(request.headers))
        if request.headers.get("if-none-match") == "service-etag":
            return httpx.Response(304, headers={"ETag": "service-etag"})
        return httpx.Response(
            200,
            json=_manifest(_entry("research", "remote_research")),
            headers={"ETag": "service-etag"},
        )

    def make_client(*args, **kwargs) -> httpx.Client:
        return real_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "Client", make_client)

    first = refresh_remote_manifest_cache(
        url="https://example.test/custom/api/expert-teams/manifest",
        cache_path=cache_path,
        token="token-1",
        force=True,
    )
    second = refresh_remote_manifest_cache(
        url="https://example.test/custom/api/expert-teams/manifest",
        cache_path=cache_path,
        token="token-1",
        min_interval_seconds=0,
    )

    assert first.updated is True
    assert first.available is True
    assert second.not_modified is True
    assert second.available is True
    assert json.loads(cache_path.read_text(encoding="utf-8"))["teams"][0]["remote_id"] == "research"
    assert seen_headers[0]["authorization"] == "Bearer token-1"
    assert seen_headers[1]["if-none-match"] == "service-etag"


def test_remote_manifest_cache_keeps_existing_file_on_fetch_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_path = tmp_path / "cache" / "manifest.json"
    cache_path.parent.mkdir(parents=True)
    _write_manifest(cache_path, _manifest(_entry("cached", "remote_cached")))
    real_client = httpx.Client

    def make_client(*args, **kwargs) -> httpx.Client:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("offline", request=request)

        return real_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "Client", make_client)

    result = refresh_remote_manifest_cache(
        url="https://example.test/custom/api/expert-teams/manifest",
        cache_path=cache_path,
        force=True,
    )

    assert result.updated is False
    assert result.available is True
    assert result.error == "offline"
    assert load_remote_expert_teams(cache_path)[0].team.id == "remote_cached"


def test_registry_loads_http_remote_manifest_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_path = tmp_path / "cache" / "manifest.json"
    real_client = httpx.Client

    def make_client(*args, **kwargs) -> httpx.Client:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_manifest(_entry("http", "remote_http")))

        return real_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "Client", make_client)
    registry = ExpertTeamRegistry(
        presets_dir=tmp_path / "presets",
        user_dir=tmp_path / "user-teams",
        remote_enabled=True,
        remote_manifest_url="https://example.test/custom/api/expert-teams/manifest",
        remote_auth_token="token-1",
        remote_cache_path=cache_path,
        remote_fetch_interval_seconds=0,
    )

    registry.scan()

    assert registry.get("remote_http") is not None
    assert registry.metadata("remote_http")["origin"] == "remote"
