"use client";

import type { CaptionStyleId } from "../../shared/render-contract";
import type { TimelineItem } from "../../shared/timeline";
import { captionStyles } from "./caption-styles";

type Inspector = "clip" | "style" | "adjust";
type Layout = "focus" | "split" | "gameplay";

export function InspectorPanel({
  inspector,
  setInspector,
  layout,
  setLayout,
  scale,
  setScale,
  blur,
  setBlur,
  captionStyle,
  setCaptionStyle,
  captionsOn,
  setCaptionsOn,
  activeItem,
  onUpdateItem,
}: {
  inspector: Inspector;
  setInspector: (value: Inspector) => void;
  layout: Layout;
  setLayout: (value: Layout) => void;
  scale: number;
  setScale: (value: number) => void;
  blur: number;
  setBlur: (value: number) => void;
  captionStyle: CaptionStyleId;
  setCaptionStyle: (value: CaptionStyleId) => void;
  captionsOn: boolean;
  setCaptionsOn: (value: boolean) => void;
  activeItem: TimelineItem | null;
  onUpdateItem: (item: TimelineItem) => void;
}) {
  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs">
        {(["clip", "style", "adjust"] as Inspector[]).map((item) => (
          <button className={inspector === item ? "active" : ""} onClick={() => setInspector(item)} key={item}>{item}</button>
        ))}
      </div>
      {inspector === "clip" && (
        <div className="inspector-content">
          <div className="inspector-section">
            <div className="section-row"><strong>Layout</strong><small>Preview</small></div>
            <div className="layout-options">
              {(["focus", "split", "gameplay"] as Layout[]).map((item) => (
                <button className={layout === item ? "active" : ""} onClick={() => setLayout(item)} key={item}>
                  <span className={`layout-mini ${item === "gameplay" ? "game" : item}`} /><small>{item}</small>
                </button>
              ))}
            </div>
          </div>
          {(!activeItem || activeItem.kind === "video") && (
            <>
              <div className="inspector-section">
                <div className="section-row"><strong>Transform</strong><button onClick={() => setScale(100)}>Reset</button></div>
                <RangeControl label="Scale" value={scale} min={75} max={160} suffix="%" setValue={setScale} />
              </div>
              <div className="inspector-section">
                <div className="section-row"><strong>Backdrop</strong><output>{blur}px</output></div>
                <RangeControl label="Blur" value={blur} min={0} max={40} setValue={setBlur} />
                <p className="inspector-copy">Preview controls are local until clip transform persistence lands.</p>
              </div>
            </>
          )}
          {activeItem?.kind === "image" && (
            <ImageInspector item={activeItem} onUpdate={onUpdateItem} />
          )}
          {activeItem?.kind === "text" && (
            <TextInspector item={activeItem} onUpdate={onUpdateItem} />
          )}
          {activeItem?.kind === "audio" && (
            <AudioInspector item={activeItem} onUpdate={onUpdateItem} />
          )}
        </div>
      )}
      {inspector === "style" && (
        <div className="inspector-content">
          <div className="inspector-section">
            <div className="section-row">
              <strong>Captions</strong>
              <button className={captionsOn ? "toggle on" : "toggle"} onClick={() => setCaptionsOn(!captionsOn)} aria-pressed={captionsOn}><i /></button>
            </div>
            <div className="caption-select">
              {captionStyles.map((style) => (
                <button className={captionStyle === style.id ? "active" : ""} onClick={() => setCaptionStyle(style.id)} key={style.id}>{style.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {inspector === "adjust" && (
        <div className="planned-panel inspector-planned">
          <span>◇</span><strong>Adjustments are planned</strong>
          <p>Exposure, color, and generated visual treatments will appear here once they can be reproduced exactly in export.</p>
        </div>
      )}
    </aside>
  );
}

function ImageInspector({ item, onUpdate }: { item: Extract<TimelineItem, { kind: "image" }>; onUpdate: (item: TimelineItem) => void }) {
  return (
    <div className="inspector-section">
      <div className="section-row"><strong>Image</strong></div>
      <div className="section-row"><span>Fit</span></div>
      <div className="layout-options">
        {(["cover", "contain"] as const).map((fit) => (
          <button key={fit} className={(item.fit ?? "cover") === fit ? "active" : ""} onClick={() => onUpdate({ ...item, fit })}>
            <small>{fit}</small>
          </button>
        ))}
      </div>
      <div className="section-row"><span>Motion</span></div>
      <div className="layout-options">
        {([
          { id: "none", label: "None" },
          { id: "kenBurnsIn", label: "Ken Burns in" },
          { id: "kenBurnsOut", label: "Ken Burns out" },
        ] as const).map((preset) => (
          <button
            key={preset.id}
            className={(item.motionPreset ?? "none") === preset.id ? "active" : ""}
            onClick={() => onUpdate({ ...item, motionPreset: preset.id })}
          >
            <small>{preset.label}</small>
          </button>
        ))}
      </div>
      <DurationControl durationSec={item.durationSec} onChange={(durationSec) => onUpdate({ ...item, durationSec })} />
    </div>
  );
}

function TextInspector({ item, onUpdate }: { item: Extract<TimelineItem, { kind: "text" }>; onUpdate: (item: TimelineItem) => void }) {
  return (
    <div className="inspector-section">
      <div className="section-row"><strong>Text</strong></div>
      <label className="range-control">
        <span>Content</span>
        <textarea
          className="ai-prompt"
          value={item.text}
          onChange={(event) => onUpdate({ ...item, text: event.target.value })}
          maxLength={280}
        />
      </label>
      <RangeControl
        label="Size"
        value={Math.round((item.typography?.fontSize ?? 0.08) * 1000)}
        min={30}
        max={180}
        setValue={(value) => onUpdate({ ...item, typography: { ...item.typography, fontSize: value / 1000 } })}
      />
      <label className="range-control">
        <span>Color</span>
        <input
          type="color"
          value={item.typography?.color ?? "#ffffff"}
          onChange={(event) => onUpdate({ ...item, typography: { ...item.typography, color: event.target.value } })}
        />
      </label>
      <div className="section-row"><span>Alignment</span></div>
      <div className="layout-options">
        {(["left", "center", "right"] as const).map((alignment) => (
          <button key={alignment} className={(item.alignment ?? "center") === alignment ? "active" : ""} onClick={() => onUpdate({ ...item, alignment })}>
            <small>{alignment}</small>
          </button>
        ))}
      </div>
      <DurationControl durationSec={item.durationSec} onChange={(durationSec) => onUpdate({ ...item, durationSec })} />
    </div>
  );
}

function AudioInspector({ item, onUpdate }: { item: Extract<TimelineItem, { kind: "audio" }>; onUpdate: (item: TimelineItem) => void }) {
  const volumePercent = Math.round((item.volume ?? 1) * 100);
  return (
    <div className="inspector-section">
      <div className="section-row"><strong>Audio</strong></div>
      <RangeControl label="Volume" value={volumePercent} min={0} max={150} suffix="%" setValue={(value) => onUpdate({ ...item, volume: value / 100 })} />
      <RangeControl
        label="Fade in"
        value={Math.round((item.fades?.inSec ?? 0) * 10)}
        min={0}
        max={30}
        suffix="s"
        setValue={(value) => onUpdate({ ...item, fades: { ...item.fades, inSec: value / 10 } })}
      />
      <RangeControl
        label="Fade out"
        value={Math.round((item.fades?.outSec ?? 0) * 10)}
        min={0}
        max={30}
        suffix="s"
        setValue={(value) => onUpdate({ ...item, fades: { ...item.fades, outSec: value / 10 } })}
      />
      <p className="inspector-copy">Trim the source window from the timeline by dragging the clip&rsquo;s edges.</p>
    </div>
  );
}

function DurationControl({ durationSec, onChange }: { durationSec: number; onChange: (value: number) => void }) {
  return (
    <label className="range-control">
      <span>Duration</span>
      <input
        type="number"
        min={0.1}
        step={0.1}
        value={Math.round(durationSec * 10) / 10}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value > 0) onChange(value);
        }}
      />
      <output>s</output>
    </label>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  suffix = "",
  setValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  setValue: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => setValue(Number(event.target.value))} />
      <output>{value}{suffix}</output>
    </label>
  );
}
