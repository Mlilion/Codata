# Codata「首次可用」P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Codata 从 demo 推进到「零基础用户能连数据、能得到可信分析」——修 4 个阻断级 P0。

**Architecture:** 四个相互独立的改动。模块1改 `run_query` 让 LLM 看到结果行（纯后端，前端零改动）；模块2在 prompt 层强制口径校验+数量级自检；模块3把 datasage 加为可发现的种子连接器；模块4默认落 codata 模式并加空状态引导。

**Tech Stack:** Python 3 / FastAPI / pytest（后端），Next.js / React / TypeScript / zustand（前端）。后端虚拟环境 `backend/venv`。

## Global Constraints

- 后端测试命令：`cd backend && source venv/bin/activate && python -m pytest <path> -q`。
- 前端校验命令：`cd frontend && npx tsc --noEmit && npx eslint <files>`（此环境 chromium 不可用，Playwright UI 测试写但不强制在此环境跑）。
- Git remote 用 SSH，push 用 `git push`（origin 已是 `github-mlilion:` 别名）。当前分支 `feat/data-agent-focus`。
- 提交信息用中文正文可，遵循 `type: subject` 格式。
- 数据分析团队判定靠 tag「数据分析」，不要动预设的 tags。
- `run_query` 结果 metadata 形状不可变（前端 DataResultCard 依赖它）。

---

## 模块 1：run_query 把结果行喂回 LLM

### Task 1: run_query 结果预览喂回 LLM

**Files:**
- Modify: `backend/app/tool/builtin/run_query.py`（新增 `_format_rows_preview`，改 `_result_from_parsed` at 160-174；新增两个常量）
- Test: `backend/tests/test_tool/test_run_query.py`

**Interfaces:**
- Consumes: `_result_from_parsed(parsed: dict, sql: str) -> ToolResult`（现有）；parsed metadata 含 `columns: list[str]`、`rows: list[list]`（datasage_parser 输出，键名为 `columns`/`rows`，见现有测试 `r.metadata["rows"]`）、`row_count: int`。
- Produces: `_format_rows_preview(columns: list[str], rows: list[list], row_count: int) -> str`（供本任务内部使用；返回 Markdown 表格预览字符串）。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_tool/test_run_query.py` 末尾（`_no_sleep` 定义之前，`TestRunQuery` 类内）追加测试。先在文件顶部 import 区加入被测函数：

```python
from app.tool.builtin.run_query import RunQueryTool, _format_rows_preview
```

在 `TestRunQuery` 类内新增：

```python
    async def test_sync_result_feeds_rows_to_output(self, monkeypatch):
        client = _FakeClient({
            "execute_sql": [_sync_result([["App", 10], ["Web", 20]], ["channel", "dau"])],
        })
        _install(monkeypatch, client)
        r = await RunQueryTool().execute({"sql": "SELECT channel, dau FROM t"}, _ctx())
        assert r.success
        # metadata 形状不变
        assert r.metadata["rows"] == [["App", 10], ["Web", 20]]
        # output 现在含可读的数据预览，模型能看到实际值
        assert "channel" in r.output and "dau" in r.output
        assert "App" in r.output and "10" in r.output
        assert "2 行" in r.output

    async def test_empty_result_output(self, monkeypatch):
        client = _FakeClient({"execute_sql": [_sync_result([], ["channel", "dau"])]})
        _install(monkeypatch, client)
        r = await RunQueryTool().execute({"sql": "SELECT channel, dau FROM t WHERE 1=0"}, _ctx())
        assert r.success
        assert "无数据行匹配" in r.output
```

在文件外层（类外，与 `_no_sleep` 同级）新增纯函数测试：

```python
def test_format_rows_preview_caps_rows():
    cols = ["a"]
    rows = [[i] for i in range(120)]
    out = _format_rows_preview(cols, rows, row_count=120)
    # 只预览前 50 行 + 标注总数
    assert out.count("\n") < 60
    assert "120" in out  # 总行数标注
    assert "前 50 行" in out

def test_format_rows_preview_truncates_wide_cell():
    cols = ["blob"]
    rows = [["x" * 500]]
    out = _format_rows_preview(cols, rows, row_count=1)
    assert "…" in out
    assert "x" * 500 not in out
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_tool/test_run_query.py -q`
Expected: FAIL — `ImportError: cannot import name '_format_rows_preview'`。

- [ ] **Step 3: 实现 `_format_rows_preview` 并接入 `_result_from_parsed`**

在 `backend/app/tool/builtin/run_query.py` 顶部常量区（`POLL_TIMEOUT_SECONDS = 60.0` 之后）新增：

```python
# Result-preview limits fed back to the LLM (metadata still carries full rows).
PREVIEW_MAX_ROWS = 50
PREVIEW_MAX_CELL_CHARS = 200
PREVIEW_MAX_TOTAL_CHARS = 4000
```

在 `_result_from_parsed` 之前新增函数：

```python
def _format_rows_preview(columns: list[str], rows: list[list], row_count: int) -> str:
    """Render a compact Markdown-table preview of the result for the LLM.

    The full result stays in metadata for the frontend; this text is what the
    model actually sees, so it can summarise, cite numbers, and chart. Capped
    on rows, cell width, and total chars to protect the context window.
    """
    cols = [str(c) for c in (columns or [])]
    if not cols:
        return ""

    def _cell(v: Any) -> str:
        s = "" if v is None else str(v)
        if len(s) > PREVIEW_MAX_CELL_CHARS:
            s = s[: PREVIEW_MAX_CELL_CHARS - 1] + "…"
        return s.replace("|", "\\|").replace("\n", " ")

    preview_rows = rows[:PREVIEW_MAX_ROWS]
    lines = [
        "| " + " | ".join(cols) + " |",
        "| " + " | ".join("---" for _ in cols) + " |",
    ]
    for row in preview_rows:
        cells = [_cell(row[i]) if i < len(row) else "" for i in range(len(cols))]
        lines.append("| " + " | ".join(cells) + " |")
    table = "\n".join(lines)

    if len(table) > PREVIEW_MAX_TOTAL_CHARS:
        table = table[:PREVIEW_MAX_TOTAL_CHARS] + "\n| …(预览已截断) |"
    if row_count > len(preview_rows):
        table += f"\n\n(数据集共 {row_count} 行，以上为前 {len(preview_rows)} 行预览；完整结果见数据面板)"
    return table
```

改写 `_result_from_parsed`（160-174）：

```python
def _result_from_parsed(parsed: dict[str, Any], sql: str) -> ToolResult:
    """Wrap a parsed sql_result metadata dict into a ToolResult.

    metadata shape matches datasage_parser output → DataResultCard renders it.
    output carries a readable row preview so the LLM can actually reason over
    the data (summarise, cite numbers, pass rows to chart_spec).
    """
    meta = dict(parsed)
    meta.setdefault("sql", sql)
    columns = meta.get("columns", [])
    rows = meta.get("rows", [])
    row_count = meta.get("row_count", len(rows))
    col_count = len(columns)

    header = f"查询成功:{row_count} 行 · {col_count} 列"
    if row_count == 0:
        output = "查询成功，但无数据行匹配"
    else:
        preview = _format_rows_preview(columns, rows, row_count)
        output = f"{header}\n\n{preview}" if preview else header

    return ToolResult(output=output, title="查询结果", metadata=meta)
```

注意：`columns` 在 metadata 里可能是字符串列表或 dict 列表（parser 视来源而定）。若为 dict（形如 `{"name": "channel"}`），`_format_rows_preview` 的 `str(c)` 会退化。**先在 Step 1 用现有 `_sync_result`（其 columns 是字符串列表）验证主路径**；若发现 parser 输出 dict 列，在此步给 `_format_rows_preview` 开头加一行归一化：`cols = [c.get("name") if isinstance(c, dict) else str(c) for c in (columns or [])]`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_tool/test_run_query.py -q`
Expected: PASS（全部，含原有 7 个）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/tool/builtin/run_query.py backend/tests/test_tool/test_run_query.py
git commit -m "feat: run_query feeds a result-row preview back to the LLM

Previously run_query returned only 'N 行·M 列' to the model; rows lived only in
metadata (frontend). The model couldn't summarise, cite numbers, pass rows to
chart_spec, or answer data-dependent follow-ups. Now output carries a capped
Markdown preview (50 rows / 200 chars per cell / 4000 chars total) while
metadata is unchanged, so the frontend DataResultCard renders exactly as before."
```

---

## 模块 4 + 模块 3（协同）：默认 codata + 空状态引导 + datasage 种子连接器

> 模块4的空状态引导依赖模块3的「datasage 卡片可发现」+「连接状态可查」，故一起实现。先做后端连接状态端点 → datasage 卡片 → 默认模式 → 空状态引导。

### Task 2: 后端「数据源已连接」状态端点

**Files:**
- Modify: `backend/app/api/` 中合适的路由文件（复用已有 mcp/connector 相关路由；若无合适文件则在 `backend/app/api/mcp.py` 或等价文件新增）
- Test: `backend/tests/test_api/`（新增 `test_data_source_status.py`）

**Interfaces:**
- Consumes: `from app.mcp.datasage_client import find_execute_sql_client`（现有；无连接返回 None）。
- Produces: `GET /api/data-source/status` → `{"connected": bool}`。

- [ ] **Step 1: 定位挂载点**

Run: `cd backend && grep -rn "APIRouter\|include_router" app/api/mcp.py app/main.py | head`
读出现有 mcp 路由的 prefix 与注册方式，决定把新端点加到哪个 router（优先复用现有 mcp/connector router，保持前缀一致）。

- [ ] **Step 2: 写失败测试**

新建 `backend/tests/test_api/test_data_source_status.py`：

```python
import pytest


@pytest.mark.asyncio
async def test_status_disconnected(app_client, monkeypatch):
    import app.api.mcp as mcp_api  # adjust to the module where the route lives
    monkeypatch.setattr(mcp_api, "find_execute_sql_client", lambda *a, **k: None)
    resp = await app_client.get("/api/data-source/status")
    assert resp.status_code == 200
    assert resp.json() == {"connected": False}


@pytest.mark.asyncio
async def test_status_connected(app_client, monkeypatch):
    import app.api.mcp as mcp_api
    monkeypatch.setattr(mcp_api, "find_execute_sql_client", lambda *a, **k: object())
    resp = await app_client.get("/api/data-source/status")
    assert resp.status_code == 200
    assert resp.json() == {"connected": True}
```

（若 route 落在别的模块，把 import 路径同步改掉。）

- [ ] **Step 3: 运行测试确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_api/test_data_source_status.py -q`
Expected: FAIL — 404（路由不存在）。

- [ ] **Step 4: 实现端点**

在选定的路由模块加入（顶部 import `from app.mcp.datasage_client import find_execute_sql_client`）：

```python
@router.get("/data-source/status")
async def data_source_status() -> dict[str, bool]:
    """Whether an execute_sql-capable data source (datasage) is connected.

    Drives the Codata empty-state onboarding.
    """
    return {"connected": find_execute_sql_client() is not None}
```

确认最终路径解析为 `/api/data-source/status`（按该 router 的 prefix 调整装饰器路径）。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_api/test_data_source_status.py -q`
Expected: PASS（2 个）。

- [ ] **Step 6: 提交**

```bash
git add backend/app/api/ backend/tests/test_api/test_data_source_status.py
git commit -m "feat: GET /api/data-source/status reports datasage connection state

Backs the Codata empty-state onboarding — the frontend can tell whether an
execute_sql-capable data source is connected without running a query."
```

### Task 3: datasage 种子连接器卡片

**Files:**
- Modify: `backend/app/data/connectors.json`
- Test: `backend/tests/`（新增或复用现有 connectors 测试；若无则新建 `test_connectors_catalog.py`）

**Interfaces:**
- Consumes: connectors.json 条目 schema `{name, url, description, category}`（现有）。
- Produces: 一个 `datasage` 键，`category: "data"`。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_connectors_catalog.py`：

```python
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
    # url 存在但为空占位——datasage 地址因部署而异，由用户填写
    assert "url" in entry
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_connectors_catalog.py -q`
Expected: FAIL — `KeyError`/assert（datasage 不在目录）。

- [ ] **Step 3: 加 datasage 条目**

在 `backend/app/data/connectors.json` 顶部（第一个键之前）加入：

```json
  "datasage": {
    "name": "datasage 数据平台",
    "url": "",
    "description": "连接你的 datasage 数据平台：用自然语言查询、分析、出图。点击后填写你的 MCP 地址。",
    "category": "data"
  },
```

（`url` 留空——datasage 地址因部署而异，由用户在连接时填写。确认 JSON 逗号语法正确。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_connectors_catalog.py -q && python -c "import json; json.load(open('app/data/connectors.json'))"`
Expected: PASS + JSON 合法（无输出即合法）。

- [ ] **Step 5: 前端校验空 url 不崩**

Run: `cd frontend && grep -n "\.url" src/app/\(main\)/plugins/content.tsx | head`
确认渲染连接器卡片时空 `url` 不会导致崩溃（只作展示/预填）。若 connect 流程直接用 `url` 发起且空值会报错，在 `AddConnectorForm`/connect 处理里对空 url 走「要求用户先填 URL」分支（datasage 卡片点击 → 打开 AddConnectorForm 并预填 name=datasage 数据平台、url 空待填）。把该调整并入本步。

- [ ] **Step 6: 提交**

```bash
git add backend/app/data/connectors.json backend/tests/test_connectors_catalog.py frontend/src/app/\(main\)/plugins/content.tsx
git commit -m "feat: datasage as a discoverable seed connector

Adds a datasage card to the connector catalog (category data, empty url — the
MCP address is deployment-specific and filled in by the user via the existing
add-connector flow). Makes the core data connection discoverable instead of
requiring users to hand-add a custom MCP server."
```

### Task 4: 默认 codata 模式

**Files:**
- Modify: `frontend/src/stores/sidebar-store.ts:62`

**Interfaces:**
- Consumes/Produces: zustand store 初始 `appMode`。持久化字段——只影响空 localStorage 的新用户。

- [ ] **Step 1: 改默认值**

`frontend/src/stores/sidebar-store.ts:62`，把 `appMode: "chat",` 改为 `appMode: "codata",`。

- [ ] **Step 2: 校验**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过（0 error）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/stores/sidebar-store.ts
git commit -m "feat: default new users to codata mode

Codata is a data-analysis product; new users (empty localStorage) should land
in the data workspace, not the generic chat mode. Existing users keep their
persisted choice."
```

### Task 5: Codata landing 空状态引导

**Files:**
- Modify: `frontend/src/components/chat/landing.tsx`（codata 分支）
- Create: `frontend/src/hooks/use-data-source-status.ts`
- Modify: `frontend/src/lib/constants.ts`（加 endpoint 常量，若该文件是 API 常量所在）

**Interfaces:**
- Consumes: `GET /api/data-source/status` → `{connected: boolean}`（Task 2）。
- Produces: `useDataSourceStatus()` hook → `{ data?: {connected: boolean}, isLoading: boolean }`。

- [ ] **Step 1: 加 endpoint 常量**

在 `frontend/src/lib/constants.ts` 的 API 常量区加入（对齐现有写法，如 `SESSIONS`/`DASHBOARD` 的形式）：

```typescript
  DATA_SOURCE: {
    STATUS: "/api/data-source/status",
  },
```
（放进已有的 `API` 对象；确认前缀与其它 endpoint 一致。）

- [ ] **Step 2: 写 hook**

新建 `frontend/src/hooks/use-data-source-status.ts`：

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

export function useDataSourceStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["data-source-status"],
    queryFn: () => api.get<{ connected: boolean }>(API.DATA_SOURCE.STATUS),
    enabled,
    staleTime: 30_000,
  });
}
```
（对齐仓库现有 hook 里 `api.get` 的真实签名——先 `grep -n "api.get" frontend/src/hooks/*.ts | head` 确认返回是否需 `.data` 解包，按实际调整。）

- [ ] **Step 3: 在 landing 的 codata 分支渲染空状态引导**

先读 `frontend/src/components/chat/landing.tsx` 找到 `isCodata` 分支与推荐渲染处（`useAnalysisRecommendations`）。在 codata 分支加入：

```tsx
const { data: dsStatus } = useDataSourceStatus(isCodata);
const dataConnected = dsStatus?.connected ?? true; // 加载中先不显示引导，避免闪烁
```

当 `isCodata && !dataConnected` 时，渲染三步引导卡片（替换/置于推荐列表之上）：

```tsx
{isCodata && !dataConnected ? (
  <div className="mx-auto max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-5 text-left">
    <p className="mb-3 text-ui-body font-medium text-[var(--text-primary)]">开始你的第一次分析</p>
    <ol className="space-y-2 text-ui-caption text-[var(--text-secondary)]">
      <li>① <Link href="/mcp" className="underline">连接数据源</Link>（datasage 数据平台）</li>
      <li>② <Link href="/settings?tab=providers" className="underline">配置模型</Link></li>
      <li>③ 回到这里，用自然语言提出你的第一个数据问题</li>
    </ol>
  </div>
) : (
  /* 现有的分析建议渲染保持不变 */
)}
```
（`Link` 从 `next/link` import；className 对齐 landing 现有 token 用法。把现有推荐 JSX 放进 `:` 分支。）

- [ ] **Step 4: 修「基于你的分析历史」误标**

在 landing.tsx 找到推荐区标题（现为「基于你的分析历史」）。改为按有无历史区分：零历史（推荐为默认集）时显示「试试这些分析」，有历史时保留原文案。若前端无法直接区分是否默认集，简化为统一中性文案「推荐分析」（避免谎称基于历史）。

- [ ] **Step 5: 校验**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/components/chat/landing.tsx src/hooks/use-data-source-status.ts`
Expected: 0 error。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/chat/landing.tsx frontend/src/hooks/use-data-source-status.ts frontend/src/lib/constants.ts
git commit -m "feat: Codata empty-state onboarding + honest recommendation label

When no data source is connected, the Codata landing shows a 3-step guide
(connect datasage → configure model → ask your first question) instead of
canned recommendations. Fixes the misleading '基于你的分析历史' label for
zero-history users."
```

---

## 模块 2：口径强制校验 + 数量级 sanity-check

### Task 6: data.txt 强制口径 + sanity-check 步骤

**Files:**
- Modify: `backend/app/agent/prompts/data.txt`
- Modify: `backend/app/data/agency-agents-zh/data/metric-caliber-expert.md`
- Modify: `backend/app/tool/builtin/run_query.py`（工具 description 补一句）
- Test: `backend/tests/`（若已有 prompt 加载测试则加断言，否则新建轻量断言测试）

**Interfaces:**
- Consumes: `_load_prompt("data")`（现有 agent 加载路径）。
- Produces: 无代码接口变化——纯文本内容 + 一处 description 字符串。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_agent/test_data_prompt_caliber.py`（若 `test_agent` 目录不存在则建）：

```python
from pathlib import Path


def test_data_prompt_enforces_caliber_and_sanity_check():
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")
    # 口径：核心指标必须先 search_indicators 权威口径
    assert "search_indicators" in text
    assert "自定义口径" in text  # 无注册指标时须注明
    # 数量级 sanity-check
    assert "数量级" in text or "sanity" in text.lower()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_agent/test_data_prompt_caliber.py -q`
Expected: FAIL（`自定义口径`、`数量级` 尚未出现）。

- [ ] **Step 3: 改 data.txt**

把 `data.txt` 第 1 条工作流升级（替换现有 1-2 条口径措辞），并在工作流里新增 sanity-check 步骤。将现有第 1 条改为：

```
1. Discover before you query. Use search_tables / list_tables to locate a
   table and get_table_profile to read its schema. For any core business
   metric (GMV / DAU / 转化率 / 留存 etc.) you MUST first call
   search_indicators and use the registered metric's authoritative
   calculation_rule — do not hand-write the SQL for a core metric. Only if no
   registered metric exists may you write your own SQL, and then you MUST note
   in your reply that it is a 自定义口径 (未经指标中心验证).
```

在第 5 条（chart_spec）之后、第 6 条之前插入新的 sanity-check 步骤（其余步骤顺延）：

```
6. Sanity-check the numbers before concluding. Is the 数量级 (order of
   magnitude) plausible? Does a total roughly equal the sum of its parts? Is a
   MoM/YoY swing large enough to suspect a wrong caliber or bad data? If
   something looks off, re-check the caliber or query rather than reporting it
   as fact.
```

- [ ] **Step 4: 改 metric-caliber-expert.md**

在 `backend/app/data/agency-agents-zh/data/metric-caliber-expert.md` 的「工作方式」区补一条：

```
- 先用 search_indicators 校准口径(优先权威 calculation_rule)，再对结果做数量级
  sanity-check：总数是否≈各分组之和、环比/同比是否异常到需怀疑口径或数据。
```

- [ ] **Step 5: 改 run_query 工具 description**

`backend/app/tool/builtin/run_query.py` 的 `description` property（约 47-54），在结尾追加一句：

```
"Before querying a core business metric, prefer a registered metric's "
"authoritative caliber (search_indicators) over hand-writing the SQL. "
```
（拼接进现有返回字符串，注意字符串相邻拼接语法。）

- [ ] **Step 6: 运行测试确认通过**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_agent/test_data_prompt_caliber.py tests/test_tool/test_run_query.py -q`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/app/agent/prompts/data.txt backend/app/data/agency-agents-zh/data/metric-caliber-expert.md backend/app/tool/builtin/run_query.py backend/tests/test_agent/test_data_prompt_caliber.py
git commit -m "feat: enforce metric caliber + magnitude sanity-check in data agent

Core-metric queries must go through search_indicators' authoritative
calculation_rule (hand-written SQL only when no registered metric exists, and
flagged as 自定义口径). Adds a sanity-check step (magnitude / parts-sum /
MoM-YoY plausibility) so wrong-but-plausible numbers get caught before they
ship."
```

---

## 最终验证（全部任务完成后）

- [ ] **后端全量**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/ -q`
Expected: 仅剩已知的 5 个 `test_web_search.py::TestFormatSerperResults` 预存失败，其余全绿。

- [ ] **前端全量**

Run: `cd frontend && npx tsc --noEmit && npx eslint && npx next build`
Expected: 0 error，build 成功。

- [ ] **人工端到端**（真实 datasage + LLM，若环境具备）

清 localStorage → 打开应用应落 codata → 未连数据源见三步引导 → 从连接器目录点 datasage 卡片填 URL + 授权 → 问一个核心指标 → 确认 agent 先 search_indicators、run_query 后能在回复里引用具体数字并出图 → 追问「按维度拆分」能基于上一轮结果继续。

- [ ] **推送**

```bash
git push
```

---

## Self-Review 记录

- **Spec 覆盖**：模块1→Task1；模块2→Task6；模块3→Task2(状态端点)+Task3(卡片);模块4→Task4(默认)+Task5(空状态)。四模块全覆盖。
- **Placeholder**：无 TBD/TODO；每个代码步给出完整代码或明确的「先 grep 确认再对齐」现实约束（前端 API 签名/路由前缀因仓库实际而异处已标注需核对）。
- **类型一致**：`_format_rows_preview(columns, rows, row_count)` 在 Task1 定义并使用；`/api/data-source/status` 返回 `{connected: bool}` 在 Task2 产出、Task5 消费；`useDataSourceStatus(enabled)` 在 Task5 定义并使用。
