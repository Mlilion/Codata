import { expect, test, type Page } from "@playwright/test";
import {
  mockWorkCraftApi,
  seedWorkCraftStorage,
  type WorkCraftMockOptions,
  type WorkCraftMockState,
} from "./fixtures/workcraft-api";

async function setupMockedApp(
  page: Page,
  options?: WorkCraftMockOptions,
  seedOptions?: Parameters<typeof seedWorkCraftStorage>[1],
): Promise<WorkCraftMockState> {
  await seedWorkCraftStorage(page, seedOptions);
  return mockWorkCraftApi(page, options);
}

async function expectNoAppCrash(page: Page) {
  await expect(page.getByText("Runtime", { exact: false })).toHaveCount(0);
  await expect(page.getByText("API 401", { exact: false })).toHaveCount(0);
}

test.describe("WorkCraft edge-state GUI regressions", () => {
  test.describe.configure({ timeout: 75_000 });

  test("billing return workflow: checkout success refreshes billing and cleans the return URL", async ({ page }) => {
    await setupMockedApp(page);

    await page.goto("/settings?tab=billing&checkout=success");
    await expect(page).toHaveURL(/\/settings\?tab=billing$/);
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("$12.50", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Chat: Best Free")).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("billing disconnected workflow: signed-out account shows the billing empty state and routes to providers", async ({ page }) => {
    await setupMockedApp(page, undefined, { authConnected: false });

    await page.goto("/settings?tab=billing");
    await expect(page.locator("p:visible").filter({ hasText: "Connect an WorkCraft account to top up and access premium models." })).toBeVisible();
    await page.getByRole("button", { name: "Go to Settings" }).click();
    await expect(page).toHaveURL(/\/settings\?tab=providers$/);
    await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("sidebar footer shows complimentary credits for new accounts without recharge history", async ({ page }) => {
    await setupMockedApp(page, undefined, {
      force: true,
      user: {
        balance: 10,
        total_recharged: 0,
      },
    });

    await page.goto("/c/new");
    if (page.viewportSize()?.width && page.viewportSize()!.width < 1024) {
      await page.getByRole("button", { name: "Toggle sidebar" }).click();
    }

    const sidebar = page.getByLabel("Chat sidebar").or(page.getByRole("dialog"));
    const sidebarFooter = sidebar.getByText("Credits Balance").locator("..");
    await expect(sidebarFooter).toContainText("$10.00");
    await expect(sidebarFooter).not.toContainText("$0.00");
    await expectNoAppCrash(page);
  });

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

  test("chatgpt auth launch failure stops the waiting state", async ({ page }) => {
    await setupMockedApp(page, {
      openaiSubscriptionConnected: false,
      openaiLoginStatus: 500,
    });

    await page.goto("/settings?tab=providers");
    await page.getByRole("button", { name: /ChatGPT Subscription/i }).click();
    await page.getByRole("button", { name: "Sign in with ChatGPT" }).click();

    await expect(page.getByText("Failed to start authentication")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with ChatGPT" })).toBeEnabled();
    await expect(page.getByText("Waiting for authentication...")).toHaveCount(0);
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
