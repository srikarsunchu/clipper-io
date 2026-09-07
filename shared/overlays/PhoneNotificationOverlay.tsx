import React from "react";
import { interpolate } from "remotion";
import { outBack, windowProgress } from "../easing";
import type { OverlayTemplate } from "./types";

export interface PhoneNotificationProps {
  appName?: string;
  message?: string;
  /** data: URI or resolved asset URL -- rendered as a small square icon, a
   * plain initial letter when omitted so the overlay is still usable before
   * an icon asset exists. */
  iconSrc?: string;
  accentColor?: string;
  time?: string;
}

/** A fake iOS-style push notification banner, sliding in from the top and
 * holding -- the standard "funnel to app" beat: show the product doing its
 * thing, then cut to the phone telling you to open it. Driven entirely by
 * `frame`/`durationFrames`, so it scrubs and exports identically. */
export const PhoneNotificationOverlay: OverlayTemplate = ({ props, frame, durationFrames, compositionWidth }) => {
  const p = props as PhoneNotificationProps;
  const appName = p.appName ?? "App";
  const message = p.message ?? "Your results are ready.";
  const accentColor = p.accentColor ?? "#2f6fed";
  const time = p.time ?? "now";

  const entranceFrames = Math.min(14, Math.max(1, Math.round(durationFrames * 0.25)));
  const exitFrames = Math.min(10, Math.max(1, Math.round(durationFrames * 0.15)));
  const entrance = outBack(windowProgress(frame, 0, entranceFrames));
  const exitStart = durationFrames - exitFrames;
  const exitProgress = windowProgress(frame, exitStart, exitFrames);
  const translateY = interpolate(entrance, [0, 1], [-140, 0]) + interpolate(exitProgress, [0, 1], [0, -140]);
  const opacity = Math.min(1, entrance) * (1 - exitProgress);

  const cardWidth = compositionWidth * 0.9;
  const pad = compositionWidth * 0.032;
  const iconSize = compositionWidth * 0.075;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: compositionWidth * 0.06,
        width: cardWidth,
        transform: `translate(-50%, ${translateY}px)`,
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: pad * 0.8,
          padding: pad,
          borderRadius: compositionWidth * 0.045,
          background: "rgba(28, 28, 32, 0.82)",
          backdropFilter: "blur(18px)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, sans-serif",
        }}
      >
        <div
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: iconSize * 0.28,
            background: p.iconSrc ? `center/cover no-repeat url(${p.iconSrc})` : accentColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "white",
            fontWeight: 700,
            fontSize: iconSize * 0.5,
          }}
        >
          {p.iconSrc ? null : appName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "rgba(255,255,255,0.55)",
              fontSize: compositionWidth * 0.028,
              fontWeight: 600,
              marginBottom: compositionWidth * 0.008,
            }}
          >
            <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{appName}</span>
            <span>{time}</span>
          </div>
          <div
            style={{
              color: "#ffffff",
              fontSize: compositionWidth * 0.033,
              fontWeight: 500,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {message}
          </div>
        </div>
      </div>
    </div>
  );
};
