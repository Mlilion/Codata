"""LLM-based structured analysis-memory extraction.

After a data-analysis conversation, merge the current structured memory with
what the user just did to produce an UPDATED structured memory (JSON). Unlike
workspace memory (freeform text), this is a typed object the recommendation
layer can reason over.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

ANALYSIS_MEMORY_UPDATE_PROMPT = """\
You maintain a user's data-analysis memory as a JSON object. Given the current
memory and a data-analysis conversation that just happened, output an UPDATED
memory that captures the user's analysis habits.

Current memory (JSON):
{current}

Conversation:
{conversation}

Produce a single JSON object with EXACTLY these keys:
- "frequent_metrics": array of {{"name": str, "table": str, "count": int, "last_used": str}}
  — metrics/measures the user queried. Increment count for repeats; add new ones.
- "frequent_dimensions": array of {{"field": str, "count": int}}
  — dimensions the user grouped/filtered by (e.g. channel, region, date grain).
- "caliber_preferences": array of short strings
  — recurring caliber/format habits (e.g. "按周聚合", "默认最近30天", "只看去重用户数").
- "analysis_topics": array of {{"summary": str, "at": str}}
  — a one-line summary of THIS analysis session appended to the existing list.

Rules:
- Merge with the current memory; do not drop still-relevant entries.
- Only record what the conversation actually shows. Do not invent metrics/tables.
- If the conversation has no real data analysis, return the current memory unchanged.
- Output ONLY the JSON object, no prose, no markdown fences."""


def build_extraction_prompt(current: dict[str, Any], conversation_text: str) -> str:
    return ANALYSIS_MEMORY_UPDATE_PROMPT.format(
        current=json.dumps(current, ensure_ascii=False),
        conversation=conversation_text,
    )


def parse_analysis_memory_response(response_text: str) -> dict[str, Any] | None:
    """Parse the LLM JSON response; return None on any failure (caller keeps old)."""
    if not response_text:
        return None
    text = response_text.strip()
    # Strip accidental markdown fences.
    if text.startswith("```"):
        text = text.strip("`")
        # drop a leading language tag like "json\n"
        nl = text.find("\n")
        if nl != -1 and text[:nl].strip().lower() in ("json", ""):
            text = text[nl + 1:]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None
