"use client";

import { Plug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageContent, PageFrame, PageHeader } from "@/components/ui/page-frame";
import { PluginsTabContent } from "./content";

export default function PluginsPage() {
  const { t } = useTranslation("plugins");

  return (
    <PageFrame className="flex-1">
      <PageContent className="max-w-4xl lg:py-8">
        <PageHeader
          title={t("title")}
          description={t("pageDescription")}
          icon={Plug}
          backHref="/c/new"
        />
        <PluginsTabContent />
      </PageContent>
    </PageFrame>
  );
}
