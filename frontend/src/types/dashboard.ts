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

/** A named dashboard — a collection of pinned charts. */
export interface Dashboard {
  id: string;
  name: string;
  is_default: boolean;
  position: number;
  item_count: number;
  time_created: string;
}

export interface DashboardCreate {
  name: string;
}

/** A chart pinned to a dashboard (mirrors backend DashboardItemResponse). */
export interface DashboardItem {
  id: string;
  dashboard_id?: string | null;
  title: string;
  position: number;
  payload: DashboardItemPayload;
  layout?: DashboardLayout | null;
  refreshed_at?: string | null;
  time_created: string;
}

export interface DashboardItemCreate {
  title: string;
  payload: DashboardItemPayload;
  dashboard_id?: string | null;
}
