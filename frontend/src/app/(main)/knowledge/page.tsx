"use client";

import { BookOpen, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageContent, PageFrame, PageHeader, SurfacePanel } from "@/components/ui/page-frame";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  useAddKnowledge,
  useDeleteKnowledge,
  useKnowledge,
  usePatchKnowledge,
  useReingestKnowledge,
  useUploadKnowledge,
  type KnowledgeEntry,
} from "@/hooks/use-knowledge";

const UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.md,.markdown,.txt";

const INGEST_STATUS_LABEL: Record<KnowledgeEntry["ingest_status"], string> = {
  pending: "排队中",
  extracting: "处理中",
  building: "处理中",
  indexing: "处理中",
  processing: "处理中",
  done: "已就绪",
  failed: "失败",
};

export default function KnowledgePage() {
  const { data: entries = [], isLoading } = useKnowledge();
  const addKnowledge = useAddKnowledge();
  const patchKnowledge = usePatchKnowledge();
  const deleteKnowledge = useDeleteKnowledge();
  const reingestKnowledge = useReingestKnowledge();
  const uploadKnowledge = useUploadKnowledge();

  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = !!url.trim() && !addKnowledge.isPending;

  const upload = (file: File) => {
    setError(null);
    uploadKnowledge.mutate(file, {
      onSuccess: () => toast.success("已上传到知识库"),
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
      { feishu_url: url.trim(), note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("已添加到知识库");
          setUrl("");
          setNote("");
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
      <PageContent className="max-w-4xl lg:py-8">
        <PageHeader
          title="知识库"
          description="把飞书文档链接添加进来，分析时 AI 就能参考它们作为权威背景。"
          icon={BookOpen}
          backHref="/c/new"
        />
        <div className="mx-auto max-w-3xl">
          <SurfacePanel
            className={cn(
              "bg-[var(--surface-secondary)] p-4 transition-colors",
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="粘贴飞书文档链接,如 https://xxx.feishu.cn/docx/..."
                className="h-10 flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-focus)]"
              />
              <Button onClick={submit} disabled={!canSubmit} className="shrink-0 gap-1.5">
                {addKnowledge.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                添加
              </Button>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="备注(可选):这篇文档讲什么,帮助 AI 判断何时用它"
              className="mt-2 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-focus)]"
            />
            {error && <p className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
            <div className="mt-3 flex items-center gap-2 border-t border-[var(--border-default)] pt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                onChange={onFileSelected}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadKnowledge.isPending}
                className="shrink-0 gap-1.5"
              >
                {uploadKnowledge.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                上传文件
              </Button>
              <span className="text-xs text-[var(--text-tertiary)]">
                或把本地文件拖到这里(PDF、Word、Excel、PPT、Markdown、TXT)
              </span>
            </div>
          </SurfacePanel>

          <div className="mt-5">
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
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3"
                  >
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
                            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                            entry.ingest_status === "done"
                              ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                              : entry.ingest_status === "failed"
                                ? "bg-[var(--color-destructive-soft)] text-[var(--color-destructive)]"
                                : "bg-[var(--surface-primary)] text-[var(--text-tertiary)]",
                          )}
                        >
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(entry)}
                      disabled={deleteKnowledge.isPending}
                      className="h-8 w-8 shrink-0 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)]"
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PageContent>
    </PageFrame>
  );
}
