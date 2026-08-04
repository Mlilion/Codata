import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { sanitizeSheetHtml } from "./sheet-html";

/**
 * Regression tests for the xlsx-preview XSS.
 *
 * The payloads below are the ones confirmed to execute against the
 * pre-fix renderer (which passed `sheet_to_html` output straight to
 * `dangerouslySetInnerHTML`). They come from a *real* SheetJS conversion
 * rather than hand-written HTML, so the test still fails if a future
 * SheetJS version changes how it emits cell values.
 */

/** Convert cell values to the HTML SheetJS would hand the renderer. */
function sheetHtmlFor(rows: string[][]): string {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.utils.sheet_to_html(ws, { id: "xlsx-table", editable: false });
}

describe("sanitizeSheetHtml", () => {
  // The payload text itself survives as *escaped* text inside a cell — that
  // is fine and expected (a spreadsheet may legitimately contain markup-like
  // text). The security property is that it produces no live element and no
  // attribute, so assert on the parsed DOM rather than on the string.
  // The exact HTML xlsx 0.18.5 produced for a cell whose value is
  // `"><img src=x onerror=…>`: the raw value went into data-v unescaped, so
  // the attribute closed early and the img became a live element. 0.20.3
  // escapes data-v and no longer emits this, so it is pinned here as a
  // literal — the sanitiser must keep neutralising it regardless of which
  // SheetJS version is installed, in case a future release regresses.
  // Captured verbatim from xlsx@0.18.5.
  const VULNERABLE_0_18_5_OUTPUT =
    '<html><head><meta charset="utf-8"/><title>SheetJS Table Export</title>' +
    '</head><body><table id="xlsx-table"><tr><td data-t="s" data-v="">' +
    '<img src=x onerror="window.__XSS__=1">" id="xlsx-table-A1">' +
    "&quot;&gt;&lt;img src=x onerror=&quot;window.__XSS__=1&quot;&gt;" +
    "</td></tr></table></body></html>";

  it("neutralises the attribute-breaking img payload that used to execute", () => {
    // Precondition: the fixture carries an unescaped <img …onerror> that
    // escaped its attribute, so the test exercises the real bug rather than a
    // strawman. Asserted on the string — parsing it would have jsdom
    // construct an HTMLImageElement, which throws against this repo's
    // canvas stub (and would attempt a load in a real browser).
    expect(VULNERABLE_0_18_5_OUTPUT).toContain('<img src=x onerror="');

    const host = document.createElement("div");
    host.innerHTML = sanitizeSheetHtml(VULNERABLE_0_18_5_OUTPUT);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    // No element anywhere carries an event handler.
    for (const el of Array.from(host.querySelectorAll("*"))) {
      expect(el.getAttributeNames().filter((n) => n.startsWith("on"))).toEqual([]);
    }
  });

  it("escapes the cell value in data-v (xlsx >= 0.20.2 behaviour)", () => {
    // Guards the upgrade away from 0.18.5: if a future install regresses to a
    // version that leaks the raw value again, the sanitiser above still holds
    // the line, but this tells us the underlying library changed.
    const raw = sheetHtmlFor([['"><img src=x onerror="window.__XSS__=1">']]);
    expect(raw).not.toContain("<img src=x");
  });

  it("neutralises a payload that closes the table and appends markup", () => {
    const raw = sheetHtmlFor([
      ['</td></tr></table><img src=y onerror="window.__XSS__=2">'],
    ]);
    const host = document.createElement("div");
    host.innerHTML = sanitizeSheetHtml(raw);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    // Everything stayed inside the single rebuilt table — nothing escaped it.
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild?.tagName).toBe("TABLE");
  });

  it("produces markup that adds no live nodes or attributes when parsed", () => {
    const raw = sheetHtmlFor([['"><img src=x onerror="window.__XSS__=1">']]);
    const host = document.createElement("div");
    host.innerHTML = sanitizeSheetHtml(raw);

    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(host.querySelectorAll("script")).toHaveLength(0);
    // No cell keeps any attribute, so nothing is left to break out of.
    for (const td of Array.from(host.querySelectorAll("td"))) {
      expect(td.getAttributeNames()).toEqual([]);
    }
  });

  it("drops data-v, the attribute carrying the unescaped value", () => {
    const raw = sheetHtmlFor([["plain"]]);
    expect(raw).toContain("data-v");
    expect(sanitizeSheetHtml(raw)).not.toContain("data-v");
  });

  it("keeps ordinary cell text intact", () => {
    const clean = sanitizeSheetHtml(
      sheetHtmlFor([
        ["region", "revenue"],
        ["日本", "1234.5"],
      ]),
    );
    const host = document.createElement("div");
    host.innerHTML = clean;
    expect(Array.from(host.querySelectorAll("td")).map((td) => td.textContent)).toEqual(
      ["region", "revenue", "日本", "1234.5"],
    );
  });

  it("renders markup-looking text as text, not elements", () => {
    const clean = sanitizeSheetHtml(sheetHtmlFor([["<b>not bold</b>"]]));
    const host = document.createElement("div");
    host.innerHTML = clean;
    expect(host.querySelectorAll("b")).toHaveLength(0);
    expect(host.querySelector("td")?.textContent).toBe("<b>not bold</b>");
  });

  it("preserves merged-cell spans", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["merged", ""],
      ["a", "b"],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    const clean = sanitizeSheetHtml(XLSX.utils.sheet_to_html(ws, { id: "t" }));
    expect(clean).toContain("colspan");
  });

  it("returns an empty string when there is no table", () => {
    expect(sanitizeSheetHtml("<p>no table here</p>")).toBe("");
    expect(sanitizeSheetHtml("")).toBe("");
  });
});
