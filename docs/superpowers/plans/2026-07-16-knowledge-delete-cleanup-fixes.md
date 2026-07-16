# 知识库删除清理修复 Implementation Plan(默认模型 + 串行锁 + 先清后建 reingest)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复真机验证暴露的三个问题:(A) headless ingest/cleanup 用配置的默认模型而非免费弱模型;(B) 加全局串行锁消除并发写 index.md 覆盖;(C) 「重新加载」= 先清后建(cleanup 旧页 → 重新 ingest),done 条目加刷新入口。

**Architecture:** 三处改动集中在 `backend/app/knowledge/ingest.py`(模型解析、锁、reingest_entry)、`backend/app/api/knowledge.py`(传 settings、reingest 端点改调度)、前端两文件。复用现有 `resolve_default_model`、`_run_wiki_agent`、`build_cleanup_prompt`、`build_ingest_prompt`。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy async / pytest-asyncio;Next.js / React Query / TypeScript。

## Global Constraints

- 后台任务(`ingest_entry` / `cleanup_entry` / `reingest_entry`)**绝不让异常传播** —— 失败记为 `ingest_status="failed"` + `ingest_error`。
- **无 DB schema 变更、无 migration**。
- 默认模型解析**复用** `app/provider/resolve.py::resolve_default_model(registry, settings)` —— 不自己读 `settings.default_model`。
- 串行锁是模块级 `asyncio.Lock`,只包住「跑 headless agent 改 wiki」段(含随后的 DB 状态写回 / 删行 / 重建);raw 快照读取可留锁外。
- `settings` 参数默认 `None` 以保持向后兼容;为 None 时模型回退到 `prompt.py` 现有级联(不改 prompt.py)。
- reingest 语义 = 先清后建:cleanup 段**只摸除 wiki 页**,**不删 raw、不删 DB 行**(与删除路径的差异);raw 由 ingest 段重新拉取覆盖。
- 测试全用 stub(monkeypatch `run_generation`),`_resolve_data_dir` → tmp_path;不跑真实 LLM。用 venv:`cd backend && venv/bin/python -m pytest ...`。

---

### Task 1: ingest/cleanup 使用配置的默认模型(缺陷 A)

**Files:**
- Modify: `backend/app/knowledge/ingest.py`
- Modify: `backend/app/api/knowledge.py`
- Test: `backend/tests/test_knowledge/test_ingest_model_selection.py`

**Interfaces:**
- Consumes: `resolve_default_model(registry, settings) -> (model_id, provider_id)` (`app/provider/resolve.py`).
- Produces: `_run_wiki_agent(..., model_id=None, provider_id=None)`; `ingest_entry(..., settings=None)`; `cleanup_entry(..., settings=None)`; `_schedule_ingest`/`_schedule_cleanup` pass `settings=st.settings`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_knowledge/test_ingest_model_selection.py`:
```python
from __future__ import annotations

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


class _FakeSettings:
    def __init__(self, model="", provider=""):
        self.default_model = model
        self.default_provider_id = provider


@pytest.mark.asyncio
async def test_ingest_uses_default_model(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="m1", feishu_url="u", feishu_token="t", doc_type="docx"))
        await s.commit()

    async def fake_snapshot(entry):
        return "raw/m1.md"

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["model"] = req.model
        captured["provider_id"] = req.provider_id
        return None

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", lambda *a, **k: _noop())
    monkeypatch.setattr(
        ingest, "resolve_default_model", lambda reg, st: ("kaon/claude-opus-4-8", "custom_x")
    )

    await ingest.ingest_entry(
        "m1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
        settings=_FakeSettings("kaon/claude-opus-4-8", "custom_x"),
    )

    assert captured["model"] == "kaon/claude-opus-4-8"
    assert captured["provider_id"] == "custom_x"


async def _noop():
    return True


@pytest.mark.asyncio
async def test_ingest_no_settings_falls_back_to_none(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="m2", feishu_url="u", feishu_token="t", doc_type="docx"))
        await s.commit()

    async def fake_snapshot(entry):
        return "raw/m2.md"

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["model"] = req.model
        return None

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", lambda *a, **k: _noop())

    await ingest.ingest_entry(
        "m2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
        settings=None,   # no settings → model stays None (fallback)
    )

    assert captured["model"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/test_ingest_model_selection.py -v`
Expected: FAIL — `ingest_entry` has no `settings` kwarg / `req.model` is not the default.

- [ ] **Step 3: Implement — thread model through ingest.py**

In `backend/app/knowledge/ingest.py`:

Add import near the top (after line 16):
```python
from app.provider.resolve import resolve_default_model
```

Change `_run_wiki_agent` signature and `PromptRequest` to accept model/provider:
```python
async def _run_wiki_agent(
    prompt: str,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager,
    model_id=None,
    provider_id=None,
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
        model=model_id,
        provider_id=provider_id,
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
```

In `cleanup_entry`, add `settings=None` to the signature and resolve the model, passing it to `_run_wiki_agent`:
```python
async def cleanup_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    ...
    try:
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is None:
                return
            raw_path = entry.raw_path
            source_page = _source_page_of(entry)

        model_id, provider_id = (
            resolve_default_model(provider_registry, settings) if settings else (None, None)
        )
        if source_page is not None:
            prompt = build_cleanup_prompt(entry, source_page, str(wiki_store.wiki_dir()))
            await _run_wiki_agent(
                prompt,
                session_factory=session_factory,
                provider_registry=provider_registry,
                agent_registry=agent_registry,
                tool_registry=tool_registry,
                index_manager=index_manager,
                model_id=model_id,
                provider_id=provider_id,
            )
        ...  # rest unchanged (delete raw + row)
```

In `ingest_entry`, add `settings=None` to the signature. It currently builds its own `PromptRequest` inline (not via `_run_wiki_agent`). Resolve the model and set it on that request:
```python
async def ingest_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    ...
    # inside the try, where req is built:
        model_id, provider_id = (
            resolve_default_model(provider_registry, settings) if settings else (None, None)
        )
        req = PromptRequest(
            session_id=session_id,
            text=prompt,
            agent="build",
            workspace=str(wiki_store.wiki_root()),
            model=model_id,
            provider_id=provider_id,
        )
```

In `backend/app/api/knowledge.py`, pass `settings=st.settings` in both `_schedule_ingest` and `_schedule_cleanup`:
```python
def _schedule_ingest(request: Request, entry_id: str) -> None:
    st = request.app.state
    asyncio.create_task(
        ingest_entry(
            entry_id,
            session_factory=st.session_factory,
            provider_registry=st.provider_registry,
            agent_registry=st.agent_registry,
            tool_registry=st.tool_registry,
            index_manager=getattr(st, "index_manager", None),
            settings=getattr(st, "settings", None),
        )
    )


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
            settings=getattr(st, "settings", None),
        )
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/test_ingest_model_selection.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run full knowledge suite (no regression)**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/ tests/test_api/ -k "knowledge or cleanup or ingest" -v`
Expected: PASS (existing ingest/cleanup tests still green; they don't pass `settings`, so model falls back to None — unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add backend/app/knowledge/ingest.py backend/app/api/knowledge.py backend/tests/test_knowledge/test_ingest_model_selection.py
git commit -m "fix(knowledge): ingest/cleanup use configured default model"
```

---

### Task 2: 全局串行锁消除并发写 index.md(缺陷 B)

**Files:**
- Modify: `backend/app/knowledge/ingest.py`
- Test: `backend/tests/test_knowledge/test_wiki_agent_lock.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: module-level `_WIKI_AGENT_LOCK = asyncio.Lock()` in `ingest.py`, held around the wiki-writing section of `ingest_entry` and `cleanup_entry`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_knowledge/test_wiki_agent_lock.py`:
```python
from __future__ import annotations

import asyncio
import json

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_concurrent_cleanups_do_not_overlap(tmp_path, monkeypatch, session_factory):
    """Two cleanup_entry tasks must serialize their wiki-agent section:
    the second must not enter run_generation until the first has left it."""
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    for eid in ("k1", "k2"):
        (wiki_store.raw_dir() / f"{eid}.md").write_text("x", encoding="utf-8")
        async with session_factory() as s:
            s.add(KnowledgeEntry(
                id=eid, feishu_url="u", feishu_token="t", doc_type="docx",
                ingest_status="deleting", raw_path=f"raw/{eid}.md",
                wiki_pages=json.dumps([f"source-{eid}.md"]),
            ))
            await s.commit()

    active = 0
    max_active = 0

    async def fake_run_generation(job, req, *a, **k):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.05)   # hold the "wiki write" window open
        active -= 1
        return None

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await asyncio.gather(
        ingest.cleanup_entry("k1", session_factory=session_factory,
                             provider_registry=object(), agent_registry=object(),
                             tool_registry=object()),
        ingest.cleanup_entry("k2", session_factory=session_factory,
                             provider_registry=object(), agent_registry=object(),
                             tool_registry=object()),
    )

    assert max_active == 1, f"wiki-agent section ran concurrently (max_active={max_active})"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/test_wiki_agent_lock.py -v`
Expected: FAIL — `max_active == 2` (no lock yet, both agents overlap).

- [ ] **Step 3: Add the lock**

In `backend/app/knowledge/ingest.py`, add after `logger = logging.getLogger(__name__)` (line 21):
```python
# Serializes wiki writes across ingest/cleanup/reingest background tasks.
# Single-user local-first: concurrent agents editing the same index.md would
# overwrite each other (later write wins), so only one may hold the wiki at a time.
_WIKI_AGENT_LOCK = asyncio.Lock()
```

In `cleanup_entry`, wrap the model-resolve + agent-run + raw/row-delete section in the lock. The `entry` read stays outside; everything that touches wiki files or deletes goes inside:
```python
    try:
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is None:
                return
            raw_path = entry.raw_path
            source_page = _source_page_of(entry)

        async with _WIKI_AGENT_LOCK:
            model_id, provider_id = (
                resolve_default_model(provider_registry, settings) if settings else (None, None)
            )
            if source_page is not None:
                prompt = build_cleanup_prompt(entry, source_page, str(wiki_store.wiki_dir()))
                await _run_wiki_agent(
                    prompt,
                    session_factory=session_factory,
                    provider_registry=provider_registry,
                    agent_registry=agent_registry,
                    tool_registry=tool_registry,
                    index_manager=index_manager,
                    model_id=model_id,
                    provider_id=provider_id,
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
                e = await s.get(KnowledgeEntry, entry_id)
                if e is not None:
                    await s.delete(e)
                    await s.commit()
    except Exception as exc:
        ...  # unchanged failure handler
```

In `ingest_entry`, wrap its wiki-writing section (the model-resolve + prompt build + `run_generation` + the `done` status/wiki_pages write-back) in `async with _WIKI_AGENT_LOCK:`. The `raw_rel = await snapshot_raw(entry)` (network/file read) may stay outside the lock; the `before = _snapshot_wiki_files()` must be inside (it reads wiki state that the lock protects). Keep the existing retry-loop and failure handler as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/test_wiki_agent_lock.py -v`
Expected: PASS — `max_active == 1`.

- [ ] **Step 5: Full knowledge suite (no regression)**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/ -v`
Expected: PASS (all). The lock must not deadlock existing single-task tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/knowledge/ingest.py backend/tests/test_knowledge/test_wiki_agent_lock.py
git commit -m "fix(knowledge): serialize wiki writes with a global lock"
```

---

### Task 3: 先清后建 reingest(缺陷 C 后端)

**Files:**
- Modify: `backend/app/knowledge/ingest.py`
- Modify: `backend/app/api/knowledge.py`
- Test: `backend/tests/test_knowledge/test_reingest_runner.py`

**Interfaces:**
- Consumes: `build_cleanup_prompt`, `build_ingest_prompt`, `_run_wiki_agent`, `snapshot_raw`, `_source_page_of`, `_WIKI_AGENT_LOCK`, `resolve_default_model`.
- Produces: `reingest_entry(entry_id, *, session_factory, provider_registry, agent_registry, tool_registry, index_manager=None, settings=None) -> None`; `_schedule_reingest(request, entry_id)` in `api/knowledge.py`; `reingest_knowledge` endpoint calls `_schedule_reingest`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_knowledge/test_reingest_runner.py`:
```python
from __future__ import annotations

import json

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_reingest_cleans_then_reingests_keeping_row_and_raw(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "r1.md"
    raw.write_text("old", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="r1", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="pending", raw_path="raw/r1.md",
            wiki_pages=json.dumps(["source-r1.md"]),
        ))
        await s.commit()

    phases = []

    def fake_cleanup_prompt(entry, source_page, wiki_dir):
        return "CLEANUP"

    def fake_ingest_prompt(entry, raw_rel, wiki_dir):
        return "INGEST"

    async def fake_run_generation(job, req, *a, **k):
        phases.append("cleanup" if req.text == "CLEANUP" else "ingest")
        return None

    async def fake_snapshot(entry):
        return "raw/r1.md"

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "build_cleanup_prompt", fake_cleanup_prompt)
    monkeypatch.setattr(ingest, "build_ingest_prompt", fake_ingest_prompt)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.reingest_entry(
        "r1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    # clean THEN build
    assert phases == ["cleanup", "ingest"]
    # row preserved and marked done; raw preserved (re-snapshotted)
    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "r1")
        assert e is not None
        assert e.ingest_status == "done"
    assert raw.exists()


@pytest.mark.asyncio
async def test_reingest_without_source_skips_cleanup(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="r2", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="pending", raw_path="", wiki_pages=json.dumps([]),
        ))
        await s.commit()

    phases = []

    async def fake_run_generation(job, req, *a, **k):
        phases.append(req.text)
        return None

    async def fake_snapshot(entry):
        return "raw/r2.md"

    monkeypatch.setattr(ingest, "build_cleanup_prompt", lambda *a: "CLEANUP")
    monkeypatch.setattr(ingest, "build_ingest_prompt", lambda *a: "INGEST")
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "delete_by_id", lambda *a, **k: _true())

    await ingest.reingest_entry(
        "r2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    assert phases == ["INGEST"]   # no cleanup phase (no source page)


async def _true():
    return True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/test_reingest_runner.py -v`
Expected: FAIL — `ingest.reingest_entry` does not exist.

- [ ] **Step 3: Implement `reingest_entry`**

In `backend/app/knowledge/ingest.py`, add after `cleanup_entry`. It runs cleanup-then-ingest under the lock, preserving the row and re-snapshotting raw. It must NEVER raise (records `failed`). Reuse `_run_wiki_agent` for the cleanup phase; the ingest phase mirrors `ingest_entry`'s inline body:
```python
async def reingest_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    """Reload an entry: remove its stale wiki pages, then re-snapshot the
    source and rebuild. Unlike delete, the DB row and (re-fetched) raw
    snapshot are preserved. Never raises; failures set ingest_status=failed.
    """
    try:
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is None:
                return
            source_page = _source_page_of(entry)

        async with _WIKI_AGENT_LOCK:
            model_id, provider_id = (
                resolve_default_model(provider_registry, settings) if settings else (None, None)
            )
            # 1. Clean stale wiki pages (skip if never ingested).
            if source_page is not None:
                cleanup_prompt = build_cleanup_prompt(
                    entry, source_page, str(wiki_store.wiki_dir())
                )
                await _run_wiki_agent(
                    cleanup_prompt,
                    session_factory=session_factory,
                    provider_registry=provider_registry,
                    agent_registry=agent_registry,
                    tool_registry=tool_registry,
                    index_manager=index_manager,
                    model_id=model_id,
                    provider_id=provider_id,
                )
            # 2. Re-snapshot source and rebuild.
            await _set_status(session_factory, entry_id, "extracting")
            raw_rel = await snapshot_raw(entry)
            before = _snapshot_wiki_files()
            ingest_prompt = build_ingest_prompt(entry, raw_rel, str(wiki_store.wiki_dir()))
            await _set_status(session_factory, entry_id, "building")
            await _run_wiki_agent(
                ingest_prompt,
                session_factory=session_factory,
                provider_registry=provider_registry,
                agent_registry=agent_registry,
                tool_registry=tool_registry,
                index_manager=index_manager,
                model_id=model_id,
                provider_id=provider_id,
            )
            after = _snapshot_wiki_files()
            new_pages = sorted({name for name, _mtime in (after - before)})
            async with session_factory() as s:
                e = await s.get(KnowledgeEntry, entry_id)
                if e is not None:
                    e.ingest_status = "done"
                    e.raw_path = raw_rel
                    e.wiki_pages = json.dumps(new_pages, ensure_ascii=False)
                    await s.commit()
    except Exception as exc:
        logger.warning("reingest_entry %s failed: %s", entry_id, exc)
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "failed"
                e.ingest_error = str(exc)
                await s.commit()
```
Note: `reingest_entry` uses `_run_wiki_agent` for BOTH phases (so both get the throwaway-session cleanup and the model). `ingest_entry` keeps its own inline body unchanged (do not refactor it here).

In `backend/app/api/knowledge.py`:
- Update the import: `from app.knowledge.ingest import cleanup_entry, ingest_entry, reingest_entry`.
- Add `_schedule_reingest` mirroring `_schedule_cleanup` but calling `reingest_entry`.
- Change `reingest_knowledge` to call `_schedule_reingest(request, entry_id=entry_id)` instead of `_schedule_ingest`:
```python
def _schedule_reingest(request: Request, entry_id: str) -> None:
    st = request.app.state
    asyncio.create_task(
        reingest_entry(
            entry_id,
            session_factory=st.session_factory,
            provider_registry=st.provider_registry,
            agent_registry=st.agent_registry,
            tool_registry=st.tool_registry,
            index_manager=getattr(st, "index_manager", None),
            settings=getattr(st, "settings", None),
        )
    )
```
In `reingest_knowledge`, keep the `pending`/`ingest_error=""` reset, then `_schedule_reingest(request, entry_id=entry_id)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/test_reingest_runner.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Full backend knowledge + API suite**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/ tests/test_api/ -k "knowledge or cleanup or ingest or reingest" -v`
Expected: PASS (all). Existing `test_knowledge_ingest_trigger.py` may assert `_schedule_ingest` was called on reingest — if so, update it to `_schedule_reingest` as a minimal contract fix (note it in the report).

- [ ] **Step 6: Commit**

```bash
git add backend/app/knowledge/ingest.py backend/app/api/knowledge.py backend/tests/test_knowledge/test_reingest_runner.py
git commit -m "feat(knowledge): reingest is clean (cleanup stale pages then rebuild)"
```

---

### Task 4: done 条目加「重新加载」刷新按钮(缺陷 C 前端)

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Consumes: existing `useReingestKnowledge` hook + `reingest(entry)` handler (`page.tsx:76,174`).
- Produces: a refresh (`RefreshCw`) icon button visible on `ingest_status === "done"` entries that calls `reingest(entry)`.

- [ ] **Step 1: Read the current button area**

Read `frontend/src/app/(main)/knowledge/page.tsx` around the action buttons (the 启用/删除 buttons near line 411-429) and the existing failed-only 重试 button (line 395-411) to confirm placement and the `reingest`/`reingestKnowledge` names.

- [ ] **Step 2: Add the RefreshCw import**

In the lucide-react import block at the top of `page.tsx`, add `RefreshCw` (check whether it is already imported; if `Trash2` is imported there, add `RefreshCw` alongside it).

- [ ] **Step 3: Add the refresh button for done entries**

In the per-entry action area (next to the 启用/停用 and 删除 buttons, around line 411-429), add a refresh icon button shown only when `entry.ingest_status === "done"`:
```tsx
                        {entry.ingest_status === "done" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => reingest(entry)}
                            disabled={reingestKnowledge.isPending}
                            className="h-8 w-8 shrink-0 text-[var(--text-tertiary)] hover:text-[var(--data-accent)]"
                            aria-label="重新加载"
                            title="重新加载(飞书/文件更新后刷新)"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
```
Place it before the 删除 button so the order reads 启用 · 重新加载 · 删除. The existing failed-state 重试 text button (line 395-411) stays as-is.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "feat(knowledge): 重新加载 button on done entries (Feishu/file refresh)"
```

---

### Task 5: 端到端真机重验

**Files:** none (verification only)

- [ ] **Step 1: Full backend suites**

Run: `cd backend && venv/bin/python -m pytest tests/test_knowledge/ tests/test_api/ -k "knowledge or cleanup or ingest or reingest" -v`
Expected: PASS (all).

- [ ] **Step 2: Frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Real-machine verify via dev desktop**

Restart `npm run dev:desktop`. Confirm the configured default model is a strong model (Settings → default model). Then:
1. Import 1 doc → wait `done`.
2. Delete it → observe cleanup converges (no context overflow), own source page removed, shared pages preserved, index.md accurate, row removed.
3. Import 2 docs, delete both near-simultaneously → confirm the lock serializes them and index.md has no overwrite/resurrection.
4. Import a doc → wait `done` → click 重新加载 → confirm it cleans then rebuilds (stale content gone, no duplication).

- [ ] **Step 4: Commit any fixes surfaced by verification** (skip if none)

```bash
git add -A
git commit -m "fix(knowledge): address issues found in fixes verification"
```

---

## Self-Review 记录

- **Spec coverage:** 缺陷 A(Task 1)、缺陷 B(Task 2)、缺陷 C 后端 先清后建(Task 3)+ 前端刷新按钮(Task 4)、真机重验(Task 5)。均有任务。
- **Placeholder scan:** 无 TBD;每步含完整代码。
- **Type/name consistency:** `resolve_default_model(registry, settings) -> (model_id, provider_id)`;`_run_wiki_agent(..., model_id, provider_id)`;`ingest_entry/cleanup_entry/reingest_entry(..., settings=None)`;`_WIKI_AGENT_LOCK`;`_schedule_reingest`。跨任务一致。锁在 Task 2 引入,Task 3 的 reingest_entry 复用它(Task 3 依赖 Task 2 已合入)。
