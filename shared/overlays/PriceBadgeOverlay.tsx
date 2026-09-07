import React from "react";
import { interpolate } from "remotion";
import { outElastic, windowProgress } from "../easing";
import type { OverlayTemplate } from "./types";

export interface PriceBadgeProps {
  originalPrice?: string;
  newPrice?: string;
  /** short ribbon label, e.g. "50% OFF" or "TODAY ONLY" */
  label?: string;
  accentColor?: string;
  /** corner to anchor the badge in; defaults to a shelf-tag-style bottom-right. */
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

const CORNER_STYLE: Record<NonNullable<PriceBadgeProps["corner"]>, React.CSSProperties> = {
  "top-left": { top: "6%", left: "6%" },
  "top-right": { top: "6%", right: "6%" },
  "bottom-left": { bottom: "6%", left: "6%" },
  "bottom-right": { bottom: "6%", right: "6%" },
};

/** An ecommerce price-drop callout -- strikethrough original price, a bold
 * new price, and a ribbon label, popping in with a shelf-tag snap. The
 * elastic overshoot is what reads as "deal" rather than a static price sticker. */
export const PriceBadgeOverlay: OverlayTemplate = ({ props, frame, durationFrames, compositionWidth }) => {
  const p = props as PriceBadgeProps;
  const originalPrice = p.originalPrice ?? "$49";
  const newPrice = p.newPrice ?? "$29";
  const label = p.label ?? "SALE";
  const accentColor = p.accentColor ?? "#e4586e";
  const corner = p.corner ?? "bottom-right";

  const entranceFrames = Math.min(16, Math.max(1, Math.round(durationFrames * 0.3)));
  const entrance = outElastic(windowProgress(frame, 0, entranceFrames));
  const scale = interpolate(entrance, [0, 1], [0.4, 1]);
  const rotate = interpolate(entrance, [0, 1], [-8, -4]);

  const badgeSize = compositionWidth * 0.26;

  return (
    <div
      style={{
        position: "absolute",
        ...CORNER_STYLE[corner],
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: "center center",
      }}
    >
      <div
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: "50%",
          background: accentColor,
          boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, -apple-system, sans-serif",
          color: "#ffffff",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: badgeSize * 0.11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.85,
            marginBottom: badgeSize * 0.02,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: badgeSize * 0.14,
            fontWeight: 500,
            textDecoration: "line-through",
            opacity: 0.7,
          }}
        >
          {originalPrice}
        </span>
        <span style={{ fontSize: badgeSize * 0.24, fontWeight: 900, lineHeight: 1.05 }}>{newPrice}</span>
      </div>
    </div>
  );
};
