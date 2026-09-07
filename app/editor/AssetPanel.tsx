"use client";
/* eslint-disable @next/next/no-img-element -- media is streamed by the local sidecar */

import { useRef, useState, type ChangeEvent } from "react";
import type { CaptionStyleId } from "../../shared/render-contract";
import type { MediaAsset } from "../../shared/timeline";
import type { CaptionCue } from "../../shared/timeline-math";
import {
  AI_CLIP_TYPES,
  type AiClipType,
  type FindMomentsPreferences,
} from "../../shared/ai-edit";
import { mediaFileUrl, type MomentCandidate, type TtsVoice } from "../sidecar-client";
import type { EditorTool } from "./EditorChrome";
import { captionStyles } from "./caption-styles";

export function AssetPanel({
  tool,
  media,
  activeMediaId,
  onSelectMedia,
  loadSource,
  captionStyle,
  setCaptionStyle,
  activeCaption,
  setActiveCaption,
  captionCues,
  onRunAutoCaptions,
  transcribing,
  onSeekToCue,
  hasActiveMedia,
  moments,
  findingMoments,
  onFindMoments,
  onApplyMoment,
  onRestoreSource,
  canRestoreSource,
  hasTranscript,
  hasGeneration,
  onAddText,
  onGenerateVoiceover,
  generatingVoice,
  onGenerateImage,
  generatingImage,
}: {
  tool: EditorTool;
  media: MediaAsset[];
  activeMediaId: string | null;
  onSelectMedia: (mediaId: string) => void;
  loadSource: (event: ChangeEvent<HTMLInputElement>) => void;
  captionStyle: CaptionStyleId;
  setCaptionStyle: (style: CaptionStyleId) => void;
  activeCaption: number;
  setActiveCaption: (index: number) => void;
  captionCues: CaptionCue[];
  onRunAutoCaptions: () => void;
  transcribing: boolean;
  onSeekToCue: (cue: CaptionCue) => void;
  hasActiveMedia: boolean;
  moments: MomentCandidate[];
  findingMoments: boolean;
  onFindMoments: (preferences: FindMomentsPreferences) => void;
  onApplyMoment: (moment: MomentCandidate) => void;
  onRestoreSource: () => void;
  canRestoreSource: boolean;
  hasTranscript: boolean;
  hasGeneration: boolean;
  onAddText: () => void;
  onGenerateVoiceover: (text: string, voice?: TtsVoice) => void;
  generatingVoice: boolean;
  onGenerateImage: (prompt: string) => void;
  generatingImage: boolean;
}) {
  const [selectedTypes, setSelectedTypes] = useState<AiClipType[]>(["best", "hot-take", "educational"]);
  const [candidateCount, setCandidateCount] = useState(6);
  const [durationRange, setDurationRange] = useState("15-45");
  const [direction, setDirection] = useState("");
  const [voiceoverText, setVoiceoverText] = useState("");
  const [voice, setVoice] = useState<TtsVoice>("alloy");
  const [imagePrompt, setImagePrompt] = useState("");

  function toggleClipType(type: AiClipType) {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        return current.length === 1 ? current : current.filter((item) => item !== type);
      }
      return [...current, type];
    });
  }

  function generateClips() {
    const [minDurationSec, maxDurationSec] = durationRange.split("-").map(Number);
    onFindMoments({
      clipTypes: selectedTypes,
      count: candidateCount,
      minDurationSec,
      maxDurationSec,
      prompt: direction.trim() || undefined,
    });
  }

  if (tool === "media") {
    return (
      <>
        <PanelHead title="Media" />
        <label className="upload-drop">
          <span>＋</span><strong>Upload media</strong><small>Video, audio, or image · stays on this device</small>
          <input type="file" accept="video/*,audio/*,image/*" onChange={loadSource} />
        </label>
        <div className="panel-section-title"><span>Project media</span><small>{media.length}</small></div>
        <div className="media-grid">
          {media.map((item) => (
            <button
              className={item.id === activeMediaId ? "media-card selected" : "media-card"}
              onClick={() => onSelectMedia(item.id)}
              key={item.id}
            >
              <MediaThumbnail media={item} />
              <strong>{item.fileName}</strong>
              <span>{item.width} × {item.height}</span>
            </button>
          ))}
          {!media.length && <p className="inspector-copy">No media yet — upload a file above.</p>}
        </div>
      </>
    );
  }

  if (tool === "captions") {
    return (
      <>
        <PanelHead title="Captions" />
        <button className="magic-action" disabled={transcribing || !hasActiveMedia} onClick={onRunAutoCaptions}>
          <span>✦</span><div><strong>{transcribing ? "Transcribing…" : "Auto captions"}</strong><small>English · word-level timing</small></div><b>↗</b>
        </button>
        <div className="panel-section-title"><span>Viral presets</span></div>
        <div className="caption-presets">
          {captionStyles.map((style) => (
            <button className={`${style.id} ${captionStyle === style.id ? "selected" : ""}`} onClick={() => setCaptionStyle(style.id)} key={style.id}>
              <span className="preset-preview"><b>{style.sample}</b><em>{style.accent}</em></span>
              <span className="preset-meta"><small>{style.label}</small><i>{style.motion}</i></span>
            </button>
          ))}
        </div>
        <div className="panel-section-title"><span>Transcript</span></div>
        <div className="transcript-list">
          {captionCues.map((cue, index) => (
            <button
              className={activeCaption === index ? "active" : ""}
              onClick={() => { setActiveCaption(index); onSeekToCue(cue); }}
              key={`${cue.start}-${index}`}
            >
              <span>{formatTime(cue.start)}</span>
              <p>{cue.words.map((word) => word.word).join(" ")}</p>
            </button>
          ))}
          {!captionCues.length && <p className="inspector-copy">No transcript yet — click Auto captions above.</p>}
        </div>
      </>
    );
  }

  if (tool === "ai") {
    return (
      <>
        <PanelHead title="AI edit" />
        <div className="ai-intro">
          <span>✦</span><strong>Turn this source into clips</strong>
          <p>Analyzes the active source, proposes different clip angles, and keeps every candidate available for review.</p>
        </div>
        <div className="ai-settings">
          <div className="ai-control-group">
            <span>Clip types</span>
            <div className="ai-type-grid">
              {AI_CLIP_TYPES.map((type) => (
                <button
                  type="button"
                  className={selectedTypes.includes(type) ? "active" : ""}
                  onClick={() => toggleClipType(type)}
                  aria-pressed={selectedTypes.includes(type)}
                  key={type}
                >
                  {formatClipType(type)}
                </button>
              ))}
            </div>
          </div>
          <div className="ai-setting-row">
            <label><span>Clips</span><select value={candidateCount} onChange={(event) => setCandidateCount(Number(event.target.value))}><option value={3}>3</option><option value={6}>6</option><option value={9}>9</option><option value={12}>12</option></select></label>
            <label><span>Length</span><select value={durationRange} onChange={(event) => setDurationRange(event.target.value)}><option value="5-15">5–15s</option><option value="15-45">15–45s</option><option value="30-60">30–60s</option><option value="60-90">60–90s</option></select></label>
          </div>
          <label><span>Direction <small>Optional</small></span><textarea className="ai-prompt" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="e.g. Focus on founder lessons and surprising mistakes" maxLength={500} /></label>
        </div>
        <button className="run-ai" disabled={findingMoments || transcribing || !hasActiveMedia} onClick={generateClips}>
          {transcribing ? "Transcribing source…" : findingMoments ? "Generating clip set…" : hasTranscript ? "Generate clips" : "Analyze source & generate"} <span>↗</span>
        </button>
        {!hasActiveMedia && <p className="inspector-copy panel-message">Upload or select a video source first.</p>}
        {hasGeneration && !findingMoments && moments.length === 0 && (
          <p className="inspector-copy panel-message">No candidates passed the quality checks. Try a shorter length, another clip type, or a source with clearer dialogue.</p>
        )}
        {canRestoreSource && <button className="restore-source" onClick={onRestoreSource}>Restore source timeline</button>}
        {moments.length > 0 && <div className="panel-section-title"><span>Generated clips</span><small>{moments.length}</small></div>}
        {moments.map((moment) => {
          const duration = moment.segments.reduce((sum, segment) => sum + segment.endSec - segment.startSec, 0);
          return (
            <div className="campaign-assist ai-candidate" key={moment.id}>
              <span>{formatClipType(moment.type)} · {moment.segments.length > 1 ? `${moment.segments.length} segments · ` : ""}{formatTime(duration)} · {moment.score}/100</span>
              <strong>{moment.title}</strong><p>{moment.reasoning}</p>
              <blockquote>{moment.transcriptExcerpt}</blockquote>
              <div className="candidate-scores"><span>Hook {moment.scoreBreakdown.hook}</span><span>Context {moment.scoreBreakdown.selfContained}</span><span>Payoff {moment.scoreBreakdown.payoff}</span><span>Cut {moment.scoreBreakdown.cleanCut}</span></div>
              <button onClick={() => onApplyMoment(moment)}>Open as working draft</button>
            </div>
          );
        })}
      </>
    );
  }

  if (tool === "audio") {
    return (
      <>
        <PanelHead title="Audio" />
        <label className="upload-drop">
          <span>♫</span><strong>Upload audio</strong><small>Music or sound effects · placed on the Audio track</small>
          <input type="file" accept="audio/*" onChange={loadSource} />
        </label>
        <div className="panel-section-title"><span>AI voiceover</span></div>
        <div className="campaign-assist">
          <span>Faceless narration</span>
          <textarea
            className="ai-prompt"
            value={voiceoverText}
            onChange={(event) => setVoiceoverText(event.target.value)}
            placeholder="Type the line you want narrated…"
            maxLength={2000}
          />
          <div className="ai-setting-row">
            <label><span>Voice</span>
              <select value={voice} onChange={(event) => setVoice(event.target.value as TtsVoice)}>
                <option value="alloy">Alloy</option>
                <option value="onyx">Onyx</option>
                <option value="nova">Nova</option>
                <option value="shimmer">Shimmer</option>
                <option value="echo">Echo</option>
                <option value="fable">Fable</option>
              </select>
            </label>
          </div>
          <button
            disabled={generatingVoice || !voiceoverText.trim()}
            onClick={() => onGenerateVoiceover(voiceoverText.trim(), voice)}
          >
            {generatingVoice ? "Generating…" : "Generate voiceover"}
          </button>
        </div>
        <div className="panel-section-title"><span>Project media</span><small>{media.filter((item) => item.mimeType.startsWith("audio/")).length}</small></div>
        <div className="media-grid">
          {media.filter((item) => item.mimeType.startsWith("audio/")).map((item) => (
            <button className="media-card" key={item.id} onClick={() => onSelectMedia(item.id)}>
              <MediaThumbnail media={item} />
              <strong>{item.fileName}</strong>
            </button>
          ))}
          {!media.some((item) => item.mimeType.startsWith("audio/")) && (
            <p className="inspector-copy">No audio yet — upload a file above. Volume, fades, and trimming live in the Inspector once it&rsquo;s on the timeline.</p>
          )}
        </div>
      </>
    );
  }

  if (tool === "elements") {
    return (
      <>
        <PanelHead title="Elements" />
        <button className="magic-action" onClick={onAddText}>
          <span>T</span><div><strong>Add text card</strong><small>Editable caption-style text on its own track</small></div><b>＋</b>
        </button>
        <p className="inspector-copy panel-message">Select a text card on the timeline to edit its content, size, color, and alignment in the Inspector.</p>
        <div className="panel-section-title"><span>AI image</span></div>
        <div className="campaign-assist">
          <span>Generated visual</span>
          <textarea
            className="ai-prompt"
            value={imagePrompt}
            onChange={(event) => setImagePrompt(event.target.value)}
            placeholder="e.g. Clean product shot of a skincare bottle on a marble surface, soft studio light"
            maxLength={2000}
          />
          <button disabled={generatingImage || !imagePrompt.trim()} onClick={() => onGenerateImage(imagePrompt.trim())}>
            {generatingImage ? "Generating…" : "Generate image"}
          </button>
        </div>
      </>
    );
  }

  const planned = {
    broll: ["B-roll", "Contextual stock search and AI-recommended cutaways will live here."],
  }[tool] ?? ["Workspace", "This workspace is planned."];

  return (
    <>
      <PanelHead title={planned[0]} badge="Planned" />
      <div className="planned-panel">
        <span>◇</span><strong>Coming next</strong><p>{planned[1]}</p>
        <small>The timeline now shows an honest empty track until these tools are connected.</small>
      </div>
    </>
  );
}

function PanelHead({ title, badge }: { title: string; badge?: string }) {
  return <div className="panel-head"><h2>{title}</h2>{badge && <span className="panel-badge">{badge}</span>}</div>;
}

function MediaThumbnail({ media }: { media: MediaAsset }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const thumbnailTime = Math.min(1, Math.max(0, media.durationSec * 0.05));

  function showThumbnail() {
    if (videoRef.current) videoRef.current.currentTime = thumbnailTime;
  }

  if (media.mimeType.startsWith("image/")) {
    return <div className="media-thumb"><img src={mediaFileUrl(media.id)} alt="" draggable={false} /><small>Image</small></div>;
  }

  if (media.mimeType.startsWith("video/") && !failed) {
    return (
      <div
        className={`media-thumb media-video-thumb ${ready ? "ready" : ""}`}
        onPointerEnter={() => {
          if (!videoRef.current) return;
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }}
        onPointerLeave={() => {
          videoRef.current?.pause();
          showThumbnail();
        }}
      >
        <video
          ref={videoRef}
          src={mediaFileUrl(media.id)}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={showThumbnail}
          onSeeked={() => setReady(true)}
          onError={() => setFailed(true)}
        />
        <span className="thumbnail-loading" aria-hidden="true" />
        <small>{formatTime(media.durationSec)}</small>
      </div>
    );
  }

  return (
    <div className="media-thumb media-audio-thumb">
      <span>{media.mimeType.startsWith("audio/") ? "♫" : "Media"}</span>
      <i aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <b key={index} />)}</i>
      <small>{formatTime(media.durationSec)}</small>
    </div>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const whole = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}`;
}

function formatClipType(type: AiClipType) {
  return {
    best: "Best moments",
    "hot-take": "Hot takes",
    educational: "Teach me",
    story: "Stories",
    hook: "Hooks",
    product: "Product",
  }[type];
}
