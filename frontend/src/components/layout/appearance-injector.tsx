"use client";

import { useEffect } from "react";
import { useAppearanceStore } from "@/stores/appearance-store";

const STYLE_ID = "codata-appearance-overrides";

/**
 * Writes appearance overrides into a single <style> element in <head>.
 *
 * Mutates the element's textContent directly from a zustand `.subscribe`
 * callback instead of going through React's renderer — React treats
 * <style> children specially in places (hoisting, deduping, precedence)
 * and can drop updates. Direct DOM writes are bulletproof and cheap.
 */
export function AppearanceInjector() {
  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }

    const apply = () => {
      el!.textContent = buildCss(useAppearanceStore.getState());
    };
    apply();

    return useAppearanceStore.subscribe(apply);
  }, []);

  return null;
}

function buildCss(
  s: ReturnType<typeof useAppearanceStore.getState>,
): string {
  const rules: string[] = [];

  rules.push(
    `:root { --ui-font-size-base: ${s.uiFontSize}px; --ui-code-font-size-base: ${s.codeFontSize}px; }`,
  );
  rules.push(`body { font-size: var(--ui-size-sm); }`);
  rules.push(
    `code, pre, kbd, samp, .font-mono, .text-ui-code { font-size: var(--ui-code-font-size-base) !important; }`,
  );

  if (s.pointerCursors) {
    rules.push(
      `button:not([disabled]), [role="button"]:not([aria-disabled="true"]), a[href], [role="link"], [role="tab"], [role="menuitem"] { cursor: pointer; }`,
    );
  }

  return rules.join("\n");
}
