# WorkCraft

[English](README.md)

WorkCraft 是一款围绕本地文件和真实工作流构建的专有桌面 AI 工作台。它把 Tauri 桌面外壳、Next.js 用户界面和 FastAPI 后端组合在一起，让用户可以在一个本地应用中处理文件、长对话、模型提供商、工具调用和生成的 artifact。

本仓库不是开源项目。开发访问、贡献权利、再分发权利和生产使用权均受 WorkCraft Inc. 的书面协议约束。

## 范围

本仓库包含 WorkCraft 桌面产品的应用代码和发布工具：

- 通过 Tauri v2 实现桌面打包和原生系统集成。
- 通过 Next.js 实现聊天、设置、artifact、模型提供商、插件、自动化和工作区界面。
- 通过 FastAPI 实现 agent 编排、流式输出、文件处理、存储、工具执行、模型路由、记忆、MCP connector、插件和自动化能力。
- 包含用于交付桌面安装包的构建、验证、发布、签名和 updater 工具。

WorkCraft 的定位是本地工作台，而不是简单的托管聊天壳。文件、对话、设置、记忆和生成的 artifact 默认存储在本地。云端模型请求只会发送到用户选择的模型路径。

## 架构

```text
User
  -> Tauri desktop shell
  -> Next.js frontend
  -> FastAPI backend
  -> agent runtime, tools, storage, providers, connectors
```

桌面外壳负责原生安装、桌面权限、updater 集成、打包资源和平台相关行为。前端负责交互产品界面，包括聊天、artifact、activity、设置、模型和 provider 选择、记忆、插件、自动化、远程访问和 workspace panel。后端负责 agent loop、可恢复 SSE 流、文件解析、工具执行、本地持久化、provider adapter、MCP 集成、记忆抽取和定时任务。

## 仓库结构

```text
desktop-tauri/    Tauri v2 桌面外壳、Rust 集成、updater 配置
frontend/         Next.js UI，包含聊天、设置、artifact 和桌面界面
backend/          FastAPI 后端、agent runtime、存储和模型/provider 层
scripts/          构建、发布、验证、签名和版本工具
docs/             内部产品、发布和实现文档
design-system/    产品设计参考和内部设计资产
```

## 运行能力

WorkCraft 在完成配置后支持以下产品能力：

- 理解 DOCX、XLSX、PPTX、PDF、CSV、本地项目文件和生成的 artifact。
- 支持带工具调用、权限门控、规划、上下文压缩和可恢复流式输出的多步 agent 工作流。
- 支持托管模型、BYOK provider、OpenAI-compatible endpoint、可用场景下的 ChatGPT 订阅流程，以及本地 Ollama 模型。
- 使用本地 SQLite 持久化 session、message、memory、setting、usage data 和 workflow metadata。
- 渲染 Markdown、代码、图表、表格、办公文档、预览等结构化 artifact。
- 在启用时支持 MCP connector、内置 skill、plugin、消息渠道、远程访问和定时自动化任务。

## 数据边界

WorkCraft 默认在本地存储用户数据，包括对话、文件、生成的 artifact、设置、记忆和 workflow metadata。当用户选择云端模型或外部 connector 时，WorkCraft 会把 prompt 上下文和必要 payload 发送给对应 provider 或 connector。用户和运营方需要自行选择符合安全、隐私和合规要求的 provider 路径与部署设置。

## 环境要求

请使用与当前应用栈兼容的版本：

- 与 Next.js 15 兼容的 Node.js。建议使用 Node.js 20 或更新版本。
- Python 3.12 或更新版本，用于后端。
- Rust 和 Cargo，用于 Tauri 桌面构建。
- macOS、Windows 或 Linux 对应的 Tauri 平台构建依赖。
- 生成签名发布产物时需要签名和 notarization 凭据。

## 安装

安装根目录和前端依赖：

```bash
npm install
cd frontend && npm install --legacy-peer-deps
```

创建根目录脚本期望使用的后端虚拟环境：

```bash
cd backend
python3.12 -m venv venv
./venv/bin/pip install -e ".[dev]"
cd ..
```

按需配置环境文件和 provider 凭据。本地开发不要求所有 provider 都已配置，但模型调用需要可用的 provider 路径或本地 Ollama 模型。

## 开发

在仓库根目录启动完整开发栈：

```bash
npm run dev:all
```

常用命令：

```bash
npm run dev:frontend
npm run dev:backend
npm run dev:desktop
```

前端开发服务器使用 `3000` 端口，后端开发服务器使用 `8000` 端口。桌面开发会启动 Tauri 外壳并连接本地前端和后端栈。

## 构建与验证

常用构建和验证命令：

```bash
npm run build:frontend
npm run build:backend
npm run sync:desktop-meta
npm run build:desktop
npm run verify:frontend-assets
npm run preflight:ui
```

桌面发布构建依赖 `frontend/out` 中导出的前端静态资源，以及 `backend/dist/workcraft-backend` 中的后端 bundle。桌面构建前运行 `npm run sync:desktop-meta`，确保 Tauri metadata 与根 package 版本一致。

## 发布检查

发布桌面构建前：

- 确认前端静态资源存在且引用正确。
- 确认 PyInstaller 后端 bundle 完整且可执行。
- 确认 Tauri metadata、应用版本、updater metadata 和 release manifest 已同步。
- 生成签名 macOS 产物前确认 macOS signing 和 notarization 凭据。
- 确认 Windows 和 Linux 产物使用预期的安装包格式与架构目标。
- 确认下载和 updater manifest 指向预期的公开产物。

## 贡献政策

WorkCraft 仅接受已与 WorkCraft Inc. 签署书面协议的授权贡献者提交贡献。内部工作流、分支规范、评审要求和贡献条款请见 [CONTRIBUTING.md](CONTRIBUTING.md)。

未授权用户不应提交代码、patch、pull request、包含机密材料的 issue 或衍生作品。

## 第三方组件

本仓库包含第三方依赖、插件、内置 skill、生成资产和 provider SDK，它们可能受各自许可证条款约束。这些条款仅适用于对应组件，不授予 WorkCraft 专有软件的任何权利。

## 许可证

WorkCraft 是专有软件，保留所有权利。

未经 WorkCraft Inc. 另行书面授权，不得使用、复制、修改、合并、发布、分发、再授权、销售、托管、作为服务提供、反向工程或创建本软件的衍生作品。

完整条款请见 [LICENSE](LICENSE)。
