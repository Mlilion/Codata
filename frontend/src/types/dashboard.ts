import type { ChartSpec, SqlResultData } from "./artifact";

/** Snapshot payload stored on a pinned dashboard item. */
export interface DashboardItemPayload {
  chartSpec: ChartSpec;
  sqlResult: SqlResultData;
}

/** Grid-canvas placement for a tile ({x,y} grid cells, {w,h} spans). */
export interface DashboardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A chart pinned to the Codata dashboard (mirrors backend DashboardItemResponse). */
export interface DashboardItem {
  id: string;
  title: string;
  position: number;
  payload: DashboardItemPayload;
  layout?: DashboardLayout | null;
  time_created: string;
}

export interface DashboardItemCreate {
  title: string;
  payload: DashboardItemPayload;
}
