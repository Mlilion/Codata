# Connectors

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~data warehouse` might mean Snowflake, BigQuery, or any other warehouse with an MCP server.

Plugins are **tool-agnostic** — they describe workflows in terms of categories (data warehouse, notebook, product analytics, etc.) rather than specific products. The bundled `.mcp.json` is empty. Configure your own MCP servers; no service connections or credentials are included.

## Connectors for this plugin

| Category | Placeholder | Example user-provided services |
|----------|-------------|-------------------------------|
| Data warehouse | `~~data warehouse` | PostgreSQL, MySQL, Snowflake, BigQuery |
| Notebook | `~~notebook` | Jupyter, Deepnote, Observable |
| Product analytics | `~~product analytics` | Amplitude, Mixpanel, Heap |
| Project tracker | `~~project tracker` | Linear, Asana |
