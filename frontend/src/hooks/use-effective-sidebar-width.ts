"use client";

import { useEffect, useState } from "react";
import {
  MAIN_CONTENT_MIN_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/constants";

export function effectiveSidebarWidth(
  requestedWidth: number,
  viewportWidth: number,
  widthCap = Number.POSITIVE_INFINITY,
): number {
  const cappedWidth = Math.min(requestedWidth, widthCap);
  if (viewportWidth < 1024) return cappedWidth;
  return Math.min(
    cappedWidth,
    Math.max(SIDEBAR_MIN_WIDTH, viewportWidth - MAIN_CONTENT_MIN_WIDTH),
  );
}

export function useEffectiveSidebarWidth(
  requestedWidth: number,
  widthCap?: number,
): number {
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  return effectiveSidebarWidth(requestedWidth, viewportWidth, widthCap);
}
