import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyOutput, verifyImageGenWasInvoked, findCpToTarget } from "./validator.ts";
import { GenError } from "./types.ts";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("verifyOutput passes for valid PNG", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cig-val-"));
  try {
    const p = path.join(dir, "good.png");
    await writeFile(p, Buffer.concat([PNG_HEADER, Buffer.alloc(5000)]));
    const r = await verifyOutput(p);
    expect(r.bytes).toBeGreaterThan(1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyOutput rejects missing file", async () => {
  await expect(verifyOutput("/no/such/file.png")).rejects.toBeInstanceOf(GenError);
});

test("verifyOutput rejects tiny file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cig-val-"));
  try {
    const p = path.join(dir, "tiny.png");
    await writeFile(p, "tiny");
    await expect(verifyOutput(p)).rejects.toThrow(/too small/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyOutput rejects non-PNG magic", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cig-val-"));
  try {
    const p = path.join(dir, "fake.png");
    await writeFile(p, Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(5000)]));
    await expect(verifyOutput(p)).rejects.toThrow(/not a valid PNG/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyImageGenWasInvoked false when no thread directory", async () => {
  const orig = process.env.CODEX_HOME;
  const tempHome = await mkdtemp(path.join(tmpdir(), "cig-home-"));
  process.env.CODEX_HOME = tempHome;
  try {
    const r = await verifyImageGenWasInvoked("no-such-thread");
    expect(r.ok).toBe(false);
  } finally {
    process.env.CODEX_HOME = orig;
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("verifyImageGenWasInvoked true when PNG exists in thread dir", async () => {
  const orig = process.env.CODEX_HOME;
  const tempHome = await mkdtemp(path.join(tmpdir(), "cig-home-"));
  process.env.CODEX_HOME = tempHome;
  try {
    const threadDir = path.join(tempHome, "generated_images", "thread-xyz");
    await mkdir(threadDir, { recursive: true });
    await writeFile(path.join(threadDir, "ig_abc.png"), Buffer.alloc(100));
    const r = await verifyImageGenWasInvoked("thread-xyz");
    expect(r.ok).toBe(true);
  } finally {
    process.env.CODEX_HOME = orig;
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("findCpToTarget detects cp from generated_images", () => {
  expect(
    findCpToTarget(
      [
        {
          id: "1",
          tool: "shell",
          status: "completed",
          command: "cp ~/.codex/generated_images/thread/ig_x.png /tmp/out.png",
        },
      ],
      "/tmp/out.png",
    ),
  ).toBe(true);

  expect(
    findCpToTarget(
      [{ id: "1", tool: "shell", status: "completed", command: "ls /tmp" }],
      "/tmp/out.png",
    ),
  ).toBe(false);
});
