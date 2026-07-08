# 报告产物优化：echarts 动态图表 + 产物区全屏

> 状态：待评审 · 日期：2026-07-07 · 范围：data-report-html skill 图表方案改造 + artifact 面板全屏

## Context（背景）

data-report-html skill（同分支已实现）当前用 LLM 手写静态内联 SVG 出图。用户反馈两点：

1. **图表要动态可交互**（至少 hover tooltip），静态 SVG 不满足。已确认改用 echarts + CDN + 内联数据，参照用户手工黄金样例 `backend/商业化数据报告_近30天.html`（echarts@5.4.3 CDN、数据内联、6 张交互图、KPI 卡、可信要素齐全）。但保持浅色主题（样例是深色，不采用其深色）。
2. **右侧产物区显示太小**：产物面板默认半屏、可拖到 75%，但报告信息密集，需要全屏查看。

**已验证的关键前提**：
- app 的 html-renderer 用 `<iframe sandbox="allow-scripts">`（无 allow-same-origin）。echarts CDN 的 `<script src>` 在此 sandbox 下能加载执行（网络请求不受 same-origin 限制；echarts 画图不需要同源资源/localStorage）。无自定义 CSP 叠加拦截。→ 不需要改 sandbox。
- 唯一边界：完全离线时 CDN 失败，图表空白 → 用占位文案兜底。
- 面板宽度状态在 `frontend/src/stores/artifact-store.ts`（`panelWidth`，默认 innerWidth/2，拖拽上限 innerWidth*0.75）；header 按钮在 `artifact-panel-header.tsx`；`Maximize2` 等 lucide 图标已在用。

**已定决策**：删除 SVG 资产全换 echarts（不留两套规范）；全屏用「面板最大化到整窗口」（纯布局，不碰 sandbox）。

## 模块 A：skill 图表方案 echarts 化

**改动目录**：`backend/app/data/skills/data-report-html/`

**删除**：
- `templates/chart-bar.svg`、`chart-line.svg`、`chart-area.svg`、`chart-pie.svg`
- `knowledge/svg-charting-rules.md`

**新增** `knowledge/echarts-charting-rules.md`：
1. CDN 引用：`<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>`（钉版本，与样例一致）。
2. 数据内联：查询结果作为 JS 数组内联进 `<script>`，不联网取数（延续数据快照原则）。
3. 浅色主题预设（关键——用户要浅色，不用样例深色）：给一套浅色 echarts 配置片段——`backgroundColor: 'transparent'`、轴线/网格/文字用浅色系（如轴线 `#e5e7eb`、文字 `#6b7280`、网格 `#eceff3`），series 配色沿用 chart-renderer 的 8 色板 `#4f8ff7 #f79f4f #4fcf8f #c77dff #f7746f #4fc4cf #f7c14f #8f9ff7`。
4. 图表类型 + 交互：line/bar/双轴 bar+line/stacked bar/pie，均为 echarts 交互图（hover tooltip、legend 开关）。数字格式化沿用 chart-renderer 规则（轴 ≥1e6→X.XM / ≥1e4→XK / 否则千分位；tooltip 千分位）。
5. 离线兜底：每个图表容器内放占位文案（如「图表需要网络加载，如未显示请检查网络连接」），echarts 成功 init 后覆盖它。
6. 可信要素（提炼自样例，与 credibility-rules.md 呼应）：header badge 标口径/数据源/统计区间、环比对象说明、数据滞后（T+1）说明、数据缺口用 echarts markPoint/markLine 显式标注、footer 写指标口径定义。
7. echarts 配置示例：给 line/bar/pie/双轴/stacked 各一段可套用的浅色 `setOption` 模板（参照样例结构，配色换成浅色 + 8 色板）。

**改 `templates/report-shell.html`**：
- `<head>` 加 echarts CDN `<script>`。
- 图表区从「内联 SVG」改为「`<div id="..." class="chart"></div>` 容器 + `<body>` 末尾 `<script>` echarts.init(...).setOption(...)」。
- `max-width` 放宽（如 1100-1200px），图表容器给固定高度（如 380px）。
- 保持浅色主题：CSS 底色/文字/卡片用现有浅色值（Task 2 已定），不改深色。
- 仍无外部 http(s) 资源，除了 echarts CDN（这是有意的功能依赖，非违规）。

**改 `SKILL.md`**：工作流「手写 SVG」步骤 → 「按 echarts-charting-rules 用 echarts 画交互图表」；铁律里图表相关项同步更新。

**测试更新**：`tests/test_skill/test_data_report_html_skill.py`——移除 SVG 骨架/svg-charting-rules 的断言，改为断言 echarts-charting-rules.md 存在且含关键内容（CDN url、8 色板首色 `#4f8ff7`、浅色主题标识）；report-shell.html 的自包含测试放宽为「除 echarts CDN 外无其它外部资源」。

## 模块 B：artifact 面板全屏

**改动文件**：`frontend/src/stores/artifact-store.ts`、`frontend/src/components/artifacts/artifact-panel.tsx`、`frontend/src/components/artifacts/artifact-panel-header.tsx`

1. artifact-store：加 `isMaximized: boolean`（默认 false）+ `toggleMaximized()`。最大化不持久化（partialize 不含它）；关闭面板时重置为 false。
2. artifact-panel.tsx：`width` 取值 = `isMaximized ? window.innerWidth（或减一个很小的边距）: panelWidth`。最大化时隐藏左侧拖拽把手（ResizeHandle 不渲染）。
3. artifact-panel-header.tsx：关闭按钮旁加全屏/还原按钮（`Maximize2` / `Minimize2` lucide 图标），onClick=`toggleMaximized()`，title「全屏 / 还原」。
4. 还原时回到之前的 panelWidth（isMaximized 只覆盖显示宽度，panelWidth 未被改写，天然记住）。

**独立性**：模块 A（后端 skill）与模块 B（前端面板）互不依赖，可分别实现、分别验证。

## 验证

1. skill 加载/内容测试：`cd backend && source venv/bin/activate && python -m pytest tests/test_skill/test_data_report_html_skill.py -q` 全绿（更新后的断言）。
2. 前端：`cd frontend && npx tsc --noEmit && npx eslint <改动文件>`；`npx next build`。
3. 端到端人工（真实 LLM + datasage + 有网络）：
   - 出一份 HTML 报告 → 浏览器打开：echarts 图表能 hover/tooltip/legend 交互、浅色主题、配色与 app 一致。
   - app 右侧产物面板打开同报告 → 图表能交互（CDN 在 sandbox 下加载成功）；点全屏 → 面板铺满窗口、报告图表放大清晰；点还原 → 回到原宽度。
   - 断网测试：图表区显示离线占位文案而非空白。

## 非目标

- 不改 iframe sandbox（echarts CDN 已验证可在现有 sandbox 运行）。
- 不做「浏览器原生 requestFullscreen」（用面板最大化）。
- 不做深色主题（保持浅色）。
- 不做 echarts 内联离线自包含（用 CDN；离线仅占位提示）。
- 活报告/刷新仍不做（dashboard 领域）。
