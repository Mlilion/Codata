"use client";

import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageContent, PageFrame, PageHeader } from "@/components/ui/page-frame";
import { AutomationsTabContent } from "./content";

export default function AutomationsPage() {
  const { t } = useTranslation("automations");

  return (
    <PageFrame className="flex-1">
      <PageContent className="max-w-4xl lg:py-8">
        <PageHeader
          title={t("title")}
          description={t("pageDescription")}
          icon={Timer}
          backHref="/c/new"
        />
        <AutomationsTabContent />
      </PageContent>
    </PageFrame>
  );
}
