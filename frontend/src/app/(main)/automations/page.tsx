"use client";

import { ArrowLeft, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AutomationsTabContent } from "./content";

export default function AutomationsPage() {
  const { t } = useTranslation("automations");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" asChild>
            <Link href="/c/new"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Timer className="h-5 w-5 text-[var(--text-secondary)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("title")}</h1>
        </div>
        <AutomationsTabContent />
      </div>
    </div>
  );
}
