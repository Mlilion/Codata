"""Analysis endpoints — history-based recommendations for the Codata landing."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.dependencies import get_session_factory

logger = logging.getLogger(__name__)

router = APIRouter()

# Shown when there's no history yet — generic starter prompts.
DEFAULT_RECOMMENDATIONS = [
    "看看最近 30 天的整体活跃趋势",
    "按渠道对比核心指标",
    "有哪些可用的数据表和指标?",
]

MAX_RECOMMENDATIONS = 5


def _build_recommendations(data: dict) -> list[str]:
    """Rule-based suggestions from structured analysis memory.

    Kept dependency-free (no LLM) so the landing page loads instantly. When
    memory is empty, fall back to generic starters.
    """
    recs: list[str] = []

    metrics = data.get("frequent_metrics") or []
    dims = data.get("frequent_dimensions") or []

    # 1) Re-look at a frequent metric.
    if metrics:
        top = metrics[0].get("name")
        if top:
            recs.append(f"看看「{top}」最近的变化趋势")

    # 2) Cross a frequent metric with a frequent dimension.
    if metrics and dims:
        m = metrics[0].get("name")
        d = dims[0].get("field")
        if m and d:
            recs.append(f"按「{d}」拆解「{m}」")

    # 3) Suggest a dimension the user uses but maybe not with the top metric.
    if len(dims) > 1 and metrics:
        m = metrics[0].get("name")
        d2 = dims[1].get("field")
        if m and d2:
            recs.append(f"「{m}」在不同「{d2}」上的差异")

    # 4) Continue a recent topic.
    topics = data.get("analysis_topics") or []
    if topics:
        last = topics[-1].get("summary")
        if last:
            recs.append(f"延续上次分析:{last}")

    # De-dupe, cap, and fall back if empty.
    seen: set[str] = set()
    deduped = [r for r in recs if not (r in seen or seen.add(r))]
    if not deduped:
        return list(DEFAULT_RECOMMENDATIONS)
    return deduped[:MAX_RECOMMENDATIONS]


@router.get("/analysis/recommendations")
async def get_recommendations(
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> dict:
    """Return history-based analysis suggestions for the Codata landing page."""
    from app.memory.analysis_memory_storage import get_analysis_memory

    try:
        data = await get_analysis_memory(session_factory, None)
    except Exception:
        logger.debug("analysis recommendations: memory load failed", exc_info=True)
        data = {}
    return {"recommendations": _build_recommendations(data)}
