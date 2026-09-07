/** Pure `progress -> eased progress` curves, `progress` and the return value
 * both in [0, 1]. Remotion (and the editor preview) always has a frame count
 * and an fps up front, so these are plain deterministic functions of
 * progress rather than a mutable, time-driven animation-library timeline --
 * there's nothing to scrub or seek that `interpolate`/`spring` don't already
 * give a caller once it has a progress value. */

export type Easing = (progress: number) => number;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const linear: Easing = (progress) => clamp01(progress);

export const inOutSine: Easing = (progress) => {
  const p = clamp01(progress);
  return 0.5 - Math.cos(Math.PI * p) / 2;
};

/** Overshoots past 1 before settling -- the "pop" feel for a badge or callout
 * arriving on screen. Not a physical spring simulation, just its shape. */
export const outElastic: Easing = (progress) => {
  const p = clamp01(progress);
  if (p === 0 || p === 1) return p;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
};

/** outBack: a smaller, cheaper overshoot than outElastic -- reads as a firm
 * "snap into place" rather than a bounce. Good default for UI-mockup overlays
 * (phone notifications, app-store badges) where elastic wobble looks silly. */
export const outBack: Easing = (progress) => {
  const p = clamp01(progress);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

export const outCubic: Easing = (progress) => {
  const p = clamp01(progress);
  return 1 - Math.pow(1 - p, 3);
};

/** progress of `frame` through a [startFrame, startFrame + durationFrames)
 * window, clamped to [0, 1] outside it -- the one bit of boilerplate every
 * overlay/kinetic-type animation needs before applying an easing curve. */
export function windowProgress(frame: number, startFrame: number, durationFrames: number): number {
  if (durationFrames <= 0) return 1;
  return clamp01((frame - startFrame) / durationFrames);
}
