"""Render structured analysis memory into a system-prompt section."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.memory.analysis_memory_storage import get_analysis_memory


async def build_analysis_memory_section(
    session_factory: async_sessionmaker[AsyncSession],
    user_id: str | None = None,
) -> str | None:
    """Build an <analysis-memory> section for the data agent, or None if empty."""
    data = await get_analysis_memory(session_factory, user_id)
    lines: list[str] = []

    metrics = data.get("frequent_metrics") or []
    if metrics:
        names = ", ".join(
            f"{m.get('name')}" + (f"({m.get('table')})" if m.get("table") else "")
            for m in metrics[:10]
        )
        lines.append(f"常用指标: {names}")

    dims = data.get("frequent_dimensions") or []
    if dims:
        lines.append("常用维度: " + ", ".join(str(d.get("field")) for d in dims[:10]))

    prefs = data.get("caliber_preferences") or []
    if prefs:
        lines.append("口径偏好: " + "; ".join(prefs[:10]))

    topics = data.get("analysis_topics") or []
    if topics:
        recent = [str(t.get("summary")) for t in topics[-5:]]
        lines.append("近期分析: " + " | ".join(recent))

    if not lines:
        return None

    body = "\n".join(f"- {ln}" for ln in lines)
    return (
        "<analysis-memory>\n"
        "以下是该用户的历史分析习惯,用于让你更懂 ta、并在合适时提出延伸分析:\n"
        f"{body}\n"
        "</analysis-memory>"
    )
