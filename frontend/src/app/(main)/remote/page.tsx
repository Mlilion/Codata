"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RemoteTabContent } from "./content";

export default function RemotePage() {
  const { t } = useTranslation("settings");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" asChild>
            <Link href="/c/new"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("remote")}</h1>
        </div>
        <RemoteTabContent />
      </div>
    </div>
  );
}
