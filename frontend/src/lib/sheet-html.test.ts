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
  it("strips the attribute-breaking img payload that used to execute", () => {
    const raw = sheetHtmlFor([['"><img src=x onerror="window.__XSS__=1">']]);

    // Precondition: SheetJS really does leak the raw value into data-v, so
    // this test is exercising the actual bug and not a strawman.
    expect(raw).toContain("<img src=x");

    const host = document.createElement("div");
    host.innerHTML = sanitizeSheetHtml(raw);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    // No element anywhere carries an event handler.
    for (const el of Array.from(host.querySelectorAll("*"))) {
      expect(el.getAttributeNames().filter((n) => n.startsWith("on"))).toEqual([]);
    }
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
