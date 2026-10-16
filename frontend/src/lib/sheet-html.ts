/**
 * Sanitiser for SheetJS `sheet_to_html` output.
 *
 * `sheet_to_html` escapes a cell's visible *text* but writes the raw cell
 * value into the `data-v` attribute:
 *
 *   <td data-t="s" data-v="<img src=x onerror=alert(1)>" …>&lt;img …&gt;</td>
 *
 * so a cell whose value is `"><img src=x onerror=…>` closes the attribute and
 * injects live markup. React does not sanitise `dangerouslySetInnerHTML`, so
 * that markup executes.
 *
 * Lives in lib/ rather than beside the renderer so it can be unit-tested
 * without mounting a React tree.
 */

/**
 * Rebuild a SheetJS table as inert markup safe for `dangerouslySetInnerHTML`.
 *
 * Parses with DOMParser — which builds an inert document: no scripts run and
 * no load/error handlers fire — then keeps only the table structure and each
 * cell's textContent. Attributes are dropped wholesale (the renderer reads
 * none of them), so no attribute remains to break out of. `colspan`/`rowspan`
 * are re-set from the parsed values to preserve layout.
 *
 * Returns "" when the input has no table.
 */
export function sanitizeSheetHtml(rawHtml: string): string {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const table = doc.querySelector("table");
  if (!table) return "";

  const out = doc.createElement("table");
  for (const row of Array.from(table.rows)) {
    const tr = doc.createElement("tr");
    for (const cell of Array.from(row.cells)) {
      const td = doc.createElement(cell.tagName.toLowerCase() === "th" ? "th" : "td");
      // Assigning textContent escapes on serialisation, so cell text that
      // looks like markup stays text.
      td.textContent = cell.textContent ?? "";
      if (cell.colSpan > 1) td.setAttribute("colspan", String(cell.colSpan));
      if (cell.rowSpan > 1) td.setAttribute("rowspan", String(cell.rowSpan));
      tr.appendChild(td);
    }
    out.appendChild(tr);
  }
  return out.outerHTML;
}
