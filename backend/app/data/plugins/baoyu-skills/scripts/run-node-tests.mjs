import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const TEST_FILE_PATTERN = /\.test\.(?:[cm]?[jt]s|tsx)$/;
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const BUN_TEST_IMPORT_PATTERN = /from\s+["']bun:test["']/;

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }

      files.push(...(await collectTestFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function isNodeCompatibleTest(filePath) {
  const source = await readFile(filePath, "utf8");
  return !BUN_TEST_IMPORT_PATTERN.test(source);
}

const allTestFiles = await collectTestFiles(ROOT_DIR);
const runnableTestFiles = [];

for (const filePath of allTestFiles.sort()) {
  if (await isNodeCompatibleTest(filePath)) {
    runnableTestFiles.push(filePath);
  }
}

if (runnableTestFiles.length === 0) {
  console.error("No Node-compatible test files found.");
  process.exit(1);
}

const forwardedArgs = process.argv.slice(2);
const nodeArgs = ["--import", "tsx", ...forwardedArgs, "--test", ...runnableTestFiles];
const child = spawn(process.execPath, nodeArgs, { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
