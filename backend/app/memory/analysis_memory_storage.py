"""Storage for structured, user-scoped analysis memory.

Single global row per user_id (null = the open-source single user). The
``data`` JSON accumulates the user's analysis behaviour; lists are capped and
trimmed here so memory can't grow unbounded.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.analysis_memory import AnalysisMemory
from app.utils.id import generate_ulid

# Per-category caps.
MAX_METRICS = 20
MAX_DIMENSIONS = 20
MAX_PREFERENCES = 15
MAX_TOPICS = 20

EMPTY_MEMORY: dict[str, Any] = {
    "frequent_metrics": [],
    "frequent_dimensions": [],
    "caliber_preferences": [],
    "analysis_topics": [],
}


def empty_memory() -> dict[str, Any]:
    return {k: list(v) for k, v in EMPTY_MEMORY.items()}


def trim_memory(data: dict[str, Any]) -> dict[str, Any]:
    """Normalise + cap each category. Tolerant of missing/garbage keys."""
    out = empty_memory()
    if not isinstance(data, dict):
        return out

    metrics = data.get("frequent_metrics")
    if isinstance(metrics, list):
        cleaned = [m for m in metrics if isinstance(m, dict) and m.get("name")]
        # Most-used first.
        cleaned.sort(key=lambda m: m.get("count", 0), reverse=True)
        out["frequent_metrics"] = cleaned[:MAX_METRICS]

    dims = data.get("frequent_dimensions")
    if isinstance(dims, list):
        cleaned = [d for d in dims if isinstance(d, dict) and d.get("field")]
        cleaned.sort(key=lambda d: d.get("count", 0), reverse=True)
        out["frequent_dimensions"] = cleaned[:MAX_DIMENSIONS]

    prefs = data.get("caliber_preferences")
    if isinstance(prefs, list):
        seen: set[str] = set()
        deduped: list[str] = []
        for p in prefs:
            if isinstance(p, str) and p.strip() and p not in seen:
                seen.add(p)
                deduped.append(p.strip())
        out["caliber_preferences"] = deduped[:MAX_PREFERENCES]

    topics = data.get("analysis_topics")
    if isinstance(topics, list):
        cleaned = [t for t in topics if isinstance(t, dict) and t.get("summary")]
        # Newest last in; keep the most recent MAX_TOPICS.
        out["analysis_topics"] = cleaned[-MAX_TOPICS:]

    return out


async def get_analysis_memory(
    session_factory: async_sessionmaker[AsyncSession],
    user_id: str | None = None,
) -> dict[str, Any]:
    """Load the analysis memory for a user (null = single user). Never None."""
    async with session_factory() as db:
        async with db.begin():
            row = await _get_row(db, user_id)
            return trim_memory(row.data) if row and isinstance(row.data, dict) else empty_memory()


async def upsert_analysis_memory(
    session_factory: async_sessionmaker[AsyncSession],
    data: dict[str, Any],
    user_id: str | None = None,
) -> dict[str, Any]:
    """Insert/replace the analysis memory (trimmed). Returns the stored data."""
    trimmed = trim_memory(data)
    async with session_factory() as db:
        async with db.begin():
            row = await _get_row(db, user_id)
            if row:
                row.data = trimmed
            else:
                db.add(AnalysisMemory(id=generate_ulid(), user_id=user_id, data=trimmed))
    return trimmed


async def _get_row(db: AsyncSession, user_id: str | None) -> AnalysisMemory | None:
    stmt = select(AnalysisMemory).where(AnalysisMemory.user_id.is_(None) if user_id is None
                                        else AnalysisMemory.user_id == user_id)
    return (await db.execute(stmt)).scalar_one_or_none()
