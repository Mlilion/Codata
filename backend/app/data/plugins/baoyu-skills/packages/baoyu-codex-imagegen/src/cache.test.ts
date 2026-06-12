import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheKey, lookupCache, storeCache, FileLock } from "./cache.ts";

test("cacheKey is deterministic and order-independent for refs", () => {
  const k1 = cacheKey("hello", "16:9", ["a.png", "b.png"]);
  const k2 = cacheKey("hello", "16:9", ["b.png", "a.png"]);
  expect(k1).toBe(k2);
  const k3 = cacheKey("hello", "16:9", []);
  expect(k3).not.toBe(k1);
  const k4 = cacheKey("hello", "1:1", []);
  expect(k4).not.toBe(k3);
});

test("lookupCache returns null on miss, path on hit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cig-test-"));
  try {
    expect(await lookupCache(dir, "abc")).toBeNull();
    const fake = path.join(dir, "abc.png");
    await writeFile(fake, Buffer.alloc(2000));
    expect(await lookupCache(dir, "abc")).toBe(fake);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("storeCache copies source into cache", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cig-test-"));
  const src = path.join(dir, "src.png");
  try {
    await writeFile(src, Buffer.from("xxxx".repeat(1000)));
    await storeCache(dir, "key1", src);
    const cached = await lookupCache(dir, "key1");
    expect(cached).not.toBeNull();
    const a = await readFile(src);
    const b = await readFile(cached!);
    expect(a.equals(b)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileLock prevents concurrent acquisition", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cig-lock-"));
  try {
    const lockPath = path.join(dir, "x.lock");
    const lock1 = new FileLock(lockPath);
    const lock2 = new FileLock(lockPath);
    await lock1.acquire(1000);
    let lock2Acquired = false;
    const p = lock2.acquire(500).then(() => (lock2Acquired = true)).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    expect(lock2Acquired).toBe(false);
    await lock1.release();
    await p;
    expect(lock2Acquired).toBe(true);
    await lock2.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
