"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 22;
const DEFAULT_UI_FONT_SIZE = 13;
const DEFAULT_CODE_FONT_SIZE = 12;

interface AppearanceState {
  /** Base UI font size in px */
  uiFontSize: number;
  /** Base code/mono font size in px */
  codeFontSize: number;
  /** Whether interactive elements get a pointer cursor */
  pointerCursors: boolean;

  setUiFontSize: (v: number) => void;
  setCodeFontSize: (v: number) => void;
  setPointerCursors: (v: boolean) => void;
}

const INITIAL = {
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  pointerCursors: false,
};

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setUiFontSize: (v) => set({ uiFontSize: clampFontSize(v) }),
      setCodeFontSize: (v) => set({ codeFontSize: clampFontSize(v) }),
      setPointerCursors: (v) => set({ pointerCursors: v }),
    }),
    {
      name: "workcraft-appearance",
      partialize: (s) => ({
        uiFontSize: s.uiFontSize,
        codeFontSize: s.codeFontSize,
        pointerCursors: s.pointerCursors,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppearanceState> | undefined;
        return {
          ...current,
          uiFontSize: clampFontSize(saved?.uiFontSize ?? current.uiFontSize),
          codeFontSize: clampFontSize(saved?.codeFontSize ?? current.codeFontSize),
          pointerCursors:
            typeof saved?.pointerCursors === "boolean"
              ? saved.pointerCursors
              : current.pointerCursors,
        };
      },
    },
  ),
);

function clampFontSize(n: unknown) {
  const value = Number(n);
  return Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, Number.isFinite(value) ? value : MIN_FONT_SIZE),
  );
}
