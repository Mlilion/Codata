"use client";

import { Search, Sparkles, Plus, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageContent, PageFrame, PageHeader } from "@/components/ui/page-frame";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SkillsTab } from "@/app/(main)/plugins/content";
import { useCreateSkill } from "@/hooks/use-plugins";

export default function SkillsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const createSkill = useCreateSkill();

  const canSubmit = !!(name.trim() && description.trim() && instructions.trim());

  const submit = () => {
    if (!canSubmit) return;
    createSkill.mutate(
      { name: name.trim(), description: description.trim(), instructions: instructions.trim() },
      {
        onSuccess: () => {
          toast.success("技能已创建");
          setCreateOpen(false);
          setName("");
          setDescription("");
          setInstructions("");
        },
        onError: () => toast.error("创建技能失败(可能同名已存在)"),
      },
    );
  };

  return (
    <PageFrame className="flex-1">
      <PageContent className="max-w-5xl lg:py-8">
        <PageHeader
          title="技能"
          description="管理内置技能、项目技能和插件技能，或把自己的分析方法沉淀成技能。"
          icon={Sparkles}
          backHref="/c/new"
          actions={
            <div className="flex w-full items-center gap-2 xl:w-auto">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索技能"
                className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-focus)]"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2.5 text-ui-2xs"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              新建技能
            </Button>
            </div>
          }
        />
        <SkillsTab search={search} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建技能</DialogTitle>
            <DialogDescription>
              把一套可复用的分析方法沉淀成技能。描述写清楚“什么时候用”,Agent 会在合适时自动调用。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              名称
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如:渠道留存分析"
                className="mt-1 h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
              />
            </label>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              描述(何时使用 —— 影响 Agent 何时触发)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="例如:当用户想分析各渠道的留存表现、定位流失严重的渠道时使用。"
                className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
              />
            </label>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              步骤 / 指令(技能正文)
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={7}
                placeholder={"1. 用 run_query 查各渠道次日/7日留存\n2. 用 chart_spec 出留存曲线\n3. 标注留存明显偏低的渠道并给出可能原因"}
                className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-heavy)]"
              />
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1.5" onClick={submit} disabled={!canSubmit || createSkill.isPending}>
              {createSkill.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </PageContent>
    </PageFrame>
  );
}
