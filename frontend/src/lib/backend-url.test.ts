import { describe, expect, it } from "vitest";
import { resolveBrowserBackendUrl } from "./backend-url";

describe("resolveBrowserBackendUrl", () => {
  it("prefers the browser stream URL over the server proxy target", () => {
    expect(
      resolveBrowserBackendUrl({
        NEXT_PUBLIC_STREAM_API_URL: "http://public.example:3001",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000",
      }),
    ).toBe("http://public.example:3001");
  });

  it("falls back to the public API URL when no stream URL is configured", () => {
    expect(
      resolveBrowserBackendUrl({
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000",
      }),
    ).toBe("http://127.0.0.1:8000");
  });
});
