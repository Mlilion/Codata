"use client";

import {
  BookOpen,
  Database,
  FileStack,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/artifacts/renderers/markdown-renderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageContent, PageFrame, PageHeader, SurfacePanel } from "@/components/ui/page-frame";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  useAddKnowledge,
  useDeleteKnowledge,
  useKnowledge,
  useKnowledgeCapacity,
  usePatchKnowledge,
  useReingestKnowledge,
  useUploadKnowledge,
  useWikiPage,
  type KnowledgeEntry,
} from "@/hooks/use-knowledge";

const UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.md,.markdown,.txt";

const INGEST_STATUS_LABEL: Record<KnowledgeEntry["ingest_status"], string> = {
  pending: "排队中",
  extracting: "提取正文中",
  building: "构建知识页中",
  indexing: "更新索引中",
  processing: "处理中",
  deleting: "清理中",
  done: "已就绪",
  failed: "失败",
};

const ACTIVE_STATUSES = new Set<KnowledgeEntry["ingest_status"]>([
  "pending",
  "extracting",
  "building",
  "indexing",
  "processing",
  "deleting",
]);

// active first (处理中置顶), then done, then failed
const STATUS_ORDER = (status: KnowledgeEntry["ingest_status"]): number => {
  if (ACTIVE_STATUSES.has(status)) return 0;
  if (status === "done") return 1;
  return 2;
};

export default function KnowledgePage() {
  const { data: entries = [], isLoading } = useKnowledge();
  const { data: cap } = useKnowledgeCapacity();
  const addKnowledge = useAddKnowledge();
  const patchKnowledge = usePatchKnowledge();
  const deleteKnowledge = useDeleteKnowledge();
  const reingestKnowledge = useReingestKnowledge();
  const uploadKnowledge = useUploadKnowledge();

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: wikiPage,
    isLoading: wikiLoading,
    isError: wikiError,
  } = useWikiPage(previewPage);

  const canSubmit = !!url.trim() && !addKnowledge.isPending;

  const doneCount = entries.filter((e) => e.ingest_status === "done").length;
  const activeCount = entries.filter((e) => ACTIVE_STATUSES.has(e.ingest_status)).length;

  const sortedEntries = [...entries].sort(
    (a, b) => STATUS_ORDER(a.ingest_status) - STATUS_ORDER(b.ingest_status),
  );

  const selectedEntry =
    sortedEntries.find((e) => e.id === selectedId) ??
    sortedEntries.find((e) => e.ingest_status === "done") ??
    sortedEntries[0] ??
    null;

  const pct = cap ? Math.min(100, Math.round((cap.index_chars / cap.max_chars) * 100)) : 0;
  const barColor =
    pct >= 100
      ? "var(--color-destructive)"
      : pct >= 80
        ? "var(--color-warning)"
        : "var(--data-accent)";

  const upload = (file: File) => {
    setError(null);
    uploadKnowledge.mutate(file, {
      onSuccess: () => {
        toast.success("已上传到知识库");
        setAddOpen(false);
      },
      onError: (err) => toast.error(apiErrorMessage(err, "上传失败")),
    });
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploadKnowledge.isPending) return;
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

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

  const toggle = (entry: KnowledgeEntry) => {
    patchKnowledge.mutate(
      { id: entry.id, enabled: !entry.enabled },
      {
        onError: (err) => toast.error(apiErrorMessage(err, "更新失败")),
      },
    );
  };

  const remove = (entry: KnowledgeEntry) => {
    deleteKnowledge.mutate(entry.id, {
      onSuccess: () => toast.success("已删除"),
      onError: (err) => toast.error(apiErrorMessage(err, "删除失败")),
    });
  };

  const reingest = (entry: KnowledgeEntry) => {
    reingestKnowledge.mutate(entry.id, {
      onSuccess: () => toast.success("已重新排队处理"),
      onError: (err) => toast.error(apiErrorMessage(err, "重试失败")),
    });
  };

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
        {/* 概览 + 容量条(横跨两栏) */}
        <SurfacePanel className="mb-4 bg-[var(--surface-secondary)] p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                <FileStack className="h-4 w-4 text-[var(--text-tertiary)]" />
                共 <span className="font-semibold text-[var(--text-primary)]">{entries.length}</span> 篇
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--color-success)]">{doneCount}</span> 已就绪
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                {activeCount > 0 && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--data-accent)]" />
                )}
                <span className="font-semibold text-[var(--text-primary)]">{activeCount}</span> 处理中
              </span>
            </div>
            {cap && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-primary)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                  <Database className="h-3 w-3 shrink-0" />
                  <span>
                    知识库索引 {cap.index_chars.toLocaleString()}/{cap.max_chars.toLocaleString()} 字符(约{" "}
                    {cap.approx_docs} 篇)
                  </span>
                  {pct >= 80 && (
                    <span className="text-[var(--color-warning)]">
                      · 接近上限,靠后文档可能不被检索
                    </span>
                  )}
                  {cap.index_chars > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreviewPage("index.md")}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-[var(--data-accent)] hover:underline"
                    >
                      <ScrollText className="h-3 w-3 shrink-0" />
                      查看索引
                    </button>
                  )}
                </div>
              </div>
            )}
        </SurfacePanel>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            {/* 左栏列表 —— Task 3 重写;先临时保留现有 <ul> 列表渲染 */}
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-6 py-12 text-center">
                <BookOpen className="mx-auto mb-3 h-8 w-8 text-[var(--text-tertiary)]" />
                <p className="text-sm text-[var(--text-secondary)]">
                  还没有知识文档,粘贴一个飞书链接开始。
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedEntries.map((entry) => {
                  const isActive = ACTIVE_STATUSES.has(entry.ingest_status);
                  return (
                    <li
                      key={entry.id}
                      className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {entry.source_type === "file" ? (
                              <span className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium text-[var(--text-primary)]">
                                <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                                <span className="truncate">
                                  {entry.title || entry.source_name}
                                </span>
                              </span>
                            ) : (
                              <a
                                href={entry.feishu_url ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-sm font-medium text-[var(--text-primary)] hover:underline"
                              >
                                {entry.title || entry.feishu_url}
                              </a>
                            )}
                            {entry.doc_type && (
                              <span className="shrink-0 rounded-md bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                                {entry.doc_type}
                              </span>
                            )}
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
                          </div>
                          {entry.note && (
                            <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                              {entry.note}
                            </p>
                          )}
                          {entry.ingest_status === "failed" && (
                            <div className="mt-0.5 flex items-center gap-2">
                              {entry.ingest_error && (
                                <span className="min-w-0 truncate text-xs text-[var(--text-tertiary)]">
                                  {entry.ingest_error}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => reingest(entry)}
                                disabled={reingestKnowledge.isPending}
                                className="shrink-0 text-xs font-medium text-[var(--data-accent)] hover:underline disabled:opacity-50"
                              >
                                重试
                              </button>
                            </div>
                          )}
                        </div>
                        <Button
                          variant={entry.enabled ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => toggle(entry)}
                          disabled={patchKnowledge.isPending}
                          className="shrink-0"
                        >
                          {entry.enabled ? "已启用" : "已停用"}
                        </Button>
                        {entry.ingest_status === "done" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => reingest(entry)}
                            disabled={reingestKnowledge.isPending}
                            className="h-8 w-8 shrink-0 text-[var(--text-tertiary)] hover:text-[var(--data-accent)]"
                            aria-label="重新加载"
                            title="重新加载(飞书/文件更新后刷新)"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(entry)}
                          disabled={deleteKnowledge.isPending || ACTIVE_STATUSES.has(entry.ingest_status)}
                          className="h-8 w-8 shrink-0 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)]"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="hidden min-w-0 xl:block">
            {/* 右栏详情 —— Task 4 */}
          </div>
        </div>
      </PageContent>

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

      <Dialog open={!!previewPage} onOpenChange={(o) => !o && setPreviewPage(null)}>
        <DialogContent className="max-h-[70vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate">{previewPage}</DialogTitle>
          </DialogHeader>
          {wikiLoading ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : wikiError ? (
            <p className="py-6 text-sm text-[var(--color-destructive)]">
              加载知识页失败,请稍后重试。
            </p>
          ) : (
            <div
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest("a");
                if (!a) return;
                const href = a.getAttribute("href") ?? "";
                // only intercept relative, in-wiki links (not http/https/mailto/#)
                if (/^(https?:|mailto:|#)/.test(href) || href === "") return;
                e.preventDefault();
                e.stopPropagation();
                // strip any leading ./ and hash/query; add .md if no extension
                let page = decodeURIComponent(
                  href.replace(/^\.\//, "").split(/[?#]/)[0],
                );
                if (page && !/\.[a-z0-9]+$/i.test(page)) page = `${page}.md`;
                if (page) setPreviewPage(page);
              }}
            >
              {wikiPage ? <MarkdownRenderer content={wikiPage.content} /> : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
