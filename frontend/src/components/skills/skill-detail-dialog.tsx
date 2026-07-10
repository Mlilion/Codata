"use client";

import { useEffect, useState } from "react";
import { Check, Code, Copy, FileText, RotateCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSkillDetail } from "@/hooks/use-plugins";
import type { SkillInfo } from "@/types/plugins";

const SOURCE_COLORS: Record<string, string> = {
  builtin: "bg-[var(--brand-soft)] text-[var(--text-accent)]",
  global: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  project: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  plugin: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
  bundled: "bg-[var(--brand-soft)] text-[var(--text-accent)]",
  custom: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
};

interface SkillDetailDialogProps {
  skill: SkillInfo | null;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: React.ReactNode;
}

export function SkillDetailDialog({
  skill,
  open = !!skill,
  onOpenChange,
  footer,
}: SkillDetailDialogProps) {
  const { t } = useTranslation("plugins");
  const { data, isLoading, isError, refetch } = useSkillDetail(skill?.name ?? null);
  const [copied, setCopied] = useState(false);
  const source = skill?.source ?? "bundled";
  const content = data?.content?.trim() ?? "";
  const tags = data?.tags?.length ? data.tags : (skill?.tags ?? []);

  useEffect(() => {
    setCopied(false);
  }, [skill?.name]);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[84vh] w-[calc(100vw-32px)] max-w-4xl grid-rows-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4 pr-12">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-tertiary)] text-[var(--text-secondary)]">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-mono text-sm leading-5 text-[var(--text-primary)]">
                {skill?.name ?? t("skillDetailTitle", { defaultValue: "Skill detail" })}
              </DialogTitle>
              <DialogDescription className="mt-1 line-clamp-2 text-xs">
                {data?.description ?? skill?.description ?? ""}
              </DialogDescription>
              {skill && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`text-ui-3xs px-1.5 py-0.5 rounded-full ${
                      SOURCE_COLORS[source] ?? SOURCE_COLORS.bundled
                    }`}
                  >
                    {skill.name.includes(":")
                      ? skill.name.split(":")[0]
                      : t(source, source)}
                  </span>
                  <span
                    className={`text-ui-3xs px-1.5 py-0.5 rounded-full ${
                      skill.enabled
                        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    {skill.enabled
                      ? t("skillEnabled", { defaultValue: "Enabled" })
                      : t("skillDisabled", { defaultValue: "Disabled" })}
                  </span>
                  {skill.is_expert && (
                    <span className="text-ui-3xs px-1.5 py-0.5 rounded-full bg-[var(--color-warning-soft)] text-[var(--color-warning)]">
                      {t("expertSkill", { defaultValue: "Expert skill" })}
                    </span>
                  )}
                  {tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="text-ui-3xs rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-[var(--text-tertiary)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-primary)]">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-5 py-2">
            <div
              className="flex min-w-0 items-center gap-2 text-ui-3xs text-[var(--text-tertiary)]"
              title={data?.location ?? skill?.location ?? "SKILL.md"}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate font-mono">
                {data?.location ?? skill?.location ?? "SKILL.md"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-ui-2xs"
              disabled={!content}
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3 w-3 mr-1" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              {copied
                ? t("copied", { defaultValue: "Copied" })
                : t("copyContent", { defaultValue: "Copy" })}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-[var(--surface-secondary)] px-4 py-4">
            {isLoading ? (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-4 rounded bg-[var(--surface-tertiary)] animate-pulse"
                  />
                ))}
              </div>
            ) : isError ? (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 text-center">
                <p className="text-xs text-[var(--text-tertiary)]">
                  {t("skillDetailLoadFailed", {
                    defaultValue: "Failed to load skill content.",
                  })}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-7 text-ui-2xs"
                  onClick={() => refetch()}
                >
                  <RotateCw className="h-3 w-3 mr-1" />
                  {t("retry", { defaultValue: "Retry" })}
                </Button>
              </div>
            ) : content ? (
              <SkillMarkdown content={content} />
            ) : (
              <p className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 text-xs text-[var(--text-tertiary)]">
                {t("skillDetailEmpty", {
                  defaultValue: "This skill has no readable content.",
                })}
              </p>
            )}
          </div>

          {footer && (
            <div className="shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4">
              {footer}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillMarkdown({ content }: { content: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-sm">
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-3">
        <Code className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span className="text-ui-3xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          SKILL.md
        </span>
      </div>
      <div className="skill-markdown prose max-w-none px-5 py-5 text-[var(--text-primary)]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            table: ({ children }) => (
              <div className="my-4 overflow-x-auto rounded-lg border border-[var(--border-default)]">
                <table>{children}</table>
              </div>
            ),
            pre: ({ children }) => (
              <pre className="my-4 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
                {children}
              </pre>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
