import { createHash } from "node:crypto";
import { Marked, type Tokens } from "marked";

export const MERMAID_VERSION = "10.9.1";

export interface MermaidBlock {
  raw: string;
  code: string;
  infoString: string;
}

export interface HashMermaidInput {
  code: string;
  theme?: string;
  scale?: number;
  background?: string;
  minWidth?: number;
  version?: string;
}

export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lexer = new Marked({ breaks: true });
  const tokens = lexer.lexer(markdown);
  walkTokens(tokens, (token) => {
    if (token.type !== "code") return;
    const codeToken = token as Tokens.Code;
    const lang = (codeToken.lang ?? "").trim();
    if (!lang.startsWith("mermaid")) return;
    const infoString = lang.slice("mermaid".length).trim();
    const code = codeToken.text ?? "";
    if (code.trim() === "") return;
    blocks.push({
      raw: codeToken.raw,
      code,
      infoString,
    });
  });
  return blocks;
}

export function replaceMermaidBlocks(
  markdown: string,
  replacements: Map<string, string>,
): string {
  let result = markdown;
  for (const [raw, replacement] of replacements) {
    if (!raw || replacement === undefined) continue;
    result = result.split(raw).join(replacement);
  }
  return result;
}

export function hashMermaidCode(input: HashMermaidInput): string {
  const payload = JSON.stringify({
    code: input.code.replace(/\s+$/g, ""),
    theme: input.theme ?? "default",
    scale: input.scale ?? 2,
    minWidth: input.minWidth ?? null,
    background: input.background ?? "white",
    version: input.version ?? MERMAID_VERSION,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

type AnyToken = { type?: string; tokens?: AnyToken[]; items?: AnyToken[] };

function walkTokens(tokens: AnyToken[], visit: (token: AnyToken) => void): void {
  for (const token of tokens) {
    visit(token);
    if (Array.isArray(token.tokens)) walkTokens(token.tokens, visit);
    if (Array.isArray(token.items)) walkTokens(token.items, visit);
  }
}
