"use client";

import { useMemo } from "react";
import { getAdaptiveTickInterval } from "../../../shared/timeline-math";

export function useTimelineGeometry(totalDuration: number, pxPerSecond: number) {
  const duration = Math.max(totalDuration, 1);
  const contentWidth = Math.max(duration * pxPerSecond + 80, 720);
  const tickInterval = getAdaptiveTickInterval(pxPerSecond);
  const ticks = useMemo(
    () => Array.from({ length: Math.ceil(duration / tickInterval) + 1 }, (_, index) => index * tickInterval),
    [duration, tickInterval],
  );

  return {
    duration,
    contentWidth,
    tickInterval,
    ticks,
    timeToPx: (time: number) => time * pxPerSecond,
    pxToTime: (pixels: number) => pixels / pxPerSecond,
  };
}
