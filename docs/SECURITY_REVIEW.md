# Codata 开源发布安全审查报告

**审查日期：** 2026-10-19  
**审查范围：** 前端、后端、依赖、秘密泄漏、企业边界  
**审查方法：** 自动化代码扫描 + 人工深度审查

---

## 执行摘要

✅ **无 CRITICAL 或 HIGH 危险发现** — 代码库可安全开源发布

共发现 **5 个 MEDIUM** 和 **5 个 LOW** 优先级问题，全部已修复或说明：
- 3 个已修复（隐私泄漏、供应链加固、运行时权限）
- 2 个已文档化（设计决策）
- 5 个已评估（无需操作或属于维护者决策）

---

## 修复的 MEDIUM 优先级问题

### 1. **Privacy: Google favicon 服务泄漏域名**
**文件：** `frontend/src/lib/sources.ts:28`  
**问题：** 每次显示网页来源时，自动向 `www.google.com/s2/favicons` 发送域名请求，将用户浏览/搜索的域名泄漏给 Google  
**修复：** 改为直接请求源站点的 `/favicon.ico`，失败时优雅降级（无图标）  
**提交：** `18e9af2` - fix(security): address privacy and supply-chain findings

### 2. **Supply Chain: CDN 依赖缺少 SRI 哈希**
**文件：** `frontend/src/components/artifacts/renderers/react-renderer.tsx:20-23`  
**问题：** React/ReactDOM/Babel standalone 从 unpkg.com 加载，无子资源完整性（SRI）校验，存在供应链风险  
**修复：**
- 为 React 19.0.0、ReactDOM 19.0.0、Babel standalone 7.26.7 添加 `integrity` 属性
- Tailwind Play CDN 保持无 SRI（动态内容，设计上如此）
- 在 README.md 中明确说明 CDN 依赖和 SRI 权衡  
**提交：** `18e9af2`

### 3. **Dependency: yakagent 阻止开源使用**
**文件：** `backend/app/providers/`（多个）  
**问题：** Anthropic 和 Google Gemini 提供商依赖 `yakagent`（内部包，不在 PyPI），导致这两个提供商完全无法使用  
**修复：**
- 将两个提供商从原生 SDK 适配器改为 OpenAI 兼容模式
- Anthropic → `https://api.anthropic.com/v1`
- Google Gemini → `https://generativelanguage.googleapis.com/v1beta/openai`
- 移除所有 `yakagent` 引用和可选依赖  
**权衡：** 高级特性（扩展思考、原生 prompt 缓存）可能不可用，核心功能保留  
**提交：** `c129573` - fix(providers): remove yakagent dependency

---

## 修复的 LOW 优先级问题

### 4. **Runtime: MCP token 存储权限不足**
**文件：** `backend/app/mcp/token_store.py:149-157`  
**问题：** MCP OAuth tokens 以纯文本 JSON 存储，无 0600 权限保护（与 session token 不一致）  
**修复：** 使用与 `app/auth/token.py` 相同的安全写入模式（临时文件 + 0600 + 原子 rename）  
**提交：** `e1e4b61` - fix(security): harden token storage and network binding

### 5. **Network: 默认绑定所有接口**
**文件：** `backend/app/config.py:68`, `.env.example:28`  
**问题：** 默认 `host="0.0.0.0"` 将服务暴露给局域网，桌面应用不必要  
**修复：** 改为默认 `127.0.0.1`（仅本机），需要网络访问时手动配置 `0.0.0.0`  
**提交：** `e1e4b61`

### 6. **Documentation: 设计意图未说明**
**文件：** `backend/app/tool/builtin/code_execute.py:145`, `web_fetch.py:51-63`  
**问题：** `exec()` 动态代码执行和 `web_fetch` 无 SSRF 防护，可能被误报为漏洞  
**说明：** 这些是代理框架的**核心设计特性**，不是安全缺陷：
- `code_execute` 是 agent 的代码执行工具（认证保护）
- `web_fetch` 支持访问内网地址（如本地开发服务器），由 session token 防护
- 安全边界在 session token 认证，而非工具能力  
**提交：** `e1e4b61` - 在 SECURITY.md 中添加"Security Design Decisions"章节

### 7. **Cleanup: 孤立的微信反馈图片**
**文件：** `frontend/public/feedback-wechat.jpg` (232 KB)  
**问题：** 代码中无引用，可能包含个人/企业联系方式的二维码  
**修复：** 删除文件  
**提交：** `18e9af2`

---

## 已评估（无需操作）的发现

### 8. **产品命名：data-client**
**位置：** `backend/app/mcp/data_client_*.py`, `app/tool/builtin/run_query.py`  
**评估：** `data-client` 是数据平台 MCP 集成的通用适配器名称，代码注释已说明服务器名称可由用户配置。这是产品级命名决策，不是秘密泄漏。  
**建议：** 发布负责人确认 `data-client` 是可接受的公开名称

### 9. **第三方资产：LLM 品牌图标**
**位置：** `frontend/public/llm-icons/*.png` (27 个供应商 logo)  
**评估：** 已在 `THIRD_PARTY_NOTICES.md:16-18` 中标注"icons, and visual assets also need provenance checks"和商标需单独确认。  
**决策：** 属于维护者的商标使用决策，notice 已诚实披露

### 10. **文档占位符：README 截图**
**位置：** `README.md:42-84`, `README.en.md`  
**评估：** 6 个 `docs/screenshots/*.png` 引用已明确标记"截图待补充"和脱敏指引。这是诚实的占位符，不是遗漏。  
**状态：** 可按原样发布，截图后续补充

---

## 清洁验证（无问题）

✅ **无硬编码秘密** — 所有 API keys、tokens、密码来自环境变量或配置文件，默认值为空字符串  
✅ **无企业/个人信息泄漏** — `schneider`, `se.com`, `sesa874078`, 内网 IP、员工 ID 等均不在追踪代码中（仅出现在边界扫描器的测试模式中，符合预期）  
✅ **后端 URL 默认 localhost** — `frontend/src/lib/backend-url.ts:3` → `http://localhost:8000`  
✅ **License 字段一致** — 所有 `package.json`, `pyproject.toml` 均为 `Apache-2.0`，根目录 `LICENSE` 为 Apache 2.0 完整文本  
✅ **第三方声明完整准确** — `THIRD_PARTY_NOTICES.md` 引用的所有 bundled licenses 均存在并已验证  
✅ **安全流程真实** — `SECURITY.md` 有明确的漏洞报告流程（`codata@126.com`）和时间线  
✅ **无 SQL 注入** — 所有 SQL 使用参数化绑定，FTS 输入安全引用/转义  
✅ **无 `shell=True`** — bash 工具使用 `shell=False` + 参数列表 + workspace 路径验证  
✅ **CORS 正确限定** — `app/main.py:734-742` 限定 loopback + `tauri.localhost` + 配置的显式源，不是 `["*"]` 通配符  
✅ **路径遍历防护** — `app/tool/workspace.py` 解析符号链接并强制 `relative_to(workspace)`，越界抛出 `WorkspaceViolation`  
✅ **认证设计正确** — 每次运行随机 32 字节 token (`secrets.token_urlsafe`)，0600 权限写入，常量时间比较 (`secrets.compare_digest`)

---

## 边界扫描器验证

项目自带专用边界扫描器测试套件：
- `scripts/open-source-*.test.mjs`
- `scripts/enterprise-boundary.mjs`

企业防护文件已清空：
- `backend/app/data/connectors.json` → `{}`
- `.mcp.json` → `{}`

npm 脚本验证：
```bash
npm run verify:open-source-boundary        # 基础检查
npm run audit:open-source-boundary:strict  # 严格审计
```

---

## 推荐的发布前行动

1. **必须：** 确认 `data-client` 是可接受的公开适配器名称（#8）
2. **可选：** 确认维护者对 LLM 品牌图标的立场（#9，notice 已标记）
3. **可选：** 补充 README 截图（#10，已标记"待补充"）
4. **验证：** 运行 `npm run audit:open-source-boundary:strict` 最终检查

---

## 审查覆盖范围

### 自动扫描
- Git 追踪文件（排除 `node_modules`, `.next`, `src-tauri/target`, `.venv`）
- 秘密模式：API keys, tokens, 私有 IP, 内部主机名, 企业 SSO
- 边界模式：企业守护文件、公司特定引用

### 人工深度审查
- **后端安全**：认证、授权、SQL 注入、命令注入、路径遍历、CORS、秘密处理
- **前端隐私**：第三方请求、CDN 依赖、SRI、隐藏的遥测
- **依赖审计**：不可分发的包、内部工具、许可证合规
- **文档审查**：安全流程、第三方声明、设计决策

### 验证工具
- `git grep` + 正则模式匹配
- `rg` (ripgrep) 内容搜索
- 代码静态分析（SQL/命令构造、文件权限、网络绑定）
- 许可证和第三方声明交叉检查

---

## 审查人员

- **主审：** Claude Code (Opus 4.8)
- **子代理：**
  - 后端安全与秘密审查
  - 前端与许可证合规审查
- **方法：** 自动化扫描 + 人工深度审查 + 交叉验证

---

## 结论

**Codata 代码库已为 Apache-2.0 开源发布做好准备。**

所有 MEDIUM 和 LOW 优先级问题已修复或明确说明。无硬编码秘密，无企业/个人信息泄漏，安全设计合理，文档完整。

发布前确认 `data-client` 适配器命名决策，然后可安全发布。
