"""Render a structured report spec into a self-contained HTML data report.

The data agent (or expert reporter) provides a structured spec — title, KPIs,
charts (echarts spec + inline data), narrative sections, caliber declarations —
via the ``build_report`` tool, and this module assembles the final HTML using a
fixed light-theme template + echarts CDN. Keeping assembly server-side means:

  - the LLM never has to emit a large HTML blob as one tool argument (which was
    getting truncated mid-JSON), only compact structured data;
  - structure, palette, and the caliber/credibility scaffolding are guaranteed
    correct instead of hand-written each time.

Charts use echarts loaded from a CDN (rendering needs network; an offline
fallback message is shown otherwise). Palette + number formatting mirror the
frontend chart-renderer so reports look like the app.
"""

from __future__ import annotations

import html
import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

ECHARTS_CDN = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"
# Vendored echarts so reports render offline / on an intranet where the CDN is
# unreachable. Falls back to the CDN <script> tag only if the asset is missing.
_ECHARTS_ASSET = Path(__file__).parent / "assets" / "echarts.min.js"


@lru_cache(maxsize=1)
def _echarts_inline_source() -> str | None:
    """Return the vendored echarts source, or None if the asset is unavailable."""
    try:
        return _ECHARTS_ASSET.read_text(encoding="utf-8")
    except OSError:
        log.warning("Vendored echarts asset missing at %s; falling back to CDN", _ECHARTS_ASSET)
        return None

# Series palette — identical to frontend chart-renderer COLORS (same order).
PALETTE = [
    "#4f8ff7", "#f79f4f", "#4fcf8f", "#c77dff",
    "#f7746f", "#4fc4cf", "#f7c14f", "#8f9ff7",
]

# Light-theme CSS, inlined (report is a standalone file — no runtime CSS vars).
_STYLE = """
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #111827; background: #f8fafc; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .report { max-width: 1200px; margin: 0 auto; padding: 32px 24px 64px; }
  section { margin-top: 28px; }
  h2 { font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 12px;
       padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  header.report-head { margin-bottom: 8px; }
  header.report-head h1 { font-size: 24px; font-weight: 700; margin: 0 0 6px; }
  header.report-head .subtitle { color: #6b7280; font-size: 14px; margin: 0 0 10px; }
  header.report-head .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; color: #6b7280; font-size: 13px; }
  .summary ul { margin: 0; padding-left: 20px; }
  .summary li { margin-bottom: 6px; }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  .kpi-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px;
              padding: 16px 18px; box-shadow: 0 1px 2px rgba(17,24,39,0.04); }
  .kpi-card .kpi-name { color: #6b7280; font-size: 13px; margin-bottom: 6px; }
  .kpi-card .kpi-value { font-size: 26px; font-weight: 700; color: #111827; }
  .kpi-card .kpi-delta { font-size: 13px; margin-top: 4px; }
  .kpi-card .kpi-delta.up { color: #16a34a; }
  .kpi-card .kpi-delta.down { color: #dc2626; }
  .kpi-card .kpi-delta.flat { color: #6b7280; }
  .attribution-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .attribution-stat { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .attribution-stat .label { color: #6b7280; font-size: 12px; }
  .attribution-stat .value { margin-top: 4px; color: #111827; font-size: 18px; font-weight: 700; }
  .drivers table { width: 100%; border-collapse: collapse; font-size: 13px; background: #ffffff; border: 1px solid #e5e7eb; }
  .drivers th, .drivers td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  .drivers th { background: #f8fafc; color: #6b7280; text-align: left; }
  .drivers td.num, .drivers th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .driver-positive { color: #16a34a; }
  .driver-negative { color: #dc2626; }
  .charts { display: grid; gap: 20px; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
  .chart-block { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
  .chart-block .chart { width: 100%; }
  .chart-block .chart-fallback { color: #6b7280; font-size: 13px; padding: 24px; text-align: center; }
  .chart-block .chart-caption { color: #6b7280; font-size: 12px; margin-top: 8px; }
  .detail table { width: 100%; border-collapse: collapse; font-size: 13px; background: #ffffff;
                  border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
  .detail th, .detail td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  .detail th { background: #f8fafc; color: #6b7280; font-weight: 600; text-align: left; }
  .detail td.num, .detail th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .detail tr:last-child td { border-bottom: none; }
  .insights .insight { margin-bottom: 10px; }
  .tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px;
         border-radius: 999px; margin-right: 8px; vertical-align: middle; }
  .tag.fact { background: #e8f0fe; color: #4f8ff7; }
  .tag.inference { background: #fef1e6; color: #f79f4f; }
  .tag.hypothesis { background: #f3e8ff; color: #9333ea; }
  .tag.recommendation { background: #e7f6ec; color: #16a34a; }
  .evidence-ref { color: #6b7280; font-size: 11px; margin-left: 8px; }
  .evidence details { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
  .evidence summary { cursor: pointer; font-weight: 600; }
  .evidence ul { margin: 10px 0 0; padding-left: 20px; color: #6b7280; font-size: 12px; }
  .caliber dl { margin: 0; }
  .caliber dt { font-weight: 600; margin-top: 10px; }
  .caliber dd { margin: 2px 0 0; color: #6b7280; font-size: 13px; }
  .caliber .custom-caliber { color: #dc2626; }
  .caveats ul { margin: 0; padding-left: 20px; color: #6b7280; }
  footer { margin-top: 40px; color: #6b7280; font-size: 12px; text-align: center; }
  @media (max-width: 640px) {
    .report { padding: 20px 14px 40px; }
    .kpi-row { grid-template-columns: 1fr; }
    header.report-head h1 { font-size: 20px; }
  }
"""

_TAG_CLASS = {"fact": "fact", "inference": "inference", "hypothesis": "hypothesis", "recommendation": "recommendation"}
_HYPOTHESIS_LABEL = "待验证假设"
_TAG_LABEL = {"fact": "事实", "inference": "推断", "recommendation": "建议"}


def _esc(v: Any) -> str:
    return html.escape("" if v is None else str(v))


def render_report(spec: dict[str, Any]) -> str:
    """Assemble a structured report spec into a full self-contained HTML string.

    spec keys (all optional except title):
      title: str
      subtitle: str
      meta: {data_as_of, generated_at, source}
      summary: [str, ...]
      kpis: [{name, value, delta_pct?, delta_dir?('up'|'down'|'flat'), delta_label?}]
      attribution: {target_metric, baseline_value, current_value, delta_value,
                    delta_pct?, explained_pct?, method?, causal_claim?}
      drivers: [{rank?, name, dimension?, baseline?, current?, delta?,
                 contribution_pct?, direction?, evidence_ids?}]
      charts: [chart_spec]  (see _chart_option)
      table: {columns: [str], rows: [[cell]], numeric: [bool per col]?, note?}
      insights: [{kind('fact'|'inference'|'hypothesis'|'recommendation'), text,
                  evidence_ids?}]
      caliber: [{metric, desc, custom?(bool)}]
      caveats: [str, ...]
    """
    parts: list[str] = []
    charts = spec.get("charts") or []

    parts.append("<!DOCTYPE html>")
    parts.append('<html lang="zh-CN"><head><meta charset="utf-8">')
    parts.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    parts.append(f"<title>{_esc(spec.get('title') or '数据分析报告')}</title>")
    if charts:
        inline = _echarts_inline_source()
        if inline:
            # Inline the library so the report is fully self-contained (opens
            # offline / on an intranet with no CDN access).
            parts.append(f"<script>{inline}</script>")
        else:
            parts.append(f'<script src="{ECHARTS_CDN}"></script>')
    parts.append(f"<style>{_STYLE}</style></head><body>")
    parts.append('<div class="report">')

    parts.append(_render_header(spec))
    parts.append(_render_summary(spec.get("summary")))
    parts.append(_render_kpis(spec.get("kpis")))
    parts.append(_render_attribution(spec.get("attribution"), spec.get("analysis_type")))
    parts.append(_render_drivers(spec.get("drivers")))
    parts.append(_render_charts(charts))
    parts.append(_render_table(spec.get("table")))
    parts.append(_render_insights(spec.get("insights")))
    parts.append(_render_caliber(spec.get("caliber")))
    parts.append(_render_caveats(spec.get("caveats")))
    parts.append(_render_evidence(spec.get("evidence")))
    trace = f" · Trace {_esc(spec.get('trace_id'))}" if spec.get("trace_id") else ""
    parts.append(f"<footer>由 Codata 生成{trace}</footer>")

    parts.append("</div>")
    if charts:
        parts.append(_render_chart_scripts(charts))
    parts.append("</body></html>")
    return "\n".join(p for p in parts if p)


def _render_header(spec: dict[str, Any]) -> str:
    title = _esc(spec.get("title") or "数据分析报告")
    subtitle = spec.get("subtitle")
    meta = spec.get("meta") or {}
    meta_spans = []
    if meta.get("data_as_of"):
        meta_spans.append(f"<span>数据截至 {_esc(meta['data_as_of'])}</span>")
    if meta.get("generated_at"):
        meta_spans.append(f"<span>生成时间 {_esc(meta['generated_at'])}</span>")
    if meta.get("source"):
        meta_spans.append(f"<span>数据来源 {_esc(meta['source'])}</span>")
    sub_html = f'<p class="subtitle">{_esc(subtitle)}</p>' if subtitle else ""
    meta_html = f'<div class="meta">{"".join(meta_spans)}</div>' if meta_spans else ""
    return f'<header class="report-head"><h1>{title}</h1>{sub_html}{meta_html}</header>'


def _render_summary(summary: list | None) -> str:
    if not summary:
        return ""
    lis = "".join(f"<li>{_esc(s)}</li>" for s in summary)
    return f'<section class="summary"><h2>执行摘要</h2><ul>{lis}</ul></section>'


def _render_kpis(kpis: list | None) -> str:
    if not kpis:
        return ""
    cards = []
    for k in kpis:
        name = _esc(k.get("name"))
        value = _esc(k.get("value"))
        delta_html = ""
        if k.get("delta_pct") is not None or k.get("delta_label"):
            direction = k.get("delta_dir") or "flat"
            cls = direction if direction in ("up", "down", "flat") else "flat"
            arrow = {"up": "▲", "down": "▼", "flat": "—"}[cls]
            label = k.get("delta_label")
            if label:
                text = _esc(label)
            else:
                text = f"{arrow} {abs(float(k['delta_pct'])):.1f}% 环比"
            delta_html = f'<div class="kpi-delta {cls}">{text}</div>'
        cards.append(
            f'<div class="kpi-card"><div class="kpi-name">{name}</div>'
            f'<div class="kpi-value">{value}</div>{delta_html}</div>'
        )
    return f'<section><h2>核心指标</h2><div class="kpi-row">{"".join(cards)}</div></section>'


def _render_attribution(attribution: dict | None, analysis_type: str | None = None) -> str:
    if not attribution:
        return ""
    values = [
        ("目标指标", attribution.get("target_metric")),
        ("基准值", attribution.get("baseline_value")),
        ("对比值", attribution.get("current_value")),
        ("变化量", attribution.get("delta_value")),
        ("变化率", f"{float(attribution['delta_pct']):.1f}%" if attribution.get("delta_pct") is not None else None),
        ("已解释变化", f"{float(attribution['explained_pct']):.1f}%" if attribution.get("explained_pct") is not None else None),
    ]
    cards = "".join(
        f'<div class="attribution-stat"><div class="label">{_esc(label)}</div><div class="value">{_esc(value)}</div></div>'
        for label, value in values if value not in (None, "")
    )
    notes = []
    if analysis_type or attribution.get("method"):
        notes.append(f"分析方法：{_esc(attribution.get('method') or analysis_type)}")
    if attribution.get("causal_claim") is not True:
        notes.append("本报告为统计归因，不构成因果证明。")
    note_html = f'<p class="chart-caption">{" ".join(notes)}</p>' if notes else ""
    return f'<section><h2>指标变化</h2><div class="attribution-overview">{cards}</div>{note_html}</section>'


def _render_drivers(drivers: list | None) -> str:
    if not drivers:
        return ""
    rows = []
    for index, driver in enumerate(drivers):
        direction = driver.get("direction") or "neutral"
        cls = "driver-positive" if direction == "positive" else "driver-negative" if direction == "negative" else ""
        contribution = driver.get("contribution_pct")
        contribution_text = f"{float(contribution):.1f}%" if contribution is not None else ""
        rows.append(
            "<tr>"
            f'<td>{_esc(driver.get("rank") or index + 1)}</td>'
            f'<td>{_esc(driver.get("name"))}</td>'
            f'<td>{_esc(driver.get("dimension"))}</td>'
            f'<td class="num">{_esc(driver.get("baseline"))}</td>'
            f'<td class="num">{_esc(driver.get("current"))}</td>'
            f'<td class="num {cls}">{_esc(driver.get("delta"))}</td>'
            f'<td class="num {cls}">{_esc(contribution_text)}</td>'
            "</tr>"
        )
    return (
        '<section class="drivers"><h2>主要驱动因素</h2><table><thead><tr>'
        '<th>排名</th><th>驱动因素</th><th>维度</th><th class="num">基准值</th>'
        '<th class="num">对比值</th><th class="num">变化量</th><th class="num">贡献率</th>'
        f'</tr></thead><tbody>{"".join(rows)}</tbody></table></section>'
    )


def _render_charts(charts: list) -> str:
    if not charts:
        return ""
    blocks = []
    for i, c in enumerate(charts):
        cid = f"chart-{i}"
        caption = c.get("caption")
        cap_html = f'<div class="chart-caption">{_esc(caption)}</div>' if caption else ""
        height = int(c.get("height", 380))
        blocks.append(
            f'<div class="chart-block"><div id="{cid}" class="chart" style="height:{height}px;">'
            f'<div class="chart-fallback">图表加载中,如未显示请刷新页面。</div>'
            f"</div>{cap_html}</div>"
        )
    inner = "".join(blocks)
    if len(charts) > 1:
        inner = f'<div class="chart-grid">{inner}</div>'
    return f'<section class="charts"><h2>趋势与分布</h2>{inner}</section>'


def _render_table(table: dict | None) -> str:
    if not table or not table.get("columns"):
        return ""
    cols = table["columns"]
    numeric = table.get("numeric") or [False] * len(cols)
    ths = "".join(
        f'<th class="num">{_esc(c)}</th>' if (i < len(numeric) and numeric[i]) else f"<th>{_esc(c)}</th>"
        for i, c in enumerate(cols)
    )
    trs = []
    for row in table.get("rows") or []:
        tds = "".join(
            f'<td class="num">{_esc(cell)}</td>' if (i < len(numeric) and numeric[i]) else f"<td>{_esc(cell)}</td>"
            for i, cell in enumerate(row)
        )
        trs.append(f"<tr>{tds}</tr>")
    note = table.get("note")
    note_html = f'<p style="color:#6b7280;font-size:12px;margin-top:8px;">{_esc(note)}</p>' if note else ""
    return (
        f'<section class="detail"><h2>数据明细</h2>'
        f"<table><thead><tr>{ths}</tr></thead><tbody>{''.join(trs)}</tbody></table>{note_html}</section>"
    )


def _render_insights(insights: list | None) -> str:
    if not insights:
        return ""
    items = []
    for it in insights:
        kind = it.get("kind", "fact")
        cls = _TAG_CLASS.get(kind, "fact")
        label = _HYPOTHESIS_LABEL if kind == "hypothesis" else _TAG_LABEL.get(kind, "事实")
        refs = it.get("evidence_ids") or []
        ref_html = f'<span class="evidence-ref">证据：{_esc(", ".join(str(ref) for ref in refs))}</span>' if refs else ""
        items.append(f'<p class="insight"><span class="tag {cls}">{label}</span>{_esc(it.get("text"))}{ref_html}</p>')
    return f'<section class="insights"><h2>归因与洞察</h2>{"".join(items)}</section>'


def _render_caliber(caliber: list | None) -> str:
    if not caliber:
        return ""
    rows = []
    for c in caliber:
        metric = (c.get("metric") or "").strip()
        desc = _esc(c.get("desc"))
        # `metric` is optional in practice (the model often sends only `desc`);
        # emit the <dt> only when it's present so we don't render an empty bold
        # heading above the description.
        if metric:
            rows.append(f"<dt>{_esc(metric)}</dt>")
        if c.get("custom"):
            rows.append(f'<dd class="custom-caliber">⚠️ 自定义口径,未经指标中心验证;{desc}</dd>')
        else:
            rows.append(f"<dd>{desc}</dd>")
    return f'<section class="caliber"><h2>口径与数据来源</h2><dl>{"".join(rows)}</dl></section>'


def _render_caveats(caveats: list | None) -> str:
    if not caveats:
        return ""
    lis = "".join(f"<li>{_esc(s)}</li>" for s in caveats)
    return f'<section class="caveats"><h2>风险与待确认</h2><ul>{lis}</ul></section>'


def _render_evidence(evidence: list | None) -> str:
    if not evidence:
        return ""
    items = []
    for index, item in enumerate(evidence):
        evidence_id = item.get("evidence_id") or item.get("id") or f"ev_{index + 1:03d}"
        kind = item.get("kind") or item.get("source") or "evidence"
        label = item.get("title") or item.get("metric") or item.get("dimension") or "数据证据"
        items.append(f"<li><strong>{_esc(evidence_id)}</strong> · {_esc(kind)} · {_esc(label)}</li>")
    return (
        '<section class="evidence"><h2>证据与追溯</h2><details>'
        f'<summary>查看 {len(items)} 条证据</summary><ul>{"".join(items)}</ul>'
        '</details></section>'
    )


def _render_chart_scripts(charts: list) -> str:
    """Emit the echarts init script. Data is JSON-inlined; options assembled here.

    Tagged with data-codata-charts so it can be found unambiguously even when the
    echarts library itself is inlined just above (which also contains setOption).
    """
    lines = ['<script data-codata-charts>', "if (window.echarts) {"]
    for i, c in enumerate(charts):
        option = _chart_option(c)
        lines.append(
            f"echarts.init(document.getElementById('chart-{i}'))"
            f".setOption({json.dumps(option, ensure_ascii=False)});"
        )
    lines.append("}")
    lines.append("</script>")
    return "\n".join(lines)


def _chart_option(c: dict[str, Any]) -> dict[str, Any]:
    """Build an echarts option dict from a compact chart spec (light theme)."""
    ctype = c.get("type", "line")
    title = c.get("title")
    base: dict[str, Any] = {
        "backgroundColor": "transparent",
        "textStyle": {"color": "#6b7280"},
        "grid": {"left": 56, "right": 24, "top": 40, "bottom": 40},
    }
    if title:
        base["title"] = {"text": title, "left": 10, "top": 6,
                         "textStyle": {"color": "#111827", "fontSize": 14}}

    series_in = c.get("series") or []

    if ctype == "pie":
        base["tooltip"] = {"trigger": "item"}
        data = [
            {"name": s.get("name"), "value": s.get("value"),
             "itemStyle": {"color": PALETTE[i % len(PALETTE)]}}
            for i, s in enumerate(series_in)
        ]
        base["series"] = [{
            "type": "pie", "radius": ["40%", "65%"], "center": ["50%", "54%"],
            "data": data, "label": {"formatter": "{b} {d}%"},
        }]
        base["legend"] = {"bottom": 0, "textStyle": {"color": "#6b7280"}}
        return base

    # cartesian (line / bar / bar_horizontal / stacked_bar)
    horizontal = ctype == "bar_horizontal"
    base["tooltip"] = {"trigger": "axis"}
    cat_axis = {"type": "category", "data": c.get("x") or [],
                "axisLine": {"lineStyle": {"color": "#e5e7eb"}},
                "axisLabel": {"color": "#6b7280"}}
    val_axis = {"type": "value",
                "axisLine": {"lineStyle": {"color": "#e5e7eb"}},
                "axisLabel": {"color": "#6b7280"},
                "splitLine": {"lineStyle": {"color": "#eceff3"}}}
    if horizontal:
        # Swap axes so category labels sit on the Y axis (readable for long,
        # many CJK names), and reverse so the largest bar is on top.
        cat_axis["inverse"] = True
        base["xAxis"] = val_axis
        base["yAxis"] = cat_axis
        base["grid"] = {"left": 160, "right": 32, "top": 40, "bottom": 40}
    else:
        base["xAxis"] = cat_axis
        base["yAxis"] = val_axis
    if len(series_in) > 1:
        base["legend"] = {"top": 0, "data": [s.get("name") for s in series_in],
                          "textStyle": {"color": "#6b7280"}}
    series_out = []
    for i, s in enumerate(series_in):
        color = PALETTE[i % len(PALETTE)]
        stype = s.get("type") or ("bar" if ctype in ("bar", "bar_horizontal", "stacked_bar") else "line")
        item: dict[str, Any] = {
            "name": s.get("name"), "type": stype, "data": s.get("data") or [],
            "itemStyle": {"color": color},
        }
        if stype == "line":
            item["smooth"] = True
        if ctype == "stacked_bar" and stype == "bar":
            item["stack"] = "total"
        series_out.append(item)
    base["series"] = series_out
    return base
