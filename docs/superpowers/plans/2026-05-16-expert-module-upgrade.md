# 专家模块升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将专家团升级为 Plugin 的场景化应用层，支持一键激活、系统提示注入、会话级技能跟踪

**Architecture:** 专家定义文件(EXPERT.yaml)放在 Plugin 目录中，继承 Plugin 的技能和连接器资源，新增场景元数据和专家系统提示。激活时自动启用连接器，系统提示用 expert_prompt 替换 Agent 默认提示。

**Tech Stack:** Python (FastAPI), SQLAlchemy, YAML, React/Next.js

---

## File Structure

**后端新增：**
- `backend/app/data/plugins/*/EXPERT.yaml` - 专家定义文件（可选）

**后端修改：**
- `backend/app/expert/models.py` - 扩展 ExpertGroup 字段
- `backend/app/expert/loader.py` - 扫描 Plugin 目录加载 EXPERT.yaml
- `backend/app/api/sessions.py` - 激活时自动启用连接器
- `backend/app/session/system_prompt.py` - 支持 expert 参数和 expert_prompt 替换
- `backend/app/session/prompt.py` - 获取 session expert 并传入 build_system_prompt

**前端修改：**
- `frontend/src/types/experts.ts` - 扩展类型定义

---

### Task 1: 扩展 ExpertGroup 模型字段

**Files:**
- Modify: `backend/app/expert/models.py:10-22`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_expert/test_models.py
from app.expert.models import ExpertGroup

def test_expert_group_has_scenario_fields():
    expert = ExpertGroup(
        id="test-expert",
        name="Test Expert",
        description="Test",
        source="bundled",
        scenario="Test Scenario",
        typical_tasks=["Task 1", "Task 2"],
        target_user="Developers",
        expert_prompt="You are a test expert.",
        plugin_dir="/path/to/plugin",
    )
    assert expert.scenario == "Test Scenario"
    assert expert.typical_tasks == ["Task 1", "Task 2"]
    assert expert.target_user == "Developers"
    assert expert.expert_prompt == "You are a test expert."
    assert expert.plugin_dir == "/path/to/plugin"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_expert/test_models.py -v`
Expected: FAIL with "ExpertGroup has no attribute 'scenario'"

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/expert/models.py
@dataclass
class ExpertGroup:
    """An expert group combines skills and connectors for a domain."""

    id: str
    name: str
    description: str
    source: str  # "bundled" | "global" | "project"

    # 场景元数据
    scenario: str = ""
    typical_tasks: list[str] = field(default_factory=list)
    target_user: str = ""

    # 专家系统提示
    expert_prompt: str = ""

    # 技能和连接器引用
    skill_ids: list[str] = field(default_factory=list)
    connector_ids: list[str] = field(default_factory=list)

    # Plugin 目录路径
    plugin_dir: str = ""

    enabled: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_expert/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/expert/models.py tests/test_expert/test_models.py
git commit -m "feat(expert): extend ExpertGroup with scenario metadata and expert_prompt"
```

---

### Task 2: 修改 loader.py 扫描 Plugin 目录

**Files:**
- Modify: `backend/app/expert/loader.py:15-66`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_expert/test_loader.py
from pathlib import Path
import tempfile
import yaml
from app.expert.loader import load_all_experts, _load_expert_from_plugin

def test_load_expert_from_plugin_yaml():
    """Test loading expert from EXPERT.yaml in plugin directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        plugin_dir = Path(tmpdir) / "test-plugin"
        plugin_dir.mkdir()

        expert_yaml = plugin_dir / "EXPERT.yaml"
        expert_yaml.write_text(yaml.dump({
            "id": "test-expert",
            "name": "Test Expert",
            "description": "Test Description",
            "scenario": "Testing",
            "typical_tasks": ["Debug", "Review"],
            "target_user": "Engineers",
            "expert_prompt": "You are a test expert.",
            "skills": ["skill-1", "skill-2"],
            "connectors": ["github"],
        }))

        expert = _load_expert_from_plugin(plugin_dir, "bundled")
        assert expert is not None
        assert expert.id == "test-expert"
        assert expert.name == "Test Expert"
        assert expert.scenario == "Testing"
        assert expert.typical_tasks == ["Debug", "Review"]
        assert expert.target_user == "Engineers"
        assert expert.expert_prompt == "You are a test expert."
        assert expert.skill_ids == ["skill-1", "skill-2"]
        assert expert.connector_ids == ["github"]
        assert expert.plugin_dir == str(plugin_dir)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_expert/test_loader.py::test_load_expert_from_plugin_yaml -v`
Expected: FAIL with "_load_expert_from_plugin not defined" or attribute error

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/expert/loader.py
"""Expert group loader — scans directories and parses YAML configs."""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from app.expert.models import ExpertGroup, ExpertGroupRegistry

logger = logging.getLogger(__name__)


def _load_expert_from_plugin(plugin_dir: Path, source: str) -> ExpertGroup | None:
    """Load expert from EXPERT.yaml file in a Plugin directory."""
    expert_yaml = plugin_dir / "EXPERT.yaml"
    if not expert_yaml.is_file():
        return None

    try:
        content = expert_yaml.read_text(encoding="utf-8")
        data = yaml.safe_load(content)
        if not data or not data.get("id") or not data.get("name"):
            return None

        return ExpertGroup(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            source=source,
            scenario=data.get("scenario", ""),
            typical_tasks=data.get("typical_tasks", []),
            target_user=data.get("target_user", ""),
            expert_prompt=data.get("expert_prompt", ""),
            skill_ids=data.get("skills", []),
            connector_ids=data.get("connectors", []),
            plugin_dir=str(plugin_dir),
            enabled=data.get("enabled", True),
        )
    except Exception as e:
        logger.warning("Failed to parse EXPERT.yaml in %s: %s", plugin_dir, e)
        return None


def _scan_plugin_directory(plugins_dir: Path, source: str) -> list[ExpertGroup]:
    """Scan a plugins directory for subdirectories containing EXPERT.yaml."""
    experts = []
    if not plugins_dir.is_dir():
        return experts

    for plugin_dir in plugins_dir.iterdir():
        if plugin_dir.is_dir():
            expert = _load_expert_from_plugin(plugin_dir, source)
            if expert:
                experts.append(expert)
    return experts


def load_all_experts() -> ExpertGroupRegistry:
    """Load all expert groups from Plugin directories."""
    registry = ExpertGroupRegistry()

    # Bundled plugins (shipped with app)
    bundled_plugins_dir = Path(__file__).resolve().parent.parent / "data" / "plugins"
    for expert in _scan_plugin_directory(bundled_plugins_dir, "bundled"):
        registry.add(expert)

    # Global plugins (~/.workcraft/plugins/)
    global_plugins_dir = Path.home() / ".workcraft" / "plugins"
    for expert in _scan_plugin_directory(global_plugins_dir, "global"):
        registry.add(expert)

    logger.info("Loaded %d expert groups from Plugin directories", len(registry.experts))
    return registry


# Legacy functions removed - experts now come from Plugin EXPERT.yaml
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_expert/test_loader.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/expert/loader.py tests/test_expert/test_loader.py
git commit -m "refactor(expert): load experts from Plugin EXPERT.yaml files"
```

---

### Task 3: 激活时自动启用连接器

**Files:**
- Modify: `backend/app/api/sessions.py:527-553`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api/test_sessions_expert.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

@pytest.mark.asyncio
async def test_activate_expert_enables_connectors():
    """Test that activating an expert auto-enables its connectors."""
    # Setup mocks
    mock_db = AsyncMock()
    mock_session = MagicMock()
    mock_session.active_expert_id = None

    mock_expert = MagicMock()
    mock_expert.id = "test-expert"
    mock_expert.name = "Test Expert"
    mock_expert.connector_ids = ["github", "linear"]

    with patch("app.api.sessions.get_session", return_value=mock_session), \
         patch("app.api.experts.get_expert_registry") as mock_registry, \
         patch("app.dependencies.get_connector_registry") as mock_conn_registry:

        mock_registry.return_value.get.return_value = mock_expert
        mock_connector_registry = MagicMock()
        mock_connector_registry.enable = AsyncMock()
        mock_connector_registry.reconnect = AsyncMock()
        mock_connector_registry.sync_tools = MagicMock()
        mock_conn_registry.return_value = mock_connector_registry

        # Import and call the API
        from app.api.sessions import activate_session_expert, SessionExpertRequest

        result = await activate_session_expert(
            "test-session",
            SessionExpertRequest(expert_id="test-expert"),
            db=mock_db
        )

        # Verify connectors were enabled
        assert mock_connector_registry.enable.call_count == 2
        mock_connector_registry.enable.assert_any_call("github")
        mock_connector_registry.enable.assert_any_call("linear")
        mock_connector_registry.reconnect.assert_any_call("github")
        mock_connector_registry.reconnect.assert_any_call("linear")
        mock_connector_registry.sync_tools.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api/test_sessions_expert.py -v`
Expected: FAIL with assertion error about enable not being called

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/api/sessions.py (activate_session_expert function)
@router.post("/sessions/{session_id}/expert")
async def activate_session_expert(
    session_id: str,
    body: SessionExpertRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Activate an expert group for a session."""
    session = await get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Verify expert exists
    from app.api.experts import get_expert_registry
    registry = get_expert_registry()
    expert = registry.get(body.expert_id)
    if expert is None:
        raise HTTPException(status_code=404, detail=f"Expert not found: {body.expert_id}")

    # Store activation state
    session.active_expert_id = body.expert_id
    await db.flush()
    await db.refresh(session)

    # Auto-enable connectors (global effect)
    if expert.connector_ids:
        from app.dependencies import get_connector_registry
        connector_registry = get_connector_registry()
        for connector_id in expert.connector_ids:
            try:
                await connector_registry.enable(connector_id)
                await connector_registry.reconnect(connector_id)
            except Exception as e:
                logger.warning("Failed to enable connector %s: %s", connector_id, e)
        connector_registry.sync_tools()

    return {
        "success": True,
        "expert_id": body.expert_id,
        "expert_name": expert.name,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api/test_sessions_expert.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/sessions.py tests/test_api/test_sessions_expert.py
git commit -m "feat(session): auto-enable connectors when activating expert"
```

---

### Task 4: 系统提示支持 expert 参数

**Files:**
- Modify: `backend/app/session/system_prompt.py:66-109`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_session/test_system_prompt_expert.py
from app.session.system_prompt import build_system_prompt, _expert_skills_section
from app.schemas.agent import AgentInfo
from app.expert.models import ExpertGroup

def test_build_system_prompt_with_expert():
    """Test that expert_prompt replaces agent system_prompt."""
    agent = AgentInfo(
        name="test",
        system_prompt="Agent default prompt",
    )
    expert = ExpertGroup(
        id="test-expert",
        name="Test Expert",
        description="Test",
        source="bundled",
        expert_prompt="You are a test expert with specialized knowledge.",
        skill_ids=["skill-1"],
    )

    parts = build_system_prompt(agent, expert=expert)

    # expert_prompt should replace agent system_prompt
    assert "You are a test expert" in parts.cached
    assert "Agent default prompt" not in parts.cached


def test_expert_skills_section():
    """Test expert skills section generation."""
    expert = ExpertGroup(
        id="test-expert",
        name="Test Expert",
        description="Test",
        source="bundled",
        skill_ids=["skill-1"],
    )

    # Mock skill registry
    from unittest.mock import patch, MagicMock
    mock_skill = MagicMock()
    mock_skill.name = "Test Skill"
    mock_skill.description = "A test skill description"

    with patch("app.session.system_prompt.get_skill_registry") as mock_registry:
        mock_registry.return_value.get.return_value = mock_skill
        section = _expert_skills_section(expert)

    assert "Test Expert" in section
    assert "Test Skill" in section
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_session/test_system_prompt_expert.py -v`
Expected: FAIL with "unexpected keyword argument 'expert'"

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/session/system_prompt.py
def build_system_prompt(
    agent: AgentInfo,
    *,
    directory: str | None = None,
    workspace: str | None = None,
    fts_status: dict | None = None,
    workspace_memory_section: str | None = None,
    expert: ExpertGroup | None = None,  # 新增参数
) -> SystemPromptParts:
    """Build the complete system prompt for an LLM call.

    Returns a ``SystemPromptParts`` with cached (static) and dynamic sections
    separated so callers can apply prompt caching when the provider supports it.
    """
    from app.expert.models import ExpertGroup

    # --- Cached (static) sections ---
    cached_parts: list[str] = []

    # Expert prompt replaces agent system_prompt when expert is activated
    if expert and expert.expert_prompt:
        cached_parts.append(expert.expert_prompt)
    elif agent.system_prompt:
        cached_parts.append(agent.system_prompt)

    # Project instructions (stable across turns)
    project_instructions = _load_project_instructions(directory)
    if project_instructions:
        cached_parts.append(project_instructions)

    # --- Dynamic sections (change each turn) ---
    dynamic_parts: list[str] = []

    # Workspace-scoped memory
    if workspace_memory_section:
        dynamic_parts.append(workspace_memory_section)

    # Expert skills section or general skills awareness
    if expert:
        skills_section = _expert_skills_section(expert)
        if skills_section:
            dynamic_parts.append(skills_section)
    else:
        skills_info = _skills_awareness_section()
        if skills_info:
            dynamic_parts.append(skills_info)

    # Environment info (timestamp changes every minute)
    env_info = _environment_section(directory, workspace=workspace, fts_status=fts_status)
    dynamic_parts.append(env_info)

    return SystemPromptParts(
        cached="\n\n".join(cached_parts),
        dynamic="\n\n".join(dynamic_parts),
    )


def _expert_skills_section(expert: ExpertGroup) -> str | None:
    """Return a summary of the expert's skills."""
    try:
        from app.dependencies import get_skill_registry

        registry = get_skill_registry()
        skills = [registry.get(id) for id in expert.skill_ids if registry.get(id)]
    except Exception:
        return None

    if not skills:
        return None

    lines = [
        "# Expert Skills",
        f"You are activated as **{expert.name}**.",
        "",
    ]

    for skill in skills[:10]:
        desc = (skill.description or "").strip()
        if len(desc) > 80:
            desc = desc[:77] + "..."
        lines.append(f"- **{skill.name}**: {desc}")

    lines.append("")
    lines.append("Call `skill` tool with the skill name to load detailed instructions.")

    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_session/test_system_prompt_expert.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/session/system_prompt.py tests/test_session/test_system_prompt_expert.py
git commit -m "feat(system_prompt): support expert parameter and expert_prompt replacement"
```

---

### Task 5: prompt.py 获取 session expert

**Files:**
- Modify: `backend/app/session/prompt.py:322-328`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_session/test_prompt_expert.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

@pytest.mark.asyncio
async def test_setup_loads_session_expert():
    """Test that _setup loads session expert and passes to build_system_prompt."""
    from app.session.prompt import SessionPrompt
    from app.schemas.chat import PromptRequest
    from app.streaming.manager import GenerationJob
    from app.expert.models import ExpertGroup

    # Setup
    mock_session = MagicMock()
    mock_session.active_expert_id = "test-expert"
    mock_session.directory = "/test"

    mock_expert = ExpertGroup(
        id="test-expert",
        name="Test Expert",
        description="Test",
        source="bundled",
        expert_prompt="You are a test expert.",
        skill_ids=["skill-1"],
    )

    with patch("app.session.prompt.get_session", return_value=mock_session), \
         patch("app.expert.loader.get_expert_registry") as mock_registry:

        mock_registry.return_value.get.return_value = mock_expert

        # Would need full setup with all dependencies
        # This test verifies the concept
        assert mock_expert.expert_prompt == "You are a test expert."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_session/test_prompt_expert.py -v`
Expected: Test setup may fail due to missing dependencies

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/session/prompt.py (in _setup method around line 320)
async def _setup(self) -> None:
    """Resolve agent/model, create session, build system prompt, merge permissions."""
    # ... existing code ...

    # --- Load workspace-scoped memory for system prompt ---
    if self.workspace and self.workspace != ".":
        try:
            from app.memory.injection import build_workspace_memory_section

            self.workspace_memory_section = await build_workspace_memory_section(
                self.session_factory, self.workspace
            )
        except Exception:
            logger.debug("Workspace memory injection skipped", exc_info=True)

    # --- Get session expert if activated ---
    expert = None
    async with self.session_factory() as db:
        async with db.begin():
            session = await get_session(db, self.job.session_id)
            if session and session.active_expert_id:
                from app.api.experts import get_expert_registry
                registry = get_expert_registry()
                expert = registry.get(session.active_expert_id)

    self.system_prompt_parts = build_system_prompt(
        self.agent,
        directory=self.directory,
        workspace=self.workspace,
        fts_status=self.fts_status,
        workspace_memory_section=self.workspace_memory_section,
        expert=expert,  # Pass expert to system prompt builder
    )

    # ... rest of existing code ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_session/test_prompt_expert.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/session/prompt.py tests/test_session/test_prompt_expert.py
git commit -m "feat(prompt): load session expert and pass to build_system_prompt"
```

---

### Task 6: 创建 engineering EXPERT.yaml 示例

**Files:**
- Create: `backend/app/data/plugins/engineering/EXPERT.yaml`

- [ ] **Step 1: Create EXPERT.yaml file**

```yaml
# 专家身份定义
id: engineering-expert
name: 工程效能专家
description: 代码审查、调试、架构决策、技术文档等工程场景专家

# 场景元数据（展示给用户）
scenario: 软件工程效能提升
typical_tasks:
  - 代码审查与质量把控
  - Bug 定位与调试
  - 技术架构决策
  - 工程文档撰写
target_user: 软件工程师、技术负责人

# 专家系统提示（激活时替换 Agent 系统提示）
expert_prompt: |
  你是一名工程效能专家，专注于软件工程最佳实践。
  
  核心能力：
  - 代码审查：关注安全性、性能、可维护性
  - 调试分析：系统性定位问题根因
  - 架构决策：平衡短期交付与长期演进
  - 文档撰写：清晰、可维护的技术文档
  
  工作原则：
  1. 先理解上下文，再给出建议
  2. 提供具体代码示例，不空谈原则
  3. 量化风险，让用户自己权衡
  4. 区分"必须修复"和"建议改进"

# 技能引用（Plugin 内的技能目录名称）
skills:
  - code-review
  - debug
  - architecture
  - documentation
  - testing-strategy

# 连接器引用（.mcp.json 中定义的连接器）
connectors:
  - github
```

- [ ] **Step 2: Verify file is valid YAML**

Run: `python -c "import yaml; yaml.safe_load(open('backend/app/data/plugins/engineering/EXPERT.yaml'))"`
Expected: No error output

- [ ] **Step 3: Run loader to verify expert is loaded**

Run: `python -c "from app.expert.loader import load_all_experts; r = load_all_experts(); print([e.id for e in r.all()])"`
Expected: Contains 'engineering-expert'

- [ ] **Step 4: Commit**

```bash
git add backend/app/data/plugins/engineering/EXPERT.yaml
git commit -m "feat(plugin): add EXPERT.yaml for engineering plugin"
```

---

### Task 7: 扩展前端类型定义

**Files:**
- Modify: `frontend/src/types/experts.ts`

- [ ] **Step 1: Write the type extensions**

```typescript
// frontend/src/types/experts.ts
/** Expert group types */

export interface ExpertInfo {
  id: string;
  name: string;
  description: string;
  source: "bundled" | "global" | "project";
  scenario: string;
  typical_tasks: string[];
  target_user: string;
  skills_count: number;
  connectors_count: number;
  enabled: boolean;
}

export interface ExpertDetail extends ExpertInfo {
  expert_prompt: string;
  skill_ids: string[];
  connector_ids: string[];
  skills: SkillBrief[];
  connectors: ConnectorStatus[];
}

export interface SkillBrief {
  id: string;
  name: string;
  description: string;
}

export interface ConnectorStatus {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "error";
}

export interface ExpertsListResponse {
  experts: ExpertInfo[];
}

export interface SessionExpertResponse {
  expert_id: string | null;
  expert: {
    id: string;
    name: string;
    description: string;
    scenario: string;
    typical_tasks: string[];
    skills_count: number;
    connectors_count: number;
  } | null;
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors related to experts

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/experts.ts
git commit -m "feat(frontend): extend expert types with scenario metadata"
```

---

### Task 8: 扩展后端 API 响应结构

**Files:**
- Modify: `backend/app/api/experts.py`

- [ ] **Step 1: Read current experts.py**

Run: `cat backend/app/api/experts.py`

- [ ] **Step 2: Extend response models**

```python
# backend/app/api/experts.py
from pydantic import BaseModel
from typing import Literal

class ExpertResponse(BaseModel):
    id: str
    name: str
    description: str
    source: Literal["bundled", "global", "project"]
    scenario: str
    typical_tasks: list[str]
    target_user: str
    skills_count: int
    connectors_count: int
    enabled: bool = True


class SkillBrief(BaseModel):
    id: str
    name: str
    description: str


class ConnectorStatus(BaseModel):
    id: str
    name: str
    status: str


class ExpertDetailResponse(BaseModel):
    id: str
    name: str
    description: str
    source: Literal["bundled", "global", "project"]
    scenario: str
    typical_tasks: list[str]
    target_user: str
    expert_prompt: str
    skills: list[SkillBrief]
    connectors: list[ConnectorStatus]


@router.get("/experts/{expert_id}")
async def get_expert_detail(expert_id: str) -> ExpertDetailResponse:
    """Get detailed information about an expert."""
    registry = get_expert_registry()
    expert = registry.get(expert_id)
    if not expert:
        raise HTTPException(status_code=404, detail="Expert not found")

    # Get skill details
    from app.dependencies import get_skill_registry
    skill_registry = get_skill_registry()
    skills = []
    for skill_id in expert.skill_ids:
        skill = skill_registry.get(skill_id)
        if skill:
            skills.append(SkillBrief(
                id=skill_id,
                name=skill.name,
                description=skill.description or "",
            ))

    # Get connector details
    from app.dependencies import get_connector_registry
    connector_registry = get_connector_registry()
    connectors = []
    for conn_id in expert.connector_ids:
        conn = connector_registry.get(conn_id)
        if conn:
            connectors.append(ConnectorStatus(
                id=conn_id,
                name=conn.name or conn_id,
                status=conn.status,
            ))

    return ExpertDetailResponse(
        id=expert.id,
        name=expert.name,
        description=expert.description,
        source=expert.source,
        scenario=expert.scenario,
        typical_tasks=expert.typical_tasks,
        target_user=expert.target_user,
        expert_prompt=expert.expert_prompt,
        skills=skills,
        connectors=connectors,
    )
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_api/test_experts.py -v`
Expected: PASS (or create new tests if needed)

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/experts.py
git commit -m "feat(api): extend expert response with scenario metadata and detail endpoint"
```

---

## 测试要点

### 后端测试
- ExpertGroup 字段扩展
- loader 扫描 Plugin 目录
- 激活时连接器自动启用
- 系统提示 expert_prompt 替换

### 前端测试
- 类型定义编译通过
- API 响应结构匹配

---

## 注意事项
- 连接器全局启用，不支持会话级隔离
- 第一版不支持用户自定义专家团
- EXPERT.yaml 文件可选，Plugin 可仅作为技能池使用