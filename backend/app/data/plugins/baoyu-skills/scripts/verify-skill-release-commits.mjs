#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import {
  formatSkillReleaseFailures,
  validateSkillReleaseCommit,
} from "./lib/skill-release-guard.mjs";

const execFileAsync = promisify(execFile);
const ZERO_SHA = /^0{40}$/;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const range = await resolveRange(options);
  const commits = await listCommits(range);

  const failures = [];
  for (const commit of commits) {
    const [subject, paths] = await Promise.all([readCommitSubject(commit), readCommitPaths(commit)]);
    failures.push(...validateSkillReleaseCommit({ commit, subject, paths }));
  }

  if (failures.length > 0) {
    console.error(formatSkillReleaseFailures(failures));
    process.exit(1);
  }

  console.log(`Skill release commit check passed (${commits.length} commit${commits.length === 1 ? "" : "s"} checked).`);
}

function parseArgs(argv) {
  const options = {
    base: "",
    head: "HEAD",
    range: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      options.base = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--head") {
      options.head = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--range") {
      options.range = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log(`Usage: verify-skill-release-commits.mjs [--base <rev> --head <rev> | --range <rev-range>]

Checks non-merge commits in the selected range. Any commit that touches
skills/<name>/** must use a Conventional Commit subject, for example:
  fix(baoyu-post-to-wechat): handle WeChat editor focus

Without explicit arguments, GitHub Actions event metadata is used when
available. Otherwise the fallback range is HEAD^..HEAD.`);
}

async function resolveRange(options) {
  if (options.range) {
    return { args: [options.range], label: options.range };
  }

  if (options.base) {
    return {
      args: [`${options.base}..${options.head || "HEAD"}`],
      label: `${options.base}..${options.head || "HEAD"}`,
    };
  }

  const githubRange = await resolveGitHubRange();
  if (githubRange) return githubRange;

  return { args: ["HEAD^..HEAD"], label: "HEAD^..HEAD" };
}

async function resolveGitHubRange() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  let event = null;
  try {
    event = JSON.parse(await fs.readFile(eventPath, "utf8"));
  } catch {
    return null;
  }

  if (event?.pull_request?.base?.sha) {
    const base = event.pull_request.base.sha;
    const head = process.env.GITHUB_SHA || "HEAD";
    return { args: [`${base}..${head}`], label: `${base}..${head}` };
  }

  if (event?.before && !ZERO_SHA.test(event.before)) {
    const head = event.after || process.env.GITHUB_SHA || "HEAD";
    return { args: [`${event.before}..${head}`], label: `${event.before}..${head}` };
  }

  return null;
}

async function listCommits(range) {
  const output = await git(["rev-list", "--no-merges", "--reverse", ...range.args]);
  return output ? output.split("\n").filter(Boolean) : [];
}

async function readCommitSubject(commit) {
  return git(["log", "-1", "--format=%s", commit]);
}

async function readCommitPaths(commit) {
  const output = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commit]);
  return output ? output.split("\n").filter(Boolean) : [];
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
