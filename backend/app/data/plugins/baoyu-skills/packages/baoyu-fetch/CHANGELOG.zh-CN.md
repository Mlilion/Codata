# 更新日志

[English](./CHANGELOG.md) | 简体中文

格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [0.1.2] - 2026-04-21

### 变更

- 将 Defuddle 升级到 0.17.0、jsdom 升级到 29.0.2，用于通用页面提取。
- 新增 `@xmldom/xmldom` override，使 Defuddle 的可选 MathML 依赖链保持在无漏洞版本。

### 修复

- 修复 X/Twitter 单条内容和 X Article 的视频提取逻辑，改为选择最高码率 MP4 变体，而不是预览图 URL。
- 修复 X Article 媒体渲染，视频实体现在输出为 `[video](...)` 链接，而不是图片嵌入。

## [0.1.1] - 2026-03-27

### 新增

- 新增 `hn` adapter，可提取 Hacker News 帖子与评论串。
- 新增 `--download-media` 和 `--media-dir`，可下载提取出的媒体文件并重写
  Markdown 链接。
- 通用提取链路新增 Defuddle 首选路径，并保留 Readability + HTML to Markdown
  作为回退方案。
- 新增登录/验证场景的交互等待模式，支持手动验证接管和 force wait 自动恢复。
- 新增 `--format markdown|json`，同时保留 `--json` 作为兼容别名。
- 新增基于 Changesets 的 npm 发版自动化流程。

### 变更

- 将包名和 CLI 名称从 `baoyu-markdown` 更名为 `baoyu-fetch`。
- npm 发布物改为直接以 Bun 执行 `src/cli.ts`，不再附带预构建的 `dist`。
- 强化 X 提取链路，覆盖 thread、article、note tweet、embed、图片 URL、
  登录态判断与媒体元数据。
- 增强 YouTube transcript 提取，并规范化 Markdown 图片输出。

### 修复

- 修复 X note tweet 的 URL 展开问题。
- 修复媒体下载前的 URL 规范化问题，包括 Substack 媒体链接。
- 修复交互模式的前台行为，使手动登录/验证流程更稳定。

## [0.1.0] - 2026-03-25

### 新增

- `baoyu-markdown` 的首个公开版本。
- 新增 Chrome CDP 会话管理、受控 tab 与网络日志采集能力。
- 新增内置 `x`、`youtube` 与通用 fallback adapters。
- 新增 X article 解析、X 单条内容提取，以及 YouTube transcript 提取。
- 新增 Markdown 渲染与文档元数据输出，并提供文件输出、JSON 输出、调试导出、
  自定义 Chrome 连接、headless 模式和超时控制等 CLI 能力。
