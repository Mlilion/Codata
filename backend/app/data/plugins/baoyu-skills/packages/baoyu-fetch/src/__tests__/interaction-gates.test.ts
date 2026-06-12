import { describe, expect, test } from "bun:test";
import { detectInteractionGateFromSnapshot } from "../browser/interaction-gates";

describe("detectInteractionGateFromSnapshot", () => {
  test("detects cloudflare challenge", () => {
    const gate = detectInteractionGateFromSnapshot({
      title: "Just a moment...",
      currentUrl: "https://example.com/cdn-cgi/challenge-platform/h/b",
      bodyText: "Checking your browser before accessing example.com",
      hasCloudflareTurnstile: true,
      hasCloudflareChallenge: true,
      hasRecaptcha: false,
      hasRecaptchaIframe: false,
      hasHcaptcha: false,
      hasHcaptchaIframe: false,
    });

    expect(gate?.kind).toBe("cloudflare");
    expect(gate?.provider).toBe("cloudflare");
  });

  test("detects google recaptcha", () => {
    const gate = detectInteractionGateFromSnapshot({
      title: "Protected page",
      currentUrl: "https://example.com/form",
      bodyText: "Please verify that you're not a robot via reCAPTCHA",
      hasCloudflareTurnstile: false,
      hasCloudflareChallenge: false,
      hasRecaptcha: true,
      hasRecaptchaIframe: true,
      hasHcaptcha: false,
      hasHcaptchaIframe: false,
    });

    expect(gate?.kind).toBe("recaptcha");
    expect(gate?.provider).toBe("google_recaptcha");
  });

  test("returns null when no challenge is present", () => {
    const gate = detectInteractionGateFromSnapshot({
      title: "Example",
      currentUrl: "https://example.com/article",
      bodyText: "Normal article body",
      hasCloudflareTurnstile: false,
      hasCloudflareChallenge: false,
      hasRecaptcha: false,
      hasRecaptchaIframe: false,
      hasHcaptcha: false,
      hasHcaptchaIframe: false,
    });

    expect(gate).toBeNull();
  });
});
