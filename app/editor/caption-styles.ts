import type { CaptionStyleId } from "../../shared/render-contract";

export const captionStyles: {
  id: CaptionStyleId;
  label: string;
  sample: string;
  accent: string;
  motion: string;
}[] = [
  { id: "pop", label: "Beasty", sample: "THIS CHANGES", accent: "EVERYTHING", motion: "Bounce" },
  { id: "mozi", label: "Mozi", sample: "BUILD THE", accent: "THING", motion: "Punch" },
  { id: "deepdiver", label: "Deep Diver", sample: "THE REAL", accent: "REASON", motion: "Rise" },
  { id: "popline", label: "Popline", sample: "MAKE IT", accent: "MEMORABLE", motion: "Pop" },
  { id: "karaoke", label: "Karaoke", sample: "Follow every", accent: "word", motion: "Track" },
  { id: "clean", label: "Simple", sample: "Less noise.", accent: "More signal.", motion: "Fade" },
  { id: "boxed", label: "Pod P", sample: "ONE GREAT", accent: "IDEA", motion: "Snap" },
  { id: "thinkmedia", label: "Think Media", sample: "Create with", accent: "confidence", motion: "Slide" },
];
