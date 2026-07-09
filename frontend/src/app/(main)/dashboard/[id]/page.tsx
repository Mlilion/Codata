import { Suspense } from "react";
import DashboardDetailClient from "./dashboard-detail-client";

/**
 * Required for Next.js static export — dynamic routes need this.
 * Returning at least one entry prevents Next.js from failing to detect the function.
 * Actual dashboard ids are resolved client-side via useParams in the Electron app.
 */
export async function generateStaticParams() {
  return [{ id: "_" }];
}

export default function DashboardDetailPage() {
  return (
    <Suspense fallback={null}>
      <DashboardDetailClient />
    </Suspense>
  );
}
