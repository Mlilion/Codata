# WorkCraft 品牌替换设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WorkCraft 项目完整替换为 WorkCraft 品牌，用于私有化商业产品。

**原则:** 完全私有化 + 保留原 LICENSE 版权声明

**新品牌配置:**
- 产品名称: WorkCraft
- 官网域名: https://work-craft.com
- Deep link: workcraft://
- Bundle ID: com.workcraft.desktop
- 用户数据目录: ~/.workcraft/

---

## 替换范围分类

### 1. 核心标识替换

| 原值 | 替换为 | 涉及文件数 |
|------|--------|-----------|
| `WorkCraft` → `WorkCraft` | ~150处 | 所有代码/文档 |
| `workcraft` → `workcraft` | ~750处 | 所有代码/配置 |
| `workcraft-proxy` → `workcraft-proxy` | ~20处 | Python/TypeScript |
| `workcraft/best-free` → `workcraft/best-free` | 3处 | Python (虚拟模型ID) |
| `Craft Free` → `Craft Free` | 1处 | Python (虚拟模型显示名) |

### 2. 域名和URL替换

| 原值 | 替换为 | 说明 |
|------|--------|------|
| `https://work-craft.com` | `https://work-craft.com` | 官网域名 |
| `https://work-craft.com/download` | `https://work-craft.com/download` | 下载页面 |
| `workcraft://` | `workcraft://` | Deep link scheme |
| `https://github.com/workcraft/desktop` | **移除** | HTTP-Referer header |
| GitHub issue/PR/Discussion 链接 | **移除** | 文档中的引用 |

**例外:** LICENSE 文件中的原作者 GitHub 链接保留不动。

### 3. Bundle Identifier 和应用名称

| 原值 | 替换为 |
|------|--------|
| `com.workcraft.desktop` | `com.workcraft.desktop` |
| `WorkCraft.app` | `WorkCraft.app` |
| `WorkCraft.exe` | `WorkCraft.exe` |
| `workcraft-desktop` (进程名) | `workcraft-desktop` |
| `workcraft-backend` (进程名) | `workcraft-backend` |

### 4. 用户数据路径

| 原值 | 替换为 |
|------|--------|
| `~/.workcraft/` | `~/.workcraft/` |
| `.workcraft/` | `.workcraft/` |
| `data/workcraft.db` | `data/workcraft.db` |
| `workcraft-auth` | `workcraft-auth` |
| `workcraft-settings` | `workcraft-settings` |
| `workcraft-drafts` | `workcraft-drafts` |
| `workcraft-sidebar` | `workcraft-sidebar` |
| `workcraft-appearance` | `workcraft-appearance` |
| `workcraft-language` | `workcraft-language` |
| `workcraft-remote-provider` | `workcraft-remote-provider` |

### 5. Token前缀和认证

| 原值 | 替换为 |
|------|--------|
| `workcraft_st_` | `workcraft_st_` |
| `workcraft_rt_` | `workcraft_rt_` |
| `"workcraft"` (realm) | `"workcraft"` |

### 6. API Key名称

| 原值 | 替换为 |
|------|--------|
| `"WorkCraft Desktop"` | `"WorkCraft Desktop"` |

### 7. 图标文件 (~30+ 文件)

需替换的目录:
- `desktop-tauri/src-tauri/icons/` - 全套桌面图标
- `frontend/public/favicon.svg`
- `WorkCraft-Logo/` 目录

**注意:** 图标需要重新设计，包含:
- 应用图标 (macOS .icns, Windows .ico, Linux .png)
- 系统托盘图标
- favicon.svg
- Logo组件中的SVG

### 8. 文档图片

`docs/readme/workcraft-*` 系列图片需重新截取或替换为 WorkCraft 界面截图。

### 9. 组件和类名

| 原值 | 替换为 |
|------|--------|
| `WorkCraftLogo` | `WorkCraftLogo` |
| `AnimatedWorkCraftLogo` | `AnimatedWorkCraftLogo` |
| `WorkCraftAccount` | `WorkCraftAccount` |
| `Sub2APIUser` | 保持不变 (Sub2API是外部服务) |

---

## 文件清单

### 前端 (frontend/src)

**核心组件:**
- `components/ui/workcraft-logo.tsx` → 重命名为 `workcraft-logo.tsx`
- `components/layout/splash-screen.tsx` - AnimatedWorkCraftLogo
- `components/desktop/title-bar.tsx` - WorkCraftLogo
- `components/settings/providers-tab.tsx` - WorkCraftLogo, WorkCraftAccount
- `components/settings/billing-tab.tsx` - WorkCraftLogo
- `components/onboarding/onboarding-screen.tsx`

**状态存储:**
- `stores/auth-store.ts` - localStorage key
- `stores/settings-store.ts` - localStorage key
- `stores/sidebar-store.ts` - localStorage key
- `stores/appearance-store.ts` - localStorage key

**其他:**
- `app/layout.tsx` - title
- `lib/constants.ts` - 模型ID, localStorage keys
- `hooks/use-chat.ts` - localStorage key
- `hooks/use-models.ts`

### 后端 (backend)

**核心文件:**
- `app/main.py` - title, provider_id
- `app/config.py` - 数据库路径, proxy配置
- `app/provider/openrouter.py` - HTTP-Referer headers, virtual model
- `app/auth/token.py` - token前缀
- `app/auth/middleware.py` - realm
- `app/auth/csrf.py` - frontend origin check
- `app/skill/registry.py` - .workcraft目录
- `app/plugin/__init__.py` - .workcraft目录

**进程相关:**
- `run.py` - 进程描述
- `workcraft.spec` → 重命名为 `workcraft.spec`

### Tauri桌面应用 (desktop-tauri)

- `src-tauri/tauri.conf.json` - productName, identifier
- `src-tauri/Cargo.toml` - package name
- `src-tauri/capabilities/default.json` - 描述
- `src-tauri/icons/` - 全套图标文件
- `package.json` - package name

### 配置和文档

- `package.json` - name, description
- `README.md` - 品牌名称, 图片, GitHub链接
- `README.zh-CN.md` - 同上
- `CHANGELOG.md` - 品牌名称
- `CONTRIBUTING.md` - GitHub链接移除
- `SECURITY.md` - GitHub链接移除
- `DESIGN.md` - 品牌名称
- `LINUX.md` - 品牌名称, 命令名

---

## 实施优先级

### Phase 1: 核心代码替换 (不影响功能)
1. 前端 localStorage keys
2. 后端 token 前缀
3. Provider ID 和模型 ID
4. 组件和类名重命名

### Phase 2: 资源文件替换
1. 图标文件替换
2. favicon.svg 替换
3. 文档图片替换

### Phase 3: 文档和URL替换
1. README/文档中的品牌名称
2. GitHub链接移除 (保留LICENSE)
3. 域名替换

### Phase 4: 验证和测试
1. TypeScript 编译检查
2. Python 类型检查
3. 前端构建验证
4. 功能回归测试

---

## 不替换的内容

1. **LICENSE 文件** - 保持原样，包含原作者 GitHub 链接
2. **Sub2API 相关** - `Sub2APIUser`, `Sub2APIError`, `proxyApi` 等保持不变 (外部服务)
3. **外部依赖引用** - node_modules, 第三方库文档中的引用不处理
4. **CHANGELOG 历史记录** - 历史条目中的 WorkCraft 引用保持原样 (历史事实)，仅更新新的条目名称

---

## 风险和注意事项

1. **数据迁移** - 现有用户数据目录 `~/.workcraft/` 需迁移到 `~/.workcraft/`（可选，或首次启动时自动迁移）
2. **Deep link 兼容** - 已注册的 `workcraft://` scheme 需要系统重新注册
3. **API Key 显示** - Sub2API 中已创建的 "WorkCraft Desktop" Key 名称无法自动更新，用户需手动重新创建
4. **图标设计** - 需要专业设计师或 AI 工具生成新的 WorkCraft 品牌图标

---

## 自检清单

- [x] 无 TBD 或 TODO 占位符
- [x] 无矛盾或不一致的替换规则
- [x] 范围明确：核心代码 + 资源 + 文档，不含外部依赖
- [x] 明确保留项：LICENSE, Sub2API相关, CHANGELOG历史
- [x] 实施顺序合理：代码 → 资源 → 文档 → 测试
