import fs from "node:fs";
import path from "node:path";

const excludedDirectories = new Set([
  ".git", "node_modules", ".next", "out", "dist", "build", "target",
  "venv", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".ruff_cache", ".codata", "test-results", "playwright-report",
]);

export function sourceFiles(root = process.cwd()) {
  const files = [];
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
        visit(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  visit(root, "");
  return files.sort();
}
