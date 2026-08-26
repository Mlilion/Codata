# Codata 项目介绍与整体分析

> 基于当前仓库的现状整理，版本号以根目录 `package.json` 中的 `1.1.16` 为准。

## 1. 项目一句话

Codata 是一个 **local-first 的桌面 Data Agent 工作区**，面向自然语言查数、SQL 执行、结果可视化、看板沉淀、专家团深度分析，以及知识、自动化、插件、连接器等扩展场景。

它不是单纯的聊天壳，而是一条完整的数据分析工作流：

```text
提出数据问题
  -> 发现表 / 字段 / 指标口径
  -> 生成或复用 SQL
  -> 在已连接的数据平台执行查询
  -> 查看结果、SQL、图表
  -> 钉到看板，或交给专家团继续分析
```

## 2. 这个项目解决什么问题

- 让分析师和业务同学用自然语言发起数据问题。
- 把 schema 检查、指标口径、SQL、结果、图表串成一条链。
- 把一次性分析和可复用产物区分开，避免结果只停留在对话里。
- 在本机保留对话、设置、看板、记忆、artifact 和工作流元数据。
- 通过模型 provider、MCP、插件、消息渠道和自动化扩展能力。

## 3. 仓库整体结构

| 目录 | 角色 |
| --- | --- |
| `frontend/` | Next.js 15 前端，承载聊天、看板、专家团、知识、设置、插件等界面 |
| `backend/` | FastAPI 后端，承载 agent loop、工具系统、模型 provider、存储和扩展服务 |
| `desktop-tauri/` | Tauri v2 桌面壳，负责窗口、托盘、升级、深链和本地 sidecar 管理 |
| `scripts/` | 构建、验证、发布、签名和版本同步脚本 |
| `docs/` | 项目说明、设计文档和超级能力流程文档 |
| `design-system/` | 视觉与交互规范，前端样式的单一参考源 |

从代码体量看，前端、后端和桌面壳都不是轻量级模块，已经是一个完整工作台而不是 demo。

## 4. 核心架构

```text
User
  -> Tauri desktop shell
  -> Next.js frontend
  -> FastAPI backend
  -> agent runtime / tools / providers / storage / dashboards / expert teams / MCP
```

### 4.1 Tauri 桌面壳

- 提供桌面窗口、托盘、单实例、深链和自动更新。
- 在 macOS 上处理原生 vibrancy，在 Windows/Linux 上处理无边框与自定义标题栏。
- 负责启动或连接本地前后端运行时。

### 4.2 Next.js 前端

- 负责主工作区、会话列表、聊天页面、看板、专家团、知识、MCP、自动化、插件、设置和 artifact 展示。
- 使用 Zustand 管理本地 UI 状态，TanStack Query 管理服务端状态。
- 负责把后端 SSE 流重建成可读的消息、工具状态和中间过程。

### 4.3 FastAPI 后端

- 负责 agent 调度、工具调用、模型路由、流式输出、会话存储和各类业务 API。
- 通过 SQLite + ORM 保存会话、消息、看板、记忆和相关元数据。
- 统一承载 MCP、知识、自动化、插件、连接器、渠道、全文检索等能力。

## 5. 前端能力版图

前端路由已经从聊天页扩展到一整套工作区：

- `/c/new`、`/c/[sessionId]`：新对话与具体会话。
- `/dashboard`：看板列表与图表沉淀。
- `/experts`：专家团工作区。
- `/knowledge`：知识库。
- `/mcp`：MCP 连接器和数据源相关界面。
- `/plugins`：插件管理。
- `/remote`：消息渠道。
- `/automations`：自动化任务。
- `/skills`：技能管理。
- `/settings`：模型、记忆、权限、外观、Ollama、用量等设置。

聊天页不是简单输入框，而是一整套分析工作台：

- 消息流与流式输出。
- 工具调用过程展示。
- 权限请求和问题分支。
- Workspace 面板，承载上下文、文件和进度。
- Artifact 面板，展示代码、文档、表格、HTML、PDF、PPT 等生成物。

## 6. 后端能力版图

后端是这个项目的核心。

### 6.1 Agent 系统

- 内置 `build`、`plan`、`explore`、`general` 等 agent。
- 支持权限分层、工具过滤和会话级覆盖。
- 处理多步工具调用、工具修复、循环检测和上下文压缩。

### 6.2 工具系统

- 内置读写、编辑、搜索、执行、任务、问题、待办、计划、技能、记忆、artifact、网页抓取等工具。
- 支持将 MCP 工具封装为 agent 工具。
- 工具输出会被截断、整理并写回消息流，避免前端和模型侧失控。

### 6.3 模型与 provider

- 支持 OpenRouter、OpenAI-compatible、自定义 endpoint、Ollama，以及多种 BYOK provider。
- 启动时会按配置自动注册可用 provider，并刷新模型目录。
- 对 Ollama 还提供二进制管理、自动启动和模型预热。

### 6.4 存储与扩展

- 会话、消息、项目、看板、记忆和知识相关数据都落在本地存储中。
- 通过知识库、全文检索、自动化任务、消息渠道、插件和连接器扩展工作流。
- 还包含调度器和后台任务机制，说明它不是一次性请求-响应服务。

## 7. 典型数据流

1. 用户在前端输入问题。
2. 前端通过 `useChat` 之类的 Hook 调用后端接口。
3. 后端创建消息，组装 system prompt，选择 agent 和 provider。
4. Agent 在循环里发起工具调用，后端执行并通过 SSE 发送增量事件。
5. 前端把文本、推理、工具状态和结果卡拼装回页面。
6. 当结果需要复用时，可以继续沉淀到看板、artifact 或报告里。

这个流程的价值在于：**结果不是只存在于模型回复里，而是可检查、可追踪、可复用。**

## 8. 构建与运行方式

### 开发启动

```bash
npm run dev:all
```

### 主要构建命令

```bash
npm run build:frontend
npm run build:backend
npm run sync:desktop-meta
npm run build:desktop
```

### 验证命令

```bash
npm run verify:open-source-boundary
npm run verify:frontend-assets
npm run preflight:ui
```

项目的构建链路比较完整：前端产物、后端 bundle 和桌面壳是分开的，但最终要在桌面发布时拼成一体。

## 9. 测试与质量控制

这个仓库的测试分层很明显：

- 后端以 `pytest` 为主，覆盖 agent、API、知识、MCP、插件、provider、session、tool、storage、streaming 等模块。
- 前端有 `vitest` 单元测试和 `Playwright` UI 测试。
- `scripts/` 下还有一组边界检查、资产检查、发布检查和桌面发布辅助脚本。

这说明项目比较重视两个边界：

- **产品边界**：哪些能力属于本地工作区，哪些属于外部 provider 或 connector。
- **安全边界**：哪些上下文可以离开本机，哪些必须留在本地。

## 10. 整体判断

### 优点

- 产品闭环完整，不是单点功能。
- 前端、后端、桌面壳分层清楚。
- 功能扩展面很广，已经覆盖知识、看板、专家团、插件、MCP、自动化等多种工作流。
- 本地优先策略明确，适合对数据与上下文边界敏感的场景。

### 需要长期关注的点

- 功能多，配置面也多，后续维护要持续控制复杂度。
- 前后端契约需要保持同步，尤其是消息、工具、artifact 和模型配置相关类型。
- provider、连接器和外部数据源很多，安全边界不能靠文档默认成立，需要靠代码和测试持续兜底。

## 11. 结论

Codata 已经不是一个“聊天 + 调接口”的简单项目，而是一个围绕数据分析、知识沉淀和桌面工作流打造的完整产品。它的核心价值不在于生成一段回答，而在于把分析过程、结果、图表、看板和协作链路组织成可复用的工作台。
