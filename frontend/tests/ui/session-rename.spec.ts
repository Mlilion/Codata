import { expect, test, type Page } from "@playwright/test";
import { mockCodataApi, seedCodataStorage } from "./fixtures/codata-api";

async function startRename(page: Page, title: string, keyboard = false) {
  const row = page.getByRole("option", { name: new RegExp(title) });
  await row.click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: "Rename", exact: true });
  if (keyboard) {
    await menuItem.focus();
    await menuItem.press("Enter");
  } else {
    await menuItem.click();
  }
  const input = page.getByRole("textbox", { name: "Rename", exact: true });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(title);
  return input;
}

test.beforeEach(async ({ page }) => {
  await seedCodataStorage(page, { force: true });
});

test("Codata history rename saves once on blur and survives reload", async ({ page }) => {
  const state = await mockCodataApi(page);
  await page.goto("/c/session-data");
  const input = await startRename(page, "Data result showcase");
  await input.fill("Renamed data analysis");
  await page.locator("main").click({ position: { x: 20, y: 20 } });

  await expect(page.getByRole("option", { name: /Renamed data analysis/ })).toBeVisible();
  await expect.poll(() => state.sessionUpdates).toEqual([
    { id: "session-data", title: "Renamed data analysis" },
  ]);
  await page.reload();
  await expect(page.getByRole("option", { name: /Renamed data analysis/ })).toBeVisible();
});

test("Escape cancels a draft and unchanged or blank titles do not save", async ({ page }) => {
  const state = await mockCodataApi(page);
  await page.goto("/c/session-alpha");
  const title = "Quarterly planning notes";
  let input = await startRename(page, title);
  await input.fill("Discard this title");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(page.getByRole("option", { name: new RegExp(title) })).toBeVisible();

  input = await startRename(page, title);
  await input.press("Enter");
  await expect(input).toHaveCount(0);

  input = await startRename(page, title);
  await input.fill("   ");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  expect(state.sessionUpdates).toEqual([]);
});

test("keyboard rename isolates editing keys and waits for IME composition", async ({ page }) => {
  const state = await mockCodataApi(page);
  await page.goto("/c/session-alpha");
  const input = await startRename(page, "Quarterly planning notes", true);
  await input.fill("Planning revised");
  await input.press("Home");
  await input.press("ArrowDown");
  await expect(input).toBeFocused();
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    isComposing: true,
  });
  await expect(input).toBeVisible();
  expect(state.sessionUpdates).toEqual([]);

  await input.press("Enter");
  await expect.poll(() => state.sessionUpdates).toEqual([
    { id: "session-alpha", title: "Planning revised" },
  ]);
  await expect(page).toHaveURL(/\/c\/session-alpha$/);
});

test("failed rename restores the old title and displays an error", async ({ page }) => {
  const state = await mockCodataApi(page);
  await page.route("**/api/sessions/session-alpha", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Rename unavailable" }),
    });
  });
  await page.goto("/c/session-alpha");
  const input = await startRename(page, "Quarterly planning notes");
  await input.fill("Cannot save this");
  await input.press("Enter");

  await expect(page.getByText("Failed to rename conversation", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /Quarterly planning notes/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Cannot save this/ })).toHaveCount(0);
  expect(state.sessionUpdates).toEqual([]);
});

test("history rename retains focus and persists on Enter", async ({ page }) => {
  const state = await mockCodataApi(page);
  await page.goto("/c/session-alpha");
  const input = await startRename(page, "Quarterly planning notes");
  await input.fill("  Renamed planning notes  ");
  await input.press("Enter");

  await expect(page.getByRole("option", { name: /Renamed planning notes/ })).toBeVisible();
  await expect.poll(() => state.sessionUpdates).toEqual([
    { id: "session-alpha", title: "Renamed planning notes" },
  ]);
  await expect(page).toHaveURL(/\/c\/session-alpha$/);
  await page.reload();
  await expect(page.getByRole("option", { name: /Renamed planning notes/ })).toBeVisible();
});
