import { expect, test, type Page } from "@playwright/test";
import {
  mockCodataApi,
  seedCodataStorage,
  type CodataMockState,
} from "./fixtures/codata-api";

async function setupMockedApp(page: Page): Promise<CodataMockState> {
  await seedCodataStorage(page);
  return mockCodataApi(page);
}

async function sendPrompt(page: Page, text: string) {
  await page.getByPlaceholder(/Describe the result you want/i).fill(text);
  const promptResponse = page.waitForResponse((res) =>
    res.url().includes("/api/chat/prompt") && res.status() === 200,
  );
  await page.getByRole("button", { name: /Send message/i }).click();
  await promptResponse;
}

async function expectNoAppCrash(page: Page) {
  await expect(page.getByText("Runtime", { exact: false })).toHaveCount(0);
  await expect(page.getByText("API 401", { exact: false })).toHaveCount(0);
}

test.describe("Codata conversation scale and compaction GUI workflows", () => {
  test.describe.configure({ timeout: 75_000 });

  test("manual compression workflow: context indicator starts compaction and persists the marker", async ({ page }) => {
    const state = await setupMockedApp(page);

    await page.goto("/c/session-compact");
    await expect(page.getByText("Context compression checkpoint").first()).toBeVisible();
    await expect(page.getByText("This conversation is above the manual compaction threshold.")).toBeVisible();

    const compactResponse = page.waitForResponse((res) =>
      res.url().includes("/api/chat/compact") && res.status() === 200,
    );
    await page.getByRole("button", { name: "Click to compact now" }).click();
    await compactResponse;

    await expect(page.getByText("Context compressed to save tokens")).toBeVisible({ timeout: 20_000 });
    expect(state.compactRequests).toHaveLength(1);
    await expectNoAppCrash(page);
  });

  test("auto compression workflow: a long prompt stream shows compressed context in the final conversation", async ({ page }) => {
    await setupMockedApp(page);

    await page.goto("/c/new");
    await expect(page.getByRole("heading", { name: /What should (Codata help you do|we do in)/i })).toBeVisible();
    await sendPrompt(page, "Trigger auto compress during a long context answer");

    await expect(page).toHaveURL(/\/c\/session-new$/);
    await expect(page.getByText("Auto compacted answer persisted after compression.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Context compressed to save tokens")).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("long conversation workflow: latest messages load first and older pages load through reverse scroll", async ({ page }) => {
    await setupMockedApp(page);

    await page.goto("/c/session-long");
    await expect(page.getByText("Long conversation load test").first()).toBeVisible();
    const latestReply = page.getByText(/Final version: launch is approved with conditions\./);
    await expect(latestReply).toBeVisible();
    const firstPrompt = page.getByText(
      "Can you turn the launch notes into a short operating brief for tomorrow's review?",
      { exact: true },
    );
    const initialPromptCount = await firstPrompt.count();

    const olderResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/messages/session-long"
        && url.searchParams.get("offset") === "0"
        && response.status() === 200;
    });
    const scroller = page.locator("main .data-agent-surface").first();
    await scroller.evaluate((element) => { element.scrollTop = 0; });
    await olderResponse;

    await expect.poll(() => firstPrompt.count()).toBeGreaterThan(initialPromptCount);
    const loadedPromptCount = await firstPrompt.count();
    await expect(latestReply).toBeVisible();

    // The old infinite query discarded the tail at the next polling refetch.
    await page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/messages/session-long"
        && url.searchParams.get("offset") === "-1"
        && response.status() === 200;
    }, { timeout: 20_000 });
    await expect(firstPrompt).toHaveCount(loadedPromptCount);
    await expect(latestReply).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("multi-conversation workflow: switching histories keeps each conversation isolated", async ({ page }) => {
    await setupMockedApp(page);

    await page.goto("/c/session-alpha");
    await expect(page.getByText("Quarterly planning notes").first()).toBeVisible();
    await expect(page.getByText(/retention, onboarding, and billing clarity/i)).toBeVisible();

    await page.getByRole("option", { name: /Invoice cleanup/i }).click();
    await expect(page).toHaveURL(/\/c\/session-beta$/);
    await expect(page.getByText("Invoice cleanup").first()).toBeVisible();
    await expect(page.getByText(/retention, onboarding, and billing clarity/i)).toHaveCount(0);

    await page.getByRole("option", { name: /Long conversation load test/i }).click();
    await expect(page).toHaveURL(/\/c\/session-long$/);
    await expect(page.getByText("Long assistant turn 060")).toBeVisible();
    await expect(page.getByText("Invoice cleanup").first()).toBeVisible();
    await expect(page.getByText("Summarize the quarterly plan")).toHaveCount(0);

    await page.getByRole("option", { name: /Artifact showcase/i }).click();
    await expect(page).toHaveURL(/\/c\/session-artifacts$/);
    await expect(page.getByText("Release Brief")).toBeVisible();
    await expect(page.getByText("Long assistant turn 060")).toHaveCount(0);
    await expectNoAppCrash(page);
  });

  test("long conversation refresh fills a multi-page gap without losing loaded history", async ({ page }) => {
    await setupMockedApp(page);
    const makeMessages = (count: number) => Array.from({ length: count }, (_, index) => {
      const id = `regression-${index}`;
      const time_created = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      const role = index % 2 === 0 ? "user" : "assistant";
      return {
        id,
        session_id: "session-long",
        time_created,
        data: { role },
        parts: [{
          id: `${id}-text`,
          message_id: id,
          session_id: "session-long",
          time_created,
          data: { type: "text", text: `Regression ${role} ${index}` },
        }],
      };
    });
    let messages = makeMessages(320);
    await page.route("**/api/messages/session-long?*", (route) => {
      const params = new URL(route.request().url()).searchParams;
      const limit = Number(params.get("limit"));
      const requested = Number(params.get("offset"));
      const offset = requested < 0 ? Math.max(0, messages.length - limit) : requested;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: messages.length,
          offset,
          messages: messages.slice(offset, offset + limit),
        }),
      });
    });

    await page.goto("/c/session-long");
    await expect(page.getByText("Regression assistant 319", { exact: true })).toBeVisible();
    const olderResponse = page.waitForResponse((response) =>
      response.url().includes("/api/messages/session-long?limit=100&offset=120"),
    );
    await page.locator("main .data-agent-surface").first().evaluate((element) => { element.scrollTop = 0; });
    await olderResponse;
    const loadedHistory = page.getByText("Regression user 120", { exact: true });
    await expect(loadedHistory).toBeVisible();

    messages = makeMessages(570);
    await expect(page.getByText("Regression assistant 569", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Regression user 320", { exact: true })).toBeVisible();
    await expect(page.getByText("Regression assistant 469", { exact: true })).toBeVisible();
    await expect(loadedHistory).toBeVisible();
    await expect(page.getByText("Regression assistant 319", { exact: true })).toHaveCount(1);
    await expectNoAppCrash(page);
  });

  test("hidden-tail workflow: the latest visible turn survives session switches", async ({ page }) => {
    await setupMockedApp(page);

    await page.goto("/c/session-hidden-long");
    await expect(page.getByText("Hidden tail regression").first()).toBeVisible();
    await expect(page.getByText("Final version: launch is approved with conditions.")).toBeVisible();

    await page.getByRole("option", { name: /Invoice cleanup/i }).click();
    await expect(page).toHaveURL(/\/c\/session-beta$/);

    await page.getByRole("option", { name: /Hidden tail regression/i }).click();
    await expect(page).toHaveURL(/\/c\/session-hidden-long$/);

    await page.waitForTimeout(1500);

    await expect(page.getByText("Final version: launch is approved with conditions.")).toBeVisible({ timeout: 20_000 });
    await expectNoAppCrash(page);
  });
});
