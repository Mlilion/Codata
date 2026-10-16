import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireAsset(sourcePath, label, type) {
  let stat;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    throw new Error(`Missing required PDF.js ${label}: ${sourcePath}`);
  }
  if (type === "file" ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error(`Invalid PDF.js ${label} (expected a ${type}): ${sourcePath}`);
  }
}

export function syncPdfAssets({
  pdfjsDistDir = path.join(frontendDir, "node_modules", "pdfjs-dist"),
  publicDir = path.join(frontendDir, "public"),
} = {}) {
  const workerSource = path.join(pdfjsDistDir, "build", "pdf.worker.min.mjs");
  const cmapsSource = path.join(pdfjsDistDir, "cmaps");
  const fontsSource = path.join(pdfjsDistDir, "standard_fonts");
  requireAsset(workerSource, "worker", "file");
  requireAsset(cmapsSource, "cmaps directory", "directory");
  requireAsset(fontsSource, "standard_fonts directory", "directory");

  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(workerSource, path.join(publicDir, "pdf.worker.min.mjs"));
  for (const [source, name] of [
    [cmapsSource, "cmaps"],
    [fontsSource, "standard_fonts"],
  ]) {
    const destination = path.join(publicDir, name);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    syncPdfAssets();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
