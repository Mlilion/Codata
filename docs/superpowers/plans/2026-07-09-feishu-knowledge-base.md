# 飞书文档知识库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户把飞书文档链接登记进 Codata 知识库,data agent 每轮看到文档清单、并能按需通过飞书官方 MCP 读取正文作为回答的权威背景。

**Architecture:** 三部分,各复用现成机制:(1) 知识库管理 = 新 `KnowledgeEntry` 表 + CRUD API + 前端 `/knowledge` 页(仿 skills/connectors);(2) 飞书读取 = 官方 `larksuite/lark-openapi-mcp` 作为 seed 连接器接入现有 `ConnectorRegistry`;(3) agent 使用 = 新 `read_knowledge` builtin 工具(复用 `datasage_client` 同款"按工具名定位 MCP client")+ 每轮把 enabled 文档清单注入 data agent system prompt(仿 `analysis_memory_injection`)。落地在现有桌面端内嵌后端(SQLite)。

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy async (aiosqlite) / Next.js + TypeScript + Tailwind / pytest。

## Global Constraints

- 数据模型预留 `user_id`(nullable,现为 null=单用户全局)+ `scope`(默认 "personal"),为将来迁独立后端多用户共享留位——copy 自 `analysis_memory.py` 的注释约定。
- 新表通过在 `app/main.py` 启动区 import 模型模块注册到 `Base.metadata`,由现有 `create_all` + `_add_missing_columns` 自动建表——**不引入 alembic 迁移文件**。
- 后端只读:知识库只读飞书,不写飞书。
- 飞书 MCP 服务器名用户可配,定位 client **按工具名**(如 `docx.v1.document.rawContent`),不用固定服务器名——同 `datasage_client.py` 原则。
- 中文面向用户文案(错误提示、空态、prompt 引导)与现有代码保持一致的中文风格。
- 所有 MCP 调用、DB 会话失败必须返回明确错误,不吞异常静默。

---

### Task 1: KnowledgeEntry 数据模型 + 飞书 URL 解析

**Files:**
- Create: `backend/app/models/knowledge_entry.py`
- Create: `backend/app/knowledge/__init__.py`
- Create: `backend/app/knowledge/feishu_url.py`
- Modify: `backend/app/main.py:104-108`(在模型注册区加一行 import)
- Test: `backend/tests/test_knowledge/__init__.py`
- Test: `backend/tests/test_knowledge/test_feishu_url.py`

**Interfaces:**
- Produces: `KnowledgeEntry` ORM 模型(表 `knowledge_entry`),字段 `id, user_id, scope, title, feishu_url, feishu_token, doc_type, note, enabled, created_at, updated_at`。
- Produces: `parse_feishu_url(url: str) -> tuple[str, str]` 返回 `(doc_type, token)`;`doc_type ∈ {"docx","wiki","sheet","bitable"}`;无法识别抛 `ValueError`。

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_knowledge/test_feishu_url.py
from __future__ import annotations

import pytest

from app.knowledge.feishu_url import parse_feishu_url


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://sample.feishu.cn/docx/AbCd1234efGh", ("docx", "AbCd1234efGh")),
        ("https://sample.feishu.cn/wiki/WxYz9876", ("wiki", "WxYz9876")),
        ("https://sample.feishu.cn/sheets/Sh33tT0k3n", ("sheet", "Sh33tT0k3n")),
        ("https://sample.feishu.cn/base/Bas3T0k3n", ("bitable", "Bas3T0k3n")),
        ("https://sample.feishu.cn/docx/AbCd1234?from=space", ("docx", "AbCd1234")),
    ],
)
def test_parse_feishu_url_ok(url, expected):
    assert parse_feishu_url(url) == expected


def test_parse_feishu_url_rejects_non_feishu():
    with pytest.raises(ValueError):
        parse_feishu_url("https://example.com/docx/abc")


def test_parse_feishu_url_rejects_unknown_type():
    with pytest.raises(ValueError):
        parse_feishu_url("https://sample.feishu.cn/unknown/abc")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_knowledge/test_feishu_url.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.knowledge'`

- [ ] **Step 3: Create the package + URL parser**

```python
# backend/app/knowledge/__init__.py
```
(空文件)

```python
# backend/app/knowledge/feishu_url.py
"""Parse a Feishu/Lark document URL into (doc_type, token).

Feishu cloud-doc URLs look like:
    https://<tenant>.feishu.cn/docx/<token>
    https://<tenant>.feishu.cn/wiki/<token>
    https://<tenant>.feishu.cn/sheets/<token>
    https://<tenant>.feishu.cn/base/<token>
We map the path segment to an internal doc_type and extract the token.
"""

from __future__ import annotations

from urllib.parse import urlparse

# path segment -> internal doc_type
_SEGMENT_TO_TYPE = {
    "docx": "docx",
    "docs": "docx",
    "wiki": "wiki",
    "sheets": "sheet",
    "sheet": "sheet",
    "base": "bitable",
    "bitable": "bitable",
}


def parse_feishu_url(url: str) -> tuple[str, str]:
    """Return (doc_type, token). Raise ValueError if not a recognised Feishu URL."""
    if not isinstance(url, str) or not url.strip():
        raise ValueError("链接不能为空")
    parsed = urlparse(url.strip())
    host = (parsed.netloc or "").lower()
    if "feishu.cn" not in host and "larksuite.com" not in host:
        raise ValueError("不是有效的飞书文档链接")
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) < 2:
        raise ValueError("无法从链接解析出文档类型和 token")
    seg, token = segments[0], segments[1]
    doc_type = _SEGMENT_TO_TYPE.get(seg)
    if doc_type is None:
        raise ValueError(f"暂不支持的飞书文档类型: {seg}")
    return doc_type, token
```

- [ ] **Step 4: Run URL test to verify it passes**

Run: `cd backend && python -m pytest tests/test_knowledge/test_feishu_url.py -v`
Expected: PASS (all cases)

- [ ] **Step 5: Create the model**

```python
# backend/app/models/knowledge_entry.py
"""KnowledgeEntry model — a user-registered Feishu document link.

Users paste Feishu doc links into the knowledge base; the data agent sees a
list of them each turn and can read a doc's body on demand via the Feishu MCP.
Open-source build is single-user, so ``user_id`` stays null; ``user_id`` and
``scope`` are reserved for a future multi-user (team-shared) upgrade.
"""

from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.utils.id import generate_ulid


class KnowledgeEntry(Base, TimestampMixin):
    __tablename__ = "knowledge_entry"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_ulid)
    # Reserved for multi-user; null = the single open-source user.
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Reserved for personal/team visibility; default personal.
    scope: Mapped[str] = mapped_column(String, nullable=False, default="personal")
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    feishu_url: Mapped[str] = mapped_column(Text, nullable=False)
    feishu_token: Mapped[str] = mapped_column(String, nullable=False)
    doc_type: Mapped[str] = mapped_column(String, nullable=False)  # docx/wiki/sheet/bitable
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```

- [ ] **Step 6: Register the model at startup**

In `backend/app/main.py`, in the model-registration block (around line 104-108, next to the other `# noqa: F401 — registers ...` imports), add:

```python
    from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401 — registers KnowledgeEntry
```

- [ ] **Step 7: Write model smoke test**

```python
# backend/tests/test_knowledge/__init__.py
```
(空文件)

```python
# append to backend/tests/test_knowledge/test_feishu_url.py
from app.models.knowledge_entry import KnowledgeEntry


def test_knowledge_entry_defaults():
    e = KnowledgeEntry(feishu_url="u", feishu_token="t", doc_type="docx")
    # defaults are applied at flush; assert column defaults exist
    assert KnowledgeEntry.__tablename__ == "knowledge_entry"
    assert e.feishu_token == "t"
```

- [ ] **Step 8: Run all Task 1 tests**

Run: `cd backend && python -m pytest tests/test_knowledge/ -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/knowledge_entry.py backend/app/knowledge/ backend/app/main.py backend/tests/test_knowledge/
git commit -m "feat(knowledge): KnowledgeEntry model + feishu URL parser"
```

---

### Task 2: 知识库 CRUD API

**Files:**
- Create: `backend/app/api/knowledge.py`
- Modify: `backend/app/api/router.py`(import + include_router)
- Test: `backend/tests/test_api/test_knowledge.py`

**Interfaces:**
- Consumes: `KnowledgeEntry`(Task 1), `parse_feishu_url`(Task 1), `get_session_factory` from `app.storage.database`.
- Produces HTTP endpoints:
  - `GET /api/knowledge` → `{"entries": [ {id,title,feishu_url,doc_type,note,enabled,created_at} ]}`
  - `POST /api/knowledge` body `{feishu_url: str, note?: str, title?: str}` → 单条 entry dict;URL 非法 → 400
  - `PATCH /api/knowledge/{id}` body `{note?: str, enabled?: bool, title?: str}` → 更新后的 entry dict;不存在 → 404
  - `DELETE /api/knowledge/{id}` → `{"ok": true}`;不存在 → 404
- Produces: `_entry_to_dict(entry) -> dict` 序列化辅助。

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_api/test_knowledge.py
"""Tests for the knowledge base CRUD endpoints."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.fixture
async def client():
    app = create_app()
    # run lifespan so DB tables are created
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        async with app.router.lifespan_context(app):
            yield c


async def _auth_headers(app_client):
    # local API requires bearer token; tests read it from app.state via a helper.
    return {}


@pytest.mark.anyio
async def test_add_and_list_knowledge(client):
    r = await client.post(
        "/api/knowledge",
        json={"feishu_url": "https://x.feishu.cn/docx/Tok123", "note": "口径说明"},
    )
    assert r.status_code == 200, r.text
    entry = r.json()
    assert entry["doc_type"] == "docx"
    assert entry["feishu_token"] == "Tok123"
    assert entry["note"] == "口径说明"

    r2 = await client.get("/api/knowledge")
    assert r2.status_code == 200
    ids = [e["id"] for e in r2.json()["entries"]]
    assert entry["id"] in ids


@pytest.mark.anyio
async def test_add_rejects_bad_url(client):
    r = await client.post("/api/knowledge", json={"feishu_url": "https://example.com/x"})
    assert r.status_code == 400


@pytest.mark.anyio
async def test_patch_and_delete(client):
    r = await client.post(
        "/api/knowledge", json={"feishu_url": "https://x.feishu.cn/wiki/W1"}
    )
    eid = r.json()["id"]

    rp = await client.patch(f"/api/knowledge/{eid}", json={"enabled": False, "note": "n2"})
    assert rp.status_code == 200
    assert rp.json()["enabled"] is False
    assert rp.json()["note"] == "n2"

    rd = await client.delete(f"/api/knowledge/{eid}")
    assert rd.status_code == 200
    rp2 = await client.patch(f"/api/knowledge/{eid}", json={"note": "x"})
    assert rp2.status_code == 404
```

**Note on auth:** the local API enforces bearer auth. Check `backend/tests/test_api/test_dashboard.py` for how existing API tests bypass/inject the session token (via conftest fixtures). Mirror that exact setup here — if `test_dashboard.py` uses an `authed_client` fixture from `conftest.py`, use the same fixture name instead of the raw `client` above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_api/test_knowledge.py -v`
Expected: FAIL — 404 on `/api/knowledge` (route not mounted)

- [ ] **Step 3: Implement the router**

```python
# backend/app/api/knowledge.py
"""Knowledge base CRUD — user-registered Feishu document links."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.knowledge.feishu_url import parse_feishu_url
from app.models.knowledge_entry import KnowledgeEntry
from app.storage.database import get_session_factory

router = APIRouter(prefix="/knowledge")


def _entry_to_dict(e: KnowledgeEntry) -> dict[str, Any]:
    return {
        "id": e.id,
        "title": e.title,
        "feishu_url": e.feishu_url,
        "feishu_token": e.feishu_token,
        "doc_type": e.doc_type,
        "note": e.note,
        "enabled": e.enabled,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


class AddBody(BaseModel):
    feishu_url: str
    note: str | None = None
    title: str | None = None


class PatchBody(BaseModel):
    note: str | None = None
    enabled: bool | None = None
    title: str | None = None


@router.get("")
async def list_knowledge() -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        rows = (await session.execute(
            select(KnowledgeEntry).order_by(KnowledgeEntry.created_at.desc())
        )).scalars().all()
        return {"entries": [_entry_to_dict(e) for e in rows]}


@router.post("")
async def add_knowledge(body: AddBody) -> dict[str, Any]:
    try:
        doc_type, token = parse_feishu_url(body.feishu_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    factory = get_session_factory()
    async with factory() as session:
        entry = KnowledgeEntry(
            feishu_url=body.feishu_url.strip(),
            feishu_token=token,
            doc_type=doc_type,
            note=(body.note or "").strip(),
            title=(body.title or "").strip(),
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        return _entry_to_dict(entry)


@router.patch("/{entry_id}")
async def patch_knowledge(entry_id: str, body: PatchBody) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        entry = await session.get(KnowledgeEntry, entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="知识条目不存在")
        if body.note is not None:
            entry.note = body.note.strip()
        if body.enabled is not None:
            entry.enabled = body.enabled
        if body.title is not None:
            entry.title = body.title.strip()
        await session.commit()
        await session.refresh(entry)
        return _entry_to_dict(entry)


@router.delete("/{entry_id}")
async def delete_knowledge(entry_id: str) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        entry = await session.get(KnowledgeEntry, entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="知识条目不存在")
        await session.delete(entry)
        await session.commit()
        return {"ok": True}
```

**Verify before running:** confirm `get_session_factory` is importable from `app.storage.database` (grep it). If the project exposes the factory differently (e.g. `from app.dependencies import get_session_factory`), use that import instead — match whatever `app/api/dashboard.py` uses to get a DB session.

- [ ] **Step 4: Mount the router**

In `backend/app/api/router.py`, add the import next to the others:

```python
from app.api import knowledge as knowledge_api
```

And add the include next to `connectors_api`:

```python
api_router.include_router(knowledge_api.router, tags=["knowledge"])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_api/test_knowledge.py -v`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/knowledge.py backend/app/api/router.py backend/tests/test_api/test_knowledge.py
git commit -m "feat(knowledge): CRUD API for feishu knowledge entries"
```

---

### Task 3: read_knowledge builtin 工具

**Files:**
- Create: `backend/app/knowledge/feishu_reader.py`
- Create: `backend/app/tool/builtin/read_knowledge.py`
- Modify: `backend/app/main.py`(在 `_register_builtin_tools` 里 import + register)
- Test: `backend/tests/test_knowledge/test_read_knowledge.py`

**Interfaces:**
- Consumes: `KnowledgeEntry`(Task 1), `get_session_factory`, MCP manager via `app.dependencies.get_connector_registry` (same pattern as `datasage_client._manager_from_singleton`).
- Produces: `find_feishu_client(manager=None)` → connected MCP client exposing a Feishu doc-read tool, or None.
- Produces: `read_feishu_doc(client, doc_type, token) -> str`(调飞书 MCP 读正文纯文本)。
- Produces: `ReadKnowledgeTool(ToolDefinition)` id=`read_knowledge`,参数 `{entry_id?: str}`;无参→列已登记 enabled 文档;有参→读该文档正文。

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_knowledge/test_read_knowledge.py
from __future__ import annotations

import pytest

from app.knowledge.feishu_reader import find_feishu_client


class _Tool:
    def __init__(self, name): self.name = name


class _Client:
    def __init__(self, tools, status="connected"):
        self.status = status
        self._tools = tools
    def list_tools(self):
        return [_Tool(t) for t in self._tools]


class _Manager:
    def __init__(self, clients):
        self._clients = clients


def test_find_feishu_client_by_tool_name():
    mgr = _Manager({
        "a": _Client(["execute_sql"]),
        "b": _Client(["docx.v1.document.rawContent", "wiki.v2.space.getNode"]),
    })
    client = find_feishu_client(mgr)
    assert client is mgr._clients["b"]


def test_find_feishu_client_skips_disconnected():
    mgr = _Manager({
        "b": _Client(["docx.v1.document.rawContent"], status="failed"),
    })
    assert find_feishu_client(mgr) is None


def test_find_feishu_client_none_when_absent():
    mgr = _Manager({"a": _Client(["execute_sql"])})
    assert find_feishu_client(mgr) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_knowledge/test_read_knowledge.py -v`
Expected: FAIL — `ModuleNotFoundError: app.knowledge.feishu_reader`

- [ ] **Step 3: Implement the Feishu reader helper**

```python
# backend/app/knowledge/feishu_reader.py
"""Locate the connected Feishu MCP client and read a document's body.

The Feishu MCP server name is user-configurable, so we locate the client by
a tool it exposes (a Feishu doc-read tool) rather than by a fixed server name
— same principle as app/mcp/datasage_client.find_execute_sql_client.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Tool names any Feishu MCP (official lark-openapi-mcp) exposes for reading a
# document body. We match on presence of any of these.
_FEISHU_READ_TOOLS = (
    "docx.v1.document.rawContent",
    "docx_v1_document_rawContent",
    "docx.builtin.search",
)


def _manager_from_singleton():
    try:
        from app.dependencies import get_connector_registry

        registry = get_connector_registry()
    except Exception:
        return None
    return getattr(registry, "mcp_manager", None) or getattr(registry, "_mcp_manager", None)


def find_feishu_client(manager: Any | None = None):
    """Return a connected MCP client exposing a Feishu doc-read tool, or None."""
    if manager is None:
        manager = _manager_from_singleton()
    if manager is None:
        return None
    for client in getattr(manager, "_clients", {}).values():
        if getattr(client, "status", None) != "connected":
            continue
        try:
            tool_names = {t.name for t in client.list_tools()}
        except Exception:
            continue
        if any(name in tool_names for name in _FEISHU_READ_TOOLS):
            return client
    return None


def _rawcontent_tool_name(client) -> str | None:
    try:
        names = {t.name for t in client.list_tools()}
    except Exception:
        return None
    for candidate in ("docx.v1.document.rawContent", "docx_v1_document_rawContent"):
        if candidate in names:
            return candidate
    return None


async def read_feishu_doc(client, doc_type: str, token: str) -> str:
    """Read a Feishu doc body as plain text via the MCP client.

    First-cut supports docx via rawContent. Other types raise a clear error.
    """
    if doc_type != "docx":
        raise ValueError(f"暂只支持读取 docx 文档,当前类型: {doc_type}")
    tool = _rawcontent_tool_name(client)
    if tool is None:
        raise RuntimeError("飞书 MCP 未提供文档读取工具")
    result = await client.call_tool(tool, {"document_id": token})
    from app.mcp.datasage_client import extract_text

    return extract_text(result)
```

**Note:** the exact rawContent argument name (`document_id` vs `documentId` vs `doc_token`) depends on the lark-openapi-mcp tool schema. During execution, once the Feishu MCP is connected (Task 4), verify the parameter name from its `tools/list` and correct this call. The plan uses `document_id` as the documented default.

- [ ] **Step 4: Run reader test to verify it passes**

Run: `cd backend && python -m pytest tests/test_knowledge/test_read_knowledge.py -v`
Expected: PASS (3 tests — they only exercise `find_feishu_client`)

- [ ] **Step 5: Implement the tool**

```python
# backend/app/tool/builtin/read_knowledge.py
"""read_knowledge — list registered Feishu knowledge docs and read one on demand."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select

from app.knowledge.feishu_reader import find_feishu_client, read_feishu_doc
from app.models.knowledge_entry import KnowledgeEntry
from app.storage.database import get_session_factory
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)

MAX_DOC_CHARS = 8000


class ReadKnowledgeTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "read_knowledge"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Access the user's registered Feishu knowledge base. Call with no "
            "arguments to list the registered documents (id, title, note). Call "
            "with an 'entry_id' to read that document's full text as authoritative "
            "background. Cite the source link in your answer when you use it."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "entry_id": {
                    "type": "string",
                    "description": "ID of a registered knowledge doc to read. Omit to list all.",
                },
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        entry_id = args.get("entry_id")
        factory = get_session_factory()

        if not entry_id:
            async with factory() as session:
                rows = (await session.execute(
                    select(KnowledgeEntry).where(KnowledgeEntry.enabled == True)  # noqa: E712
                )).scalars().all()
            listing = [
                {"id": e.id, "title": e.title or e.feishu_url, "note": e.note, "type": e.doc_type}
                for e in rows
            ]
            if not listing:
                return ToolResult(output="知识库为空,用户尚未登记任何飞书文档。")
            return ToolResult(output=json.dumps(listing, ensure_ascii=False))

        async with factory() as session:
            entry = await session.get(KnowledgeEntry, entry_id)
        if entry is None:
            return ToolResult(error=f"知识条目不存在: {entry_id}")

        client = find_feishu_client()
        if client is None:
            return ToolResult(error="飞书未连接。请先在连接器中授权飞书,才能读取文档。")

        try:
            body = await read_feishu_doc(client, entry.doc_type, entry.feishu_token)
        except Exception as exc:  # surface for self-correction
            return ToolResult(error=f"读取飞书文档失败: {exc}")

        if len(body) > MAX_DOC_CHARS:
            body = body[:MAX_DOC_CHARS] + "\n…(内容过长已截断)"
        header = f"文档《{entry.title or entry.feishu_url}》(来源: {entry.feishu_url})\n\n"
        return ToolResult(output=header + body)
```

**Verify before running:** confirm `ToolResult` accepts `output=` and `error=` kwargs (grep `class ToolResult` in `app/tool/base.py`) — mirror exactly how `run_query.py` constructs `ToolResult`.

- [ ] **Step 6: Register the tool**

In `backend/app/main.py`, inside `_register_builtin_tools` (near the other `from app.tool.builtin.* import ...` lines around line 494-503), add:

```python
    from app.tool.builtin.read_knowledge import ReadKnowledgeTool
```

Then register it alongside the other tools (find where `RunQueryTool` is instantiated/registered and mirror it):

```python
    tool_registry.register(ReadKnowledgeTool())
```

- [ ] **Step 7: Run all knowledge tests**

Run: `cd backend && python -m pytest tests/test_knowledge/ -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/knowledge/feishu_reader.py backend/app/tool/builtin/read_knowledge.py backend/app/main.py backend/tests/test_knowledge/test_read_knowledge.py
git commit -m "feat(knowledge): read_knowledge builtin tool + feishu reader"
```

---

### Task 4: 飞书 MCP seed 连接器 + agent 引导

**Files:**
- Modify: `backend/app/data/connectors.json`(加一个 feishu seed 条目)
- Modify: `backend/app/agent/prompts/data.txt`(加知识库使用引导)
- Test: `backend/tests/test_seed_connectors.py`(加断言 feishu seed 存在)

**Interfaces:**
- Consumes: 现有 seed-connector 机制(见 `data/connectors.json` 的 `datasage` 条目形状)。
- Produces: `connectors.json` 中的 `feishu` 条目,`seed: true`,`category: "knowledge"`。

- [ ] **Step 1: Write the failing test**

Open `backend/tests/test_seed_connectors.py`, find the existing test that asserts `datasage` is a seed connector, and add an analogous assertion:

```python
def test_feishu_is_seed_connector():
    import json, pathlib
    p = pathlib.Path(__file__).resolve().parents[1] / "app" / "data" / "connectors.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    assert "feishu" in data
    assert data["feishu"].get("seed") is True
    assert data["feishu"].get("category") == "knowledge"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_seed_connectors.py::test_feishu_is_seed_connector -v`
Expected: FAIL — `KeyError: 'feishu'` / assertion error

- [ ] **Step 3: Add the seed connector**

In `backend/app/data/connectors.json`, add a `feishu` key (mirror the `datasage` entry's shape):

```json
  "feishu": {
    "name": "飞书文档",
    "url": "",
    "description": "连接飞书,读取你登记在知识库里的飞书文档作为分析背景。点击后按提示完成飞书授权。",
    "category": "knowledge",
    "seed": true
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_seed_connectors.py::test_feishu_is_seed_connector -v`
Expected: PASS

- [ ] **Step 5: Add agent guidance to data.txt**

In `backend/app/agent/prompts/data.txt`, under the `# Boundaries` section (or just before it), add:

```
# Knowledge base (Feishu docs)
- The user may register Feishu documents as a knowledge base. A
  <knowledge-base> list of registered docs (title + note) is injected when
  present. Before answering a business question, scan that list: if a doc looks
  relevant (a metric definition, a business rule, a glossary), call
  read_knowledge(entry_id) to read its body and treat it as authoritative
  background. Cite the source Feishu link in your answer when you use it.
- If the list is present but nothing is relevant, answer normally without reading.
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/data/connectors.json backend/app/agent/prompts/data.txt backend/tests/test_seed_connectors.py
git commit -m "feat(knowledge): feishu seed connector + data-agent knowledge guidance"
```

---

### Task 5: 知识库清单注入 system prompt

**Files:**
- Create: `backend/app/knowledge/injection.py`
- Modify: `backend/app/session/system_prompt.py`(加 `knowledge_section` 参数)
- Modify: `backend/app/session/prompt.py`(为 data agent 构建 + 传入 section)
- Test: `backend/tests/test_knowledge/test_injection.py`

**Interfaces:**
- Consumes: `KnowledgeEntry`(Task 1), `async_sessionmaker`.
- Produces: `build_knowledge_section(session_factory) -> str | None` — 返回 `<knowledge-base>...</knowledge-base>` 或 None(无 enabled 条目时)。
- Modifies: `build_system_prompt(...)` 增加 keyword-only 参数 `knowledge_section: str | None = None`,非空时 append 到 `dynamic_parts`(与 `analysis_memory_section` 完全一致的处理)。

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_knowledge/test_injection.py
from __future__ import annotations

import pytest

from app.knowledge.injection import build_knowledge_section
from app.models.knowledge_entry import KnowledgeEntry
from app.storage.database import get_session_factory


@pytest.mark.anyio
async def test_build_knowledge_section_none_when_empty(tmp_db_factory):
    # tmp_db_factory: a session factory backed by an empty temp DB (see conftest)
    section = await build_knowledge_section(tmp_db_factory)
    assert section is None


@pytest.mark.anyio
async def test_build_knowledge_section_lists_enabled(tmp_db_factory):
    async with tmp_db_factory() as s:
        s.add(KnowledgeEntry(
            feishu_url="https://x.feishu.cn/docx/T1", feishu_token="T1",
            doc_type="docx", title="客单价口径", note="AOV 定义", enabled=True,
        ))
        s.add(KnowledgeEntry(
            feishu_url="https://x.feishu.cn/docx/T2", feishu_token="T2",
            doc_type="docx", title="停用的", note="", enabled=False,
        ))
        await s.commit()
    section = await build_knowledge_section(tmp_db_factory)
    assert section is not None
    assert "<knowledge-base>" in section
    assert "客单价口径" in section
    assert "停用的" not in section  # disabled excluded
```

**Note:** `tmp_db_factory` — check `backend/tests/conftest.py` for an existing temp-DB session-factory fixture (the memory/dashboard tests use one). Reuse its exact name. If none exists, create the fixture in `tests/test_knowledge/conftest.py` building an in-memory aiosqlite engine + `Base.metadata.create_all`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_knowledge/test_injection.py -v`
Expected: FAIL — `ModuleNotFoundError: app.knowledge.injection`

- [ ] **Step 3: Implement injection**

```python
# backend/app/knowledge/injection.py
"""Render the registered Feishu knowledge docs into a system-prompt section."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.knowledge_entry import KnowledgeEntry

MAX_LISTED = 50


async def build_knowledge_section(
    session_factory: async_sessionmaker[AsyncSession],
) -> str | None:
    """Build a <knowledge-base> section listing enabled docs, or None if empty."""
    async with session_factory() as session:
        rows = (await session.execute(
            select(KnowledgeEntry)
            .where(KnowledgeEntry.enabled == True)  # noqa: E712
            .order_by(KnowledgeEntry.created_at.desc())
            .limit(MAX_LISTED)
        )).scalars().all()

    if not rows:
        return None

    lines = []
    for e in rows:
        label = e.title or e.feishu_url
        note = f" — {e.note}" if e.note else ""
        lines.append(f"- [{e.id}] {label}{note}")
    body = "\n".join(lines)
    return (
        "<knowledge-base>\n"
        "以下是用户登记的飞书知识文档。回答业务问题前先看这个清单,若某篇相关,"
        "调用 read_knowledge(entry_id) 读取其正文作为权威背景,并在回答中注明来源:\n"
        f"{body}\n"
        "</knowledge-base>"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_knowledge/test_injection.py -v`
Expected: PASS

- [ ] **Step 5: Add the parameter to build_system_prompt**

In `backend/app/session/system_prompt.py`: find the signature (around line 73 where `analysis_memory_section: str | None = None` is) and add a sibling parameter:

```python
    knowledge_section: str | None = None,
```

Then find where `analysis_memory_section` is appended (around line 107-108):

```python
    if analysis_memory_section:
        dynamic_parts.append(analysis_memory_section)
```

Add immediately after:

```python
    if knowledge_section:
        dynamic_parts.append(knowledge_section)
```

- [ ] **Step 6: Wire it in prompt.py for the data agent**

In `backend/app/session/prompt.py`, find the data-agent analysis-memory block (around line 451-458). Add a parallel block right after it:

```python
        # --- Load the Feishu knowledge-base listing for the data agent ---
        if self.agent.name == "data":
            try:
                from app.knowledge.injection import build_knowledge_section

                self.knowledge_section = await build_knowledge_section(
                    self.session_factory
                )
            except Exception:
                logger.debug("Knowledge section injection skipped", exc_info=True)
```

Then in **both** `build_system_prompt(...)` calls that pass `analysis_memory_section=self.analysis_memory_section` (around line 466 and line 1141), add:

```python
            knowledge_section=self.knowledge_section,
```

Initialize the attribute where `self.analysis_memory_section` is initialized (grep for `self.analysis_memory_section =` — add `self.knowledge_section = None` alongside it, likely in `__init__`).

- [ ] **Step 7: Run the full knowledge + prompt test suites**

Run: `cd backend && python -m pytest tests/test_knowledge/ tests/test_session/ -v`
Expected: PASS (no regressions in session prompt tests)

- [ ] **Step 8: Commit**

```bash
git add backend/app/knowledge/injection.py backend/app/session/system_prompt.py backend/app/session/prompt.py backend/tests/test_knowledge/test_injection.py
git commit -m "feat(knowledge): inject registered feishu docs list into data agent prompt"
```

---

### Task 6: 前端知识库管理页

**Files:**
- Create: `frontend/src/app/(main)/knowledge/page.tsx`
- Modify: `frontend/src/components/codata/codata-sidebar.tsx`(加"知识库"入口)
- (Reference only, do not blindly copy) `frontend/src/app/(main)/skills/page.tsx`

**Interfaces:**
- Consumes: backend `GET/POST/PATCH/DELETE /api/knowledge`(Task 2), the app's fetch wrapper in `frontend/src/lib/api.ts`.
- Produces: a `/knowledge` route rendering list + add form.

- [ ] **Step 1: Inspect existing patterns**

Read `frontend/src/app/(main)/skills/page.tsx` and `frontend/src/lib/api.ts` to learn: (a) the fetch helper name (e.g. `apiFetch`/`api.get`), (b) how a management page is structured (data fetching hook, list rendering, Tailwind classes). Match these exactly. Note the exact fetch helper signature — the code below assumes an `api` object with `.get/.post/.patch/.delete`; **replace with the real helper**.

- [ ] **Step 2: Create the page**

```tsx
// frontend/src/app/(main)/knowledge/page.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api"; // ← replace with the real fetch helper from Step 1

type Entry = {
  id: string;
  title: string;
  feishu_url: string;
  doc_type: string;
  note: string;
  enabled: boolean;
};

export default function KnowledgePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await api.get("/api/knowledge");
    setEntries(data.entries ?? []);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, []);

  async function add() {
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/knowledge", { feishu_url: url, note });
      setUrl("");
      setNote("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "添加失败");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(e: Entry) {
    await api.patch(`/api/knowledge/${e.id}`, { enabled: !e.enabled });
    await load();
  }

  async function remove(id: string) {
    await api.delete(`/api/knowledge/${id}`);
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold mb-1">知识库</h1>
      <p className="text-sm text-muted-foreground mb-4">
        把飞书文档链接添加进来,分析时 AI 就能参考它们作为权威背景。
      </p>

      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          placeholder="粘贴飞书文档链接,如 https://xxx.feishu.cn/docx/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          onClick={add}
          disabled={loading || !url.trim()}
        >
          添加
        </button>
      </div>
      <input
        className="w-full rounded border px-3 py-2 text-sm mb-2"
        placeholder="备注(可选):这篇文档讲什么,帮助 AI 判断何时用它"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <ul className="divide-y">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 py-3">
            <div className="flex-1 min-w-0">
              <a
                href={e.feishu_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium hover:underline truncate block"
              >
                {e.title || e.feishu_url}
              </a>
              {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
            </div>
            <span className="text-xs rounded bg-muted px-2 py-0.5">{e.doc_type}</span>
            <button className="text-xs" onClick={() => toggle(e)}>
              {e.enabled ? "已启用" : "已停用"}
            </button>
            <button className="text-xs text-red-500" onClick={() => remove(e.id)}>
              删除
            </button>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">
            还没有知识文档,粘贴一个飞书链接开始。
          </li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add the sidebar entry**

In `frontend/src/components/codata/codata-sidebar.tsx`, find where existing entries (历史查询 / 看板) link to routes, and add a "知识库" entry linking to `/knowledge`, matching the exact JSX/icon pattern used there.

- [ ] **Step 4: Type-check and build**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/\(main\)/knowledge/page.tsx`
Expected: no type errors, no lint errors. Fix any (most likely: correct the `api` helper import/usage to match `lib/api.ts`).

Run: `cd frontend && npm run build`
Expected: build succeeds; `/knowledge` route appears in output.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(main\)/knowledge/page.tsx frontend/src/components/codata/codata-sidebar.tsx
git commit -m "feat(knowledge): frontend knowledge base management page"
```

---

### Task 7: 端到端验证

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && python -m pytest tests/test_knowledge/ tests/test_api/test_knowledge.py tests/test_seed_connectors.py -v`
Expected: all PASS.

- [ ] **Step 2: Run broader suites for regressions**

Run: `cd backend && python -m pytest tests/test_session/ tests/test_api/ -q`
Expected: no new failures vs baseline (note: `tests/test_tool/test_web_search.py` has a known pre-existing failure unrelated to this work — ignore only that one).

- [ ] **Step 3: Manual smoke (documented, requires a real Feishu app)**

Use the `superpowers:verify` / `run` skill to launch the app, then:
1. Open `/knowledge`, paste a real Feishu docx link, add it → appears in list.
2. Connect + authorize the Feishu connector (connectors page).
3. In a Codata (data-agent) chat, ask a question the doc answers → confirm the agent calls `read_knowledge` and cites the Feishu link.

If a real Feishu app isn't available in this environment, document this step as **unrun** with that reason (do not fake it), and confirm Steps 1-2 pass.

- [ ] **Step 4: Final commit (if any doc/notes updates)**

```bash
git add -A
git commit -m "test(knowledge): end-to-end verification notes"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** Task 1 = data model + URL parse (spec §4.1); Task 2 = CRUD API (§4.1); Task 3 = read_knowledge tool (§4.3); Task 4 = feishu seed connector (§4.2) + agent guidance (§4.4); Task 5 = list injection (§4.4); Task 6 = management UI (§4.1 frontend); Task 7 = the §6 end-to-end verification step.
- **Known integration unknowns flagged inline (verify during execution, do not guess silently):** (a) auth fixture name for API tests, (b) `get_session_factory` import location, (c) `ToolResult` kwargs, (d) lark-openapi-mcp's exact rawContent param name + tool id, (e) frontend fetch-helper API, (f) temp-DB test fixture name. Each is called out at its step.
- **Deferred (per spec §8, not in this plan):** wiki-space traversal (only single docx read implemented in `read_feishu_doc`), sheet/bitable reading, RAG/vector layer, team-shared multi-user. `read_feishu_doc` raises a clear error for non-docx types so this boundary is explicit.
