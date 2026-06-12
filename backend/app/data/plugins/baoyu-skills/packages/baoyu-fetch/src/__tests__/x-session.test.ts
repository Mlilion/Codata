import { describe, expect, test } from "bun:test";

import { buildXSessionCookieMap, hasRequiredXSessionCookies } from "../adapters/x/session";

describe("X session helpers", () => {
  test("keeps non-empty X session cookies", () => {
    expect(
      buildXSessionCookieMap([
        { name: "auth_token", value: "auth" },
        { name: "ct0", value: "csrf" },
        { name: "twid", value: "u=123" },
        { name: "ct0", value: "" },
        { name: "", value: "ignored" },
        { name: "gt", value: undefined },
      ]),
    ).toEqual({
      auth_token: "auth",
      ct0: "csrf",
      twid: "u=123",
    });
  });

  test("requires auth_token and ct0 for a ready X session", () => {
    expect(hasRequiredXSessionCookies({ auth_token: "auth" })).toBe(false);
    expect(hasRequiredXSessionCookies({ ct0: "csrf" })).toBe(false);
    expect(hasRequiredXSessionCookies({ auth_token: "auth", ct0: "csrf" })).toBe(true);
  });
});
