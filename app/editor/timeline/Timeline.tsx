"use client";
/* eslint-disable @next/next/no-img-element -- timeline media is streamed by the local sidecar */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AudioItem, MediaAsset, TimelineItem, Track, VideoItem } from "../../../shared/timeline";
import {
  clampClipStart,
  clipDuration,
  isAudioItem,
  isImageItem,
  isTextItem,
  isVideoItem,
  snapTime,
  withAudioTrim,
  withVideoTrim,
  type EditCaptionCue,
} from "../../../shared/timeline-math";
import { mediaFileUrl } from "../../sidecar-client";
import { Button, IconButton } from "../ui/Button";
import { Divider } from "../ui/Divider";
import { Tooltip } from "../ui/Tooltip";
import { useTimelineGeometry } from "./useTimelineGeometry";

const TRACK_HEIGHT = 44;
const LABEL_WIDTH = 176;
const MIN_ITEM_PX = 10;

type DragMode = "move" | "trim-start" | "trim-end";

// How far a pointer has to travel above/below the timeline tracks before a
// "move" drag counts as "drag this clip out to delete it" rather than an
// ordinary reposition.
const DRAG_OUT_THRESHOLD_PX = 48;

interface DragState {
  clipId: string;
  mode: DragMode;
  pointerX: number;
  original: TimelineItem;
}

export interface TimelineProps {
  currentTime: number;
  setCurrentTime: (time: number) => void;
  playing: boolean;
  selectedLayer: string;
  setSelectedLayer: (layer: string) => void;
  splitClip: () => void;
  deleteClip: () => void;
  totalDuration: number;
  tracks: Track[];
  clips: TimelineItem[];
  mediaById: Map<string, MediaAsset>;
  activeClipId: string | null;
  editCaptionCues: EditCaptionCue[];
  onUpdateClips: (clips: TimelineItem[]) => Promise<void>;
}

export function Timeline({
  currentTime,
  setCurrentTime,
  playing,
  selectedLayer,
  setSelectedLayer,
  splitClip,
  deleteClip,
  totalDuration,
  tracks,
  clips,
  mediaById,
  activeClipId,
  editCaptionCues,
  onUpdateClips,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftClipsRef = useRef(clips);
  const [pxPerSecond, setPxPerSecond] = useState(4);
  const [draftClips, setDraftClips] = useState(clips);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragOutPending, setDragOutPending] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [hiddenTracks, setHiddenTracks] = useState<Set<string>>(new Set());
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [scrollState, setScrollState] = useState({ left: 0, max: 0 });
  const pxPerSecondRef = useRef(pxPerSecond);

  useEffect(() => {
    pxPerSecondRef.current = pxPerSecond;
  }, [pxPerSecond]);

  useEffect(() => {
    draftClipsRef.current = clips;
    // External split/delete operations replace the persisted clip collection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftClips(clips);
  }, [clips]);

  const orderedTracks = useMemo(() => [...tracks].sort((a, b) => a.order - b.order), [tracks]);
  const { duration, contentWidth, ticks } = useTimelineGeometry(totalDuration, pxPerSecond);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScrollState = () => {
      setScrollState({
        left: viewport.scrollLeft,
        max: Math.max(0, viewport.scrollWidth - viewport.clientWidth),
      });
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        const rect = viewport.getBoundingClientRect();
        const anchorX = event.clientX - rect.left;
        const oldScale = pxPerSecondRef.current;
        const anchorTime = (viewport.scrollLeft + anchorX) / oldScale;
        const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * viewport.clientHeight
            : event.deltaY;
        const nextScale = Math.max(0.35, Math.min(32, oldScale * Math.exp(-delta * 0.01)));
        pxPerSecondRef.current = nextScale;
        setPxPerSecond(nextScale);
        requestAnimationFrame(() => {
          viewport.scrollLeft = Math.max(0, anchorTime * nextScale - anchorX);
          updateScrollState();
        });
        return;
      }
      if (viewport.scrollWidth <= viewport.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      viewport.scrollLeft += delta;
    };
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(viewport);
    viewport.addEventListener("scroll", updateScrollState, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    const frame = requestAnimationFrame(updateScrollState);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", updateScrollState);
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [contentWidth]);

  useEffect(() => {
    if (!playing || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const x = currentTime * pxPerSecond;
    if (x < viewport.scrollLeft + 80 || x > viewport.scrollLeft + viewport.clientWidth - 80) {
      viewport.scrollTo({ left: Math.max(0, x - viewport.clientWidth * 0.35), behavior: "smooth" });
    }
  }, [currentTime, playing, pxPerSecond]);

  function setZoom(next: number) {
    const viewport = viewportRef.current;
    const clamped = Math.max(0.35, Math.min(32, next));
    const oldScale = pxPerSecondRef.current;
    if (viewport) {
      const anchorX = currentTime * oldScale - viewport.scrollLeft;
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, currentTime * clamped - anchorX);
      });
    }
    pxPerSecondRef.current = clamped;
    setPxPerSecond(clamped);
  }

  function seekFromPointer(event: ReactPointerEvent<HTMLElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const time = (event.clientX - rect.left + viewport.scrollLeft) / pxPerSecond;
    setCurrentTime(Math.max(0, Math.min(duration, time)));
  }

  function beginScrub(event: ReactPointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  }

  function continueScrub(event: ReactPointerEvent<HTMLElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekFromPointer(event);
  }

  function finishScrub(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginDrag(event: ReactPointerEvent, clip: TimelineItem, mode: DragMode) {
    event.stopPropagation();
    const item = event.currentTarget.closest(".timeline-media-item") as HTMLElement | null;
    item?.setPointerCapture(event.pointerId);
    setSelectedLayer(clip.trackId);
    setCurrentTime(clip.startSec);
    setDrag({ clipId: clip.id, mode, pointerX: event.clientX, original: clip });
  }

  function snapCandidates(clipId: string): number[] {
    const candidates = [0, currentTime];
    for (const candidate of draftClips) {
      if (candidate.id === clipId) continue;
      candidates.push(candidate.startSec, candidate.startSec + clipDuration(candidate));
    }
    return candidates;
  }

  function updateDrag(event: ReactPointerEvent) {
    if (!drag) return;
    if (drag.mode === "move") {
      const viewport = viewportRef.current;
      const rect = viewport?.getBoundingClientRect();
      const outOfBounds = Boolean(
        rect && (event.clientY < rect.top - DRAG_OUT_THRESHOLD_PX || event.clientY > rect.bottom + DRAG_OUT_THRESHOLD_PX)
      );
      if (outOfBounds !== dragOutPending) setDragOutPending(outOfBounds);
      // Dragged far enough out that release will delete it -- don't also fight
      // that with the normal reposition math below.
      if (outOfBounds) return;
    }
    const delta = (event.clientX - drag.pointerX) / pxPerSecond;
    const threshold = 8 / pxPerSecond;
    const candidates = snapCandidates(drag.clipId);
    setDraftClips((current) => {
      const next = current.map((clip) => {
        if (clip.id !== drag.clipId) return clip;
        const trackClips = current.filter((candidate) => candidate.trackId === clip.trackId);
        if (drag.mode === "move") {
          const rawStart = drag.original.startSec + delta;
          const proposed = snapping ? snapTime(rawStart, candidates, threshold) : rawStart;
          return { ...clip, startSec: clampClipStart(clip, proposed, trackClips) };
        }
        // Image/text items have no source trim window -- dragging their edges
        // just adjusts durationSec (and, for the start handle, startSec) directly.
        if ((isImageItem(clip) && isImageItem(drag.original)) || (isTextItem(clip) && isTextItem(drag.original))) {
          const originalEnd = drag.original.startSec + drag.original.durationSec;
          if (drag.mode === "trim-start") {
            const maxDelta = drag.original.durationSec - 0.1;
            const rawStart = Math.max(0, Math.min(drag.original.startSec + maxDelta, drag.original.startSec + delta));
            const snappedStart = snapping ? snapTime(rawStart, candidates, threshold) : rawStart;
            const adjustedStart = clampClipStart(clip, Math.max(0, Math.min(originalEnd - 0.1, snappedStart)), trackClips);
            return { ...clip, startSec: adjustedStart, durationSec: Math.max(0.1, originalEnd - adjustedStart) };
          }
          const rawEnd = Math.max(drag.original.startSec + 0.1, originalEnd + delta);
          const snappedEnd = snapping ? snapTime(rawEnd, candidates, threshold) : rawEnd;
          return { ...clip, durationSec: Math.max(0.1, snappedEnd - drag.original.startSec) };
        }
        // Video/audio items trim a window within their source media, bounded
        // by how much source material actually exists on either side. Both
        // kinds share the exact same arithmetic over plain numbers; only the
        // final wrapper (withVideoTrim vs withAudioTrim) differs by kind, so
        // branch on kind only at the point of constructing the return value.
        if (isVideoItem(clip) && isVideoItem(drag.original)) {
          const mediaDuration = mediaById.get(clip.assetId)?.durationSec ?? Number.POSITIVE_INFINITY;
          const { trimInSec, trimOutSec, startSec } = trimSourceWindow(drag.mode, drag.original, delta, mediaDuration, trackClips, snapping, candidates, threshold, clip);
          return { ...withVideoTrim(clip, trimInSec, trimOutSec), startSec };
        }
        if (isAudioItem(clip) && isAudioItem(drag.original)) {
          const mediaDuration = mediaById.get(clip.assetId)?.durationSec ?? Number.POSITIVE_INFINITY;
          const { trimInSec, trimOutSec, startSec } = trimSourceWindow(drag.mode, drag.original, delta, mediaDuration, trackClips, snapping, candidates, threshold, clip);
          return { ...withAudioTrim(clip, trimInSec, trimOutSec), startSec };
        }
        return clip;
      });
      draftClipsRef.current = next;
      return next;
    });
  }

  async function finishDrag(event: ReactPointerEvent) {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const shouldDelete = dragOutPending;
    const draggedClipId = drag.clipId;
    setDrag(null);
    setDragOutPending(false);
    setSaveState("saving");
    try {
      const nextClips = shouldDelete ? removeClipWithRipple(draftClipsRef.current, draggedClipId) : draftClipsRef.current;
      if (shouldDelete) {
        draftClipsRef.current = nextClips;
        setDraftClips(nextClips);
      }
      await onUpdateClips(nextClips);
    } finally {
      setSaveState("saved");
    }
  }

  function toggleSet(setter: (value: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <section className="timeline-area redesigned-timeline" aria-label="Project timeline">
      <div
        className="timeline-resize-handle"
        role="separator"
        aria-label="Resize timeline"
        aria-orientation="horizontal"
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const grid = event.currentTarget.closest(".editing-grid") as HTMLElement | null;
          if (!grid) return;
          const height = Math.max(190, Math.min(420, grid.getBoundingClientRect().bottom - event.clientY));
          grid.style.gridTemplateRows = `minmax(300px, 1fr) ${height}px`;
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
      <div className="timeline-commandbar">
        <div className="timeline-command-group">
          <Button size="sm" onClick={splitClip}>Split</Button>
          <Tooltip label="Delete selected clip">
            <IconButton label="Delete selected clip" onClick={deleteClip}>⌫</IconButton>
          </Tooltip>
          <Divider />
          <Button
            size="sm"
            variant={snapping ? "primary" : "ghost"}
            aria-pressed={snapping}
            onClick={() => setSnapping((value) => !value)}
          >
            Magnet
          </Button>
        </div>
        <div className="timeline-status" aria-live="polite">
          <span className={saveState === "saving" ? "saving" : ""}>{saveState === "saving" ? "Saving…" : "Saved"}</span>
          <Divider />
          <IconButton
            label="Scroll timeline left"
            disabled={scrollState.left <= 0}
            onClick={() => viewportRef.current?.scrollBy({ left: -Math.max(240, (viewportRef.current?.clientWidth ?? 600) * 0.7), behavior: "smooth" })}
          >
            ‹
          </IconButton>
          <input
            className="timeline-position-slider"
            aria-label="Timeline horizontal position"
            type="range"
            min="0"
            max={Math.max(1, scrollState.max)}
            step="1"
            value={Math.min(scrollState.left, Math.max(1, scrollState.max))}
            disabled={scrollState.max === 0}
            onChange={(event) => {
              if (viewportRef.current) viewportRef.current.scrollLeft = Number(event.target.value);
            }}
          />
          <IconButton
            label="Scroll timeline right"
            disabled={scrollState.left >= scrollState.max}
            onClick={() => viewportRef.current?.scrollBy({ left: Math.max(240, (viewportRef.current?.clientWidth ?? 600) * 0.7), behavior: "smooth" })}
          >
            ›
          </IconButton>
          <Divider />
          <IconButton label="Zoom out" onClick={() => setZoom(pxPerSecond / 1.35)}>−</IconButton>
          <input
            aria-label="Timeline zoom"
            type="range"
            min="0.35"
            max="32"
            step="0.05"
            value={pxPerSecond}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <IconButton label="Zoom in" onClick={() => setZoom(pxPerSecond * 1.35)}>＋</IconButton>
          <button className="timeline-fit" onClick={() => setZoom(Math.max(0.35, ((viewportRef.current?.clientWidth ?? 720) - 48) / duration))}>
            Fit
          </button>
        </div>
      </div>

      <div className="timeline-grid">
        <div className="timeline-label-column">
          <div className="timeline-label-heading"><span>Layers</span><small>{orderedTracks.length}</small></div>
          {orderedTracks.map((track) => {
            const count = track.kind === "caption"
              ? editCaptionCues.length
              : draftClips.filter((clip) => clip.trackId === track.id).length;
            const selected = selectedLayer === track.id || selectedLayer === track.kind || (track.kind === "caption" && selectedLayer === "captions");
            return (
              <div
                key={track.id}
                className={`timeline-track-label ${selected ? "selected" : ""}`}
              >
                <button className="timeline-track-main" onClick={() => setSelectedLayer(track.id)}>
                  <span className={`track-kind-dot kind-${track.kind}`} />
                  <span><strong>{track.name}</strong><small>{count ? `${count} item${count === 1 ? "" : "s"}` : "Empty"}</small></span>
                </button>
                <button
                  className="timeline-track-toggle"
                  title={track.kind === "audio" ? "Mute track" : "Hide track"}
                  aria-label={track.kind === "audio" ? "Mute track" : "Hide track"}
                  aria-pressed={track.kind === "audio" ? mutedTracks.has(track.id) : hiddenTracks.has(track.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (track.kind === "audio") toggleSet(setMutedTracks, mutedTracks, track.id);
                    else toggleSet(setHiddenTracks, hiddenTracks, track.id);
                  }}
                >
                  {track.kind === "audio" ? (mutedTracks.has(track.id) ? "M" : "◖") : (hiddenTracks.has(track.id) ? "○" : "●")}
                </button>
              </div>
            );
          })}
        </div>

        <div
          className="timeline-viewport"
          ref={viewportRef}
        >
          <div className="timeline-content" style={{ width: contentWidth }}>
            <div
              className="timeline-ruler-new"
              onPointerDown={beginScrub}
              onPointerMove={continueScrub}
              onPointerUp={finishScrub}
              onPointerCancel={finishScrub}
            >
              {ticks.map((time) => (
                <button
                  key={time}
                  style={{ left: time * pxPerSecond }}
                  onClick={(event) => {
                    if (event.detail === 0) setCurrentTime(time);
                  }}
                >
                  <i />
                  <span>{formatTimelineTime(time)}</span>
                </button>
              ))}
            </div>
            <div
              className="timeline-lanes"
              style={{ "--track-count": orderedTracks.length } as CSSProperties}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) seekFromPointer(event);
              }}
            >
              {orderedTracks.map((track) => {
                const trackClips = draftClips.filter((clip) => clip.trackId === track.id);
                const hidden = hiddenTracks.has(track.id);
                return (
                  <div
                    key={track.id}
                    className={`timeline-lane kind-${track.kind} ${hidden ? "is-hidden" : ""}`}
                    style={{ height: TRACK_HEIGHT }}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) seekFromPointer(event);
                    }}
                  >
                    {track.kind === "caption"
                      ? editCaptionCues.map((cue, index) => (
                          <button
                            key={`${cue.editStart}-${index}`}
                            className="timeline-caption-item"
                            style={{
                              left: cue.editStart * pxPerSecond,
                              width: Math.max(MIN_ITEM_PX, (cue.editEnd - cue.editStart) * pxPerSecond),
                            }}
                            onClick={() => setCurrentTime(cue.editStart)}
                            title={cue.words.map((word) => word.word).join(" ")}
                          >
                            {cue.words.map((word) => word.word).join(" ")}
                          </button>
                        ))
                      : trackClips.map((clip) => (
                          <TimelineClip
                            key={clip.id}
                            clip={clip}
                            media={isVideoItem(clip) || isImageItem(clip) || isAudioItem(clip) ? mediaById.get(clip.assetId) : undefined}
                            pxPerSecond={pxPerSecond}
                            selected={clip.id === activeClipId}
                            pendingDelete={dragOutPending && drag?.clipId === clip.id}
                            onPointerDown={(event) => beginDrag(event, clip, "move")}
                            onPointerMove={updateDrag}
                            onPointerUp={finishDrag}
                            onTrimStart={(event) => beginDrag(event, clip, "trim-start")}
                            onTrimEnd={(event) => beginDrag(event, clip, "trim-end")}
                          />
                        ))}
                    {!trackClips.length && track.kind !== "caption" && (
                      <span className="timeline-empty-lane">Drop {track.kind === "video" ? "media" : track.kind} here</span>
                    )}
                  </div>
                );
              })}
              <div
                className="timeline-playhead-new"
                style={{ left: currentTime * pxPerSecond }}
                onPointerDown={beginScrub}
                onPointerMove={continueScrub}
                onPointerUp={finishScrub}
                onPointerCancel={finishScrub}
              >
                <span>{formatTimelineTime(currentTime, true)}</span>
                <i />
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className={playing ? "playing-indicator on" : "playing-indicator"} aria-label={playing ? "Playing" : "Paused"}>●</span>
    </section>
  );
}

/** Removes one item and closes the gap it leaves on its own track by shifting
 * every later item on that same track left by the removed item's duration --
 * mirrors deleteClipAtPlayhead's ripple in app/page.tsx (playhead-based
 * deletion), just keyed by a specific clip id instead of the current time. */
function removeClipWithRipple(clips: TimelineItem[], clipId: string): TimelineItem[] {
  const removed = clips.find((clip) => clip.id === clipId);
  if (!removed) return clips;
  return clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) =>
      clip.trackId === removed.trackId && clip.startSec > removed.startSec
        ? { ...clip, startSec: clip.startSec - removed.durationSec }
        : clip
    );
}

/** Shared arithmetic for trimming a source window (video/audio) -- both kinds
 * have the identical trimInSec/trimOutSec/startSec shape, so the numbers are
 * computed once here and the caller wraps them with the kind-specific
 * withVideoTrim/withAudioTrim to get a properly-typed result back. */
function trimSourceWindow(
  mode: "trim-start" | "trim-end",
  original: VideoItem | AudioItem,
  delta: number,
  mediaDuration: number,
  trackClips: TimelineItem[],
  snapping: boolean,
  candidates: number[],
  threshold: number,
  clipForClamp: TimelineItem,
): { trimInSec: number; trimOutSec: number; startSec: number } {
  if (mode === "trim-start") {
    const maxDelta = clipDuration(original) - 0.1;
    const trimDelta = Math.max(-original.trimInSec, Math.min(maxDelta, delta));
    const rawStart = original.startSec + trimDelta;
    const snappedStart = snapping ? snapTime(rawStart, candidates, threshold) : rawStart;
    const adjustedStart = clampClipStart(clipForClamp, Math.max(0, snappedStart), trackClips);
    return {
      trimInSec: Math.max(0, original.trimInSec + adjustedStart - original.startSec),
      trimOutSec: original.trimOutSec,
      startSec: adjustedStart,
    };
  }
  const rawOut = Math.max(original.trimInSec + 0.1, Math.min(mediaDuration, original.trimOutSec + delta));
  const timelineEnd = original.startSec + (rawOut - original.trimInSec);
  const snappedEnd = snapping ? snapTime(timelineEnd, candidates, threshold) : timelineEnd;
  return {
    trimInSec: original.trimInSec,
    trimOutSec: Math.max(original.trimInSec + 0.1, Math.min(mediaDuration, original.trimInSec + snappedEnd - original.startSec)),
    startSec: original.startSec,
  };
}

function TimelineClip({
  clip,
  media,
  pxPerSecond,
  selected,
  pendingDelete,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onTrimStart,
  onTrimEnd,
}: {
  clip: TimelineItem;
  media?: MediaAsset;
  pxPerSecond: number;
  selected: boolean;
  pendingDelete: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTrimStart: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  onTrimEnd: (event: ReactPointerEvent<HTMLSpanElement>) => void;
}) {
  const length = clipDuration(clip);
  const label = isTextItem(clip) ? clip.text || "Text card" : media?.fileName ?? "Media";
  return (
    <button
      className={`timeline-media-item kind-${clip.kind} ${selected ? "selected" : ""} ${pendingDelete ? "pending-delete" : ""}`}
      style={{ left: clip.startSec * pxPerSecond, width: Math.max(MIN_ITEM_PX, length * pxPerSecond) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={pendingDelete ? "Release to remove from timeline" : `${label} · ${formatTimelineTime(length, true)}`}
    >
      <span className="timeline-trim-handle start" onPointerDown={onTrimStart} />
      {media?.mimeType.startsWith("video/") && <TimelineVideoFrame media={media} />}
      {media?.mimeType.startsWith("image/") && <img src={mediaFileUrl(media.id)} alt="" draggable={false} />}
      {isAudioItem(clip) && <span className="timeline-audio-glyph" aria-hidden="true">♫</span>}
      <span className="timeline-item-tint" />
      <strong>{label}</strong>
      <small>{formatTimelineTime(length, true)}</small>
      <span className="timeline-trim-handle end" onPointerDown={onTrimEnd} />
    </button>
  );
}

function TimelineVideoFrame({ media }: { media: MediaAsset }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <video
      ref={ref}
      src={mediaFileUrl(media.id)}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={() => {
        if (ref.current) ref.current.currentTime = Math.min(1, media.durationSec * 0.05);
      }}
    />
  );
}

export function formatTimelineTime(seconds: number, precise = false): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const base = hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return precise ? `${base}.${Math.floor((safe % 1) * 10)}` : base;
}

export const timelineLabelWidth = LABEL_WIDTH;
