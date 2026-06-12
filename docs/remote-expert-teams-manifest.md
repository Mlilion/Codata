# Remote Expert Teams Manifest

WorkCraft can load remote expert teams through a manifest adapter. It supports
either a local JSON file or an HTTP manifest URL cached on disk. This is disabled
by default and does not affect preset, user, or project expert teams unless
explicitly enabled.

## Runtime Settings

- `WORKCRAFT_REMOTE_EXPERT_TEAMS_ENABLED=true`
- `WORKCRAFT_REMOTE_EXPERT_TEAMS_MANIFEST_PATH=/path/to/manifest.json`
- `WORKCRAFT_REMOTE_EXPERT_TEAMS_MANIFEST_URL=https://example.com/custom/api/expert-teams/manifest`
- `WORKCRAFT_REMOTE_EXPERT_TEAMS_AUTH_TOKEN=<sub2api jwt>`
- `WORKCRAFT_REMOTE_EXPERT_TEAMS_CACHE_PATH=/path/to/cache/manifest.json`
- `WORKCRAFT_REMOTE_EXPERT_TEAMS_FETCH_INTERVAL_SECONDS=60`

When the path is omitted, WorkCraft reads:

```text
~/.workcraft/remote-expert-teams/manifest.json
```

When `WORKCRAFT_REMOTE_EXPERT_TEAMS_MANIFEST_URL` is set, WorkCraft fetches the
remote URL with `Authorization: Bearer <token>` when a token is configured,
sends `If-None-Match` from the cached ETag, and writes the response to:

```text
~/.workcraft/remote-expert-teams/cache/manifest.json
```

The registry always loads from the cached JSON file. If the remote service is
temporarily unavailable, the last valid cache remains usable.

The desktop runtime watches the manifest file metadata during expert team API
reads. If the file is changed, added, or removed, the registry is rescanned
without restarting the backend. Remote teams are read-only. If a remote team ID
collides with a preset, user, or project team, the local team wins and the
remote entry is skipped.

## Schema 1.0

```json
{
  "schema_version": "1.0",
  "tenant_id": "workcraft",
  "account_id": "local-dev",
  "generated_at": "2026-05-28T12:00:00Z",
  "expires_at": null,
  "etag": "mock-v1",
  "teams": [
    {
      "remote_id": "market_research_team",
      "runtime_id": "remote_workcraft_market_research_team",
      "version": "1.2.0",
      "channel": "stable",
      "license": {
        "status": "active",
        "features": ["summon", "resume"],
        "expires_at": null
      },
      "visibility": {
        "listed": true,
        "category": "业务策略",
        "tags": ["远程"]
      },
      "team": {
        "id": "remote_workcraft_market_research_team",
        "name": "市场调研专家团",
        "description": "分析市场、竞品和落地策略。",
        "icon": "users",
        "version": "1.2.0",
        "process": "workflow",
        "concurrency": 1,
        "tags": ["市场调研"],
        "category": "业务策略",
        "members": [
          {
            "id": "analyst",
            "name": "市场分析师",
            "role": "市场研究",
            "goal": "识别目标市场、竞品格局和机会点。"
          },
          {
            "id": "strategist",
            "name": "策略顾问",
            "role": "业务策略",
            "goal": "基于调研结果形成可执行建议。"
          }
        ],
        "tasks": [
          {
            "id": "research",
            "name": "市场调研",
            "member": "analyst",
            "task": "围绕 {{user_input}} 输出市场与竞品分析。",
            "expected_output": "结构化市场调研报告。",
            "output": "research_report"
          },
          {
            "id": "strategy",
            "name": "策略建议",
            "member": "strategist",
            "depends_on": ["research"],
            "context": ["research"],
            "task": "根据 {{research_report}} 给出产品定位、风险和行动建议。",
            "expected_output": "可执行的策略建议。",
            "output": "strategy_report"
          }
        ]
      }
    }
  ]
}
```

Only entries with `license.status` set to `active`, non-expired license
metadata, and `visibility.listed=true` are loaded.

Invalid entries are skipped individually and logged; one bad published team does
not prevent other valid teams in the manifest from loading.
