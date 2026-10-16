from pathlib import Path


def test_data_prompt_enforces_caliber_and_sanity_check():
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")
    # 口径：核心业务数字必须走权威口径（语义模型指标），不手写 SQL
    assert "tool_search" in text
    assert "A semantic model is optional" in text
    assert "never assume a server name" in text
    assert "自定义口径" in text  # execute_sql 取数时须注明
    # sanity-check（数量级 / parts-sum）
    assert "order of magnitude" in text.lower() or "数量级" in text or "sanity" in text.lower()


def test_data_prompt_has_run_query_escalation_criteria():
    """Prompt must give the agent concrete triggers for escalating to run_query."""
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")

    # Section header
    assert "When to use run_query" in text

    # Concrete triggers
    assert "Missing grain" in text
    assert "DATE_TRUNC" in text
    assert "Cross-entity dimension rejection" in text
    assert "HAVING" in text
    assert "Window functions" in text
    assert "Multi-indicator" in text
    assert "Time comparison" in text

    # Escalation guardrails
    assert "First inspect schema" in text
    assert "one SQL" in text.lower() or "ONCE" in text  # one call per question
    assert "custom definition" in text


def test_data_prompt_no_loop_anti_pattern():
    """The old 'split into N query_indicator calls + code_execute' escape hatch
    must be gone — it competes with the execute_sql escalation path and the agent
    will always pick the familiar loop over writing SQL."""
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")

    # Old anti-pattern text must NOT exist
    assert "split by the finest available grain and aggregate up locally" not in text
    assert "rolling a finer grain up to a coarser one" not in text

    # New step 5 explicitly forbids the loop
    assert "Do NOT" in text and "N separate semantic queries" in text
    assert "old anti-pattern" in text

    # code_execute must not be used for reassembling query rows
    assert "never use it to reassemble" in text.lower()


def test_data_prompt_uses_concise_markdown_final_answers():
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")

    assert "GitHub-flavored Markdown" in text
    assert "### 关键发现" in text
    assert "Do not narrate tool selection" in text
    assert "do not paste it into the final" in text
    assert "Show the SQL you wrote." not in text


def test_data_prompt_routes_attribution_to_skill():
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")
    assert "attribution-analysis" in text
    assert "what drove growth or decline" in text
    assert "report_recommended=true" in text


def test_data_prompt_uses_structured_clarification_only_for_blocking_ambiguity():
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")

    assert "# Requirement clarification" in text
    assert "Use the `question` tool BEFORE querying" in text
    assert "1-3 blocking questions" in text
    assert "recommended/default option first" in text
    assert "normal" in text and "questionnaire" in text
    assert "Never ask a blocking clarification as plain chat text" in text
