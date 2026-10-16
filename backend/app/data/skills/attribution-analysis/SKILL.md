---
name: attribution-analysis
description: Use for questions about why a metric changed, what drove growth or decline, which dimensions contributed, or where an anomaly came from. Supports observation-based attribution reports; it does not claim causality without an experiment or quasi-experimental design.
---

# Attribution Analysis

Use this skill when the user wants an explanation of a metric change, growth
source, decline driver, anomaly, funnel loss, or dimension contribution.

The model may choose the query order, number of queries, dimensions, grain,
SQL, and in-memory calculations. Do not force a fixed tool sequence. Prefer
registered metrics when available, and use the available read-only query tools
when the semantic model cannot express the requested analysis.

Build the analysis from real evidence. Keep the following concepts separate:

- `fact`: directly supported by returned data.
- `inference`: a statistical interpretation of the evidence.
- `hypothesis`: a possible business explanation that still needs validation.
- `recommendation`: a proposed next action.

Contribution is not causality. Without an experiment or quasi-experimental
design, use language such as "主要贡献来自" or "与变化同步" and do not say
that a factor caused or proved the change.

After gathering the evidence, call `compile_attribution` before writing the
final answer when numeric driver values are available. Pass raw numbers through
`baseline_raw`, `current_raw`, and `delta_raw`; use the returned ranks,
contribution percentages, and evidence validation instead of calculating them
in prose. This compiler does not constrain how the evidence was queried.

Report delivery has two triggers:

- If the user explicitly asks for a report, always call `build_report`.
- Otherwise, inspect the `delivery` object returned by `compile_attribution`.
  When `delivery.report_recommended=true`, automatically call `build_report`
  with a light or full report according to `delivery.report_level`, unless the
  user explicitly asked for a concise answer or no report.

When building the report, include `report_type: "attribution"`,
`analysis_type`, and the available `attribution`, `drivers`, `evidence`, and
`trace_id` fields. Keep the chat response short and point to the report. When
`report_recommended=false`, return the concise Markdown attribution answer and
the inline result card without creating an HTML report.

Read the references only when needed:

- `knowledge/attribution-methods.md` for choosing a decomposition method.
- `knowledge/report-structure.md` for dynamic report sections.
- `knowledge/credibility-rules.md` for evidence and causal-language rules.
