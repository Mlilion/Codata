"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppearanceStore } from "@/stores/appearance-store";

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 22;

export function AppearanceCustomize() {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-3">
      <h3 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
        {t("customize")}
      </h3>
      <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
        <ToggleRow
          title={t("usePointerCursors")}
          desc={t("usePointerCursorsDesc")}
        />
        <NumberRow
          title={t("uiFontSize")}
          desc={t("uiFontSizeDesc")}
          field="uiFontSize"
        />
        <NumberRow
          title={t("codeFontSize")}
          desc={t("codeFontSizeDesc")}
          field="codeFontSize"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  const value = useAppearanceStore((s) => s.pointerCursors);
  const setter = useAppearanceStore((s) => s.setPointerCursors);

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)] px-4 py-3">
      <div className="min-w-0">
        <p className="text-ui-body font-medium text-[var(--text-primary)]">{title}</p>
        <p className="mt-0.5 text-ui-caption text-[var(--text-tertiary)]">{desc}</p>
      </div>
      <Switch checked={value} onCheckedChange={setter} />
    </div>
  );
}

function NumberRow({
  title,
  desc,
  field,
}: {
  title: string;
  desc: string;
  field: "uiFontSize" | "codeFontSize";
}) {
  const value = useAppearanceStore((s) => s[field]);
  const setUi = useAppearanceStore((s) => s.setUiFontSize);
  const setCode = useAppearanceStore((s) => s.setCodeFontSize);
  const setter = field === "uiFontSize" ? setUi : setCode;
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    setter(Number.isFinite(next) ? next : value);
  };

  const step = (delta: number) => {
    setter(value + delta);
  };

  return (
    <div className="border-b border-[var(--border-subtle)] px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-ui-body font-medium text-[var(--text-primary)]">{title}</p>
          <p className="mt-0.5 text-ui-caption text-[var(--text-tertiary)]">{desc}</p>
        </div>
        <div className="flex shrink-0 items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)]">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={value <= FONT_SIZE_MIN}
            className="flex h-8 w-8 items-center justify-center rounded-l-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35"
            aria-label={`${title} -1`}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center border-x border-[var(--border-default)]">
            <Input
              type="number"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setDraft(String(value));
                  e.currentTarget.blur();
                }
              }}
              className="h-8 w-12 border-0 bg-transparent px-1 text-center text-ui-caption shadow-none focus-visible:ring-0"
            />
            <span className="pr-2 text-ui-3xs text-[var(--text-tertiary)]">px</span>
          </div>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={value >= FONT_SIZE_MAX}
            className="flex h-8 w-8 items-center justify-center rounded-r-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35"
            aria-label={`${title} +1`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={value}
          onChange={(e) => setter(Number(e.target.value))}
          className="h-1.5 flex-1 accent-[var(--brand-primary)]"
          aria-label={title}
        />
        <span className="w-10 text-right font-mono text-ui-caption text-[var(--text-secondary)]">
          {value}px
        </span>
      </div>
    </div>
  );
}
