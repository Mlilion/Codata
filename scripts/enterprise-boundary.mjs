import fs from "node:fs";
import path from "node:path";
import { sourceFiles } from "./source-files.mjs";

const excludedFiles = new Set([
  "scripts/enterprise-boundary.mjs",
  "scripts/open-source-enterprise-boundary.test.mjs",
]);
const textExtensions = /\.(py|txt|ts|tsx|js|jsx|rs|json|toml|yaml|yml|mjs|md|html|spec|example)$/;
const forbiddenContent = [
  /schneider-electric\.com/i,
  /datasage\.flow\.chat/i,
  /atlassian_schneider/i,
  /codata_atlassian_mcp/i,
  /(?:connector_id\s*[!=]=\s*["']atlassian|["']connector_id["']\s*:\s*["']atlassian)/,
  /sap[_-](?:bex|browser)/i,
  /SapBex|SapBrowser/,
  /TEMP_ZSE_|MDDX-|KaonRouter|kaon\//i,
  /公司默认|公司 Atlassian/,
  /\b10\.155\.100\.91\b/,
  /\bCodataAdmin\b/,
];

export function enterpriseFindings(root = process.cwd()) {
  const findings = [];
  for (const file of sourceFiles(root)) {
    if (excludedFiles.has(file) || !textExtensions.test(file)) continue;
    const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenContent.some((pattern) => pattern.test(line))) {
        findings.push(`${file}:${index + 1}`);
      }
    });
  }
  for (const file of ["backend/app/data/connectors.json", "backend/app/data/plugins/data/.mcp.json"]) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const config = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    if (Object.keys(file.endsWith(".mcp.json") ? config.mcpServers : config).length) {
      findings.push(`${file}: preconfigured services must not be shipped`);
    }
  }
  return findings;
}
