# Codata

<div align="center">
  <img src="frontend/public/logo.svg" width="96" alt="Codata" />

  <h3>本地优先的 Data Agent：自然语言查数、SQL、图表、看板和专家团分析工作流</h3>

  <p>
    <a href="README.md">English</a>
  </p>

  <p>
    <img src="docs/assets/readme/codata-product-intro-2026-v2.gif" width="920" alt="Codata 产品介绍动画" />
  </p>

  <p><sub>用自然语言问数据，看 SQL、看结果、出图表，并把有价值的分析沉淀到看板。</sub></p>
</div>

Codata 是一个公司内部使用的桌面 Data Agent 工作区。它把本地桌面应用、Next.js 前端和 FastAPI Agent 后端组合在一起，让分析师和业务团队可以用自然语言提出数据问题，由 Agent 发现表和指标口径、生成或复用 SQL、执行查询、展示结果卡片、生成图表，并把有价值的结果钉到看板。

Codata 的产品主线是一条清晰的数据分析链路：

```text
提出数据问题
  -> 发现表 / 字段 / 指标口径
  -> 生成或复用 SQL
  -> 在已连接的数据平台执行查询
  -> 查看结果、SQL 和图表
  -> 钉到看板，或交给专家团做深度分析
```

## 亮点

- **自然语言数据分析**：直接问“按渠道对比付费转化率”或“找出本周最大异常下滑”。
- **面向数据源的 Agent 流程**：Data Agent 会先检查 schema、搜索注册指标、避免臆造表字段、执行 SQL，并根据错误修复查询。
- **SQL 结果卡片**：查询结果以结构化 artifact 展示，保留表格、SQL、字段、行数据和图表元数据。
- **指标口径约束**：核心业务指标优先使用已注册指标定义；没有权威口径时，会显式标注为自定义口径。
- **看板沉淀**：把图表结果钉到命名看板，支持重命名、布局调整、删除和基于原 SQL 刷新。
- **专家团深度分析**：复杂问题可以交给多 Agent 专家团，拆分成数据发现、SQL、归因、可视化和报告交付等步骤。
- **本地优先桌面运行时**：对话、设置、看板、记忆、artifact 和工作流元数据默认存储在本机。
- **自带模型**：支持 OpenAI-compatible provider、自定义 endpoint、直接 provider adapter 或本地 Ollama。
- **可扩展工具体系**：按配置启用 MCP、技能、插件、文件工具、报告生成和桌面集成能力。

<details>
<summary><kbd>目录</kbd></summary>

- [Data Agent 工作流](#data-agent-工作流)
- [核心能力](#核心能力)
- [看板与产物](#看板与产物)
- [专家团](#专家团)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [开发命令](#开发命令)
- [仓库结构](#仓库结构)
- [数据边界](#数据边界)
- [内部开发说明](#内部开发说明)

</details>

## Data Agent 工作流

Codata 不是通用聊天壳，而是围绕数据分析设计的桌面 Agent。在 Codata 模式下，助手应当：

1. 理解用户的分析目标。
2. 通过已连接的数据平台发现可用表、字段和指标定义。
3. 核心业务指标优先使用注册指标的计算口径。
4. 在 schema 和口径明确后再写 SQL。
5. 通过数据执行工具运行查询。
6. 根据数据平台返回的错误修复 SQL。
7. 用具体数字、口径说明、限制和 SQL 解释结论。
8. 在需要复用时生成图表、看板或报告。

当前数据平台集成围绕 datasage-compatible MCP 连接构建。未连接数据源时，Codata 会引导用户先连接数据源，再进行真实数据分析。

## 核心能力

### 自然语言查数

用户用业务语言描述问题，Codata 将其转成数据分析流程：schema 检查、指标检索、SQL 生成、执行查询和结论解释。

### SQL 与结果可检查

SQL 结果不会被藏在一段文字后面。Codata 会保留查询结果、SQL、字段、行数据和图表元数据，方便用户确认答案从哪里来。

### 指标口径意识

对于 DAU、GMV、转化率、留存、收入、成本等核心指标，Codata 会优先查找注册指标定义。没有注册指标时，回答中应说明这是自定义口径，避免把未经验证的 SQL 当成权威指标。

### 图表和看板

Codata 可以把查询结果渲染成图表卡片，并钉到看板。看板项会保存 SQL 结果快照，在数据源可用时可以沿原执行路径刷新。

### 分析记忆

Codata 会在本地保存结构化分析记忆，让常见主题、指标偏好和用户习惯能在后续数据会话中继续发挥作用。

### 文件和报告

桌面运行时可以读取 CSV、Excel、PDF、文档和工作区文件。数据分析结果可以根据工作流交付为 Markdown、HTML、办公文档、代码 artifact 或看板面板。

## 看板与产物

Codata 将日常探索和可复用产物分开：

- **内联结果卡片**：适合一次性探索和追问。
- **看板图表**：适合长期监控、复盘和对比。
- **生成报告**：适合把一次分析保存为可分享的静态快照。
- **Artifact 面板**：让生成文件、HTML、代码和预览与对话并排展示。

## 专家团

专家团是 Codata 处理复杂分析的编排层。一个专家团是一份结构化配置，包含成员、任务、依赖、上下文策略、工具和最终交付规则。

在数据场景中，专家团可以把一个复杂问题拆给不同角色：

- 数据发现与 schema 检查
- 指标口径确认
- SQL 执行与纠错
- 归因分析或异常定位
- 图表规格设计
- 报告撰写与最终交付

Codata 支持三种执行模式：

| 模式 | 适合场景 | 工作方式 |
| --- | --- | --- |
| `sequential` | 线性分析流程 | 按任务顺序执行。 |
| `workflow` | 固定依赖图 | 构建 DAG，运行依赖已满足的任务。 |
| `hierarchical` | 开放式复杂调查 | Manager Agent 委派专家并综合最终答案。 |

## 技术架构

```text
User
  -> Tauri desktop shell
  -> Next.js frontend
  -> FastAPI backend
  -> agent runtime, data tools, dashboards, expert teams, storage, providers, MCP
```

- **Tauri 桌面外壳**：原生打包、桌面权限、updater 集成、资源打包和平台相关行为。
- **Next.js 前端**：Codata 工作区、聊天、数据结果卡、看板、专家团、artifact、设置、插件和活动面板。
- **FastAPI 后端**：Agent loop、可恢复流式输出、datasage/MCP 工具集成、SQL 执行封装、看板刷新、专家团编排、文件解析、SQLite 持久化、provider 路由和定时任务。

## 下载与文档

- 桌面端下载(Windows / macOS):https://mlilion.github.io/Codata/
- 完整使用与配置文档:https://mlilion.github.io/Codata/guide.html
- 版本发布:https://github.com/Mlilion/Codata/releases

> 桌面端内置自动更新:启动后与每 4 小时自动检查 GitHub Releases 上的新版本,也可在「设置 → 关于」手动检查。

## 快速开始

### 环境要求

- Node.js 20 或更新版本。
- Python 3.12 或更新版本。
- Rust 和 Cargo，用于 Tauri 桌面构建。
- macOS、Windows 或 Linux 对应的 Tauri 平台依赖。
- 可用的模型 provider、OpenAI-compatible endpoint、自定义 endpoint 或本地 Ollama 模型。
- 用于真实数据库分析的 datasage-compatible MCP 数据源。

### 安装依赖

```bash
git clone <internal-repository-url>
cd codata

npm install
cd frontend && npm install --legacy-peer-deps
cd ..

cd backend
python3.12 -m venv venv
./venv/bin/pip install -e ".[dev]"
cd ..
```

### 启动开发栈

```bash
npm run dev:all
```

前端开发服务器使用 `3000` 端口，后端开发服务器使用 `8000` 端口。桌面开发会启动 Tauri 外壳并连接本地前端和后端栈。

## 开发命令

```bash
npm run dev:frontend
npm run dev:backend
npm run dev:desktop

npm run build:frontend
npm run build:backend
npm run sync:desktop-meta
npm run build:desktop
```

验证命令：

```bash
npm run verify:open-source-boundary
npm run verify:frontend-assets
npm run preflight:ui
```

桌面发布构建依赖 `frontend/out` 中导出的前端静态资源，以及 `backend/dist/codata-backend` 中的后端 bundle。桌面构建前运行 `npm run sync:desktop-meta`，确保 Tauri metadata 与根 package 版本一致。

## 仓库结构

```text
desktop-tauri/    Tauri v2 桌面外壳与 Rust 集成
frontend/         Next.js UI，包含 Codata 工作区、聊天、看板、专家团、设置和 artifact
backend/          FastAPI 后端、Agent runtime、数据工具、专家编排、存储和 provider 层
scripts/          构建、发布、验证、签名和版本工具
docs/             内部设计说明和项目文档
design-system/    产品设计参考和视觉资产
```

## 数据边界

Codata 默认在本地存储对话、看板状态、生成产物、设置、记忆和工作流元数据。当用户选择云端模型或外部连接器时，相关 prompt 上下文和必要 payload 会发送给对应 provider 或 connector。

数据库分析依赖用户已连接的数据平台及其权限。用户需要自行选择符合安全、隐私和合规要求的 provider 路径、模型访问方式、数据源权限、SQL 安全规则、连接器范围和部署设置。

## 内部开发说明

代码修改按内部 issue、分支、评审和发布流程执行。合并前请根据修改范围运行对应验证命令，并重点关注数据源权限、模型 provider 路由、SQL 安全规则，以及哪些上下文可能离开本机。安全处理要求见 [安全策略](SECURITY.md)。
