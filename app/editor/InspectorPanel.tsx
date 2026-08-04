"use client";

import type { CaptionStyleId } from "../../shared/render-contract";
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
          <div className="inspector-section">
            <div className="section-row"><strong>Transform</strong><button onClick={() => setScale(100)}>Reset</button></div>
            <RangeControl label="Scale" value={scale} min={75} max={160} suffix="%" setValue={setScale} />
          </div>
          <div className="inspector-section">
            <div className="section-row"><strong>Backdrop</strong><output>{blur}px</output></div>
            <RangeControl label="Blur" value={blur} min={0} max={40} setValue={setBlur} />
            <p className="inspector-copy">Preview controls are local until clip transform persistence lands.</p>
          </div>
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
