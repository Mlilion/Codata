# Codata 企业推广:文档补齐 + 桌面端升级链路规划

- 日期:2026-07-13
- 状态:设计稿(待评审)
- 一句话:为面向公司内部推广,补齐一份全量 HTML 使用/配置文档,把文档与下载页用 GitHub Pages 发布出去,并把已有的桌面端自动升级链路梳理清楚、文档化——不新起自托管服务。

---

## 一、背景与目标

Codata 已是一个可用的本地优先桌面数据 agent(Tauri + Next.js + 内嵌后端)。现在准备向公司内部推广,需要:

1. **补齐详细的配置和使用文档**(一份全量 HTML)。
2. **规划桌面端的升级/更新接口**——排查后确认机制**已存在且能跑**,本次工作是理清、文档化、并把在线文档与下载页发布出去。
3. **决定承载方式**:是否单独部署服务。结论——**不单独部署服务**,用 GitHub Pages + GitHub Releases 静态托管。

### 关键前提(已与需求方确认)

- 员工电脑**能访问公网 / GitHub**。→ 现有 GitHub Releases 升级链路可继续使用,自托管非必须。
- 承载方式:**静态托管,不起服务**。
- 文档定位:**一份全量文档**(面向所有使用者,涵盖小白到管理员)。
- 托管位置:**GitHub Pages(文档/下载页)+ GitHub Releases(安装包/升级清单)**。
- 发布策略:**维持现有发布流程**(打 tag → CI 构建签名公证 → 生成 manifest)。

### 明确不做(控制范围)

- 不新起自托管的文档/升级服务(codata-server 是另一份企业化 spec 的独立工程,与本次无关)。
- 不改动桌面端的升级核心逻辑(已验证可用)。
- 不改动现有 CI 发布流程的构建/签名/公证步骤。

---

## 二、现状盘点(排查结论)

### 2.1 桌面端升级机制——已存在,完整可用

| 环节 | 现状 | 位置 |
|---|---|---|
| 升级端点 | 指向 GitHub Releases 的"永远最新"清单 | `desktop-tauri/src-tauri/tauri.conf.json` → `plugins.updater.endpoints` = `https://github.com/Mlilion/Codata/releases/latest/download/latest.json` |
| 签名校验 | 内置 minisign 公钥 | 同上 `plugins.updater.pubkey` |
| 更新插件 | `tauri-plugin-updater` v2 已启用 | `desktop-tauri/src-tauri/src/lib.rs`、`Cargo.toml` |
| 触发入口 | 托盘 / 菜单"Check for Updates" 发 `check-for-updates` 事件 | `src/tray.rs`、`src/menu.rs` |
| 前端流程 | 启动 5s 后 + 每 4 小时自动检查;手动检查;下载带进度;装完 `relaunch()` 重启;支持"忽略此版本" | `frontend/src/hooks/use-update-check.ts` |
| UI 入口 | 侧栏页脚 + 设置页"软件更新" | `frontend/src/components/layout/sidebar-footer.tsx` |
| 发布流水线 | 打 `v*` tag → Win NSIS + macOS(arm64/x64,签名+公证)→ 生成 manifest → 传 Release | `.github/workflows/release.yml` |
| manifest 生成 | 产出 `latest.json`(升级)+ `downloads-latest.json`(下载页),并输出完整 `release-site/` 目录 | `scripts/generate-release-manifests.mjs` |

**结论:升级接口无需重做。** 端点用 `/releases/latest/download/` 的固定路径,发新版本无需改客户端。

### 2.2 自托管切换能力——已预留,本次不启用

`generate-release-manifests.mjs` 已支持环境变量:
- `CODATA_SITE_BASE_URL`:设置后,资源 URL 指向 `<base>/downloads/releases/<tag>/`,并输出 `release-site/update/latest.json`、`release-site/downloads/latest.json`。
- `CODATA_RELEASE_ASSET_BASE_URL`:更细粒度地覆盖资源基址。

即未来要迁到公司自有域名时,只需设这两个变量 + 改 `tauri.conf.json` 的 endpoint,无需改代码。本次**不启用**,但写入文档作为演进路径。

### 2.3 文档现状

- 已有 `docs/codata-office-user-guide.html`(2295 行,面向"办公小白"的使用指南),视觉/结构可复用。
- **缺**:完整的配置详解(模型/API Key/MCP/datasage 授权)、安装排查、更新说明、管理员发布手册。
- **缺**:在线托管——文档仅在仓库里,员工拿不到链接;README 无下载入口;无 GitHub Pages workflow。

---

## 三、方案设计

三个可独立交付的组件:

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Pages 静态站点(新增)                             │
│                                                           │
│   /            下载落地页 index.html                       │
│                └─ 运行时 fetch Releases 的                  │
│                   downloads-latest.json → 显示最新三平台下载 │
│   /guide.html  全量使用/配置文档(新增,单文件内嵌)         │
└───────────────────────────┬───────────────────────────────┘
                            │ 链接指向
                            ▼
┌─────────────────────────────────────────────────────────┐
│  GitHub Releases(现有,不改流程)                          │
│   latest.json            ← 桌面端 updater 读取(升级)       │
│   downloads-latest.json  ← 下载页读取(展示)               │
│   *.dmg / *.exe / *.app.tar.gz(+.sig)                     │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │ 打 v* tag 触发
                  .github/workflows/release.yml(现有,不改)
```

### 3.1 组件 A:全量 HTML 文档

- **新建** `docs/codata-guide.html`,保留现有 `codata-office-user-guide.html`(小白版仍可单独分发)。
- 单文件、内嵌 CSS/JS、左侧章节导航、可离线双击打开;复用现有 guide 的视觉语言(配色、排版、组件)保持一致。
- 章节结构:
  1. 产品简介与适用场景
  2. 安装(Windows / macOS 双平台;macOS 首次打开公证/安全提示说明)
  3. **配置详解**(本次补齐重点):模型来源与 API Key、MCP 接入、datasage 授权(经 mcp-access 流程)、工作区、权限与工作模式
  4. 快速上手:十分钟完成第一个任务
  5. 界面导览 + 功能模块速查
  6. 提示词写法
  7. 文件、附件与工作区
  8. 自动化任务
  9. **软件更新**:自动检查时机(启动 5s / 每 4h)、手动检查入口、下载安装重启、"忽略此版本"行为
  10. **常见问题排查(FAQ)**:装不上、连不上模型、MCP/datasage 授权失败、更新失败、macOS 公证告警等
  11. 附录:**管理员 / 发布手册**——打 tag 发版步骤、产物与签名说明、回滚思路、灰度思路、未来迁自有域名的切换点(`CODATA_SITE_BASE_URL` 等)
- 文档内容以**已验证的现有实现**为准(不臆造功能);配置章节的截图沿用 `docs/assets/readme/` 现有素材,缺失处以文字步骤描述。

### 3.2 组件 B:GitHub Pages 发布

- **新建** `.github/workflows/pages.yml`,用官方 `actions/deploy-pages` 发布。
- 站点内容(建议放在仓库 `site/` 或直接取 `docs/` 的产物,实现阶段定目录):
  - `index.html`:下载落地页。
  - `guide.html`:由 `docs/codata-guide.html` 拷贝/发布而来。
- **下载页取数(方案 A,已选)**:下载页**不内嵌版本数据**,前端 JS 运行时 `fetch` GitHub Releases 上 `latest` 的 `downloads-latest.json`,解析 `downloads.{macos-aarch64,macos-x86_64,windows-x86_64}` 渲染下载按钮与版本号。好处:发版流程完全不用动,Pages 只需在文档变更时重发。
  - 兜底:fetch 失败时显示"前往 GitHub Releases 页"的直链。
- **触发**:push 到 main 且改动文档/站点文件时重新发布。
- README(中英)增加"下载 / 文档"入口,指向 Pages 站点。

### 3.3 组件 C:升级链路梳理与文档化(不改代码)

- 在文档"软件更新"章节 + "管理员/发布手册"附录中,把 2.1 的链路写清楚:客户端如何检查、清单格式、发版如何自动被客户端感知。
- 在附录写明 2.2 的自托管演进路径(留给企业化阶段)。
- 代码层面**仅在需要时**做一处确认性检查:`tauri.conf.json` endpoint 已是 `/releases/latest/download/`(无需改)。若发现任何硬编码版本号路径才修正——预期无改动。

---

## 四、数据契约(供实现参考,均为现状,不新增)

`latest.json`(桌面端 updater 读取,Tauri v2 标准):
```json
{
  "version": "1.1.12",
  "notes": "...",
  "pub_date": "ISO8601",
  "platforms": {
    "windows-x86_64": { "signature": "...", "url": "..." },
    "darwin-aarch64": { "signature": "...", "url": "..." },
    "darwin-x86_64":  { "signature": "...", "url": "..." }
  }
}
```

`downloads-latest.json`(下载页读取):
```json
{
  "version": "1.1.12",
  "notes": "...",
  "pub_date": "ISO8601",
  "source": "https://github.com/Mlilion/Codata/releases/tag/<tag>",
  "downloads": {
    "macos-aarch64": { "label", "platform", "arch", "kind", "filename", "url", "size", "sha256" },
    "macos-x86_64":  { "..." },
    "windows-x86_64":{ "..." }
  }
}
```

下载页仅消费 `downloads.*.{label,url,filename}` 与顶层 `version`。

---

## 五、验收标准

- **文档**:`docs/codata-guide.html` 可离线双击打开,导航可用,配置章节覆盖模型/API Key/MCP/datasage;更新与 FAQ、管理员附录齐全;内容与现有实现一致。
- **Pages**:workflow 成功发布;下载页能拉到最新 `downloads-latest.json` 并显示三平台下载 + 版本号;fetch 失败有兜底链接;`guide.html` 可访问。
- **升级链路**:文档准确描述现有链路;确认 endpoint 无需改;README 有下载/文档入口。
- **不回退**:现有 `release.yml`、升级核心逻辑、小白版指南均未被破坏。

---

## 六、范围外(未来演进)

- 迁移到公司自有域名 / 对象存储:设 `CODATA_SITE_BASE_URL` + 改 `tauri.conf.json` endpoint + 发 `release-site/`。
- 灰度发布、更新统计、强制更新策略:需自有服务或 Pages 之外的后端,归入 codata-server 企业化阶段。
- 文档国际化(英文版):本次先中文全量,英文视推广需要再排。
