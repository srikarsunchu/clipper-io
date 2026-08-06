"use client";

import { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Project, TimelineItem, VideoItem } from "../shared/timeline";
import type { CaptionStyleId } from "../shared/render-contract";
import {
  buildCaptionCues,
  findClipAtTime as findClipAtTimelineTime,
  interpolateFacePoint,
  isVideoItem,
  mapFaceRangesToEditTime,
  mapFaceTrackToEditTime,
  mapCuesToEditTime,
  normalizeProject,
  readMediaFaceTrack,
  subtractRanges,
  timelineDuration as getTimelineDuration,
  withVideoTrim,
  type CaptionCue,
} from "../shared/timeline-math";
import { createProject, fetchProject, saveProjectTimeline, transcribeMedia, uploadMedia, renderProject, renderDownloadUrl, findMoments, trackFaces, type FindMomentsPreferences, type MomentCandidate } from "./sidecar-client";
import { AssetPanel } from "./editor/AssetPanel";
import { EditorTopbar, ToolRail, type EditorTool } from "./editor/EditorChrome";
import { InspectorPanel } from "./editor/InspectorPanel";
import { PreviewStage } from "./editor/PreviewStage";
import { Timeline } from "./editor/timeline/Timeline";

type Tool = EditorTool;
type Layout = "focus" | "split" | "gameplay";
type CaptionStyle = CaptionStyleId;
type Inspector = "clip" | "style" | "adjust";

export default function EditorPage() {
  const [tool, setTool] = useState<Tool>("media");
  const [layout, setLayout] = useState<Layout>("split");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("pop");
  const [inspector, setInspector] = useState<Inspector>("clip");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(120);
  const [project, setProject] = useState<Project | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState("video");
  const [showExport, setShowExport] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderDownload, setRenderDownload] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [captionsOn, setCaptionsOn] = useState(true);
  const [blur, setBlur] = useState(18);
  const [scale, setScale] = useState(112);
  const [activeCaption, setActiveCaption] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [findingMoments, setFindingMoments] = useState(false);
  const [moments, setMoments] = useState<MomentCandidate[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  const videoTrack = project?.tracks.find((track) => track.kind === "video") ?? null;
  const videoClips: VideoItem[] = useMemo(
    () =>
      project && videoTrack
        ? project.clips.filter((clip): clip is VideoItem => isVideoItem(clip) && clip.trackId === videoTrack.id).sort((a, b) => a.startSec - b.startSec)
        : [],
    [project, videoTrack]
  );
  const mediaById = useMemo(() => new Map((project?.media ?? []).map((media) => [media.id, media])), [project]);
  const totalDuration = videoClips.length
    ? videoClips[videoClips.length - 1].startSec + videoClips[videoClips.length - 1].durationSec
    : 0;
  const projectDuration = getTimelineDuration(project?.clips ?? []);
  const activeClip = videoClips.find((clip) => clip.id === activeClipId) ?? videoClips[0] ?? null;
  const activeMedia = activeClip ? mediaById.get(activeClip.assetId) ?? null : null;

  const hasTranscriptForActiveMedia = Boolean(
    project?.transcript?.length &&
    project.transcriptMediaId &&
    project.transcriptMediaId === activeMedia?.id,
  );
  const captionCues = useMemo(
    () => (hasTranscriptForActiveMedia && project?.transcript ? buildCaptionCues(project.transcript) : []),
    [hasTranscriptForActiveMedia, project?.transcript]
  );
  const editCaptionCues = useMemo(
    () => mapCuesToEditTime(captionCues, videoClips, hasTranscriptForActiveMedia ? project?.transcriptMediaId ?? null : null),
    [captionCues, videoClips, hasTranscriptForActiveMedia, project?.transcriptMediaId]
  );
  const sourceTime = activeClip ? activeClip.trimInSec + (currentTime - activeClip.startSec) : 0;
  const activeCue = captionCues.find((cue) => sourceTime >= cue.start && sourceTime < cue.end) ?? null;

  const activeMediaFaceTrack = useMemo(
    () => (project && activeMedia ? readMediaFaceTrack(project, activeMedia.id) : { points: [], segments: [] }),
    [project, activeMedia]
  );
  const editFaceTrack = useMemo(
    () => (activeMedia ? mapFaceTrackToEditTime(activeMediaFaceTrack.points, videoClips, activeMedia.id) : []),
    [activeMediaFaceTrack, videoClips, activeMedia]
  );
  const editFaceCoverage = useMemo(
    () => (activeMedia ? mapFaceRangesToEditTime(activeMediaFaceTrack.segments, videoClips, activeMedia.id) : []),
    [activeMediaFaceTrack, videoClips, activeMedia]
  );
  const autoFramePoint = interpolateFacePoint(editFaceTrack, editFaceCoverage, currentTime);

  useEffect(() => {
    if (!activeMedia) {
      // Sync server-persisted generation history when the selected media changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMoments([]);
      return;
    }
    const latest = [...(project?.aiGenerations ?? [])]
      .reverse()
      .find((generation) => generation.sourceMediaId === activeMedia.id);
    setMoments(latest?.moments ?? []);
  }, [activeMedia, project?.aiGenerations]);

  function findClipAtTime(time: number): VideoItem | null {
    // videoClips is always VideoItem[], so the generic TimelineItem lookup
    // always actually returns a VideoItem (or null) here.
    return findClipAtTimelineTime(videoClips, time) as VideoItem | null;
  }

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const savedId = window.localStorage.getItem("clipwire-project-id");
      try {
        if (savedId) {
          const existing = await fetchProject(savedId);
          if (!cancelled) setProject(normalizeProject(existing));
          return;
        }
      } catch {
        // fall through and create a fresh project
      }
      const created = await createProject("Untitled project");
      window.localStorage.setItem("clipwire-project-id", created.id);
      if (!cancelled) setProject(normalizeProject(created));
    }
    bootstrap().catch(() => flash("Could not reach the local editing sidecar"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("clipwire-editor");
    if (!saved) return;
    try {
      const next = JSON.parse(saved);
      // Restore local editor preferences once after client hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (next.layout) setLayout(next.layout);
      if (next.captionStyle) setCaptionStyle(next.captionStyle);
    } catch {}
  }, []);

  useEffect(() => {
    window.localStorage.setItem("clipwire-editor", JSON.stringify({ layout, captionStyle }));
  }, [layout, captionStyle]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      if (event.key.toLowerCase() === "s") splitClip();
      if (event.key === "ArrowLeft") { event.preventDefault(); syncVideoTime(currentTime - (event.shiftKey ? 5 : 1 / 30)); }
      if (event.key === "ArrowRight") { event.preventDefault(); syncVideoTime(currentTime + (event.shiftKey ? 5 : 1 / 30)); }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteClipAtPlayhead(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    if (!videoRef.current || !activeClip) return;
    videoRef.current.muted = muted;
    if (playing) videoRef.current.play().catch(() => setPlaying(false));
    else videoRef.current.pause();
  }, [playing, muted, activeClip]);

  useEffect(() => {
    // Only re-seek when the active clip identity changes (scrub target or clip
    // boundary crossing). Depending on currentTime/activeClip here would fire on
    // every native timeupdate tick and fight playback.
    if (!videoRef.current || !activeClip) return;
    const desiredLocal = activeClip.trimInSec + Math.max(0, currentTime - activeClip.startSec);
    videoRef.current.currentTime = desiredLocal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipId]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2300);
  }

  function togglePlayback() {
    setPlaying((value) => !value);
  }

  async function loadSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !project) return;
    flash("Uploading and analyzing media…");
    try {
      const updated = await uploadMedia(project.id, file);
      setProject(normalizeProject(updated));
      const media = updated.media[updated.media.length - 1];
      flash(`Loaded ${media.fileName} · ${media.width}×${media.height} · ${formatTime(media.durationSec)}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function runAutoCaptions() {
    if (!project || !activeMedia) {
      flash("Upload a video first");
      return;
    }
    setTranscribing(true);
    flash("Transcribing audio…");
    try {
      const updated = await transcribeMedia(project.id, activeMedia.id);
      setProject(normalizeProject(updated));
      flash("Transcript ready");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Transcription failed");
    } finally {
      setTranscribing(false);
    }
  }

  async function persistClips(
    nextClips: TimelineItem[],
    sourceTimelineSnapshot: TimelineItem[] | null | undefined = project?.sourceTimelineSnapshot,
  ) {
    if (!project) return;
    const updated = { ...project, clips: nextClips, sourceTimelineSnapshot, updatedAt: new Date().toISOString() };
    setProject(updated);
    try {
      await saveProjectTimeline(project.id, { clips: nextClips, sourceTimelineSnapshot });
    } catch {
      flash("Could not save the edit to the sidecar");
    }
  }

  async function runFindMoments(preferences: FindMomentsPreferences) {
    if (!project || !activeMedia) {
      flash("Upload or select a video source first");
      return;
    }
    setFindingMoments(true);
    setMoments([]);
    try {
      let workingProject = project;
      if (project.transcriptMediaId !== activeMedia.id || !project.transcript?.length) {
        setTranscribing(true);
        flash("Transcribing the active source…");
        workingProject = normalizeProject(await transcribeMedia(project.id, activeMedia.id));
        setProject(workingProject);
        setTranscribing(false);
      }
      flash("Generating distinct clip candidates…");
      const result = await findMoments(project.id, {
        ...preferences,
        sourceMediaId: activeMedia.id,
      });
      setMoments(result.generation.moments);
      setProject({
        ...workingProject,
        aiGenerations: [...(workingProject.aiGenerations ?? []).slice(-9), result.generation],
        updatedAt: result.generation.createdAt,
      });
      if (!result.generation.moments.length) flash("No candidates met those settings");
      else flash(`Generated ${result.generation.moments.length} clip candidates`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Finding moments failed");
    } finally {
      setTranscribing(false);
      setFindingMoments(false);
    }
  }

  async function applyMoment(moment: MomentCandidate) {
    if (!project || !videoTrack || !activeMedia || project.transcriptMediaId !== activeMedia.id) {
      flash("This candidate no longer matches the active source");
      return;
    }
    const transcriptMediaId = activeMedia.id;
    let cursor = 0;
    const newClips: TimelineItem[] = moment.segments.map((segment) => {
      // Origin ("this came from an AI moment-detection pass") belongs on the
      // clip only as a fact about how the placement was produced -- the
      // underlying asset's own provenance is untouched, since no new asset
      // was created here, just a different trim of the existing source video.
      const clip: VideoItem = {
        id: crypto.randomUUID(),
        trackId: videoTrack.id,
        kind: "video",
        assetId: transcriptMediaId,
        trimInSec: segment.startSec,
        trimOutSec: segment.endSec,
        startSec: cursor,
        durationSec: segment.endSec - segment.startSec,
      };
      cursor += segment.endSec - segment.startSec;
      return clip;
    });
    // A moment replaces the working clip rather than appending after it — tacking a
    // 30s moment onto the end of a 40-minute source clip made it an unselectable
    // sliver of the timeline (~1% of its width).
    const otherTrackClips = project.clips.filter((clip) => clip.trackId !== videoTrack.id);
    const sourceTimelineSnapshot = project.sourceTimelineSnapshot ?? project.clips;
    await persistClips([...otherTrackClips, ...newClips], sourceTimelineSnapshot);
    setActiveClipId(newClips[0]?.id ?? null);
    syncVideoTime(0);
    flash(`"${moment.title}" opened as a working draft`);
  }

  async function restoreSourceTimeline() {
    if (!project?.sourceTimelineSnapshot?.length || !videoTrack) return;
    const restored = project.sourceTimelineSnapshot;
    const firstVideoClip = restored
      .filter((clip) => clip.trackId === videoTrack.id)
      .sort((a, b) => a.startSec - b.startSec)[0];
    await persistClips(restored, null);
    setActiveClipId(firstVideoClip?.id ?? null);
    setCurrentTime(0);
    flash("Source timeline restored");
  }

  async function splitClip() {
    if (!project) return;
    const selectedTrack = project.tracks.find((track) => track.id === selectedLayer || track.kind === selectedLayer);
    const candidates = selectedTrack
      ? project.clips.filter((clip) => clip.trackId === selectedTrack.id)
      : videoClips;
    const clip = findClipAtTimelineTime(candidates, currentTime);
    if (!clip || !isVideoItem(clip)) {
      flash("Move the playhead inside a clip to split");
      return;
    }
    const splitLocal = clip.trimInSec + (currentTime - clip.startSec);
    if (splitLocal <= clip.trimInSec + 0.05 || splitLocal >= clip.trimOutSec - 0.05) {
      flash("Move the playhead inside a clip to split");
      return;
    }
    const first: VideoItem = withVideoTrim(clip, clip.trimInSec, splitLocal);
    const second: VideoItem = { ...withVideoTrim(clip, splitLocal, clip.trimOutSec), id: crypto.randomUUID(), startSec: currentTime };
    const nextClips = project.clips.flatMap((existing) => (existing.id === clip.id ? [first, second] : [existing]));
    await persistClips(nextClips);
    flash(`Split added at ${formatTime(currentTime)}`);
  }

  async function deleteClipAtPlayhead() {
    if (!project) return;
    const selectedTrack = project.tracks.find((track) => track.id === selectedLayer || track.kind === selectedLayer);
    const candidates = selectedTrack
      ? project.clips.filter((clip) => clip.trackId === selectedTrack.id)
      : videoClips;
    const clip = findClipAtTimelineTime(candidates, currentTime);
    if (!clip) {
      flash("No clip under the playhead");
      return;
    }
    const removedLen = clip.durationSec;
    const nextClips = project.clips
      .filter((existing) => existing.id !== clip.id)
      .map((existing) =>
        existing.trackId === clip.trackId && existing.startSec > clip.startSec
          ? { ...existing, startSec: existing.startSec - removedLen }
          : existing
      );
    await persistClips(nextClips);
    setCurrentTime(Math.min(currentTime, clip.startSec));
    flash("Clip deleted");
  }

  async function startRender() {
    if (!project || !videoClips.length) {
      flash("Upload a video first");
      return;
    }
    setRendering(true);
    setRenderError(null);
    setRenderDownload(null);
    try {
      let workingProject = project;

      // Auto-reframe: track every video source actually used on the timeline,
      // not just the first one -- a multi-source timeline needs its own crop
      // per media, and re-tracking only the ranges that aren't already covered
      // (rather than the whole media every time) keeps repeat exports cheap.
      const usedMediaIds = Array.from(new Set(videoClips.map((clip) => clip.assetId)));
      for (const mediaId of usedMediaIds) {
        const media = mediaById.get(mediaId);
        if (!media || !media.mimeType.startsWith("video/")) continue;

        const required = videoClips
          .filter((clip) => clip.assetId === mediaId)
          .map((clip) => ({ startSec: clip.trimInSec, endSec: clip.trimOutSec }));
        const existing = readMediaFaceTrack(workingProject, mediaId);
        const missing = subtractRanges(required, existing.segments);
        if (!missing.length) continue;

        try {
          flash(`Tracking faces (${media.fileName})…`);
          workingProject = await trackFaces(project.id, mediaId, missing);
          setProject(workingProject);
        } catch {
          flash(`Face tracking failed for ${media.fileName} — that clip will export with a center crop`);
        }
      }

      // The server derives the full render plan straight from the (now
      // up-to-date) stored project via buildRenderPlan -- no need to hand-
      // assemble segments/cues here, so preview and export can never disagree
      // about what a given project actually contains.
      const result = await renderProject(project.id, {
        style: captionStyle,
        width: 1080,
        height: 1920,
        fps: 30,
      });
      setRenderDownload(renderDownloadUrl(result.downloadUrl));
      flash("Render complete · 1080 × 1920 MP4");
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "Render failed");
    } finally {
      setRendering(false);
    }
  }

  function selectMedia(mediaId: string) {
    const clip = project?.clips.find((candidate) => isVideoItem(candidate) && candidate.assetId === mediaId);
    if (!clip) return;
    const track = project?.tracks.find((candidate) => candidate.id === clip.trackId);
    setSelectedLayer(clip.trackId);
    if (track?.kind === "video") syncVideoTime(clip.startSec);
    else setCurrentTime(clip.startSec);
  }

  function seekToCue(cue: CaptionCue) {
    const editCue = editCaptionCues.find((candidate) => candidate.start === cue.start && candidate.end === cue.end);
    if (editCue) syncVideoTime(editCue.editStart);
  }

  function syncVideoTime(value: number) {
    const clamped = Math.max(0, Math.min(totalDuration, value));
    const clip = findClipAtTime(clamped) ?? videoClips[0] ?? null;
    setCurrentTime(clamped);
    if (!clip) return;
    if (clip.id !== activeClipId) {
      setActiveClipId(clip.id);
    } else if (videoRef.current) {
      videoRef.current.currentTime = clip.trimInSec + Math.max(0, clamped - clip.startSec);
    }
  }

  function onVideoTimeUpdate(localTime: number) {
    if (!activeClip) return;
    if (localTime >= activeClip.trimOutSec - 0.02) {
      const index = videoClips.findIndex((clip) => clip.id === activeClip.id);
      const next = videoClips[index + 1];
      if (next) {
        setCurrentTime(next.startSec);
        setActiveClipId(next.id);
      } else {
        setPlaying(false);
        setCurrentTime(totalDuration);
      }
      return;
    }
    setCurrentTime(activeClip.startSec + (localTime - activeClip.trimInSec));
  }

  return (
    <main className="editor-shell" onKeyDown={(event: ReactKeyboardEvent) => event.stopPropagation()}>
      <EditorTopbar
        projectName={project?.name ?? "Loading…"}
        duration={formatTime(totalDuration)}
        onExport={() => setShowExport(true)}
        onFormat={() => flash("Format is optimized for Shorts, Reels, and TikTok")}
      />

      <section className="editing-grid">
        <ToolRail tool={tool} onChange={setTool} />

        <aside className="asset-panel">
          <AssetPanel
            tool={tool}
            media={project?.media ?? []}
            activeMediaId={activeMedia?.id ?? null}
            onSelectMedia={selectMedia}
            loadSource={loadSource}
            captionStyle={captionStyle}
            setCaptionStyle={setCaptionStyle}
            activeCaption={activeCaption}
            setActiveCaption={setActiveCaption}
            captionCues={captionCues}
            onRunAutoCaptions={runAutoCaptions}
            transcribing={transcribing}
            onSeekToCue={seekToCue}
            hasActiveMedia={Boolean(activeMedia)}
            moments={moments}
            findingMoments={findingMoments}
            onFindMoments={runFindMoments}
            onApplyMoment={applyMoment}
            onRestoreSource={restoreSourceTimeline}
            canRestoreSource={Boolean(project?.sourceTimelineSnapshot?.length)}
            hasTranscript={hasTranscriptForActiveMedia}
            hasGeneration={Boolean(
              activeMedia &&
              project?.aiGenerations?.some((generation) => generation.sourceMediaId === activeMedia.id)
            )}
          />
        </aside>

        <PreviewStage
          activeClip={activeClip}
          activeMedia={activeMedia}
          videoRef={videoRef}
          layout={layout}
          zoom={zoom}
          mediaScale={scale}
          autoFramePoint={autoFramePoint}
          currentTime={currentTime}
          totalDuration={projectDuration}
          playing={playing}
          muted={muted}
          captionsOn={captionsOn}
          activeCue={activeCue}
          sourceTime={sourceTime}
          captionStyle={captionStyle}
          onZoomChange={setZoom}
          onTogglePlayback={togglePlayback}
          onSeek={syncVideoTime}
          onToggleMute={() => setMuted(!muted)}
          onVideoTimeUpdate={onVideoTimeUpdate}
          onVideoEnded={() => setPlaying(false)}
        />

        <InspectorPanel
          inspector={inspector}
          setInspector={setInspector}
          layout={layout}
          setLayout={setLayout}
          scale={scale}
          setScale={setScale}
          blur={blur}
          setBlur={setBlur}
          captionStyle={captionStyle}
          setCaptionStyle={setCaptionStyle}
          captionsOn={captionsOn}
          setCaptionsOn={setCaptionsOn}
        />

        <Timeline
          currentTime={currentTime}
          setCurrentTime={syncVideoTime}
          playing={playing}
          selectedLayer={selectedLayer}
          setSelectedLayer={setSelectedLayer}
          splitClip={splitClip}
          deleteClip={deleteClipAtPlayhead}
          totalDuration={totalDuration}
          tracks={project?.tracks ?? []}
          clips={project?.clips ?? []}
          mediaById={mediaById}
          activeClipId={activeClip?.id ?? null}
          editCaptionCues={editCaptionCues}
          onUpdateClips={persistClips}
        />
      </section>

      {showExport && (
        <ExportModal
          rendering={rendering}
          downloadUrl={renderDownload}
          error={renderError}
          close={() => {
            if (!rendering) {
              setShowExport(false);
              setRenderDownload(null);
              setRenderError(null);
            }
          }}
          startRender={startRender}
        />
      )}
      {toast && <div className="editor-toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function ExportModal({ rendering, downloadUrl, error, close, startRender }: { rendering: boolean; downloadUrl: string | null; error: string | null; close: () => void; startRender: () => void }) {
  return <div className="modal-backdrop" onMouseDown={close}><section className="export-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span>Export clip</span><h2>Render with captions</h2></div><button onClick={close}>×</button></header><div className="export-preview"><div className="mini-export-video"><span>1080 <em>×</em> 1920</span></div><div><strong>Ready to render</strong><small>Exports as MP4 · H.264, captions burned in using your selected caption style</small></div></div>{downloadUrl ? <div className="rendering"><span><strong>Render complete</strong></span><small>Your captioned MP4 is ready.</small></div> : rendering ? <div className="rendering"><span><strong>Rendering…</strong></span><small>This can take a little while depending on clip length.</small></div> : error ? <div className="rendering"><span><strong>Render failed</strong></span><small>{error}</small></div> : null}<footer>{downloadUrl ? <><button onClick={close}>Close</button><a className="export-confirm" href={downloadUrl} download>Download MP4 <span>↓</span></a></> : <><button onClick={close} disabled={rendering}>Cancel</button><button className="export-confirm" onClick={startRender} disabled={rendering}>{rendering ? "Rendering…" : "Export MP4"} <span>↗</span></button></>}</footer></section></div>;
}

function formatTime(seconds: number) { const whole = Math.floor(seconds); const hundredths = Math.floor((seconds - whole) * 100); return `00:${String(whole).padStart(2,"0")}.${String(hundredths).padStart(2,"0")}`; }
