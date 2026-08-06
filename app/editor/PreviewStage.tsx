"use client";
/* eslint-disable @next/next/no-img-element -- media is streamed by the local sidecar */

import type { RefObject } from "react";
import type { CaptionStyleId } from "../../shared/render-contract";
import type { MediaAsset, VideoItem } from "../../shared/timeline";
import type { CaptionCue } from "../../shared/timeline-math";
import { mediaFileUrl } from "../sidecar-client";

type Layout = "focus" | "split" | "gameplay";

// Must match .video-canvas's fixed width/height in globals.css -- the cover-fit
// and pan-to-face math below is computed against this exact pixel box.
const CANVAS_WIDTH = 270;
const CANVAS_HEIGHT = 480;

function computeAutoFrameStyle(point: { centerX: number; centerY: number }, sourceWidth: number, sourceHeight: number) {
  const scale = Math.max(CANVAS_WIDTH / sourceWidth, CANVAS_HEIGHT / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;

  const desiredLeft = point.centerX * scaledWidth - CANVAS_WIDTH / 2;
  const cropLeft = Math.max(0, Math.min(scaledWidth - CANVAS_WIDTH, desiredLeft));
  const desiredTop = point.centerY * scaledHeight - CANVAS_HEIGHT / 2;
  const cropTop = Math.max(0, Math.min(scaledHeight - CANVAS_HEIGHT, desiredTop));

  return {
    position: "absolute" as const,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    left: `${-cropLeft}px`,
    top: `${-cropTop}px`,
  };
}

export function PreviewStage({
  activeClip,
  activeMedia,
  videoRef,
  layout,
  zoom,
  mediaScale,
  autoFramePoint,
  currentTime,
  totalDuration,
  playing,
  muted,
  captionsOn,
  activeCue,
  sourceTime,
  captionStyle,
  onZoomChange,
  onTogglePlayback,
  onSeek,
  onToggleMute,
  onVideoTimeUpdate,
  onVideoEnded,
}: {
  activeClip: VideoItem | null;
  activeMedia: MediaAsset | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  layout: Layout;
  zoom: number;
  mediaScale: number;
  autoFramePoint: { centerX: number; centerY: number } | null;
  currentTime: number;
  totalDuration: number;
  playing: boolean;
  muted: boolean;
  captionsOn: boolean;
  activeCue: CaptionCue | null;
  sourceTime: number;
  captionStyle: CaptionStyleId;
  onZoomChange: (zoom: number) => void;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onToggleMute: () => void;
  onVideoTimeUpdate: (time: number) => void;
  onVideoEnded: () => void;
}) {
  const isVideo = activeMedia?.mimeType.startsWith("video/");
  const isImage = activeMedia?.mimeType.startsWith("image/");

  return (
    <section className="stage-zone">
      <div className="stage-toolbar">
        <div>
          <button aria-label="Zoom out preview" onClick={() => onZoomChange(Math.max(40, zoom - 8))}>−</button>
          <span>{zoom}%</span>
          <button aria-label="Zoom in preview" onClick={() => onZoomChange(Math.min(120, zoom + 8))}>＋</button>
          <button onClick={() => onZoomChange(72)}>Fit</button>
        </div>
        <div><span className="preview-mode-label">Preview · 9:16</span></div>
      </div>
      <div className="canvas-space">
        <div className={`video-canvas layout-${layout}`} style={{ transform: `scale(${zoom / 100})` }}>
          {activeClip && activeMedia && isVideo && (
            <video
              key={activeMedia.id}
              ref={videoRef}
              src={mediaFileUrl(activeMedia.id)}
              className="local-video"
              style={
                autoFramePoint
                  ? computeAutoFrameStyle(autoFramePoint, activeMedia.width, activeMedia.height)
                  : { transform: `scale(${mediaScale / 100})` }
              }
              onTimeUpdate={(event) => onVideoTimeUpdate((event.target as HTMLVideoElement).currentTime)}
              onEnded={onVideoEnded}
            />
          )}
          {activeClip && activeMedia && isImage && (
            <img className="local-video" style={{ transform: `scale(${mediaScale / 100})` }} src={mediaFileUrl(activeMedia.id)} alt="" />
          )}
          {(!activeClip || !activeMedia) && (
            <div className="empty-canvas">
              <span>▧</span>
              <strong>Add media to start</strong>
              <small>Your 9:16 composition will appear here</small>
            </div>
          )}
          {captionsOn && activeCue && (
            <div className={`canvas-caption caption-${captionStyle}`}>
              {activeCue.words.map((word, index) =>
                sourceTime >= word.start && sourceTime < word.end
                  ? <em key={index}>{word.word} </em>
                  : <span key={index}>{word.word} </span>
              )}
            </div>
          )}
          {activeClip && activeMedia && <div className="selection-box"><i className="handle tl" /><i className="handle tr" /><i className="handle bl" /><i className="handle br" /></div>}
        </div>
      </div>
      <div className="transport">
        <div className="transport-left">
          <button aria-label="Go to start" onClick={() => onSeek(0)}>│‹</button>
          <button onClick={() => onSeek(Math.max(0, currentTime - 5))}>−5</button>
          <button className="transport-play" aria-label={playing ? "Pause" : "Play"} onClick={onTogglePlayback}>{playing ? "Ⅱ" : "▶"}</button>
          <button onClick={() => onSeek(Math.min(totalDuration, currentTime + 5))}>+5</button>
          <button aria-label="Go to end" onClick={() => onSeek(totalDuration)}>›│</button>
        </div>
        <div className="timecode"><b>{formatTimecode(currentTime)}</b><span>/ {formatTimecode(totalDuration)}</span></div>
        <div className="transport-right">
          <button aria-label={muted ? "Unmute" : "Mute"} onClick={onToggleMute}>{muted ? "M" : "◖))"}</button>
          <span className="preview-quality">Full</span>
        </div>
      </div>
    </section>
  );
}

function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const whole = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 30);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
