import { describe, expect, test } from "bun:test";
import { shouldAutoContinueForceWait, shouldKeepBrowserOpenAfterInteraction } from "../commands/convert";

describe("shouldAutoContinueForceWait", () => {
  test("continues when a challenge disappears", () => {
    expect(
      shouldAutoContinueForceWait(
        {
          url: "https://example.com/challenge",
          hasGate: true,
          loginState: "unknown",
          sessionReady: true,
        },
        {
          url: "https://example.com/article",
          hasGate: false,
          loginState: "unknown",
          sessionReady: true,
        },
      ),
    ).toBe(true);
  });

  test("waits for X session cookies before continuing after login", () => {
    expect(
      shouldAutoContinueForceWait(
        {
          url: "https://x.com/i/flow/login",
          hasGate: false,
          loginState: "logged_out",
          sessionReady: false,
        },
        {
          url: "https://x.com/home",
          hasGate: false,
          loginState: "logged_in",
          sessionReady: false,
        },
      ),
    ).toBe(false);

    expect(
      shouldAutoContinueForceWait(
        {
          url: "https://x.com/i/flow/login",
          hasGate: false,
          loginState: "logged_out",
          sessionReady: false,
        },
        {
          url: "https://x.com/home",
          hasGate: false,
          loginState: "logged_in",
          sessionReady: true,
        },
      ),
    ).toBe(true);
  });

  test("does not continue when nothing changed yet", () => {
    expect(
      shouldAutoContinueForceWait(
        {
          url: "https://x.com/lennysan/status/2036483059407810640",
          hasGate: false,
          loginState: "unknown",
          sessionReady: false,
        },
        {
          url: "https://x.com/lennysan/status/2036483059407810640",
          hasGate: false,
          loginState: "unknown",
          sessionReady: false,
        },
      ),
    ).toBe(false);
  });
});

describe("shouldKeepBrowserOpenAfterInteraction", () => {
  test("keeps launched X login browsers open", () => {
    expect(
      shouldKeepBrowserOpenAfterInteraction({
        launched: true,
        interaction: { kind: "login", provider: "x" },
      }),
    ).toBe(true);
  });

  test("does not keep reused or non-login browsers open", () => {
    expect(
      shouldKeepBrowserOpenAfterInteraction({
        launched: false,
        interaction: { kind: "login", provider: "x" },
      }),
    ).toBe(false);

    expect(
      shouldKeepBrowserOpenAfterInteraction({
        launched: true,
        interaction: { kind: "cloudflare", provider: "cloudflare" },
      }),
    ).toBe(false);
  });
});
