"use client";

import { BookOpen, CheckCircle2, Download, ExternalLink, Info, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";
import { useUpdateCheck } from "@/hooks/use-update-check";
import packageJson from "../../../package.json";

const USER_GUIDE_URL = "https://work-craft.com/workcraft-office-user-guide.html";

export function AboutTab() {
  const { t } = useTranslation("settings");
  const {
    available,
    version,
    notes,
    checking,
    downloading,
    progress,
    error,
    lastCheckedAt,
    checkNow,
    downloadAndInstall,
  } = useUpdateCheck();

  const currentVersion = packageJson.version;
  const checkedAt = lastCheckedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(lastCheckedAt))
    : null;

  const openUserGuide = () => {
    if (IS_DESKTOP) {
      void desktopAPI.openExternal(USER_GUIDE_URL);
      return;
    }
    window.open(USER_GUIDE_URL, "_blank", "noopener,noreferrer");
  };

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

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--text-secondary)]" />
          <h2 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t("aboutUserGuideTitle")}
          </h2>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-ui-body font-medium text-[var(--text-primary)]">
              {t("aboutUserGuide")}
            </p>
            <p className="mt-1 text-ui-caption leading-relaxed text-[var(--text-secondary)]">
              {t("aboutUserGuideDesc")}
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={openUserGuide}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {t("aboutOpenUserGuide")}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-ui-title-sm font-semibold text-[var(--text-primary)]">
            {t("softwareUpdate")}
          </h2>
          <p className="mt-1 text-ui-caption text-[var(--text-secondary)]">
            {IS_DESKTOP ? t("softwareUpdateDesc") : t("softwareUpdateDesktopOnly")}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
          {!IS_DESKTOP ? (
            <p className="text-ui-caption text-[var(--text-secondary)]">
              {t("softwareUpdateDesktopOnly")}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-ui-body font-medium text-[var(--text-primary)]">
                    {available
                      ? t("updateAvailableDesc", { version })
                      : t("currentVersion", { version: currentVersion })}
                  </p>
                  <p className="mt-1 text-ui-caption text-[var(--text-tertiary)]">
                    {checkedAt ? t("lastCheckedAt", { time: checkedAt }) : t("notCheckedYet")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => void checkNow()}
                    disabled={checking || downloading}
                  >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
                    {t("checkForUpdates")}
                  </Button>
                  {available && (
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={downloadAndInstall}
                      disabled={downloading}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {t("updateNow")}
                    </Button>
                  )}
                </div>
              </div>

              {downloading && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand-primary)] transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-ui-caption text-[var(--text-secondary)]">
                    {progress}%
                  </span>
                </div>
              )}

              {!available && checkedAt && !checking && !error && (
                <div className="flex items-center gap-1.5 text-ui-caption text-[var(--color-success)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("upToDate")}
                </div>
              )}

              {notes && (
                <div className="rounded-lg bg-[var(--surface-primary)] p-3 text-ui-caption leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                  {notes}
                </div>
              )}

              {error && (
                <p className="text-ui-caption text-[var(--color-destructive)] break-all">
                  {t("updateFailed")}: {error}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
