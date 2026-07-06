import type { ChartSpec, SqlResultData } from "./artifact";

/** Snapshot payload stored on a pinned dashboard item. */
export interface DashboardItemPayload {
  chartSpec: ChartSpec;
  sqlResult: SqlResultData;
}

/** A chart pinned to the Codata dashboard (mirrors backend DashboardItemResponse). */
export interface DashboardItem {
  id: string;
  title: string;
  position: number;
  payload: DashboardItemPayload;
  time_created: string;
}

export interface DashboardItemCreate {
  title: string;
  payload: DashboardItemPayload;
}
