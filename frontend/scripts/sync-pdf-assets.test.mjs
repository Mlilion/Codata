import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";

import { syncPdfAssets } from "./sync-pdf-assets.mjs";

const scratchRoot = path.resolve(`.test-sync-pdf-assets-${process.pid}-${randomUUID()}`);

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

after(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

test("replaces the PDF worker and synchronizes only its two public asset directories", () => {
  const pdfjsDistDir = path.join(scratchRoot, "node_modules", "pdfjs-dist");
  const publicDir = path.join(scratchRoot, "public");
  writeFile(path.join(pdfjsDistDir, "build", "pdf.worker.min.mjs"), "new worker");
  writeFile(path.join(pdfjsDistDir, "cmaps", "new.cmap"), "new cmap");
  writeFile(path.join(pdfjsDistDir, "standard_fonts", "new.pfb"), "new font");
  writeFile(path.join(publicDir, "pdf.worker.min.mjs"), "old worker");
  writeFile(path.join(publicDir, "cmaps", "stale.cmap"), "stale");
  writeFile(path.join(publicDir, "standard_fonts", "stale.pfb"), "stale");
  writeFile(path.join(publicDir, "keep.txt"), "preserve");

  syncPdfAssets({ pdfjsDistDir, publicDir });

  assert.equal(fs.readFileSync(path.join(publicDir, "pdf.worker.min.mjs"), "utf8"), "new worker");
  assert.equal(fs.readFileSync(path.join(publicDir, "cmaps", "new.cmap"), "utf8"), "new cmap");
  assert.equal(fs.readFileSync(path.join(publicDir, "standard_fonts", "new.pfb"), "utf8"), "new font");
  assert.equal(fs.existsSync(path.join(publicDir, "cmaps", "stale.cmap")), false);
  assert.equal(fs.existsSync(path.join(publicDir, "standard_fonts", "stale.pfb")), false);
  assert.equal(fs.readFileSync(path.join(publicDir, "keep.txt"), "utf8"), "preserve");
});

test("reports a missing PDF.js asset and leaves public files untouched", () => {
  const pdfjsDistDir = path.join(scratchRoot, "incomplete", "pdfjs-dist");
  const publicDir = path.join(scratchRoot, "incomplete", "public");
  writeFile(path.join(publicDir, "keep.txt"), "preserve");
  writeFile(path.join(pdfjsDistDir, "build", "pdf.worker.min.mjs"), "worker");
  writeFile(path.join(pdfjsDistDir, "cmaps", "map.cmap"), "map");

  assert.throws(
    () => syncPdfAssets({ pdfjsDistDir, publicDir }),
    /Missing required PDF\.js standard_fonts directory:/,
  );
  assert.equal(fs.readFileSync(path.join(publicDir, "keep.txt"), "utf8"), "preserve");
  assert.equal(fs.existsSync(path.join(publicDir, "pdf.worker.min.mjs")), false);
});
