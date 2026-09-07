export type FormatId = "9:16" | "1:1" | "4:5" | "16:9";

export interface FormatPreset {
  id: FormatId;
  label: string;
  description: string;
  width: number;
  height: number;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: "9:16", label: "9:16", description: "Shorts, Reels, TikTok", width: 1080, height: 1920 },
  { id: "1:1", label: "1:1", description: "Square, feed posts", width: 1080, height: 1080 },
  { id: "4:5", label: "4:5", description: "Instagram portrait", width: 1080, height: 1350 },
  { id: "16:9", label: "16:9", description: "YouTube, landscape", width: 1920, height: 1080 },
];

export function getFormatPreset(id: FormatId): FormatPreset {
  return FORMAT_PRESETS.find((preset) => preset.id === id) ?? FORMAT_PRESETS[0];
}

/** Scales a format's render dimensions down to a preview-sized box (capped at
 * `maxDimension` on the longer side) while keeping the exact aspect ratio --
 * one formula for every format instead of a hand-picked preview size per
 * preset. 9:16 at maxDimension=480 reproduces the editor's original fixed
 * 270x480 canvas exactly, so the default format has no visual change. */
export function previewBoxSize(preset: FormatPreset, maxDimension = 480): { width: number; height: number } {
  const scale = maxDimension / Math.max(preset.width, preset.height);
  return { width: Math.round(preset.width * scale), height: Math.round(preset.height * scale) };
}
