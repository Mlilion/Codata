"use client";

import { Download, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import packageJson from "../../../package.json";

export function AboutTab() {
  const { t } = useTranslation("settings");
  const currentVersion = packageJson.version;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
              {t("about")}
            </h2>
            <p className="text-ui-caption text-[var(--text-secondary)]">
              {t("aboutVersion", { version: currentVersion })}
            </p>
          </div>
        </div>
        <p className="text-ui-body text-[var(--text-secondary)]">
          {t("aboutDesc")}
        </p>
        <p className="text-ui-caption text-[var(--text-tertiary)]">
          {t("aboutCopyright")}
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t("softwareUpdate")}
          </h2>
          <p className="mt-1 text-ui-caption text-[var(--text-secondary)]">
            {t("softwareUpdateDesc")}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ui-body font-medium text-[var(--text-primary)]">
              {t("currentVersion", { version: currentVersion })}
            </p>
            <a
              href="https://github.com/Mlilion/Codata/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--border-default)] px-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-tertiary)]"
            >
              <Download className="h-3.5 w-3.5" />
              {t("manualDownload")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
