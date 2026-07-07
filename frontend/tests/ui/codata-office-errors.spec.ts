import { expect, test, type Page } from "@playwright/test";
import {
  mockCodataApi,
  seedCodataStorage,
  type CodataMockOptions,
  type CodataMockState,
} from "./fixtures/codata-api";

async function setupMockedApp(page: Page, options?: CodataMockOptions): Promise<CodataMockState> {
  await seedCodataStorage(page);
  return mockCodataApi(page, options);
}

async function expectNoAppCrash(page: Page) {
  await expect(page.getByText("Runtime", { exact: false })).toHaveCount(0);
  await expect(page.getByText("API 401", { exact: false })).toHaveCount(0);
}

async function openArtifactFile(page: Page, fileName: string) {
  const fileButton = page.locator("#main-content").getByRole("button", { name: fileName, exact: true });
  await expect(fileButton).toBeVisible();
  await fileButton.click();
  await expect(page.getByText(fileName).first()).toBeVisible();
}

async function closeArtifactPanel(page: Page) {
  const panelButtons = page.locator("aside").getByRole("button");
  await expect.poll(() => panelButtons.count()).toBeGreaterThan(0);
  await panelButtons.last().click();
}

test.describe("Codata Office artifact and error-state GUI workflows", () => {
  test.describe.configure({ timeout: 75_000 });

  test("office artifact workflow: preview DOCX, XLSX, PDF, and PPTX from real binary files", async ({ page }) => {
    const state = await setupMockedApp(page);

    await page.goto("/c/session-artifacts");
    await expect(page.getByText("Artifact showcase").first()).toBeVisible();

    await openArtifactFile(page, "office-brief.docx");
    await expect(page.getByText("Codata DOCX workflow")).toBeVisible({ timeout: 20_000 });
    await closeArtifactPanel(page);

    await openArtifactFile(page, "office-matrix.xlsx");
    await expect(page.getByText("Coverage")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Office XLSX")).toBeVisible();
    await expect(page.getByText("Rendered")).toBeVisible();
    await closeArtifactPanel(page);

    await openArtifactFile(page, "office-report.pdf");
    await expect.poll(() => page.locator("canvas").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await closeArtifactPanel(page);

    await openArtifactFile(page, "office-deck.pptx");
    await expect(page.getByText("1 / 1")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.locator("canvas").count(), { timeout: 20_000 }).toBeGreaterThan(0);

    expect(state.binaryReads.join("\n")).toContain("office-brief.docx");
    expect(state.binaryReads.join("\n")).toContain("office-matrix.xlsx");
    expect(state.binaryReads.join("\n")).toContain("office-report.pdf");
    expect(state.binaryReads.join("\n")).toContain("office-deck.pptx");
    await expectNoAppCrash(page);
  });

  test("artifact error workflow: missing binary preview shows a recoverable file error", async ({ page }) => {
    await setupMockedApp(page, { binaryFailures: ["missing-report.xlsx"] });

    await page.goto("/c/session-artifacts");
    await openArtifactFile(page, "missing-report.xlsx");
    await expect(page.getByText("File not found:", { exact: false })).toBeVisible();
    await expect(page.getByText("missing-report.xlsx", { exact: false }).first()).toBeVisible();
    await expectNoAppCrash(page);
  });

  test("chat upload error workflow: failed file upload surfaces a toast and keeps composer usable", async ({ page }) => {
    const state = await setupMockedApp(page, { failUploads: ["broken-upload.txt"] });

    await page.goto("/c/new");
    await expect(page.getByRole("heading", { name: /What should (Codata help you do|we do in)/i })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "broken-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this upload should fail"),
    });

    await expect(page.getByText("Failed to upload file")).toBeVisible();
    await expect(page.getByPlaceholder(/Describe the result you want/i)).toBeVisible();
    expect(state.fileUploads).not.toContain("broken-upload.txt");
    await expectNoAppCrash(page);
  });

  test("chat error workflow: prompt errors show a recoverable toast", async ({ page }) => {
    await setupMockedApp(page, {
      promptErrors: [
        { match: "provider auth gate", status: 401, detail: "Provider API key rejected" },
      ],
    });

    await page.goto("/c/new");
    await page.getByPlaceholder(/Describe the result you want/i).fill("provider auth gate");
    const errorResponse = page.waitForResponse((res) =>
      res.url().includes("/api/chat/prompt") && res.status() === 401,
    );
    await page.getByRole("button", { name: /Send message/i }).click();
    await errorResponse;
    await expect(page.getByText("Provider API key rejected")).toBeVisible();
    await expect(page.getByPlaceholder(/Describe the result you want/i)).toBeEnabled();
    await expectNoAppCrash(page);
  });

  test("messaging channel validation workflow: required credentials are enforced", async ({ page }) => {
    await setupMockedApp(page);

    await page.goto("/settings?tab=remote");
    const dingTalkCard = page.locator("div.rounded-lg").filter({ hasText: "DingTalk" }).first();
    await dingTalkCard.getByRole("button", { name: "Connect" }).click();
    const clientIdInput = page.getByPlaceholder("Enter DingTalk client ID or app key");
    const dingTalkForm = clientIdInput.locator("xpath=ancestor::div[contains(@class, 'space-y-2')][1]");
    await dingTalkForm.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByText("Client ID / App Key is required")).toBeVisible();
    await expectNoAppCrash(page);
  });
});
