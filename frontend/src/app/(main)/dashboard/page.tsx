"use client";

import { ArrowLeft, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DashboardContent } from "./content";

export default function DashboardPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" asChild>
            <Link href="/c/new">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <LayoutDashboard className="h-5 w-5 text-[var(--text-secondary)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">看板</h1>
        </div>
        <DashboardContent />
      </div>
    </div>
  );
}
