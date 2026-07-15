"""Prompt that drives a headless agent to ingest one source into the wiki."""
from __future__ import annotations


def build_ingest_prompt(entry, raw_rel_path: str, wiki_dir_abs: str) -> str:
    title = entry.title or entry.feishu_url
    return f"""你是知识库维护助手。把一份新资料整合进本地 Markdown wiki。

## 资料
- 标题:{title}
- 来源:{entry.feishu_url}
- 原文文件(只读):{raw_rel_path}(相对 wiki 根目录,绝对路径在 wiki 目录的上一级 raw/ 下)
- entry_id:{entry.id}

## wiki 目录(用文件工具读写这里)
{wiki_dir_abs}
结构约定:
- `index.md` — 分类索引(## 资料摘要 / ## 实体 / ## 概念 三个表格),每行 `| [标题](页面.md) | 一句话摘要 |`。这是精度关键,摘要要精准、有区分度。
- `source-<英文slug>.md` — 本篇资料的摘要页(YAML frontmatter: title/source/entry_id/type=source)。
- `<实体slug>.md` / `<概念slug>.md` — 实体页/概念页(frontmatter type=entity|concept)。
- `log.md` — 追加日志。

## 你的步骤(用 read 先读原文,用 read/write/edit 操作 wiki)
1. 读原文 raw 文件,提炼关键信息。
2. 写 `source-<slug>.md` 摘要页(标题、要点、涉及的实体/概念)。
3. 为文中重要实体/概念创建或**更新**对应页面;已存在则用 edit 合并新信息,不要覆盖。
4. 页面之间用 `[[页面slug]]` 双链互相引用。
5. 更新 `index.md`:把新页面加进对应分类表格(已存在的条目更新其摘要)。
6. 在 `log.md` 末尾追加一行:`## [{entry.id}] ingest | {title}`。
7. 若新资料与已有页面内容矛盾,在相关页面用 `> ⚠️ 矛盾:...` 标注,不要静默覆盖。

只操作上述 wiki 目录内的文件。完成后简述你创建/更新了哪些页面。"""
