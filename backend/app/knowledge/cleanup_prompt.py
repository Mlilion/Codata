"""Prompt that drives a headless agent to remove one source from the wiki."""
from __future__ import annotations


def build_cleanup_prompt(entry, source_page: str | None, wiki_dir_abs: str) -> str:
    title = entry.title or entry.feishu_url or entry.id
    anchor = (
        f"- 它的 source 摘要页:{source_page}"
        if source_page
        else "- (未找到该资料的 source 摘要页,请根据 entry_id 在 wiki 中定位其残留内容)"
    )
    return f"""你是知识库维护助手。一份资料被移除,请把它从本地 Markdown wiki 中干净地摘除。

## 被移除的资料
- 标题:{title}
- entry_id:{entry.id}
{anchor}

## wiki 目录(用文件工具读写这里)
{wiki_dir_abs}
结构约定:
- `index.md` — 分类索引(## 资料摘要 / ## 实体 / ## 概念 三个表格)。这是精度关键。
- `source-<slug>.md` — 每篇资料的摘要页。
- `<实体slug>.md` / `<概念slug>.md` — 实体页/概念页,页间用 `[[页面slug]]` 双链引用。
- `log.md` — 追加日志。

## 你的步骤(先 read 判断,再 write/edit/删除)
1. 读该资料的 source 页,了解它引入了哪些实体/概念页。
2. 删除这个 source 页(它是该资料独有的)。
3. 对它引用过的每个实体/概念页,用 grep 检查是否还有**其他**页面通过 `[[反向链]]` 引用它:
   - 仍被其他资料引用 → 保留该页,只删除其中专属于本资料的段落/矛盾标注。
   - 已无任何其他引用(孤儿) → 删除整页。
4. 更新 `index.md`:移除已删页面对应的行;保留页的摘要若因删段而变化,同步更新。
5. 在 `log.md` 末尾追加一行:`## [{entry.id}] remove | {title}`。
6. 绝不删除 `index.md` / `log.md` 本身,不动与本资料无关的页面。

只操作上述 wiki 目录内的文件。完成后简述你删除/保留了哪些页面及理由。"""
