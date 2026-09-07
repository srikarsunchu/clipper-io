import type React from "react";

/** Everything a registered `htmlOverlay` template needs to paint one frame.
 * `props` is the item author's own serializable input (validated by the
 * template itself, not by the render pipeline -- same posture as
 * TextItem.typography being loosely typed and defaulted per-layer). */
export interface OverlayTemplateProps {
  props: Record<string, unknown>;
  /** frame relative to this overlay's own Sequence, i.e. 0 at the overlay's
   * own start -- never the composition's absolute frame. */
  frame: number;
  durationFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
}

export type OverlayTemplate = React.FC<OverlayTemplateProps>;
