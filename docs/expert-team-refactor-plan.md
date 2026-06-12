#当前专家团暴漏的问题
🔴 设计层面

  1. hierarchical 是"幽灵特性"——而它恰恰是你初衷里最关键的编排模式
  ExpertTeamProcess.HIERARCHICAL 在枚举里存在(models.py:17),但 runner.py:123 直接 raise "not supported in this build",generator 也不会产出它。你的初衷是"自定义多 agent 流程编排、注入多角色协助",而
  manager-delegation(经理动态把子任务派给下属、按需追加任务)正是最强的编排范式,目前完全缺失。现在的 coordinator 不是 hierarchical manager,只是一个固定追加在末尾的总结器。

  2. coordinator 被硬编码、强制运行、且不能用工具
  - runner.py:125 只要有产出就无条件 _run_coordinator。很多流程最后一个 task 本身就是交付物(如"终稿优化"),再让 coordinator 重写一遍是纯 token 浪费,还会稀释/篡改真正的产物。
  - coordinator 调 LLM 时 tools=None(runner.py:1102)。若交付物是文件/图片,coordinator 只能输出散文,无法落地最终文件。
  - 没有 final_output: <task_id> 或 coordinator: off 的开关。

  3. member↔task 是"一任务一角色一次性人设",缺乏真正的 agent 协作
  每个 task 是一次性的:从模板 + 依赖输出拼出全新 message list,跑完最多 6 轮工具后产出文本。member 没有跨 task 的记忆线程,所谓"专家"实质是"某个 task
  的提示词人设"。reviewer/critic、辩论、迭代精修这类"高质量协作"模式,目前只能用 loop.back_to + 字符串条件硬编码,非常受限。

  4. 任务间全是自由文本传递,没有结构化交接
  上游产物是 prose,下游靠 prompt 去"理解"。没有 output_schema / JSON 强约束。对"高质量完整完成复杂工作"而言,这是可靠性的根本短板——每一跳都在重新解释自然语言。

  5. 条件/循环表达式语言过弱,导致 loop 实际不可靠
  workflow.py:11 只支持 contains/equals/not_contains/not_equals 对渲染后字符串做判断。循环退出条件本质是"在 LLM 自由文本里找子串"(如 {{review}} contains 通过),LLM 措辞一变就失效;不支持数值比较、AND/OR、分组。loop
  特性看起来有,实战中基本不可信赖。

  🟠 健壮性层面

  6. sequential 模式完全无视 depends_on,且与 validation 模型不一致(隐蔽 footgun)
  - _run_sequential(runner.py:747)严格按 tasks[] 列表顺序执行,忽略所有声明的依赖。
  - 但 validation.py 的模板校验用的是 depends_on 图(_upstream_task_ids)。于是一个 sequential 团队能通过校验(依赖图说某变量上游可达),运行时却按列表顺序执行,若列表里生产者排在消费者之后 → render_template 抛
  Template variable not found(workflow.py:72)→ task 运行时炸,而非校验时拦截。

  7. sequential 与 workflow 的失败处理语义分裂
  sequential 里任一 task 异常 → logger.exception + break(runner.py:758),后续 task 既不执行也不发 skip 事件,然后 coordinator 仍用残缺产出汇总。workflow 则有完整的 _skip_node
  传播。两套语义,用户体验和可观测性不一致。

  8. 并发下 per-task token 归账错误(影响计费/展示)
  _usage_delta 用"任务前后对 self.total_tokens 快照求差"(runner.py:1704)。当 concurrency>1,同层多个 task 并发,A 的 delta 会把 B 消耗的 token 算进去,每个 task 的 token 统计失真。

  9. 专家团运行的 cost 恒为 0.0(疑似计费缺口)
  已确认主循环 processor.py 用 calculate_step_cost(utils.py:361)正确算钱并累计 total_cost;而 runner.py 全程 cost=0.0(:129/:1466/:1474),积累了 token 却从不折算成本。结合仓库里的
  recharge-panel,专家团这条路径很可能没扣费。

  10. _MAX_TOOL_ROUNDS = 6 全局硬编码,静默截断
  runner.py:61。需要多轮网页抓取/检索的研究类 task,6 轮后默默停止返回半成品,无任何"被截断"信号,也无法按 task/member 调整。

  11. resume 重建脆弱
  _load_completed_outputs_for_resume(runner.py:203)靠重解析持久化的 message/part、匹配 snapshot 字段重建 task_outputs。匹配不上的静默丢弃,下游 task 可能拿着缺失上下文继续跑且无告警。

  12. ANY_COMPLETED + 模板引用可能跑挂
  ANY_COMPLETED 模式下 task 可在"一个依赖完成、另一个被 skip"时运行;若模板引用了被 skip 那个的 output → 上下文里没这个 key → render_template 抛错 → task 失败。

  🟡 可扩展性层面

  13. process 分发硬编码,新增编排范式必须改 1725 行的 runner
  runner.py:118 if WORKFLOW / elif SEQUENTIAL / else raise。没有"执行器策略"抽象,想加 hierarchical / debate / map-reduce 都要在这个巨类里动刀。

  14. ExpertTeamRunner 是 1725 行的上帝类
  一个类塞了:会话准备、预检问答(启发式+LLM)、DAG 执行、顺序执行、工具执行、权限、持久化、流式、上下文策略、coordinator、token 统计(~40 个方法)。单元测试和扩展都困难。

  15. 工具执行从主循环复制了一份(发散风险)
  已确认 _execute_tool(runner.py:1217)重新实现了权限评估、part 持久化、ToolContext 装配、session file 跟踪;主循环在 processor.py:649 有自己的一套。adapter 只复用了 schema 生成,执行没复用。主循环以后修
  bug/加能力,专家团这条路会悄悄落后。

  16. 角色库默认目录里硬编码了个人绝对路径
  roles.py:155/171 写死 Path("/Users/apple/code/agency-orchestrator/...")。这是开发机路径被打进了发行代码,应只走 env/config。

  🟢 可用性 / 产品层面

  17. generator 校验失败直接抛错,丢弃草稿
  ExpertTeamGenerateResponse 明明有 validation_errors 字段(models.py:279),但 generator.py:103 校验失败时是 raise ValueError → API 返回 400/500,用户辛苦生成的草稿全丢,无法在 UI 里修。这个字段目前永远是
  [],设计意图没落地。

  18. 引擎层硬编码中文 + 输入映射二次模糊匹配
  标题/提示/兜底文案("协调者: 汇总交付"等)在引擎里写死,无法多语言部署。_map_answers_to_inputs(runner.py:708)已经有 input_key 却又靠"label 是否是 question 子串"做二次模糊映射,多此一举且易错。

  ---
  三、推荐的目标架构

  核心思路:把"巨类 runner"拆成"编排器 + 可插拔执行器 + 一组服务",并统一 sequential/workflow 模型。

  ExpertTeamOrchestrator (薄)
    ├─ PreflightService          预检问答(启发式/LLM 可替换)
    ├─ ProcessExecutor (Protocol)   ← 策略模式,关键解耦
    │     ├─ WorkflowExecutor
    │     ├─ SequentialExecutor   = concurrency=1 的 workflow(统一!)
    │     └─ HierarchicalExecutor  ← 补上初衷里的核心范式
    ├─ TaskRunner                单个 task 的 LLM↔Tool 循环(per-task 配置)
    ├─ SharedToolInvoker         ← 与主循环共用同一份工具执行
    ├─ ContextBuilder            上下文/模板/结构化交接
    ├─ FinalizationService       coordinator | last_task | none,可带工具
    └─ EventSink / Persistence   流式+落库(已是 adapter,继续)

  分阶段落地建议(按性价比排序):

  P0 — 一致性与正确性(低风险高收益)
  1. 统一 sequential = concurrency 1 的 workflow:删掉 _run_sequential 分支,sequential 也走 DAG 拓扑。一举解决问题 6、7、13 一半,并消除"校验按图、执行按序"的分裂。
  2. 修 per-task token 归账(问题 8):给 TaskRunner 一个局部 usage accumulator,由 adapter 把 usage 直接回传给当前 task,不再用全局快照求差。
  3. 接入 cost 计算(问题 9):复用 calculate_step_cost,补上专家团计费。
  4. generator 失败返回草稿 + validation_errors(问题 17):把 raise 改成填充已有字段返回。
  5. 清掉硬编码个人路径(问题 16)。

  P1 — 可靠性(中风险)
  6. per-task max_tool_rounds,截断时显式发信号(问题 10)。
  7. 结构化交接:task 可选 output_schema,强制 JSON、存结构化、暴露为强类型模板变量(问题 4)。这是提升"复杂任务完成质量"的最大杠杆。
  8. 可配置 finalization:final: {mode: coordinator|last_task|none, member, tools},允许 coordinator 用工具落地交付物(问题 2)。
  9. resume 匹配失败时告警而非静默(问题 11);ANY_COMPLETED 下模板引用缺失 var 时降级为占位符而非抛错(问题 12)。

  P2 — 扩展性与能力(较大改动)
  10. 抽出 ProcessExecutor 策略接口(问题 13),并据此实现或删除 hierarchical(问题 1)。建议实现:给 manager 一个"派发/追加子任务"的工具,真正落地你"动态多 agent 编排"的初衷。
  11. 拆分 runner 上帝类(问题 14),抽 SharedToolInvoker 与主循环共用(问题 15)。
  12. 更强的条件/循环表达式(问题 5):安全表达式求值 + 数值/布尔/AND/OR;loop 退出改为依赖结构化控制信号字段(配合 #7 的 output_schema)而非文本子串。
  13. 引擎字符串 i18n,输入映射只用 input_key(问题 18)。


# 专家团模块改造优化计划（P0 + P1 + 真正的 Hierarchical）

> 目标：修复 P0 正确性问题、增强 P1 可靠性、并参考 CrewAI 真正落地 `hierarchical` 编排。
> 原则：保留现有运行时与 `adapters/` 集成（这是产品护城河），只补编排能力；向后兼容现有 YAML 预设；每阶段保持测试绿。

---

## 0. 现状基线（已核实）

- 引擎入口：`backend/app/expert/runner.py`（1725 行，god class）。
- 执行分支：`runner.run()` → `WORKFLOW` / `SEQUENTIAL` / `HIERARCHICAL(raise)`。
- 复用基础设施：`adapters/{llm,tools,stream}.py`、`ProviderRegistry`、`ToolRegistry`、SSE、Session 持久化。
- 计费函数：`app/session/utils.py:calculate_step_cost(usage_data, model_info) -> float`（专家团当前恒传 cost=0.0，未调用）。
- 预设全部为 `process: workflow`（统一 sequential 对预设零风险）。
- 回归基线测试：`tests/test_expert/{test_create_expert_teams,test_remote_manifest,test_roles,test_runner_context,test_workflow_validation}.py`。

---

## 1. 目标架构（增量引入，不推翻）

把 runner 的"巨类"按职责切出**最小必要**的抽象，使 executor 可插拔、task 执行可复用：

```
ExpertTeamRunner（编排器，变薄）
  ├─ PreflightService        预检问答（沿用现有逻辑，原样抽出）
  ├─ TaskRunner              单 task 的 LLM↔Tool 循环（从 _run_task 抽出，返回 TaskResult）
  ├─ ProcessExecutor (Protocol)   ← 关键解耦
  │     ├─ WorkflowExecutor   现有 DAG 逻辑迁移至此
  │     ├─ SequentialExecutor = 隐式线性依赖 + concurrency=1 的 workflow（统一）
  │     └─ HierarchicalExecutor   新增：manager 委派（参考 CrewAI）
  ├─ FinalizationService     coordinator | last_task | none，可带工具
  └─ RunState                共享状态容器（context / task_outputs / usage / statuses）
```

`TaskResult`（新 dataclass）：
```python
@dataclass
class TaskResult:
    text: str
    structured: dict | None        # output_schema 命中时的解析结果
    usage: dict[str, int]          # 本 task 的规范化 token（解决并发归账）
    cost: float                    # 本 task 成本
    status: str                    # completed / failed / skipped / truncated
    rounds: int
    truncated: bool                # 是否触达 max_tool_rounds
```

> 拆分策略：**只抽出 `TaskRunner` 和 `ProcessExecutor` 两个抽象**即可支撑 P0/P1 + hierarchical；其余服务（Preflight/Finalization）做"原样搬移"以控制风险，完整解耦留作后续。

---

## 2. 模型变更（`expert/models.py`，全部向后兼容、带默认值）

```python
# ExpertTaskConfig 新增
max_tool_rounds: int | None = Field(default=None, ge=1, le=30)   # P1-6，None → 用团队默认
output_schema: dict[str, Any] | None = None                       # P1-7 结构化交接

# ExpertTeamConfig 新增
default_max_tool_rounds: int = Field(default=6, ge=1, le=30)      # P1-6
finalization: ExpertFinalizationConfig = Field(default_factory=...) # P1-8
manager: ExpertManagerConfig | None = None                        # Hierarchical
max_delegations: int = Field(default=12, ge=1, le=50)             # Hierarchical 防失控

class ExpertFinalizationConfig(BaseModel):                        # P1-8
    mode: Literal["coordinator", "last_task", "none"] = "coordinator"
    member: str | None = None          # 指定哪个 member 充当 finalizer（默认协调者）
    tools: list[str] = []              # 允许 finalizer 使用工具（默认空=纯文本）

class ExpertManagerConfig(BaseModel):                             # Hierarchical
    member: str | None = None          # 指定 manager 成员；None=自动创建协调者 manager
    prompt: str = "<默认 manager 提示词>"
    submode: Literal["coordinated", "autonomous"] = "coordinated"
    # coordinated: tasks[] 作为"建议计划"交给 manager 调度
    # autonomous:  无预定义 tasks，manager 用 delegate 工具动态派活
```

兼容性：hierarchical 模式下 `tasks` 的 `min_length=1` 约束需放宽为允许空（autonomous），用 `model_validator` 处理：仅当 `process != hierarchical` 时要求非空。

---

## 3. 分阶段实施

### Phase 0 — 重构脚手架（零行为变更，先保绿）

| 步骤 | 内容 | 文件 |
|---|---|---|
| 0.1 | 抽出 `TaskRunner.run_task(task, member, sequence) -> TaskResult`，内容=现 `_run_task` 的 LLM↔Tool 循环 | 新 `expert/executors/task_runner.py` |
| 0.2 | 定义 `ProcessExecutor` Protocol + `RunState` 容器 | 新 `expert/executors/base.py` |
| 0.3 | 现有 DAG 逻辑迁入 `WorkflowExecutor`（`_run_workflow*` / loop / skip） | 新 `expert/executors/workflow.py` |
| 0.4 | `runner.run()` 改为：preflight → 选 executor → finalize；旧分支删除 | `runner.py` |

**验收**：`pytest tests/test_expert/` 全绿，行为与改造前一致（diff 只动结构）。

---

### Phase 1 — P0 正确性

**P0-1 统一 sequential（修问题 6/7/13 一半）**
- `SequentialExecutor`：执行前为未声明 `depends_on` 的 task **注入隐式线性依赖**（`task[i].depends_on = [task[i-1].id]`），然后复用 `WorkflowExecutor` 逻辑、`concurrency=1`。
- 效果：① 保持现有"列表顺序"语义（无依赖时）；② 显式 `depends_on` 被尊重;③ 失败传播/skip 与 workflow 一致;④ 消除"校验按图、执行按序"的分裂。
- 测试：`test_sequential_honors_explicit_deps`、`test_sequential_implicit_chain_preserves_order`、`test_sequential_failure_propagates_skip`。

**P0-2 per-task token 归账（修问题 8）**
- `TaskRunner` 内部用**局部 usage 累加器**消费 `usage` chunk，写入 `TaskResult.usage`；不再用 `self.total_tokens` 前后快照求差。
- `RunState.total_tokens` 改为对各 `TaskResult.usage` 求和（顺序聚合，无并发竞争）。
- 测试：`test_concurrent_tasks_usage_isolated`（concurrency=2，两 task 各自 usage 不串）。

**P0-3 接入成本（修问题 9）**
- `TaskRunner` 拿到 task 实际 `model_info`（经 `ProviderRegistry.resolve_model`）后调 `calculate_step_cost(result.usage, model_info)` 填 `TaskResult.cost`。
- `step_finish` / `DONE` 事件填真实 `cost` 与累计 `total_cost`；coordinator 同理。
- 测试：`test_task_cost_computed_from_pricing`、`test_zero_pricing_model_cost_zero`。

**P0-4 generator 返回草稿而非抛错（修问题 17）**
- `generate_expert_team_config`：`validate_expert_team_config(team)` 有错时**不再 raise**，改为返回 `{"team": team, "validation_errors": errors, ...}`。
- 仅当 `ExpertTeamConfig(**normalized)` 的 pydantic 构造失败（无法成形）才 400，并给结构化错误信息。
- API `generate_expert_team`：返回体已有 `validation_errors` 字段，前端可据此让用户修。
- 测试：`test_generate_returns_draft_with_semantic_errors`。

**P0-5 清除硬编码个人路径（修问题 16）**
- 删除 `roles.py:_default_dirs` 中的 `/Users/apple/code/agency-orchestrator/...`；统一走 `WORKCRAFT_AGENTS_DIR` env + `config.py` 配置项 + 仓库内 `app/data/`。
- 测试：`test_default_dirs_have_no_absolute_personal_paths`。

**验收**：全测试绿 + 上述新测试通过。

---

### Phase 2 — P1 可靠性

**P1-6 per-task `max_tool_rounds` + 截断信号（修问题 10）**
- `TaskRunner` 用 `task.max_tool_rounds or team.default_max_tool_rounds` 取代硬编码 6。
- 触达上限仍有未决工具调用时：`TaskResult.truncated=True`，在产出尾部追加显式说明并在 snapshot `status="truncated"`，前端可视化。
- 测试：`test_max_tool_rounds_per_task_override`、`test_truncation_flag_and_notice`。

**P1-7 结构化交接 `output_schema`（修问题 4，参考 CrewAI output_pydantic）**
- `TaskRunner`：当 `task.output_schema` 存在 →
  1. 若 model 支持 `json_output`，传 `response_format={"type":"json_object"}`；
  2. 解析 + 按 schema 校验（`jsonschema` 或轻量校验）；失败则按 `retry_count` 重试，附"请严格输出符合 schema 的 JSON"提示；
  3. 成功 → `TaskResult.structured`，写入 `RunState`，模板变量 `{{output_var}}` 注入**紧凑 JSON**而非散文。
- `ContextBuilder`/`render_template`：结构化变量优先用 JSON 序列化值。
- 测试：`test_output_schema_enforced_and_passed_downstream`、`test_output_schema_retry_on_invalid_json`。

**P1-8 可配置 finalization（修问题 2）**
- `FinalizationService` 按 `team.finalization.mode`：
  - `coordinator`（默认，保持现状）：现 `_run_coordinator` 逻辑；若 `finalization.tools` 非空，则给 coordinator 配工具（复用 `TaskRunner`，使其能落地最终文件）。
  - `last_task`：不再追加 LLM 调用，直接以最后一个 completed task 的产物作为交付，省 token。
  - `none`：不做汇总。
- `runner.run()` 末尾调用 `FinalizationService.finalize(run_state)` 替换无条件 `_run_coordinator`。
- 测试：`test_finalization_last_task_no_extra_llm`、`test_finalization_none`、`test_coordinator_with_tools_can_write_file`。

**P1-9 resume 健壮性 + ANY_COMPLETED 模板降级（修问题 11/12）**
- `_load_completed_outputs_for_resume`：匹配失败/产出缺失时 `logger.warning` 并在 snapshot 标 `restored_partial=True`（不再静默丢弃）。
- `render_template` 增加运行时**容错模式** `strict=False`：缺失变量（如 ANY_COMPLETED 下被 skip 的上游 output）替换为占位符 `[上游任务未产出]`，不抛错；validation 仍用 `strict=True`。
- 测试：`test_any_completed_missing_var_renders_placeholder`、`test_resume_logs_on_unmatched`。

**验收**：全测试绿 + 新测试通过；手动跑一个 workflow 预设确认体验无回归。

---

### Phase 3 — 真正实现 Hierarchical（参考 CrewAI）

**CrewAI 对标**：`Process.hierarchical` = 一个 manager agent + 两个委派工具（Delegate work to coworker / Ask question to coworker），manager 自主调度下属、聚合结果。

**3.1 `HierarchicalExecutor`（新 `expert/executors/hierarchical.py`）**

```
1. 解析/创建 manager：
   - team.manager.member 指定则用之；否则自动创建"协调经理"member（带 manager.prompt）。
2. 组装 manager 上下文：
   - 团队目标(user_input) + 成员花名册(每个 member 的 role/goal/能力)
   - coordinated 子模式：把 tasks[] 作为"建议计划"提供
3. 注入两个合成工具给 manager（仅 manager 可见）：
   - delegate_work(coworker_id, task, context) → 调 TaskRunner 在该 member 上执行子任务，
     子任务产出作为该工具的 tool-result 回灌给 manager
   - ask_coworker(coworker_id, question, context) → 同上，轻量问答
4. 运行 manager 的 agentic 循环（复用 TaskRunner 的 LLM↔Tool 机制）：
   - manager 思考→委派→读结果→再委派…直到不再调用工具或产出最终答复
   - 受 team.max_delegations 与 abort_event 约束（防失控）
5. manager 的最终文本即交付（finalization.mode 在 hierarchical 下默认 last_task=manager 产出）
```

**3.2 持久化 / 流式（复用现有）**
- manager 自身：一条 assistant message（agent=经理），其思考/工具调用走标准 SSE。
- 每次 delegate_work：复用 `_create_assistant_message` + step snapshot 为下属生成嵌套时间线（snapshot 加 `delegated_by=manager_id` 便于前端缩进展示）。
- token/cost：manager 与每个被委派子任务各自 `TaskResult.usage/cost`，聚合进 `RunState`（天然解决归账）。

**3.3 模型/校验**
- `process: hierarchical` 时放宽 `tasks` 非空约束（autonomous 允许空）。
- 校验：`manager.member` 若指定必须存在于 members；`coordinated` 下 tasks 的 member 引用仍校验。
- 自动 manager 的 id 用保留前缀（如 `__manager__`），避免与用户 member 冲突。

**3.4 委派工具实现要点**
- 作为运行时合成工具（不进全局 ToolRegistry），仅在 hierarchical executor 内注册到该次 manager 的工具集。
- `coworker_id` 非法 → 返回错误 tool-result 让 manager 自纠，而非崩溃。
- 子任务复用 P1-7 结构化交接：manager 可要求下属返回结构化结果。
- 防递归：被委派的下属默认不再拥有委派工具（单层 manager；多层留作后续）。

**3.5 测试**
- `test_hierarchical_manager_delegates_and_aggregates`（mock LLM 让 manager 委派 2 个下属再汇总）。
- `test_hierarchical_respects_max_delegations`。
- `test_hierarchical_invalid_coworker_returns_tool_error`。
- `test_hierarchical_autonomous_no_predefined_tasks`。
- `generator.py`：放开生成 hierarchical 的能力（system prompt 增加 hierarchical 指引 + manager 字段）。

**验收**：新增 hierarchical 预设（如"研究→分析→成稿"由经理调度）端到端跑通；全测试绿。

---

## 4. 测试矩阵（TDD：每阶段先写测试）

| 类别 | 用例 |
|---|---|
| 回归 | 现有 5 个测试文件全程保持绿 |
| Phase1 | sequential 依赖/顺序/失败传播；并发 usage 隔离；cost 计算；generator 返回草稿；无个人路径 |
| Phase2 | max_tool_rounds 覆盖/截断；output_schema 强制+下传+重试；finalization 三模式；ANY_COMPLETED 占位；resume 告警 |
| Phase3 | manager 委派聚合；max_delegations；非法 coworker；autonomous 空 tasks；hierarchical 生成 |

LLM 调用统一用现有测试里的 mock provider 模式（参考 `test_runner_context.py`）。

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 抽 TaskRunner 引入回归 | Phase 0 纯结构搬移、先保绿；小步 diff |
| 用户已有 sequential 自定义团队行为变化 | 隐式线性依赖严格等价"列表顺序"；加专门测试覆盖 |
| output_schema 对不支持 json_output 的模型 | 降级为"提示词约束 + 解析重试"，失败回退纯文本并告警 |
| hierarchical manager 失控/烧 token | `max_delegations` 硬上限 + abort + 单层委派 |
| 自动 manager id 冲突 | 保留前缀 `__manager__` + 校验 |
| 前端需适配（finalization=last_task 无 coordinator 消息、hierarchical 嵌套时间线） | snapshot 加 `delegated_by` / `restored_partial` / `truncated` 字段，前端渐进增强；后端先行 |

---

## 6. 交付顺序与里程碑

1. **M0**：Phase 0 合并（重构脚手架，行为不变）。
2. **M1**：Phase 1 合并（P0 正确性：sequential 统一 + 计费/token + generator + 清路径）。
3. **M2**：Phase 2 合并（P1 可靠性：tool 轮次 + 结构化交接 + finalization + resume 容错）。
4. **M3**：Phase 3 合并（Hierarchical + 生成支持 + 预设示例）。

每个里程碑独立可发布、可回滚。建议每个里程碑一个 PR，commit 遵循 `feat/fix/refactor` 约定。

---

## 7. 不在本次范围（后续）

- runner god class 的**完整**服务化拆分（本次只抽 TaskRunner/ProcessExecutor）。
- 共享 ToolInvoker 与主循环统一（问题 15）。
- 多层 manager / agent 间自由辩论。
- 引擎层字符串 i18n（问题 18）。
- 条件表达式升级为完整安全求值器（本次仅加 render 容错；Flows 式路由留待 hierarchical 稳定后）。
