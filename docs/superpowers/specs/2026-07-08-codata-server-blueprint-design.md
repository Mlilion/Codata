# Codata 独立后端 —— 架构蓝图与路线图

- 日期:2026-07-08
- 状态:蓝图(不落地单块实现)
- 作者:brainstorming 会话产出,待用户评审

---

## 1. 背景与目标

Codata 目前是一个本地优先的桌面数据分析 agent:Tauri(Rust)壳 + Next.js 前端 + Python/FastAPI 后端(以 PyInstaller sidecar 形式内嵌在桌面端)。当前后端用 loopback session token 做同机鉴权、本地 SQLite 存储、单用户。语义层与查询引擎不在本仓库,而在团队自有的 datasage 平台(通过 MCP 消费)。

本蓝图的目标:**新建一个独立的、团队自托管的 Codata 远程后端(`codata-server`),作为团队身份权威与共享资源的承载者**,并规划语义层、知识库、skills、仪表盘等能力后续逐步搬入的路线与接口契约。

### 1.1 关键决策(本次会话锁定)

1. **新后端 = 独立的 Codata 服务**,拥有自己的用户/登录/权限体系。datasage 仅作为其中一个被连接的数据源。方向为"超集"。
2. **桌面端 + 内嵌 sidecar 后端保持不动。** 新后端是新增的远程服务,不替换、不改造现有桌面端后端。
3. **脚手架 = 官方 [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template),前后端都保留、都用。** 理由见 §3。
4. **三端分工:**
   - Tauri 桌面端(现有)= 分析师的对话/分析**消费端**
   - Web 管理台(模板前端演进)= 语义层 / 知识库 / skills / 用户的**运营维护端**
   - `codata-server`(模板后端演进)= 两端共同后端 + 团队身份权威
5. **部署/租户模型 = 单企业自托管、团队共享。** 需要真实登录 / 用户 / 角色(RBAC),但无需跨租户隔离。
6. **首期范围 = 认证底座 + 预留接口。** 共享资源后续逐个搬,搬迁顺序含语义层 + 知识库的管理台。
7. **设备登录复刻 datasage 的 Split-Flow**(`mcp_auth` / `check_mcp_auth` 已跑通),不自造 OAuth device flow。
8. skills 服务化目标 = 先集中管理分发,后服务端执行(分阶段)。

### 1.2 非目标(本蓝图明确不做)

- 不做多租户 SaaS(跨组织隔离)。
- 不改动/不迁移现有桌面端与其内嵌后端。
- 首期不搬任何业务资源到新后端(只留接口)。
- 不采用 WrenAI 式多容器微服务拓扑(理由见 §4)。

---

## 2. 三端拓扑

```
┌───────────────────────────┐        ┌───────────────────────────┐
│  Tauri 桌面端(现有,不动) │        │  Web 管理台(模板前端演进) │
│  分析/对话消费端           │        │  语义层/知识库/skills/用户  │
│  + 内嵌 sidecar 后端       │        │  运营维护端                │
│    (loopback token,守本机)│        └─────────────┬─────────────┘
└─────────────┬─────────────┘                      │
              │ 登录后带 JWT                        │ 登录后带 JWT
              │ (设备登录 Split-Flow)               │ (浏览器登录)
              └──────────────┬──────────────────────┘
                             ▼
              ┌────────────────────────────────┐
              │  codata-server (新, 远程)       │
              │  官方模板 backend 演进           │
              │  ┌──────────────────────────┐  │
              │  │ 鉴权网关: deny-by-default │  │
              │  │ + RBAC guard             │  │
              │  ├──────────────────────────┤  │
              │  │ auth / users / roles     │  │ ← 模板自带 + RBAC 扩展
              │  │ device (Split-Flow)      │  │ ← 复刻 datasage
              │  │ resources/* (占位骨架)   │  │ ← 首期只留接口
              │  └──────────────────────────┘  │
              └───────────────┬────────────────┘
                              ▼
                     ┌──────────────┐
                     │  Postgres    │  ← 新后端独立库(不碰桌面端 SQLite)
                     └──────────────┘

外部数据源(后续通过连接器接入):datasage(MCP)、其他数仓
```

### 2.1 两套鉴权并存,守不同的门(无冲突)

| | 内嵌 sidecar 后端(不动) | codata-server(新) |
|---|---|---|
| 鉴权 | loopback session token | 登录 + JWT |
| 证明 | "同机同一用户" | "你是谁 + 什么角色" |
| 作用域 | 单机、单用户、本机 agent/文件/shell | 多用户、团队共享资源 |

桌面端同时持有两个 token,分别调两个后端——与它现在"同时持有 datasage API key"是同一模式,无代码冲突。

### 2.2 概念陷阱(必须规避)

**登录鉴权是手段,被保护的共享资源是目的。** 若新后端只做登录而不拥有任何被保护的团队资源,鉴权即空转。因此首期虽只做"认证底座 + 预留接口",但路线图必须明确至少一类共享资源(建议 skills 或语义层管理)尽快落地,让登录产生实际约束力。

---

## 3. 脚手架选型

### 3.1 结论

**官方 full-stack-fastapi-template,前后端都保留。**

### 3.2 候选对比(对齐本项目约束)

| 约束 | 官方 full-stack-fastapi-template | benavlabs Fastro | 说明 |
|---|---|---|---|
| 单企业登录/用户 | ✅ 内置且久经考验 | ✅ 内置 | 都满足 |
| worker(定时/skills执行/导出) | ❌ 无(需自加) | ✅ ARQ/Taskiq+Redis | Fastro 领先,但可加 |
| RBAC 角色 | ❌ 仅 is_superuser | ⚠️ 有 tier 也需扩展 | 都需扩展 |
| access+refresh token | ⚠️ 仅 access | ✅ access+refresh | Fastro 更全,可加 |
| **SQLModel 对齐 datasage** | ✅ SQLModel | ❌ 裸 SQLAlchemy | **官方领先(换不来)** |
| **配套 Web 管理台前端** | ✅ React+shadcn+登录+用户页 | ❌ 纯后端,需自搭前端 | **官方领先** |
| 维护/稳定性 | ✅ 官方 44k⭐,2026-01 仍更新 | ⚠️ ARQ→Taskiq 迁移中+推付费版 | **官方更稳** |
| 限流/缓存 | ❌ 无 | ✅ Redis+分层限流 | Fastro 领先,可加 |

### 3.3 为什么选官方(按权重排序)

1. **SQLModel 与 datasage 对齐** —— 团队在 datasage 已用 SQLModel,两后端同一 ORM 心智模型,人员切换/复制模式成本最低。这是换脚手架换不来的价值。
2. **配套前端正好当管理台** —— 语义层/知识库/用户管理天然是 Web 形态;模板自带 React+shadcn+登录态+自动生成 TS client,省掉大量胶水。之前误判为"多余的前端",修正后是核心优点。
3. **稳定性压倒花哨功能** —— 团队长期依赖的基础设施应选不折腾的。Fastro 处于 ARQ→Taskiq 迁移 + 推付费 FastroAI 的变动期。
4. **Fastro 领先项都是"加法"** —— worker/限流/refresh token 都能在官方模板上自加,且现有内嵌后端已有 scheduler(croniter)、rate-limit 中间件零件可搬。

### 3.4 官方模板拿来即用 vs 需自补

**拿来即用:** FastAPI + SQLModel + Postgres + Alembic + JWT 登录 + 密码重置 + Docker Compose + Traefik HTTPS + pytest + Playwright + 自动生成 TS client + 用户管理页 + 明暗主题。

**需自补(均有现成参考):**
- **RBAC 角色层** —— 模板仅 `is_superuser`;参考 datasage `RoleRepository`。
- **worker 进程** —— 定时任务、skills 服务端执行;搬现有 scheduler 或加 ARQ。
- **设备登录换 token 流程** —— 复刻 datasage Split-Flow。

---

## 4. 为什么是模块化单体,而非微服务

- Codata 现有后端本就是干净的模块化单体(`app/api`、`app/session`、`app/scheduler`、`app/skill`、`app/connector`…),官方模板也是单体。单企业规模不值得为每能力付出独立部署/网络开销。
- WrenAI 的 5 容器拓扑(wren-ui / wren-ai-service / wren-engine(Java) / ibis-server / qdrant)是为通用云产品设计,且其自身正把 Java 引擎收敛为嵌入式 Rust core —— 方向恰恰是收敛,不是发散。
- **唯一允许的进程拆分** = 重/长任务的 worker(定时、skills 服务端执行、大导出),同一代码库、以 worker 方式运行,让 Web 层保持响应。这是**部署拆分**,非代码拆分。

---

## 5. 首期设计:认证底座 + 预留接口

### 5.1 服务模块骨架(`codata-server`)

```
auth/       登录、JWT 签发/校验、密码重置          ← 模板自带
users/      用户 CRUD、角色                        ← 模板 + RBAC 扩展
device/     设备登录换 token(Split-Flow)          ← 复刻 datasage,新写
rbac/       角色 & 权限判定                        ← 新写
resources/  空资源层骨架 + 预留接口契约            ← 首期只留接口
```

### 5.2 身份与令牌模型

- **用户登录(浏览器/Web 管理台):** 模板现成 `email+password → access JWT`。
- **设备登录(Tauri 桌面端)—— 复刻 datasage Split-Flow:**
  1. 桌面端 `POST /device/auth` → 返回 `auth_url` + `request_id`,**本轮结束**(不阻塞轮询)。
  2. 用户浏览器打开 `auth_url`、登录、批准。
  3. 桌面端轮询 `GET /device/auth/{request_id}` → 批准后拿到长效 token。
  4. 之后桌面端请求带 `Authorization: Bearer <token>`。
- **为何复刻不自造:** datasage 已跑通(`mcp_auth`/`check_mcp_auth`),桌面端已有"开链接→轮询"交互代码,迁移成本最低。

### 5.3 RBAC(模板缺,必补)

- `Role`(如 `admin` / `analyst` / `viewer`)+ `User.role_id`。
- 权限判定用依赖注入 guard:`require_role("admin")` / `require_permission("skills:write")`。
- 权限标识用字符串 `<resource>:<action>`(如 `skills:read`、`dashboard:write`)—— 未来加资源只是新增字符串,不改鉴权框架。
- 角色语义对齐 datasage,便于两边一致。

### 5.4 ★预留接口(首期精髓)★

首期最重要产出是**统一的资源接入契约**,让后续资源"填空"而非"改地基":

- **统一资源基类:** 每个未来资源(skill / dashboard / semantic model / knowledge)遵循同一套 `owner_id` + `acl`(JSONB)+ 团队可见性字段;参考 datasage `Artifact.acl` 模式。
- **统一鉴权中间件:** 所有 `/api/*` deny-by-default,靠 RBAC guard 放行;沿用现有内嵌后端 `AuthMiddleware` 的 deny-by-default 思路。
- **占位路由:** `/api/skills`、`/api/dashboards`、`/api/semantic`、`/api/knowledge` 首期返回 `501 Not Implemented`,但 OpenAPI schema、权限标识、resource 模型骨架先定下来。
- **桌面端集成契约:** 明确桌面端(经其内嵌后端)带 JWT 调 `codata-server` 的方式,及两后端 token 各管各的边界。

### 5.5 数据存储

- 新后端独立 **Postgres**(不碰桌面端 SQLite)。
- 首期表:`user`、`role`、`device_auth_request`,及资源基类抽象结构。
- Alembic 迁移(模板自带)。

---

## 6. 子项目分解与搬迁路线图

每个子项目后续各自走一轮 spec → plan → 实现。顺序按"依赖 + 让登录尽快有牙齿"排。

| # | 子项目 | 说明 | 依赖 | 承载端 |
|---|---|---|---|---|
| 0 | **认证底座 + 预留接口(首期)** | 登录/用户/角色/JWT/设备换 token + 资源契约 + 占位路由 | 无 | 后端 + 管理台登录/用户页 |
| 1 | **skills 集中管理分发** | skills 从客户端本地文件提升为后端集中存储/版本/权限;客户端拉取 | #0 | 后端 + 管理台 |
| 2 | **语义层 + 知识库管理台** | 自建语义层(MDL/指标/维度)+ 知识库的 Web 维护界面 | #0 | 后端 + 管理台 |
| 3 | **查询引擎** | 编译/路由/执行 SQL(参考 datasage 4 层引擎 + WrenAI MDL) | #2 | 后端 + worker |
| 4 | **连接器框架** | 统一接入多数据源;datasage 为其一 | #3 | 后端 |
| 5 | **仪表盘/会话云端化** | 共享仪表盘、会话/历史多设备可见 | #0 | 后端 + 两端 |
| 6 | **skills 服务端执行** | skills 在后端服务器执行(沙箱/资源隔离) | #1, worker | 后端 + worker |

### 6.1 接口契约先行

在动 #1–#6 任何一个前,#0 已固化的契约(资源基类 ACL、权限字符串、deny-by-default 网关、设备 token 边界)是所有后续子项目共同遵守的地基。每个子项目落地时只新增权限字符串与具体路由实现,不改地基。

---

## 7. 参考来源

- 官方脚手架:https://github.com/fastapi/full-stack-fastapi-template
- 备选脚手架:https://github.com/benavlabs/FastAPI-boilerplate(及 SQLModel 变体 https://github.com/benavlabs/SQLModel-boilerplate)
- datasage:`/Users/renyc/code/data_sage` —— 语义层(`meta_indicators`/impls/dimensions)、Split-Flow 鉴权(`ai/mcp/auth.py`)、RBAC(`system.RoleRepository`)、artifacts ACL。
- WrenAI:`/Users/renyc/WrenAI` —— MDL manifest 语义层、NL→SQL 流水线、多容器拓扑(反面参照)。
- 现有内嵌后端:`backend/app/`(`auth/middleware.py` deny-by-default、`scheduler/`、`skill/registry.py`、`connector/`)。

---

## 8. 待办 / 开放问题(留给各子项目一轮解决)

- worker 技术选型:搬现有 croniter scheduler vs 引入 ARQ/Taskiq(#1/#3/#6 时定)。
- 语义层建模:自建 MDL 的具体 schema(借鉴 WrenAI MDL + datasage 指标模型)(#2 时定)。
- access+refresh token 是否首期就上,还是 #5 多设备时再补。
- Web 管理台与桌面端是否最终共用一套组件库(#2/#5 时评估)。
