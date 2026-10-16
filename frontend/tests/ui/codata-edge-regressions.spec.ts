import { expect, test, type Page } from "@playwright/test";
import {
  mockCodataApi,
  seedCodataStorage,
  type CodataMockOptions,
  type CodataMockState,
} from "./fixtures/codata-api";

async function setupMockedApp(
  page: Page,
  options?: CodataMockOptions,
  seedOptions?: Parameters<typeof seedCodataStorage>[1],
): Promise<CodataMockState> {
  await seedCodataStorage(page, seedOptions);
  return mockCodataApi(page, options);
}

async function expectNoAppCrash(page: Page) {
  await expect(page.getByText("Runtime", { exact: false })).toHaveCount(0);
  await expect(page.getByText("API 401", { exact: false })).toHaveCount(0);
}

test.describe("Codata edge-state GUI regressions", () => {
  test.describe.configure({ timeout: 75_000 });

  test("auth expiry workflow: backend 401 while sending is recoverable and keeps the composer usable", async ({ page }) => {
    await setupMockedApp(page, {
      promptErrors: [{ match: "expired auth", status: 401, detail: "Session expired" }],
    });

    await page.goto("/c/new");
    await page.getByPlaceholder(/Describe the result you want/i).fill("expired auth should not crash");
    const failedPrompt = page.waitForResponse((res) =>
      res.url().includes("/api/chat/prompt") && res.status() === 401,
    );
    await page.getByRole("button", { name: /Send message/i }).click();
    await failedPrompt;

    await expect(page.getByText("Failed to send message")).toBeVisible();
    await expect(page.getByPlaceholder(/Describe the result you want/i)).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("messaging channel disconnect workflow: disconnected channels stay editable", async ({ page }) => {
    const state = await setupMockedApp(page);

    await page.goto("/settings?tab=remote");
    const dingTalkCard = page.locator("div.rounded-lg").filter({ hasText: "DingTalk" }).first();
    await dingTalkCard.getByRole("button", { name: "Connect" }).click();
    const clientIdInput = page.getByPlaceholder("Enter DingTalk client ID or app key");
    await clientIdInput.fill("ding-edge");
    await page.getByPlaceholder("Enter DingTalk client secret or app secret").fill("ding-edge-secret");
    const dingTalkForm = clientIdInput.locator("xpath=ancestor::div[contains(@class, 'space-y-2')][1]");
    await dingTalkForm.getByRole("button", { name: "Connect" }).click();
    await expect.poll(() => JSON.stringify(state.channelAdds)).toContain("ding-edge");

    await dingTalkCard.getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => JSON.stringify(state.channelRemoves)).toContain("dingtalk");
    await expect(dingTalkCard.getByRole("button", { name: "Edit" })).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("connector auth failure workflow: failed OAuth is surfaced as a toast instead of an unhandled UI error", async ({ page }) => {
    await setupMockedApp(page, {
      connectorErrors: [{ match: "notion/connect", status: 500, detail: "Notion OAuth unavailable" }],
    });

    await page.goto("/settings?tab=plugins");
    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await page.locator('input[placeholder="Search..."]:visible').fill("notion");
    const notionRow = page.locator("div").filter({ hasText: "Notion" }).filter({ hasText: "Search and update pages" }).first();
    await expect(notionRow).toBeVisible();
    await notionRow.getByRole("switch").click();

    await expect(page.getByText("Notion OAuth unavailable")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("model settings refresh button reloads backend model catalogs", async ({ page }) => {
    const state = await setupMockedApp(page);

    await page.goto("/settings?tab=providers");
    await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh models" }).click();

    await expect.poll(() => state.modelRefreshes.length).toBe(1);
    await expect(page.getByText("Models refreshed. 2 models available.")).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("ollama status failure shows a retryable error instead of an endless spinner", async ({ page }) => {
    await setupMockedApp(page, {
      ollamaStatusCode: 500,
    });

    await page.goto("/settings?tab=providers");
    await page.getByRole("button", { name: "Ollama" }).click();

    await expect(page.getByText("Failed to load Ollama status.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expectNoAppCrash(page);
  });
});
