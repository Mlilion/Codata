"""Deterministic normalization for attribution report specs."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def compile_attribution_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Normalize attribution fields and validate explicit evidence references.

    Numeric ``*_raw`` fields are optional. When supplied, they are used for
    calculations while display strings remain untouched.
    """
    result = deepcopy(spec)
    if result.get("report_type") != "attribution" and not result.get("attribution") and not result.get("drivers"):
        return result

    attribution = result.setdefault("attribution", {})
    drivers = [dict(item) for item in (result.get("drivers") or []) if isinstance(item, dict)]
    total_delta = _number(attribution.get("delta_raw"))
    if total_delta is None:
        baseline = _number(attribution.get("baseline_raw"))
        current = _number(attribution.get("current_raw"))
        if baseline is not None and current is not None:
            total_delta = current - baseline
            attribution["delta_raw"] = total_delta
            if attribution.get("delta_pct") is None and baseline != 0:
                attribution["delta_pct"] = round(total_delta / abs(baseline) * 100, 4)

    for driver in drivers:
        delta = _number(driver.get("delta_raw"))
        if delta is None:
            baseline = _number(driver.get("baseline_raw"))
            current = _number(driver.get("current_raw"))
            if baseline is not None and current is not None:
                delta = current - baseline
                driver["delta_raw"] = delta
        if delta is not None:
            driver.setdefault("direction", "positive" if delta > 0 else "negative" if delta < 0 else "neutral")
            if driver.get("contribution_pct") is None and total_delta not in (None, 0):
                driver["contribution_pct"] = round(delta / total_delta * 100, 4)

    drivers.sort(key=_driver_sort_key)
    for index, driver in enumerate(drivers, start=1):
        driver["rank"] = index
    result["drivers"] = drivers

    if attribution.get("explained_pct") is None and total_delta not in (None, 0):
        known_deltas = [_number(driver.get("delta_raw")) for driver in drivers]
        if drivers and all(value is not None for value in known_deltas):
            attribution["explained_pct"] = round(sum(value for value in known_deltas if value is not None) / total_delta * 100, 4)

    _validate_evidence_references(result)

    result["delivery"] = _recommend_delivery(result)

    caveats = list(result.get("caveats") or [])
    causal_note = "贡献度表示统计分解，不构成因果证明。"
    if attribution.get("causal_claim") is not True and causal_note not in caveats:
        caveats.append(causal_note)
    result["caveats"] = caveats
    return result


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _driver_sort_key(driver: dict[str, Any]) -> tuple[int, float, int]:
    delta = _number(driver.get("delta_raw"))
    contribution = _number(driver.get("contribution_pct"))
    magnitude = abs(delta) if delta is not None else abs(contribution) if contribution is not None else -1
    explicit_rank = driver.get("rank") if isinstance(driver.get("rank"), int) else 10**9
    return (0 if magnitude >= 0 else 1, -magnitude, explicit_rank)


def _validate_evidence_references(spec: dict[str, Any]) -> None:
    evidence_ids: set[str] = set()
    for index, item in enumerate(spec.get("evidence") or [], start=1):
        if not isinstance(item, dict):
            continue
        evidence_id = str(item.get("evidence_id") or item.get("id") or f"ev_{index:03d}")
        if evidence_id in evidence_ids:
            raise ValueError(f"Duplicate attribution evidence id: {evidence_id}")
        item["evidence_id"] = evidence_id
        evidence_ids.add(evidence_id)

    referenced: set[str] = set()
    for item in [*(spec.get("drivers") or []), *(spec.get("insights") or [])]:
        if not isinstance(item, dict):
            continue
        referenced.update(str(value) for value in (item.get("evidence_ids") or []))

    if referenced and not evidence_ids:
        raise ValueError("Attribution findings reference evidence_ids, but no evidence index was provided.")
    unknown = sorted(referenced - evidence_ids)
    if unknown:
        raise ValueError(f"Unknown attribution evidence id(s): {', '.join(unknown)}")


def _recommend_delivery(spec: dict[str, Any]) -> dict[str, Any]:
    """Recommend an HTML report only when the attribution is substantively complex."""
    drivers = [item for item in (spec.get("drivers") or []) if isinstance(item, dict)]
    evidence = [item for item in (spec.get("evidence") or []) if isinstance(item, dict)]
    analysis_type = str(spec.get("analysis_type") or "change_attribution")
    dimensions = {str(item.get("dimension")) for item in drivers if item.get("dimension")}
    directions = {str(item.get("direction")) for item in drivers if item.get("direction")}

    reasons: list[str] = []
    if len(drivers) >= 3:
        reasons.append(f"包含 {len(drivers)} 个驱动因素")
    if len(evidence) >= 2:
        reasons.append(f"引用 {len(evidence)} 组独立证据")
    if len(dimensions) >= 2:
        reasons.append("包含多维度归因")
    if {"positive", "negative"} <= directions:
        reasons.append("同时存在正向和负向贡献")
    if analysis_type in {"metric_tree", "funnel_attribution", "anomaly_attribution", "causal_analysis"} and len(drivers) >= 2:
        reasons.append(f"{analysis_type} 需要结构化展示")

    recommended = bool(reasons)
    return {
        "report_recommended": recommended,
        "report_level": "full" if len(reasons) >= 3 else "light" if recommended else "none",
        "reasons": reasons,
    }
