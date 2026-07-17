# 知识库页两栏重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识库页从单列窄卡片重构为两栏布局(左文档列表 + 右详情面板),详情面板内联展示元信息 + 知识页列表 + markdown 预览,添加区收进顶部 Dialog,去掉"备注"输入。

**Architecture:** 纯前端重构,单文件 `frontend/src/app/(main)/knowledge/page.tsx`。复用现有全部 hooks(`use-knowledge.ts`,不改)、`PageHeader`(`actions` slot)、`SurfacePanel`、`Dialog`、`MarkdownRenderer`、`Button`。后端 note 清理为可选独立任务。

**Tech Stack:** Next.js / React / TypeScript / Tailwind(CSS 变量主题)。校验用 `cd frontend && npx tsc --noEmit`。

## Global Constraints

- 纯前端重构为主;**不改** `use-knowledge.ts` hooks、ingest/cleanup/reingest 后端、容量算法、`MarkdownRenderer`。
- 复用现有主题 CSS 变量(`--surface-*`/`--border-*`/`--text-*`/`--data-accent`/`--color-success|warning|destructive[-soft]`);不引入硬编码颜色。
- 两栏 grid 用 `xl:grid-cols-[minmax(0,1fr)_420px]`(与 experts 页一致);窄屏(<xl)单列 + 详情抽屉。
- `PageHeader` 的 `actions` prop 放「+ 添加文档」按钮。
- `useAddKnowledge.mutate` 只传 `{ feishu_url }`(note 参数可选,省略即可 — 不改 hook)。
- 每个任务结束 `npx tsc --noEmit` 必须 clean(`INGEST_STATUS_LABEL` 是 `Record<ingest_status,string>`,类型完整性由 tsc 守)。
- 删除按钮沿用现有保护:`deleteKnowledge.isPending || ACTIVE_STATUSES.has(entry.ingest_status)` 时 disabled。

---

### Task 1: 骨架 — 两栏 grid + 顶部 + 选中状态

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Produces: 两栏骨架;`selectedEntryId`/`addDialogOpen` state;`selectedEntry` 派生 + 默认选中逻辑;PageHeader `actions` 按钮(暂只 open dialog,dialog 内容 Task 2)。

- [ ] **Step 1: 加 state 与派生选中**

在组件顶部 state 区(现有 `url`/`note`/`error`/... 附近)替换/新增:
```tsx
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
```
删除 `note`、`expanded` 两个 state(及其 `toggleExpand`)。

在 `sortedEntries` 之后加派生选中(默认首个 done,回退列表首项):
```tsx
  const selectedEntry =
    sortedEntries.find((e) => e.id === selectedId) ??
    sortedEntries.find((e) => e.ingest_status === "done") ??
    sortedEntries[0] ??
    null;
```
(用 `selectedEntry?.id` 作为真正的"当前选中",避免 selectedId 指向已删条目。)

- [ ] **Step 2: 重排渲染骨架**

把 `return (...)` 的整体结构改为:PageHeader(带 actions)+ 概览/容量条(横跨)+ 两栏 grid。先只放左栏列表(沿用现有列表渲染,临时保留),右栏放占位:
```tsx
  return (
    <PageFrame className="flex-1">
      <PageContent className="max-w-6xl lg:py-8">
        <PageHeader
          title="知识库"
          description="把飞书文档或本地文件加进来,分析时 AI 就能参考它们作为权威背景。"
          icon={BookOpen}
          backHref="/c/new"
          actions={
            <Button onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加文档
            </Button>
          }
        />
        {/* 概览 + 容量条(横跨两栏)—— 原 SurfacePanel 概览块原样搬来 */}
        {/* ...(保留现有概览/容量 SurfacePanel 代码)... */}

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            {/* 左栏列表 —— Task 3 重写;先临时保留现有 <ul> 列表渲染 */}
          </div>
          <div className="hidden min-w-0 xl:block">
            {/* 右栏详情 —— Task 4 */}
          </div>
        </div>
      </PageContent>
      {/* 添加 Dialog —— Task 2;预览 —— Task 4 移入右栏 */}
    </PageFrame>
  );
```
本步先让页面能编译渲染(左栏用现有列表、右栏占位);添加区旧 SurfacePanel 暂时删除(其功能 Task 2 迁到 Dialog)。若旧添加区被删导致 `submit`/`upload`/拖拽 handler 暂时未使用,保留这些函数(Task 2 复用),用 `void` 或先挂在占位处避免 lint 报错。

- [ ] **Step 3: tsc**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "refactor(knowledge): two-pane skeleton + selection state"
```

---

### Task 2: 添加 Dialog(去掉备注)

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Consumes: `addOpen`/`setAddOpen`, `url`, `isDragging`, `fileInputRef`, `useAddKnowledge`, `useUploadKnowledge`.
- Produces: 一个 `<Dialog open={addOpen}>` 含 URL 输入 + 上传/拖拽,**无备注**;`submit()` 只传 `{ feishu_url }`。

- [ ] **Step 1: 改 submit 去掉 note**

```tsx
  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    addKnowledge.mutate(
      { feishu_url: url.trim() },
      {
        onSuccess: () => {
          toast.success("已添加到知识库");
          setUrl("");
          setAddOpen(false);
        },
        onError: (err) =>
          setError(apiErrorMessage(err, "添加失败,请检查飞书链接是否正确")),
      },
    );
  };
```
`upload` 的 `onSuccess` 也加 `setAddOpen(false)`。

- [ ] **Step 2: 加添加 Dialog**

在 return 末尾(预览 Dialog 附近)加:
```tsx
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加文档</DialogTitle>
          </DialogHeader>
          <div
            className={cn(
              "rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 transition-colors",
              isDragging && "border-[var(--border-focus)] bg-[var(--surface-primary)]",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploadKnowledge.isPending) setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={onDrop}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="粘贴飞书文档链接,如 https://xxx.feishu.cn/docx/..."
                className="h-10 flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-focus)]"
              />
              <Button onClick={submit} disabled={!canSubmit} className="shrink-0 gap-1.5">
                {addKnowledge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                添加
              </Button>
            </div>
            {error && <p className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
            <div className="mt-3 flex items-center gap-2 border-t border-[var(--border-default)] pt-3">
              <input ref={fileInputRef} type="file" accept={UPLOAD_ACCEPT} onChange={onFileSelected} className="hidden" />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadKnowledge.isPending} className="shrink-0 gap-1.5">
                {uploadKnowledge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                上传文件
              </Button>
              <span className="text-xs text-[var(--text-tertiary)]">
                或把本地文件拖到这里(PDF、Word、Excel、PPT、Markdown、TXT)
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: tsc + commit**

Run: `cd frontend && npx tsc --noEmit` → clean.
```bash
git add "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "refactor(knowledge): move add form into a dialog, drop 备注 input"
```

---

### Task 3: 左栏文档卡片(可选中,精简操作)

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Consumes: `sortedEntries`, `selectedEntry`, `setSelectedId`, `toggle`, `patchKnowledge`.
- Produces: 左栏可选中卡片列表(标题/类型/状态 + 「N 个知识页」文字 + 启用开关);移除卡片上的展开、重新加载、删除。

- [ ] **Step 1: 重写左栏列表渲染**

替换 Task 1 里临时保留的 `<ul>`,每张卡片可点选中:
```tsx
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-6 py-12 text-center">
                <BookOpen className="mx-auto mb-3 h-8 w-8 text-[var(--text-tertiary)]" />
                <p className="text-sm text-[var(--text-secondary)]">还没有知识文档,点右上角「添加文档」开始。</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedEntries.map((entry) => {
                  const isActive = ACTIVE_STATUSES.has(entry.ingest_status);
                  const isSelected = entry.id === selectedEntry?.id;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.id)}
                        className={cn(
                          "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                          isSelected
                            ? "border-[var(--border-focus)] bg-[var(--surface-primary)]"
                            : "border-[var(--border-default)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-primary)]",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-[var(--text-primary)]">
                                {entry.source_type === "file"
                                  ? <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                                  : <BookOpen className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
                                <span className="truncate">{entry.title || entry.source_name || entry.feishu_url}</span>
                              </span>
                              {entry.doc_type && (
                                <span className="shrink-0 rounded-md bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                                  {entry.doc_type}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                  entry.ingest_status === "done"
                                    ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                                    : entry.ingest_status === "failed"
                                      ? "bg-[var(--color-destructive-soft)] text-[var(--color-destructive)]"
                                      : "bg-[var(--surface-primary)] text-[var(--text-tertiary)]",
                                )}
                              >
                                {isActive && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                {INGEST_STATUS_LABEL[entry.ingest_status] ?? entry.ingest_status}
                              </span>
                              {entry.ingest_status === "done" && entry.wiki_pages.length > 0 && (
                                <span className="text-xs text-[var(--text-tertiary)]">
                                  {entry.wiki_pages.length} 个知识页
                                </span>
                              )}
                            </div>
                          </div>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); toggle(entry); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); toggle(entry); } }}
                            className={cn(
                              "shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                              entry.enabled
                                ? "border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-secondary)]"
                                : "border-[var(--border-default)] text-[var(--text-tertiary)]",
                              patchKnowledge.isPending && "opacity-50",
                            )}
                          >
                            {entry.enabled ? "已启用" : "已停用"}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
```
注:启用开关用 `span[role=button]` + `stopPropagation`,避免嵌套 `<button>`(HTML 不允许 button 套 button)。

- [ ] **Step 2: tsc + commit**

Run: `cd frontend && npx tsc --noEmit` → clean.
```bash
git add "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "refactor(knowledge): selectable list cards, actions moved to detail"
```

---

### Task 4: 右栏详情面板 + 内联预览

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Consumes: `selectedEntry`, `previewPage`/`setPreviewPage`, `useWikiPage`, `reingest`, `remove`, `toggle`, `deleteKnowledge`, `reingestKnowledge`, `MarkdownRenderer`.
- Produces: 右栏详情(元信息头 + 知识页列表 + 内联预览);删除预览 Dialog(改为内联);删除选中项后回退。

- [ ] **Step 1: 详情面板默认预览页 effect**

选中文档变化时,默认预览其首个知识页(或 index):
```tsx
  useEffect(() => {
    if (!selectedEntry) { setPreviewPage(null); return; }
    if (selectedEntry.ingest_status === "done" && selectedEntry.wiki_pages.length > 0) {
      setPreviewPage((prev) =>
        prev && selectedEntry.wiki_pages.includes(prev) ? prev : selectedEntry.wiki_pages[0],
      );
    } else {
      setPreviewPage(null);
    }
  }, [selectedEntry?.id]); // eslint-disable-line react-hooks/exhaustive-deps
```
(在文件顶部 import 加 `useEffect`。)

- [ ] **Step 2: 删除的回退**

改 `remove` 成功后清选中,让派生逻辑回退:
```tsx
  const remove = (entry: KnowledgeEntry) => {
    deleteKnowledge.mutate(entry.id, {
      onSuccess: () => { toast.success("已删除"); setSelectedId(null); },
      onError: (err) => toast.error(apiErrorMessage(err, "删除失败")),
    });
  };
```

- [ ] **Step 3: 右栏详情渲染**

替换 Task 1 右栏占位 `<div className="hidden ... xl:block">`:
```tsx
          <div className="hidden min-w-0 xl:block">
            {selectedEntry ? (
              <SurfacePanel className="flex flex-col gap-3 bg-[var(--surface-secondary)] p-4">
                {/* 元信息头 */}
                <div>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {selectedEntry.source_type === "file" ? (
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                          <FileText className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                          <span className="truncate">{selectedEntry.title || selectedEntry.source_name}</span>
                        </div>
                      ) : (
                        <a href={selectedEntry.feishu_url ?? undefined} target="_blank" rel="noreferrer"
                           className="block truncate text-sm font-semibold text-[var(--text-primary)] hover:underline">
                          {selectedEntry.title || selectedEntry.feishu_url}
                        </a>
                      )}
                    </div>
                    {selectedEntry.doc_type && (
                      <span className="shrink-0 rounded-md bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                        {selectedEntry.doc_type}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                      selectedEntry.ingest_status === "done" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : selectedEntry.ingest_status === "failed" ? "bg-[var(--color-destructive-soft)] text-[var(--color-destructive)]"
                          : "bg-[var(--surface-primary)] text-[var(--text-tertiary)]",
                    )}>
                      {ACTIVE_STATUSES.has(selectedEntry.ingest_status) && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                      {INGEST_STATUS_LABEL[selectedEntry.ingest_status] ?? selectedEntry.ingest_status}
                    </span>
                    <Button variant={selectedEntry.enabled ? "secondary" : "outline"} size="sm"
                            onClick={() => toggle(selectedEntry)} disabled={patchKnowledge.isPending} className="ml-auto">
                      {selectedEntry.enabled ? "已启用" : "已停用"}
                    </Button>
                    {selectedEntry.ingest_status === "done" && (
                      <Button variant="ghost" size="icon" onClick={() => reingest(selectedEntry)}
                              disabled={reingestKnowledge.isPending}
                              className="h-8 w-8 shrink-0 text-[var(--text-tertiary)] hover:text-[var(--data-accent)]"
                              aria-label="重新加载" title="重新加载(飞书/文件更新后刷新)">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => remove(selectedEntry)}
                            disabled={deleteKnowledge.isPending || ACTIVE_STATUSES.has(selectedEntry.ingest_status)}
                            className="h-8 w-8 shrink-0 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)]"
                            aria-label="删除">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {selectedEntry.ingest_status === "failed" && selectedEntry.ingest_error && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-xs text-[var(--text-tertiary)]">{selectedEntry.ingest_error}</span>
                      <button type="button" onClick={() => reingest(selectedEntry)} disabled={reingestKnowledge.isPending}
                              className="shrink-0 text-xs font-medium text-[var(--data-accent)] hover:underline disabled:opacity-50">
                        重试
                      </button>
                    </div>
                  )}
                </div>

                {/* 知识页列表 */}
                {selectedEntry.ingest_status === "done" && selectedEntry.wiki_pages.length > 0 && (
                  <div className="border-t border-[var(--border-default)] pt-3">
                    <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">
                      知识页 ({selectedEntry.wiki_pages.length})
                    </div>
                    <ul className="flex flex-col gap-0.5">
                      {selectedEntry.wiki_pages.map((page, i) => (
                        <li key={`${selectedEntry.id}-${i}`}>
                          <button type="button" onClick={() => setPreviewPage(page)}
                                  className={cn(
                                    "flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-xs transition-colors",
                                    previewPage === page ? "bg-[var(--surface-primary)] text-[var(--text-primary)]"
                                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-primary)] hover:text-[var(--text-primary)]",
                                  )}>
                            <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                            <span className="truncate">{page}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 内联预览 */}
                {previewPage && (
                  <div className="border-t border-[var(--border-default)] pt-3">
                    <div className="mb-1.5 truncate text-xs font-medium text-[var(--text-secondary)]">预览:{previewPage}</div>
                    <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3"
                         onClick={(e) => {
                           const a = (e.target as HTMLElement).closest("a");
                           if (!a) return;
                           const href = a.getAttribute("href") ?? "";
                           if (/^(https?:|mailto:|#)/.test(href) || href === "") return;
                           e.preventDefault(); e.stopPropagation();
                           let page = decodeURIComponent(href.replace(/^\.\//, "").split(/[?#]/)[0]);
                           if (page && !/\.[a-z0-9]+$/i.test(page)) page = `${page}.md`;
                           if (page) setPreviewPage(page);
                         }}>
                      {wikiLoading ? (
                        <div className="flex items-center justify-center py-8 text-[var(--text-tertiary)]"><Loader2 className="h-4 w-4 animate-spin" /></div>
                      ) : wikiError ? (
                        <p className="py-4 text-sm text-[var(--color-destructive)]">加载知识页失败,请稍后重试。</p>
                      ) : wikiPage ? (
                        <MarkdownRenderer content={wikiPage.content} />
                      ) : null}
                    </div>
                  </div>
                )}
                {selectedEntry.ingest_status !== "done" && selectedEntry.ingest_status !== "failed" && (
                  <p className="border-t border-[var(--border-default)] pt-3 text-xs text-[var(--text-tertiary)]">知识页构建中,完成后可预览。</p>
                )}
              </SurfacePanel>
            ) : (
              <SurfacePanel className="flex flex-col items-center justify-center gap-2 bg-[var(--surface-secondary)] px-6 py-16 text-center">
                <BookOpen className="h-8 w-8 text-[var(--text-tertiary)]" />
                <p className="text-sm text-[var(--text-secondary)]">从左侧选择一篇文档,查看其知识页与内容。</p>
              </SurfacePanel>
            )}
          </div>
```

- [ ] **Step 4: 「查看索引」走内联预览**

概览条里「查看索引」按钮的 onClick 改为设置预览(索引不属于某文档,直接设 previewPage;右栏预览区独立于 selectedEntry 也能显示索引 —— 见下方调整)。为让 index 能在右栏预览:把内联预览区从"依赖 selectedEntry"提为"selectedEntry 或 previewPage===index.md 时显示"。简化实现:「查看索引」onClick = `setPreviewPage("index.md")`;并在右栏渲染条件里,`selectedEntry` 为空但 `previewPage` 有值时,也渲染一个"仅预览"的 SurfacePanel(复用同一预览 JSX)。若判断此分支复杂,退而用现有 Dialog 仅承载 index.md 预览(标注在报告里)。

- [ ] **Step 5: 移除旧的独立预览 Dialog**

删除原来 return 末尾的 `<Dialog open={!!previewPage}>...</Dialog>`(预览已内联)。若 Step 4 选择保留 Dialog 仅供 index,则相应保留最小化版本。

- [ ] **Step 6: tsc + commit**

Run: `cd frontend && npx tsc --noEmit` → clean.
```bash
git add "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "refactor(knowledge): detail panel with wiki-page list + inline preview"
```

---

### Task 5: 窄屏详情抽屉 + 清理

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`

**Interfaces:**
- Produces: 窄屏(<xl)选中文档时详情以覆盖层展示;移除未使用的 import/变量。

- [ ] **Step 1: 窄屏详情抽屉**

右栏详情当前 `hidden xl:block`(窄屏不可见)。窄屏用一个受控覆盖层:选中且窄屏时,把右栏详情 JSX 复用进一个 Dialog(或固定定位覆盖层)。最简做法:抽出详情内容为一个局部 `const detailPanel = (...)`(在 Step 之前的 JSX 提取),桌面放 `hidden xl:block` 容器,窄屏放:
```tsx
      <Dialog open={!!selectedId && !!selectedEntry} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto xl:hidden">
          {detailPanel}
        </DialogContent>
      </Dialog>
```
桌面(xl)时该 Dialog 用 `xl:hidden` 保证不弹出(仅窄屏)。默认选中在窄屏不应自动弹窗 —— 因此窄屏抽屉的 open 条件用 `selectedId`(用户显式点击才设置),而非派生的 `selectedEntry`;桌面右栏仍用 `selectedEntry`(默认选中)。

注:若提取 `detailPanel` 变量在两处渲染导致 key/state 问题,改为两处各写一份相同 JSX 也可接受(标注报告)。

- [ ] **Step 2: 清理未使用符号**

检查并移除不再使用的 import(如 `ChevronDown`/`ChevronRight` 若已无展开;`ScrollText` 若查看索引改样式后不用则保留判断)与变量。`npx tsc --noEmit` + 目测无 lint 未使用告警。

- [ ] **Step 3: tsc + commit**

Run: `cd frontend && npx tsc --noEmit` → clean.
```bash
git add "frontend/src/app/(main)/knowledge/page.tsx"
git commit -m "refactor(knowledge): narrow-screen detail drawer + cleanup"
```

---

### Task 6(可选): 后端彻底移除 note

**Files:**
- Modify: `backend/app/api/knowledge.py`, `backend/app/knowledge/injection.py`
- Test: 现有 `backend/tests/test_api/test_knowledge.py` / `test_injection.py`

**Interfaces:**
- Produces: 移除 `AddBody.note`、`add_knowledge` 落 note、`_entry_to_dict["note"]`、`_legacy_listing_section` note 拼接。DB 列保留(不加 migration)。

- [ ] **Step 1: 确认调用面**

Run: `cd backend && grep -rnE "\.note|\"note\"|note=" app/ | grep -vE "notebook|footnote"`
确认所有 note 使用点(API + injection + entry_to_dict)。

- [ ] **Step 2: 移除 note 使用**

- `api/knowledge.py`:`AddBody` 删 `note`;`add_knowledge` 不再 `note=...`(用空串默认或删该赋值);`_entry_to_dict` 删 `"note"` 键。
- `injection.py`:`_legacy_listing_section` 删 `note = ...` 与拼接,行改为 `f"- [{e.id}] {label}"`。
- DB 模型 `note` 列**保留**(避免 migration;仅停止写入/读出)。

- [ ] **Step 3: 跑受影响测试**

Run: `cd backend && venv/bin/python -m pytest tests/test_api/test_knowledge.py tests/test_knowledge/test_injection.py -v`
若测试断言了 `note` 字段/输出,更新为新契约(报告说明)。
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/knowledge.py backend/app/knowledge/injection.py backend/tests
git commit -m "refactor(knowledge): drop unused note from API + legacy listing"
```

---

### Task 7: 真机验证

**Files:** none。

- [ ] **Step 1: tsc**

Run: `cd frontend && npx tsc --noEmit` → clean。

- [ ] **Step 2: 真机(dev 桌面端)**

重启/复用 dev 桌面端。验证:
1. 空库:左栏空态 + 右栏引导。
2. 顶部「添加文档」→ Dialog:提交飞书链接;上传本地文件;拖拽。均无备注输入。
3. 导入完成后点左栏卡片 → 右栏元信息 + 知识页列表 + 首个知识页内联预览。
4. 点不同知识页切换预览;`[[双链]]` 面板内跳转。
5. 概览条「查看索引」→ 预览 index.md。
6. 右栏「重新加载」;「删除」(删选中项后右栏回退到下一篇/空态)。
7. 窄屏(缩窗到 <xl):单列列表,点卡片弹详情抽屉,返回。

- [ ] **Step 3: Commit 修复(如有)**

---

## Self-Review 记录
- **Spec coverage:** 两栏骨架(T1)、添加 Dialog 去备注(T2)、可选中卡片精简操作(T3)、详情面板+内联预览+查看索引(T4)、窄屏抽屉+清理(T5)、后端去 note 可选(T6)、真机验证(T7)。均覆盖。
- **Placeholder scan:** 无 TBD;每步含完整代码或明确操作。T4 Step4/T5 Step1 给了主实现 + 明确的退化备选(标注报告),非占位。
- **Type/name consistency:** `selectedId`/`selectedEntry`/`previewPage`/`addOpen`/`isDragging`;hooks 名与现有一致;`ACTIVE_STATUSES`/`INGEST_STATUS_LABEL` 复用;删除保护条件与现有一致。任务顺序 T1→T5 递进(每步 tsc 绿),T6 可选独立,T7 收尾。
