"use client";

import { useTranslation } from "react-i18next";

interface TransTextProps {
  ns?: string | string[];
  key: string;
  className?: string;
  options?: Record<string, unknown>;
}

/**
 * Wrapper for translated text that handles SSR hydration mismatch.
 * i18next-browser-languagedetector cannot read localStorage on server,
 * causing SSR to use fallback language (en) while client may use user's
 * preference (zh). suppressHydrationWarning tells React to accept this.
 */
export function TransText({ ns, key, className, options }: TransTextProps) {
  const { t } = useTranslation(ns);
  return (
    <span className={className} suppressHydrationWarning>
      {t(key, options)}
    </span>
  );
}