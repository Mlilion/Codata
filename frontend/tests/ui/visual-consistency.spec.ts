import { expect, test, type Page } from "@playwright/test";
import { mockCodataApi, seedCodataStorage } from "./fixtures/codata-api";

async function openChannels(page: Page, theme: "light" | "dark") {
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("theme", selectedTheme);
  }, theme);
  await page.goto("/settings?tab=remote");
  await expect(page.getByTestId("channel-workspace")).toBeVisible();
  await expect(page.getByTestId("channel-detail")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, testId: string) {
  const overflow = await page.getByTestId(testId).evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function expectNoViewportOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  await seedCodataStorage(page, { force: true });
  await mockCodataApi(page);
});

test("channel settings keeps its split layout on a standard desktop", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChannels(page, "light");

  const list = await page.getByTestId("channel-list").boundingBox();
  const detail = await page.getByTestId("channel-detail").boundingBox();
  expect(list).not.toBeNull();
  expect(detail).not.toBeNull();
  expect(detail!.x).toBeGreaterThan(list!.x + list!.width);
  await expectNoHorizontalOverflow(page, "channel-workspace");

  await testInfo.attach("channels-desktop-light", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("channel settings stacks without white panels in dark compact desktop", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openChannels(page, "dark");

  await expect(page.locator("html")).toHaveClass(/dark/);
  const list = await page.getByTestId("channel-list").boundingBox();
  const detail = await page.getByTestId("channel-detail").boundingBox();
  expect(list).not.toBeNull();
  expect(detail).not.toBeNull();
  expect(detail!.y).toBeGreaterThan(list!.y);
  await expectNoHorizontalOverflow(page, "channel-workspace");

  const detailBackground = await page.getByTestId("channel-detail").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(detailBackground).not.toBe("rgb(255, 255, 255)");

  await testInfo.attach("channels-compact-dark", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("channel settings remains usable on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChannels(page, "light");

  await expectNoHorizontalOverflow(page, "channel-workspace");
  const detail = await page.getByTestId("channel-detail").boundingBox();
  expect(detail?.width).toBeLessThanOrEqual(350);

  await testInfo.attach("channels-mobile-light", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("management pages share the same page shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const entry of [
    ["/automations", "Automations"],
    ["/plugins", "Plugins & Skills"],
    ["/knowledge", "知识库"],
    ["/skills", "技能"],
    ["/mcp", "MCP"],
  ] as const) {
    await page.goto(entry[0]);
    await expect(page.getByRole("heading", { name: entry[1], exact: true })).toBeVisible();
    await expect(page.locator("#main-content")).toHaveClass(/vibrancy-opaque/);
    await expectNoViewportOverflow(page);
  }
});

test("management page shell remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/skills");

  await expect(page.getByRole("heading", { name: "技能", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建技能", exact: true })).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("stream handoff keeps one user turn and one persisted assistant turn", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/c/new");

  const prompt = "Create a VP-ready customer feedback memo";
  const composer = page.getByPlaceholder(/Describe the result you want|What do you want to analyze/i);
  await expect(composer).toBeVisible();
  await composer.fill(prompt);
  const promptResponse = page.waitForResponse((response) =>
    response.url().includes("/api/chat/prompt") && response.status() === 200,
  );
  await page.getByRole("button", { name: /Send message/i }).click();
  await promptResponse;

  await expect(page.getByText(/VP-ready customer feedback memo/).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/the feedback points to a fixable revenue risk/).last()).toBeVisible();
  await expect(page.getByText(/the feedback points to a fixable revenue risk/)).toHaveCount(1);
});
