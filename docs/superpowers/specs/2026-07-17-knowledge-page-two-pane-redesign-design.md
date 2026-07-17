# 知识库页两栏重构 — 设计

日期:2026-07-17
分支:feat/llm-wiki-knowledge-base
文件:`frontend/src/app/(main)/knowledge/page.tsx`(前端布局重构;后端可选清理)

## 背景

当前知识库页是单列窄卡片(`max-w-4xl`/`max-w-3xl`):概览+容量条 → 添加区(URL + **备注** + 上传/拖拽)→ 单列文档卡片(标题/类型/状态、备注、就地展开知识页、启用/重新加载/删除三个操作挤在一行)。知识页预览走 Dialog 弹窗。

两个问题:
1. **布局不够清晰**:操作按钮拥挤、预览要弹窗跳出、信息层次扁平。
2. **"备注"已失效**:`note` 字段现在只在遗留的 `_legacy_listing_section`(`injection.py:54`)里拼进 prompt;只要 wiki `index.md` 存在(现都会建),就走新路径,note **完全不进 AI**。它是个误导性的 UI 摆设(用户以为填了有用)。

## 目标

- 两栏布局(左列表 + 右详情面板),信息分层清晰,像 experts 页。
- 详情面板内联展示:文档元信息 + 知识页列表 + markdown 预览(取代弹窗)。
- 去掉"备注"输入。
- 添加区收进顶部「+ 添加文档」按钮触发的 Dialog,列表区更干净。
- 纯前端重排为主;ingest/cleanup/reingest/容量/轮询逻辑不变。

## 决策记录

- 布局:两栏 `grid xl:grid-cols-[minmax(0,1fr)_420px]`(复用 experts 页模式)。
- 详情面板:元信息头 → 知识页列表 → 内联 markdown 预览。
- 添加区:PageHeader 右侧「+ 添加文档」→ Dialog(URL 输入 + 上传/拖拽),**无备注**。
- 卡片操作精简:卡片只留「启用/停用」开关;**重新加载、删除、重试移到右栏详情面板**(低频 + 删除破坏性,放详情更稳)。
- 预览:从 Dialog 改为**面板内联**;`index.md`(查看索引)也走同一预览区。
- 窄屏(<xl):单列列表;选中一篇时详情以全屏覆盖层/抽屉滑入(带返回)。
- 备注后端:前端停止发送/展示;**后端字段暂保留**(不动 DB/legacy 路径,避免回归),实现时再定是否连带清理。

## 布局

```
┌─ PageHeader:知识库                         [+ 添加文档] ─┐
├─ 概览条:共 N 篇 · X 已就绪 · Y 处理中 ─ 容量条 [查看索引]─┤   ← 横跨两栏
├──────────────────────┬───────────────────────────────────┤
│ 左栏:文档列表         │ 右栏:详情面板 (420px)             │
│ minmax(0,1fr)         │                                   │
│ ▸ 卡片(可选中/高亮)  │  元信息头:标题 / 来源链接 / 类型   │
│   📄 标题  [type]     │           状态 · [启用] [↻] [🗑]   │
│   ✓状态 · N 个知识页   │  ─────────────────────────────    │
│   [●启用]             │  知识页 (N):                       │
│ ▸ 卡片                │   · source-xxx.md  ← 选中          │
│ ...                   │   · concept-yyy.md                 │
│                       │  ─────────────────────────────    │
│                       │  预览:<选中页>                     │
│                       │   (MarkdownRenderer 内联)          │
└──────────────────────┴───────────────────────────────────┘
```

容器从 `max-w-4xl` 放宽到约 `max-w-6xl` 以容纳两栏。

## 组件结构

### 顶部(横跨两栏)
- `PageHeader` 标题「知识库」+ 右侧 action slot 放「+ 添加文档」按钮。
- 概览条 + 容量条:沿用现有 `SurfacePanel` 内容(篇数/已就绪/处理中 + 容量进度条 + 「查看索引」),算法不变。「查看索引」点击 → `setPreviewPage("index.md")` + 若窄屏则打开详情抽屉。

### 添加 Dialog
- 触发:PageHeader 的「+ 添加文档」。
- 内容:URL 输入(Enter 提交)+ 「添加」按钮;分隔线;「上传文件」按钮 + 拖拽区(拖拽状态 `isDragging` 作用于 Dialog 内容)。**无备注输入**。
- 提交/上传成功后关闭 Dialog + toast;`addKnowledge.mutate` 不再传 `note`。

### 左栏:文档卡片(可选中)
- 三层:标题行(来源图标 + 标题 + 类型标签)/ 元信息行(状态徽章 + 「N 个知识页」纯文字)/ 右侧启用开关。
- 整卡点击 → `setSelectedEntryId(entry.id)`(+ 窄屏打开详情抽屉);选中态高亮(边框/背景)。
- 卡片上**只保留启用/停用开关**;移除卡片上的重新加载、删除、就地展开(`expanded`/`ChevronDown` 删除)。
- 排序不变:active 置顶 → done → failed。
- 失败卡片:元信息行显示「失败」徽章(重试在右栏)。

### 右栏:详情面板
- **元信息头**:标题(feishu 条目可点开原文)、来源链接 + 类型标签、状态徽章、启用开关、重新加载(↻,done 时可用)、删除(🗑,`ACTIVE_STATUSES` 时禁用,沿用现有保护)。失败时显示错误详情 + 「重试」。
- **知识页列表**:`知识页 (N)` + 每个 `wiki_pages` 项为可点按钮;点击 `setPreviewPage(page)`,选中项高亮。
- **内联预览**:`useWikiPage(previewPage)` + `MarkdownRenderer`;`[[双链]]` 点击拦截复用现有逻辑(补 `.md` → `setPreviewPage`,外链照常),目标从 Dialog 改为面板预览区。加载/错误态同现有。
- **默认选中**:进页面默认选首个 done 文档 + 其首个知识页(或 source 页);右栏不空。
- **空/未选**:空库或未选时,右栏显示引导文案。

## 前端状态
- 新增/保留:`selectedEntryId: string | null`、`previewPage: string | null`、`addDialogOpen: boolean`、`isDragging`(移入 Dialog)、`url`。
- **移除**:`note`、`expanded: Set<string>`。
- 选中派生:`selectedEntry = entries.find(e => e.id === selectedEntryId)`;selectedEntryId 为空或指向已删条目时,回退到首个 done(或列表首项/ null)。
- hooks 全部不变(`useKnowledge`/`useKnowledgeCapacity`/`useAddKnowledge`/`usePatchKnowledge`/`useDeleteKnowledge`/`useReingestKnowledge`/`useUploadKnowledge`/`useWikiPage`);轮询不变。

## 边界情况
- **空库**:左栏空态引导(粘贴飞书链接 / 上传);右栏引导文案。
- **窄屏(<xl)**:单列列表;选中打开全屏覆盖/抽屉详情(带返回);添加 Dialog 本就是覆盖层,天然适配。
- **失败文档**:详情头显错误 + 重试;预览区提示「尚未成功构建」。
- **选中项被删**:删除成功后回退选中(下一篇 done / 首项 / null → 空态)。
- **长标题/长链接**:截断(`truncate`)。
- **重新加载/删除进行中**:按钮 disabled(沿用 `ACTIVE_STATUSES` 与 `isPending`)。

## 后端(备注清理,可选)
- **默认(保守)**:前端不再发送 `note`(`AddBody` 仍接受,缺省空)、UI 不再显示 note。后端 `note` 字段、`_entry_to_dict.note`、`_legacy_listing_section` note 拼接**暂不动**,避免触碰 DB/legacy 引入回归。
- 实现计划里可加一个可选任务:彻底移除 note(`AddBody.note`、`add_knowledge` 落库、`_entry_to_dict`、legacy 拼接),按需决定。

## 非目标(YAGNI)
- 不改 ingest/cleanup/reingest 后端逻辑。
- 不改容量条算法、markdown 渲染器。
- 不做多选/批量操作、搜索/过滤/分组(可留后续)。
- 不改数据模型 / 无 migration(除非选择彻底删 note,另议)。

## 测试与验证
- `npx tsc --noEmit` clean。
- 真机(dev 桌面端)验证:空库引导;添加 Dialog 提交飞书链接 + 上传文件;选中文档 → 右栏元信息 + 知识页 + 内联预览;点知识页切换预览;`[[双链]]`面板内跳转;查看索引;重新加载;删除(含删除选中项后的回退);窄屏抽屉。
