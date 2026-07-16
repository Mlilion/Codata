# 知识条目删除的 LLM 驱动清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除知识条目时,用一个 headless build agent 对称地把该资料从本地 wiki 中摘除(删独有 source 页、清孤儿页、重建 index),完成后再删 DB 行;清理期间条目显示「清理中」,失败可重试。

**Architecture:** 后端新增 `cleanup_prompt.build_cleanup_prompt` 与 `ingest.cleanup_entry`(fire-and-forget 后台任务,复用 ingest 的 headless agent 运行逻辑);`DELETE /knowledge/{id}` 改为置 `ingest_status="deleting"` 并调度后台清理,不再当场删行/删快照。前端把 `deleting` 接入现有的状态标签 + 轮询机制。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy async / pytest-asyncio(后端);Next.js / React Query / TypeScript(前端)。

## Global Constraints

- 后台任务(`cleanup_entry`)**绝不让异常传播** —— 失败必须记为 `ingest_status="failed"` + `ingest_error`。
- **无 DB schema 变更、无 migration** —— 复用 `KnowledgeEntry.ingest_status`,新增取值 `"deleting"`。
- 只操作 `knowledge-wiki/` 目录内文件;`index.md`、`log.md` 本身绝不删除。
- 清理的孤儿判定靠 agent 用 grep 数 `[[反向链]]`,不依赖 `wiki_pages` 字段(该字段含共享页,不可靠)。
- 测试全部用 stub(monkeypatch `run_generation` / `snapshot`),不跑真实 LLM;沿用 `_resolve_data_dir` → `tmp_path` 的 monkeypatch 模式。

---

### Task 1: cleanup prompt

**Files:**
- Create: `backend/app/knowledge/cleanup_prompt.py`
- Test: `backend/tests/test_knowledge/test_cleanup_prompt.py`

**Interfaces:**
- Consumes: `KnowledgeEntry`(已有模型:`.id`, `.title`, `.feishu_url`)
- Produces: `build_cleanup_prompt(entry, source_page: str | None, wiki_dir_abs: str) -> str`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_knowledge/test_cleanup_prompt.py`:
```python
from __future__ import annotations
from app.knowledge.cleanup_prompt import build_cleanup_prompt
from app.models.knowledge_entry import KnowledgeEntry


def test_cleanup_prompt_mentions_key_pieces():
    e = KnowledgeEntry(id="e1", feishu_url="https://x", feishu_token="t", doc_type="docx", title="渠道口径说明")
    p = build_cleanup_prompt(e, "source-channel.md", "/data/knowledge-wiki/wiki")
    assert "e1" in p                      # entry_id 带入
    assert "渠道口径说明" in p             # 标题带入
    assert "source-channel.md" in p       # source 页锚点
    assert "/data/knowledge-wiki/wiki" in p
    assert "[[" in p                      # 反向链检查约定
    assert "index.md" in p and "log.md" in p
    assert "孤儿" in p                     # 孤儿判定说明存在
    assert "remove" in p                  # log 记录格式


def test_cleanup_prompt_without_source_page():
    e = KnowledgeEntry(id="e2", title="无摘要页")
    p = build_cleanup_prompt(e, None, "/data/knowledge-wiki/wiki")
    assert "e2" in p
    assert "None" not in p                # 不泄漏 None 字面量
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_knowledge/test_cleanup_prompt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.knowledge.cleanup_prompt'`

- [ ] **Step 3: Write minimal implementation**

`backend/app/knowledge/cleanup_prompt.py`:
```python
"""Prompt that drives a headless agent to remove one source from the wiki."""
from __future__ import annotations


def build_cleanup_prompt(entry, source_page: str | None, wiki_dir_abs: str) -> str:
    title = entry.title or entry.feishu_url or entry.id
    anchor = (
        f"- 它的 source 摘要页:{source_page}"
        if source_page
        else "- (未找到该资料的 source 摘要页,请根据 entry_id 在 wiki 中定位其残留内容)"
    )
    return f"""你是知识库维护助手。一份资料被移除,请把它从本地 Markdown wiki 中干净地摘除。

## 被移除的资料
- 标题:{title}
- entry_id:{entry.id}
{anchor}

## wiki 目录(用文件工具读写这里)
{wiki_dir_abs}
结构约定:
- `index.md` — 分类索引(## 资料摘要 / ## 实体 / ## 概念 三个表格)。这是精度关键。
- `source-<slug>.md` — 每篇资料的摘要页。
- `<实体slug>.md` / `<概念slug>.md` — 实体页/概念页,页间用 `[[页面slug]]` 双链引用。
- `log.md` — 追加日志。

## 你的步骤(先 read 判断,再 write/edit/删除)
1. 读该资料的 source 页,了解它引入了哪些实体/概念页。
2. 删除这个 source 页(它是该资料独有的)。
3. 对它引用过的每个实体/概念页,用 grep 检查是否还有**其他**页面通过 `[[反向链]]` 引用它:
   - 仍被其他资料引用 → 保留该页,只删除其中专属于本资料的段落/矛盾标注。
   - 已无任何其他引用(孤儿) → 删除整页。
4. 更新 `index.md`:移除已删页面对应的行;保留页的摘要若因删段而变化,同步更新。
5. 在 `log.md` 末尾追加一行:`## [{entry.id}] remove | {title}`。
6. 绝不删除 `index.md` / `log.md` 本身,不动与本资料无关的页面。

只操作上述 wiki 目录内的文件。完成后简述你删除/保留了哪些页面及理由。"""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_knowledge/test_cleanup_prompt.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/knowledge/cleanup_prompt.py backend/tests/test_knowledge/test_cleanup_prompt.py
git commit -m "feat(knowledge): cleanup prompt for LLM-driven delete"
```

---

### Task 2: cleanup_entry 后台任务

**Files:**
- Modify: `backend/app/knowledge/ingest.py`
- Test: `backend/tests/test_knowledge/test_cleanup_runner.py`

**Interfaces:**
- Consumes: `build_cleanup_prompt` (Task 1); existing `wiki_store`, `run_generation`, `delete_by_id`, `Session`, `KnowledgeEntry`, `GenerationJob`, `PromptRequest`, `generate_ulid` (all already imported in `ingest.py`).
- Produces: `cleanup_entry(entry_id, *, session_factory, provider_registry, agent_registry, tool_registry, index_manager=None) -> None`; helper `_source_page_of(entry) -> str | None`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_knowledge/test_cleanup_runner.py`:
```python
from __future__ import annotations

import json

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_cleanup_entry_success_deletes_row_and_raw(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "c1.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c1", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c1.md",
            wiki_pages=json.dumps(["log.md", "source-c1.md"]),
        ))
        await s.commit()

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["session_id"] = req.session_id
        return None

    deleted = []

    async def fake_delete_by_id(db, model, id):
        deleted.append((model, id))
        return True

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.cleanup_entry(
        "c1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        assert await s.get(KnowledgeEntry, "c1") is None   # row gone
    assert not raw.exists()                                # raw snapshot gone
    # throwaway cleanup session deleted too
    assert (ingest.Session, captured["session_id"]) in deleted


@pytest.mark.asyncio
async def test_cleanup_entry_failure_keeps_row_and_raw(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "c2.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c2", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c2.md",
            wiki_pages=json.dumps(["source-c2.md"]),
        ))
        await s.commit()

    async def boom(job, req, *a, **k):
        raise RuntimeError("agent 崩了")

    monkeypatch.setattr(ingest, "run_generation", boom)

    # must not raise
    await ingest.cleanup_entry(
        "c2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "c2")
        assert e is not None
        assert e.ingest_status == "failed"
        assert "agent 崩了" in e.ingest_error
    assert raw.exists()   # raw snapshot preserved for retry


@pytest.mark.asyncio
async def test_cleanup_entry_no_source_page_skips_agent(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "c3.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c3", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c3.md",
            wiki_pages=json.dumps(["log.md"]),   # no source-*.md
        ))
        await s.commit()

    ran = {"agent": False}

    async def fake_run_generation(job, req, *a, **k):
        ran["agent"] = True
        return None

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.cleanup_entry(
        "c3",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    assert ran["agent"] is False                 # agent skipped
    async with session_factory() as s:
        assert await s.get(KnowledgeEntry, "c3") is None
    assert not raw.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_knowledge/test_cleanup_runner.py -v`
Expected: FAIL — `AttributeError: module 'app.knowledge.ingest' has no attribute 'cleanup_entry'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/knowledge/ingest.py`, add the import near the top (with the other `from app.knowledge...` imports):
```python
from app.knowledge.cleanup_prompt import build_cleanup_prompt
```

Add these two functions at the end of the module:
```python
def _source_page_of(entry) -> str | None:
    """The entry's own source-*.md page, parsed from wiki_pages JSON."""
    try:
        pages = json.loads(entry.wiki_pages or "[]")
    except Exception:
        pages = []
    for name in pages:
        if isinstance(name, str) and name.startswith("source-"):
            return name
    return None


async def _run_wiki_agent(
    prompt: str,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager,
) -> None:
    """Drive a headless build agent over the wiki dir, then delete the
    throwaway session so it never surfaces as a phantom chat."""
    session_id = generate_ulid()
    stream_id = generate_ulid()
    job = GenerationJob(stream_id=stream_id, session_id=session_id)
    req = PromptRequest(
        session_id=session_id,
        text=prompt,
        agent="build",
        workspace=str(wiki_store.wiki_root()),
    )
    await run_generation(
        job,
        req,
        session_factory=session_factory,
        provider_registry=provider_registry,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
        index_manager=index_manager,
    )
    try:
        async with session_factory() as s:
            await delete_by_id(s, Session, session_id)
            await s.commit()
    except Exception as cleanup_exc:  # best-effort: never fail a good run
        logger.warning(
            "failed to delete throwaway session %s: %s", session_id, cleanup_exc
        )


async def cleanup_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
) -> None:
    """Remove an entry's wiki footprint via a headless agent, then delete the
    DB row and raw snapshot. Runs as a background task; NEVER raises — failures
    are recorded as ``ingest_status="failed"`` so the user can retry the delete.
    """
    try:
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is None:
                return
            raw_path = entry.raw_path
            source_page = _source_page_of(entry)

        if source_page is not None:
            prompt = build_cleanup_prompt(entry, source_page, str(wiki_store.wiki_dir()))
            await _run_wiki_agent(
                prompt,
                session_factory=session_factory,
                provider_registry=provider_registry,
                agent_registry=agent_registry,
                tool_registry=tool_registry,
                index_manager=index_manager,
            )

        # Delete raw snapshot (best-effort) then the DB row.
        if raw_path:
            try:
                p = wiki_store.wiki_root() / raw_path
                if p.exists():
                    p.unlink()
            except Exception:
                logger.debug("cleanup: raw unlink failed for %s", entry_id, exc_info=True)
        async with session_factory() as s:
            await delete_by_id(s, KnowledgeEntry, entry_id)
            await s.commit()
    except Exception as exc:
        logger.warning("cleanup_entry %s failed: %s", entry_id, exc)
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "failed"
                e.ingest_error = str(exc)
                await s.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_knowledge/test_cleanup_runner.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full ingest suite to confirm no regression**

Run: `cd backend && python -m pytest tests/test_knowledge/ -v`
Expected: PASS (all, including existing ingest tests — the extracted `_run_wiki_agent` must not change ingest behavior; if ingest_entry was refactored to use it, that suite still passes).

Note: this task does NOT require refactoring `ingest_entry` to use `_run_wiki_agent`. Leave `ingest_entry` as-is to keep the task focused; the shared helper is used by `cleanup_entry` only.

- [ ] **Step 6: Commit**

```bash
git add backend/app/knowledge/ingest.py backend/tests/test_knowledge/test_cleanup_runner.py
git commit -m "feat(knowledge): cleanup_entry background task removes wiki footprint"
```

---

### Task 3: DELETE endpoint 改为调度清理

**Files:**
- Modify: `backend/app/api/knowledge.py`
- Modify: `backend/tests/test_api/test_knowledge_delete_cleanup.py`

**Interfaces:**
- Consumes: `cleanup_entry` (Task 2); existing `_schedule_ingest` pattern, `KnowledgeEntry`, `wiki_store`.
- Produces: `_schedule_cleanup(request, entry_id) -> None`; new `delete_knowledge` behavior — returns entry dict with `ingest_status="deleting"`, row still present, background cleanup scheduled; idempotent when already `deleting`.

- [ ] **Step 1: Update the existing delete test to the new contract**

The existing `test_delete_removes_raw_file` asserts the raw file is deleted synchronously by the endpoint. Under the new design the endpoint no longer deletes the raw file (the background task does). Replace the file contents of `backend/tests/test_api/test_knowledge_delete_cleanup.py` with:
```python
"""Deleting a knowledge entry schedules background LLM cleanup and marks the
row 'deleting' instead of removing it synchronously."""

from __future__ import annotations

import pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401
from app.api import knowledge as knowledge_api
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_delete_marks_deleting_and_schedules_cleanup(
    app_client, monkeypatch, session_factory
):
    scheduled = []
    monkeypatch.setattr(
        knowledge_api, "_schedule_cleanup",
        lambda request, entry_id: scheduled.append(entry_id),
    )

    async with session_factory() as session:
        async with session.begin():
            session.add(
                KnowledgeEntry(id="e9", feishu_url="u", feishu_token="t", doc_type="docx")
            )

    resp = await app_client.delete("/api/knowledge/e9")
    assert resp.status_code == 200, resp.text
    assert resp.json()["ingest_status"] == "deleting"

    # row is still present (background task will remove it)
    async with session_factory() as session:
        e = await session.get(KnowledgeEntry, "e9")
        assert e is not None
        assert e.ingest_status == "deleting"

    assert scheduled == ["e9"]


@pytest.mark.asyncio
async def test_delete_is_idempotent_while_deleting(
    app_client, monkeypatch, session_factory
):
    scheduled = []
    monkeypatch.setattr(
        knowledge_api, "_schedule_cleanup",
        lambda request, entry_id: scheduled.append(entry_id),
    )

    async with session_factory() as session:
        async with session.begin():
            session.add(
                KnowledgeEntry(
                    id="e10", feishu_url="u", feishu_token="t",
                    doc_type="docx", ingest_status="deleting",
                )
            )

    resp = await app_client.delete("/api/knowledge/e10")
    assert resp.status_code == 200, resp.text
    assert resp.json()["ingest_status"] == "deleting"
    assert scheduled == []   # no re-schedule while already deleting


@pytest.mark.asyncio
async def test_delete_missing_returns_404(app_client):
    resp = await app_client.delete("/api/knowledge/nope")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_api/test_knowledge_delete_cleanup.py -v`
Expected: FAIL — `_schedule_cleanup` attribute does not exist / response status not "deleting".

- [ ] **Step 3: Rewrite `delete_knowledge` and add `_schedule_cleanup`**

In `backend/app/api/knowledge.py`, add the import:
```python
from app.knowledge.ingest import cleanup_entry, ingest_entry
```
(replace the existing `from app.knowledge.ingest import ingest_entry` line.)

Add `_schedule_cleanup` right below `_schedule_ingest`:
```python
def _schedule_cleanup(request: Request, entry_id: str) -> None:
    st = request.app.state
    asyncio.create_task(
        cleanup_entry(
            entry_id,
            session_factory=st.session_factory,
            provider_registry=st.provider_registry,
            agent_registry=st.agent_registry,
            tool_registry=st.tool_registry,
            index_manager=getattr(st, "index_manager", None),
        )
    )
```

Replace the whole `delete_knowledge` function body with:
```python
@router.delete("/{entry_id}")
async def delete_knowledge(
    entry_id: str, request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    entry = await db.get(KnowledgeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    # Idempotent: if cleanup is already running, don't reschedule.
    if entry.ingest_status == "deleting":
        return _entry_to_dict(entry)
    # Uploaded files are deterministic to remove now; wiki pages + row are
    # cleaned up asynchronously by the background agent.
    if entry.source_type == "file" and entry.file_path:
        try:
            p = _Path(entry.file_path)
            if p.exists():
                p.unlink()
        except Exception:
            pass
    entry.ingest_status = "deleting"
    entry.ingest_error = ""
    await db.flush()
    await db.refresh(entry)
    _schedule_cleanup(request, entry_id=entry_id)
    return _entry_to_dict(entry)
```

Note: `delete_knowledge` now takes `request: Request` — the signature changed. Make sure `Request` is imported (it already is at the top of the file).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_api/test_knowledge_delete_cleanup.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the API knowledge suite to confirm no regression**

Run: `cd backend && python -m pytest tests/test_api/ -k knowledge -v`
Expected: PASS (all knowledge API tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/knowledge.py backend/tests/test_api/test_knowledge_delete_cleanup.py
git commit -m "feat(knowledge): delete endpoint schedules async cleanup, marks deleting"
```

---

### Task 4: 前端接入 `deleting` 状态

**Files:**
- Modify: `frontend/src/hooks/use-knowledge.ts`
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Consumes: backend now returns `ingest_status="deleting"` (Task 3).
- Produces: `deleting` recognized as an active (polled) status with label 「清理中」; delete button disabled while an entry is `deleting`.

- [ ] **Step 1: Add `deleting` to the type + polling set in the hook**

In `frontend/src/hooks/use-knowledge.ts`, extend the `ingest_status` union (line 14-21) by adding `| "deleting"`:
```typescript
  ingest_status:
    | "pending"
    | "extracting"
    | "building"
    | "indexing"
    | "processing"
    | "deleting"
    | "done"
    | "failed";
```

In `useKnowledge`'s `refetchInterval` active set (line 45-51), add `"deleting"`:
```typescript
      const active = new Set([
        "pending",
        "extracting",
        "building",
        "indexing",
        "processing",
        "deleting",
      ]);
```

- [ ] **Step 2: Add label + active status + disable button in the page**

In `frontend/src/app/(main)/knowledge/page.tsx`:

Add to `INGEST_STATUS_LABEL` (after `processing: "处理中",`):
```typescript
  deleting: "清理中",
```

Add `"deleting"` to the `ACTIVE_STATUSES` set:
```typescript
const ACTIVE_STATUSES = new Set<KnowledgeEntry["ingest_status"]>([
  "pending",
  "extracting",
  "building",
  "indexing",
  "processing",
  "deleting",
]);
```

Update the delete button's `disabled` prop (currently `disabled={deleteKnowledge.isPending}`) to also disable while this entry is being cleaned up:
```tsx
                          disabled={
                            deleteKnowledge.isPending ||
                            entry.ingest_status === "deleting"
                          }
```

- [ ] **Step 3: Typecheck / build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (`INGEST_STATUS_LABEL` is typed `Record<KnowledgeEntry["ingest_status"], string>`, so a missing `deleting` key would fail the build — confirming both files are in sync.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/use-knowledge.ts "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "feat(knowledge): show 清理中 state during async delete cleanup"
```

---

### Task 5: 端到端验证

**Files:** none (verification only)

- [ ] **Step 1: Full backend knowledge suites**

Run: `cd backend && python -m pytest tests/test_knowledge/ tests/test_api/ -k "knowledge or cleanup or ingest" -v`
Expected: PASS (all).

- [ ] **Step 2: Drive the real flow with the `verify` skill**

Invoke the `verify` skill (or `/run`) to launch the app, import a small doc into the knowledge base, wait for `done`, then click delete and observe: the row shows 「清理中」, the wiki `source-*.md` for that entry disappears, `index.md` no longer references it, and the row leaves the list. Confirm a shared concept page referenced by another entry is NOT deleted.

- [ ] **Step 3: Commit any fixes surfaced by verification**

```bash
git add -A
git commit -m "fix(knowledge): address issues found in delete-cleanup verification"
```
(skip if nothing needed)

---

## Self-Review 记录

- **Spec coverage:** LLM 清理(Task 1+2)、deleting 状态/保留行(Task 2+3)、失败保留+可重试(Task 2)、index 一并重建(Task 1 prompt)、无 source 页边界(Task 2)、重复删除幂等(Task 3)、ingest 中删除不加锁(无需代码,天然满足)、前端清理中(Task 4)、测试策略(每个 Task 的 test + Task 5)。均有对应任务。
- **Placeholder scan:** 无 TBD/TODO;每个改动步骤含完整代码。
- **Type consistency:** `cleanup_entry` / `_source_page_of` / `_run_wiki_agent` / `_schedule_cleanup` / `build_cleanup_prompt(entry, source_page, wiki_dir_abs)` 签名在 Task 间一致;前端 `deleting` 取值在 hook 与 page 两处同步添加。
