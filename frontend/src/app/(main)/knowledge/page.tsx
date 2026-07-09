"use client";

import { ArrowLeft, BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api";
import {
  useAddKnowledge,
  useDeleteKnowledge,
  useKnowledge,
  usePatchKnowledge,
  type KnowledgeEntry,
} from "@/hooks/use-knowledge";

export default function KnowledgePage() {
  const { data: entries = [], isLoading } = useKnowledge();
  const addKnowledge = useAddKnowledge();
  const patchKnowledge = usePatchKnowledge();
  const deleteKnowledge = useDeleteKnowledge();

  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!url.trim() && !addKnowledge.isPending;

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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-chat)]">
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4 lg:px-7">
        <div className="mb-2 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" asChild>
            <Link href="/c/new">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <BookOpen className="h-5 w-5 text-[var(--text-secondary)]" />
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            知识库
          </h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          把飞书文档链接添加进来,分析时 AI 就能参考它们作为权威背景。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-7 scrollbar-auto">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
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
          </div>

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
                        <a
                          href={entry.feishu_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-sm font-medium text-[var(--text-primary)] hover:underline"
                        >
                          {entry.title || entry.feishu_url}
                        </a>
                        {entry.doc_type && (
                          <span className="shrink-0 rounded-md bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                            {entry.doc_type}
                          </span>
                        )}
                      </div>
                      {entry.note && (
                        <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                          {entry.note}
                        </p>
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
      </div>
    </div>
  );
}
