import { PhoneNotificationOverlay } from "./PhoneNotificationOverlay";
import { PriceBadgeOverlay } from "./PriceBadgeOverlay";
import type { OverlayTemplate } from "./types";

/** Every `HtmlOverlayItem.template` id this build knows how to paint. Adding
 * a new overlay is: write the component, register it here -- nothing else in
 * the render pipeline needs to change, same as adding a caption style preset. */
const OVERLAY_TEMPLATES: Record<string, OverlayTemplate> = {
  phoneNotification: PhoneNotificationOverlay,
  priceBadge: PriceBadgeOverlay,
};

export function getOverlayTemplate(id: string): OverlayTemplate | null {
  return OVERLAY_TEMPLATES[id] ?? null;
}

export function listOverlayTemplateIds(): string[] {
  return Object.keys(OVERLAY_TEMPLATES);
}
