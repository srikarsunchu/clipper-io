"use client";

import { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

type Tool = "media" | "captions" | "broll" | "audio" | "elements" | "ai";
type Layout = "focus" | "split" | "gameplay";
type CaptionStyle = "pop" | "clean" | "boxed" | "karaoke";
type Inspector = "clip" | "style" | "adjust";

const tools: { id: Tool; icon: string; label: string }[] = [
  { id: "media", icon: "▧", label: "Media" },
  { id: "captions", icon: "CC", label: "Captions" },
  { id: "broll", icon: "◫", label: "B-roll" },
  { id: "audio", icon: "♫", label: "Audio" },
  { id: "elements", icon: "◇", label: "Elements" },
  { id: "ai", icon: "✦", label: "AI edit" },
];

const captionStyles: { id: CaptionStyle; label: string; sample: string }[] = [
  { id: "pop", label: "Pop", sample: "BIG IDEA" },
  { id: "clean", label: "Clean", sample: "Big idea" },
  { id: "boxed", label: "Boxed", sample: "BIG IDEA" },
  { id: "karaoke", label: "Karaoke", sample: "Big idea" },
];

const transcript = [
  ["00:00", "The biggest mistake I made was building before I understood distribution."],
  ["00:04", "I spent two years polishing a product nobody knew existed."],
  ["00:09", "Then I flipped the order: audience first, product second."],
  ["00:14", "That one change made every launch after it easier."],
];

export default function Editor() {
  const [tool, setTool] = useState<Tool>("media");
  const [layout, setLayout] = useState<Layout>("split");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("pop");
  const [inspector, setInspector] = useState<Inspector>("clip");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(7.42);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(72);
  const [sourceName, setSourceName] = useState("Founder_Podcast_Ep12.mp4");
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedLayer, setSelectedLayer] = useState("video");
  const [showExport, setShowExport] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [toast, setToast] = useState("");
  const [captionsOn, setCaptionsOn] = useState(true);
  const [blur, setBlur] = useState(18);
  const [scale, setScale] = useState(112);
  const [activeCaption, setActiveCaption] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("clipwire-editor");
    if (!saved) return;
    try {
      const next = JSON.parse(saved);
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
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      if (event.key.toLowerCase() === "s") splitClip();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); flash("Undid last change"); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    if (sourceUrl && videoRef.current) {
      videoRef.current.muted = muted;
      if (playing) videoRef.current.play().catch(() => setPlaying(false));
      else videoRef.current.pause();
    }
  }, [playing, muted, sourceUrl]);

  useEffect(() => {
    if (!playing || sourceUrl) return;
    const timer = window.setInterval(() => setCurrentTime((value) => value >= 34 ? 0 : value + .04), 40);
    return () => window.clearInterval(timer);
  }, [playing, sourceUrl]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2300);
  }

  function togglePlayback() {
    setPlaying((value) => !value);
  }

  function loadSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(file));
    setSourceName(file.name);
    setTool("captions");
    flash("Video loaded locally · transcript ready to generate");
  }

  function splitClip() {
    setSelectedLayer("video");
    flash(`Split added at ${formatTime(currentTime)}`);
  }

  function startRender() {
    setRenderProgress(4);
    const timer = window.setInterval(() => {
      setRenderProgress((value) => {
        const next = Math.min(value + 12, 100);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => { setShowExport(false); setRenderProgress(0); flash("Render complete · 1080 × 1920 MP4"); }, 650);
        }
        return next;
      });
    }, 180);
  }

  function syncVideoTime(value: number) {
    setCurrentTime(value);
    if (videoRef.current) videoRef.current.currentTime = value;
  }

  return (
    <main className="editor-shell" onKeyDown={(event: ReactKeyboardEvent) => event.stopPropagation()}>
      <header className="editor-topbar">
        <div className="brand"><span className="brand-glyph">C</span><strong>clipwire</strong><i>studio</i></div>
        <div className="project-title"><button onClick={() => flash("Back to projects")}>‹</button><span><strong>Founder distribution cut</strong><small>Draft · saved just now</small></span></div>
        <div className="history"><button aria-label="Undo" onClick={() => flash("Undid last change")}>↶</button><button aria-label="Redo" onClick={() => flash("Redid last change")}>↷</button><span>00:34.0</span></div>
        <div className="top-actions"><button className="format-pill" onClick={() => flash("Format is optimized for Shorts, Reels, and TikTok")}><span>▯</span> 9:16 <b>⌄</b></button><button className="share-button" onClick={() => flash("Review link copied")}>Share</button><button className="export-main" onClick={() => setShowExport(true)}>Export <span>↗</span></button></div>
      </header>

      <section className="editing-grid">
        <nav className="tool-rail" aria-label="Editor tools">
          {tools.map((item) => <button className={tool === item.id ? "tool active" : "tool"} onClick={() => setTool(item.id)} key={item.id}><span>{item.icon}</span><small>{item.label}</small></button>)}
          <div className="rail-spacer" /><button className="tool"><span>?</span><small>Help</small></button>
        </nav>

        <aside className="asset-panel">
          <PanelContent tool={tool} sourceName={sourceName} loadSource={loadSource} captionStyle={captionStyle} setCaptionStyle={setCaptionStyle} activeCaption={activeCaption} setActiveCaption={setActiveCaption} layout={layout} setLayout={setLayout} flash={flash} />
        </aside>

        <section className="stage-zone">
          <div className="stage-toolbar"><div><button onClick={() => setZoom(Math.max(40, zoom - 8))}>−</button><span>{zoom}%</span><button onClick={() => setZoom(Math.min(120, zoom + 8))}>＋</button><button onClick={() => setZoom(72)}>Fit</button></div><div><button onClick={() => flash("Safe zones enabled")}>⌗ Safe zones</button><button onClick={() => flash("Guides enabled")}>⌁ Guides</button></div></div>
          <div className="canvas-space">
            <div className={`video-canvas layout-${layout}`} style={{ transform: `scale(${zoom / 100})` }}>
              {sourceUrl ? <video ref={videoRef} src={sourceUrl} className="local-video" onTimeUpdate={(event) => setCurrentTime((event.target as HTMLVideoElement).currentTime)} onEnded={() => setPlaying(false)} /> : <DemoVideo layout={layout} />}
              {captionsOn && <div className={`canvas-caption caption-${captionStyle}`}><span>BUILD THE</span> <em>‏AUDIENCE</em><br /><span>BEFORE THE PRODUCT</span></div>}
              <div className="selection-box"><i className="handle tl" /><i className="handle tr" /><i className="handle bl" /><i className="handle br" /></div>
              <div className="canvas-badge">@founderfiles</div>
              <div className="platform-ui"><span>♡</span><span>◯</span><span>↗</span></div>
            </div>
          </div>
          <div className="transport"><div className="transport-left"><button onClick={() => syncVideoTime(0)}>│‹</button><button onClick={() => syncVideoTime(Math.max(0, currentTime - 5))}>−5</button><button className="transport-play" onClick={togglePlayback}>{playing ? "Ⅱ" : "▶"}</button><button onClick={() => syncVideoTime(Math.min(34, currentTime + 5))}>+5</button><button onClick={() => syncVideoTime(34)}>›│</button></div><div className="timecode"><b>{formatTime(currentTime)}</b><span>/ 00:34.00</span></div><div className="transport-right"><button onClick={() => setMuted(!muted)}>{muted ? "🔇" : "◖))"}</button><button onClick={() => flash("Playback quality: Full")}>Full⌄</button></div></div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs">{(["clip", "style", "adjust"] as Inspector[]).map((item) => <button className={inspector === item ? "active" : ""} onClick={() => setInspector(item)} key={item}>{item}</button>)}</div>
          {inspector === "clip" && <ClipInspector layout={layout} setLayout={setLayout} scale={scale} setScale={setScale} blur={blur} setBlur={setBlur} flash={flash} />}
          {inspector === "style" && <StyleInspector captionStyle={captionStyle} setCaptionStyle={setCaptionStyle} captionsOn={captionsOn} setCaptionsOn={setCaptionsOn} />}
          {inspector === "adjust" && <AdjustInspector flash={flash} />}
        </aside>

        <Timeline currentTime={currentTime} setCurrentTime={syncVideoTime} playing={playing} selectedLayer={selectedLayer} setSelectedLayer={setSelectedLayer} splitClip={splitClip} />
      </section>

      {showExport && <ExportModal progress={renderProgress} close={() => { if (!renderProgress) setShowExport(false); }} startRender={startRender} />}
      {toast && <div className="editor-toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function PanelContent({ tool, sourceName, loadSource, captionStyle, setCaptionStyle, activeCaption, setActiveCaption, layout, setLayout, flash }: {
  tool: Tool; sourceName: string; loadSource: (event: ChangeEvent<HTMLInputElement>) => void; captionStyle: CaptionStyle; setCaptionStyle: (style: CaptionStyle) => void; activeCaption: number; setActiveCaption: (index: number) => void; layout: Layout; setLayout: (layout: Layout) => void; flash: (message: string) => void;
}) {
  if (tool === "media") return <><PanelHead title="Media" action="＋" /><label className="upload-drop"><span>＋</span><strong>Upload media</strong><small>Video, audio, or image · stays on this device</small><input type="file" accept="video/*,audio/*,image/*" onChange={loadSource} /></label><div className="panel-section-title"><span>Project media</span><button>▦</button></div><div className="media-grid"><button className="media-card selected"><div className="media-thumb host"><i>▶</i><small>38:14</small></div><strong>{sourceName}</strong><span>1920 × 1080</span></button><button className="media-card"><div className="media-thumb gameplay"><small>00:34</small></div><strong>Subway_Run_04.mp4</strong><span>1080 × 1920</span></button><button className="media-card"><div className="media-thumb desk"><small>00:08</small></div><strong>Keyboard_Broll.mp4</strong><span>4K stock</span></button></div></>;
  if (tool === "captions") return <><PanelHead title="Captions" action="•••" /><button className="magic-action" onClick={() => flash("Captions generated and filler words removed")}><span>✦</span><div><strong>Auto captions</strong><small>English · remove filler words</small></div><b>↗</b></button><div className="panel-section-title"><span>Style</span><button onClick={() => flash("Caption preset saved")}>Save preset</button></div><div className="caption-presets">{captionStyles.map((style) => <button className={`${style.id} ${captionStyle === style.id ? "selected" : ""}`} onClick={() => setCaptionStyle(style.id)} key={style.id}><span>{style.sample}</span><small>{style.label}</small></button>)}</div><div className="panel-section-title"><span>Transcript</span><button>⌕</button></div><div className="transcript-list">{transcript.map(([time, line], index) => <button className={activeCaption === index ? "active" : ""} onClick={() => setActiveCaption(index)} key={time}><span>{time}</span><p contentEditable suppressContentEditableWarning>{line}</p></button>)}</div></>;
  if (tool === "broll") return <><PanelHead title="B-roll" action="⌕" /><button className="magic-action" onClick={() => flash("AI placed 4 B-roll suggestions on the timeline")}><span>✦</span><div><strong>Auto B-roll</strong><small>Match visuals to transcript</small></div><b>＋</b></button><label className="search-field">⌕<input placeholder="Search stock video" /></label><div className="chip-row"><button>Business</button><button>Technology</button><button>Money</button></div><div className="stock-grid">{["city","laptop","charts","phone","team","code"].map((item,index) => <button className={`stock ${item}`} onClick={() => flash(`${item} B-roll added above the main clip`)} key={item}><span>＋</span><small>00:0{index+4}</small></button>)}</div></>;
  if (tool === "audio") return <><PanelHead title="Audio" action="⌕" /><button className="magic-action" onClick={() => flash("Voice enhanced and background noise reduced")}><span>✦</span><div><strong>Enhance speech</strong><small>Clean noise · level voice</small></div><b>↗</b></button><label className="search-field">⌕<input placeholder="Search music & sound effects" /></label><div className="audio-tabs"><button className="active">Music</button><button>Sound effects</button></div>{[["Momentum","Sane Beats","2:18"],["Soft Focus","Helio","1:54"],["Dream Sequence","Nara","2:41"]].map(([name,artist,time],index) => <button className="audio-row" onClick={() => flash(`${name} added to the audio track`)} key={name}><span>{index === 1 ? "▶" : "♫"}</span><p><strong>{name}</strong><small>{artist}</small></p><time>{time}</time><b>＋</b></button>)}</>;
  if (tool === "elements") return <><PanelHead title="Elements" action="⌕" /><div className="element-block"><span>Text</span><button className="add-heading" onClick={() => flash("Heading added to canvas")}>Add a heading</button><div><button>Add body text</button><button>Add small text</button></div></div><div className="panel-section-title"><span>Shapes & stickers</span><button>See all</button></div><div className="element-grid"><button>→</button><button>○</button><button>★</button><button>!</button><button>⌁</button><button>#</button></div><div className="panel-section-title"><span>Brand</span><button>Manage</button></div><div className="brand-kit"><span>FF</span><div><strong>Founder Files</strong><small>2 fonts · 4 colors</small></div></div></>;
  return <><PanelHead title="AI edit" action="✦" /><div className="ai-intro"><span>✦</span><strong>What should we change?</strong><p>Describe the edit. Clipwire will suggest timeline changes you can accept or refine.</p></div><textarea className="ai-prompt" defaultValue="Tighten the hook, remove pauses, add relevant business B-roll, and use energetic captions." /><button className="run-ai" onClick={() => flash("AI edit plan created · 7 changes ready to review")}>Generate edit plan <span>↗</span></button><div className="panel-section-title"><span>Quick actions</span></div>{["Find the strongest 30 seconds","Remove silences and filler words","Turn this into a split-screen clip","Add zooms on key phrases"].map((item) => <button className="suggestion" onClick={() => flash(`${item} applied as a draft`)} key={item}>{item}<span>＋</span></button>)}<div className="campaign-assist"><span>Optional assist</span><strong>Campaign brief</strong><p>25–45s · @AmbroHQ · #buildinpublic</p><button onClick={() => flash("Campaign requirements checked against this edit")}>Check this edit</button></div></>;
}

function PanelHead({ title, action }: { title: string; action: string }) { return <div className="panel-head"><h2>{title}</h2><button>{action}</button></div>; }

function DemoVideo({ layout }: { layout: Layout }) {
  return <div className="demo-video"><div className="host-shot"><div className="studio-light one" /><div className="studio-light two" /><div className="host-person"><span /><i /></div><div className="mic" /></div>{layout !== "focus" && <div className="gameplay-shot"><div className="game-road"><i /><i /><i /></div><span className="score">012940</span><span className="coin">● 24</span></div>}<div className="grain" /></div>;
}

function ClipInspector({ layout, setLayout, scale, setScale, blur, setBlur, flash }: { layout: Layout; setLayout: (layout: Layout) => void; scale: number; setScale: (value: number) => void; blur: number; setBlur: (value: number) => void; flash: (message: string) => void }) {
  return <div className="inspector-content"><div className="inspector-section"><div className="section-row"><strong>Layout</strong><button onClick={() => flash("Layout reset")}>Reset</button></div><div className="layout-options"><button className={layout === "focus" ? "active" : ""} onClick={() => setLayout("focus")}><span className="layout-mini focus" /><small>Focus</small></button><button className={layout === "split" ? "active" : ""} onClick={() => setLayout("split")}><span className="layout-mini split" /><small>Split</small></button><button className={layout === "gameplay" ? "active" : ""} onClick={() => setLayout("gameplay")}><span className="layout-mini game" /><small>Gameplay</small></button></div></div><div className="inspector-section"><div className="section-row"><strong>Transform</strong><button onClick={() => { setScale(100); flash("Transform reset"); }}>↺</button></div><RangeControl label="Scale" value={scale} min={75} max={160} suffix="%" setValue={setScale} /><div className="two-inputs"><label><span>X</span><input defaultValue="0" /></label><label><span>Y</span><input defaultValue="-14" /></label></div><div className="transform-buttons"><button onClick={() => flash("Video fitted to canvas")}>Fit</button><button className="active" onClick={() => flash("Video filled to canvas")}>Fill</button><button onClick={() => flash("Auto reframe follows the speaker")}>✦ Auto reframe</button></div></div><div className="inspector-section"><div className="section-row"><strong>Background</strong><button>＋</button></div><div className="background-row"><button className="blur-swatch active" /><button className="color-swatch black" /><button className="color-swatch violet" /><button className="color-swatch cream" /><button className="color-swatch image">▧</button></div><RangeControl label="Blur" value={blur} min={0} max={40} setValue={setBlur} /></div><div className="inspector-section"><button className="danger-button" onClick={() => flash("Selected layer removed from draft")}>⌫ Delete selected layer</button></div></div>;
}

function StyleInspector({ captionStyle, setCaptionStyle, captionsOn, setCaptionsOn }: { captionStyle: CaptionStyle; setCaptionStyle: (value: CaptionStyle) => void; captionsOn: boolean; setCaptionsOn: (value: boolean) => void }) {
  return <div className="inspector-content"><div className="inspector-section"><div className="section-row"><strong>Captions</strong><button className={captionsOn ? "toggle on" : "toggle"} onClick={() => setCaptionsOn(!captionsOn)}><i /></button></div><div className="caption-select">{captionStyles.map((style) => <button className={captionStyle === style.id ? "active" : ""} onClick={() => setCaptionStyle(style.id)} key={style.id}>{style.label}</button>)}</div></div><div className="inspector-section"><div className="section-row"><strong>Typography</strong><button>↺</button></div><label className="select-field"><span>Font</span><select defaultValue="Anton"><option>Anton</option><option>Inter Black</option><option>Montserrat</option></select></label><RangeControl label="Size" value={54} min={24} max={80} setValue={() => {}} /><div className="format-grid"><button className="active">B</button><button><i>I</i></button><button>≡</button><button>☰</button></div></div><div className="inspector-section"><strong className="section-title">Colors</strong><div className="color-pickers"><label><i className="text-color" /><span>Text</span></label><label><i className="highlight-color" /><span>Highlight</span></label><label><i className="stroke-color" /><span>Stroke</span></label></div></div><div className="inspector-section"><strong className="section-title">Animation</strong><div className="animation-row"><button className="active">Pop</button><button>Rise</button><button>Bounce</button></div></div></div>;
}

function AdjustInspector({ flash }: { flash: (message: string) => void }) {
  return <div className="inspector-content"><div className="inspector-section"><div className="section-row"><strong>Smart enhance</strong><button className="magic-small" onClick={() => flash("Smart enhancement applied")}>✦ Apply</button></div><p className="inspector-copy">Balance exposure, clarity, and skin tones for short-form feeds.</p></div><div className="inspector-section">{[["Exposure",4], ["Contrast",12], ["Saturation",8], ["Temperature",-2], ["Sharpness",18]].map(([label,value]) => <RangeControl key={label} label={String(label)} value={Number(value)} min={-40} max={40} setValue={() => {}} />)}</div><div className="inspector-section"><div className="section-row"><strong>Effects</strong><button>＋</button></div><button className="effect-card"><span>✦</span><div><strong>Face sharpen</strong><small>Strength 24</small></div></button><button className="effect-card"><span>↗</span><div><strong>Motion zooms</strong><small>4 moments</small></div></button></div></div>;
}

function RangeControl({ label, value, min, max, suffix = "", setValue }: { label: string; value: number; min: number; max: number; suffix?: string; setValue: (value: number) => void }) { return <label className="range-control"><span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(event) => setValue(Number(event.target.value))} /><output>{value}{suffix}</output></label>; }

function Timeline({ currentTime, setCurrentTime, playing, selectedLayer, setSelectedLayer, splitClip }: { currentTime: number; setCurrentTime: (time: number) => void; playing: boolean; selectedLayer: string; setSelectedLayer: (layer: string) => void; splitClip: () => void }) {
  const playhead = `${(currentTime / 34) * 100}%`;
  return <section className="timeline-area"><div className="timeline-tools"><div><button onClick={splitClip}>✂ <span>Split</span></button><button>⌫</button><button>⧉</button><button>↔</button></div><div><button>−</button><input type="range" min="40" max="130" defaultValue="86" /><button>＋</button><button>⌘</button></div></div><div className="timeline-ruler"><span className="track-label">Tracks</span><div>{[0,5,10,15,20,25,30,34].map((time) => <button key={time} onClick={() => setCurrentTime(time)} style={{left:`${(time/34)*100}%`}}><i />{time === 0 ? "00:00" : `00:${String(time).padStart(2,"0")}`}</button>)}</div></div><div className="timeline-body"><div className="track-names"><button className={selectedLayer === "video" ? "active" : ""} onClick={() => setSelectedLayer("video")}><span>▣</span><p><strong>Video</strong><small>2 layers</small></p><i>◉</i></button><button className={selectedLayer === "captions" ? "active" : ""} onClick={() => setSelectedLayer("captions")}><span>CC</span><p><strong>Captions</strong><small>English</small></p><i>◉</i></button><button className={selectedLayer === "broll" ? "active" : ""} onClick={() => setSelectedLayer("broll")}><span>◫</span><p><strong>B-roll</strong><small>3 clips</small></p><i>◉</i></button><button className={selectedLayer === "audio" ? "active" : ""} onClick={() => setSelectedLayer("audio")}><span>♫</span><p><strong>Audio</strong><small>2 tracks</small></p><i>◉</i></button></div><div className="tracks"><div className="playhead" style={{left:playhead}}><span>{formatTime(currentTime)}</span><i /></div><div className="track video-track"><button className="clip main selected"><span className="filmstrip">{Array.from({length:12}).map((_,i) => <i key={i} />)}</span><strong>{"Founder_Podcast_Ep12.mp4"}</strong><small>00:00–00:34</small></button></div><div className="track caption-track">{[0,24,49,72].map((left,index) => <button style={{left:`${left}%`,width:index === 3 ? "25%" : "23%"}} key={left}><span>{transcript[index][1].slice(0,30)}…</span></button>)}</div><div className="track broll-track"><button className="bclip one" style={{left:"18%",width:"17%"}}>Laptop close-up</button><button className="bclip two" style={{left:"47%",width:"13%"}}>Audience graph</button><button className="bclip three" style={{left:"72%",width:"20%"}}>Launch day</button></div><div className="track audio-track"><button className="voice-wave"><span>{Array.from({length:86}).map((_,i) => <i style={{height:`${5+(i*7)%17}px`}} key={i} />)}</span><strong>Enhanced voice</strong></button><button className="music-wave"><span>{Array.from({length:86}).map((_,i) => <i style={{height:`${4+(i*11)%12}px`}} key={i} />)}</span><strong>Momentum</strong></button></div></div></div><input aria-label="Timeline playhead" className="timeline-scrubber" type="range" min="0" max="34" step=".02" value={currentTime} onChange={(event) => setCurrentTime(Number(event.target.value))} /><span className={playing ? "playing-indicator on" : "playing-indicator"}>●</span></section>;
}

function ExportModal({ progress, close, startRender }: { progress: number; close: () => void; startRender: () => void }) {
  return <div className="modal-backdrop" onMouseDown={close}><section className="export-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span>Export clip</span><h2>Founder distribution cut</h2></div><button onClick={close}>×</button></header><div className="export-preview"><div className="mini-export-video"><span>BUILD THE <em>AUDIENCE</em></span></div><div><strong>Ready to render</strong><small>All media is available · no missing fonts</small><p><i>✓</i> Captions inside safe zone</p><p><i>✓</i> Audio peaks below 0 dB</p></div></div><div className="export-settings"><label><span>Resolution</span><select><option>1080 × 1920 (Full HD)</option><option>2160 × 3840 (4K)</option></select></label><div><label><span>Frame rate</span><select><option>30 fps</option><option>60 fps</option></select></label><label><span>Format</span><select><option>MP4 · H.264</option><option>MOV</option></select></label></div><label className="switch-row"><span><strong>Burn in captions</strong><small>Include captions in the rendered video</small></span><button className="toggle on"><i /></button></label></div>{progress > 0 ? <div className="rendering"><span><strong>Rendering clip</strong><b>{progress}%</b></span><div><i style={{width:`${progress}%`}} /></div><small>You can keep editing after this prototype render finishes.</small></div> : <footer><button onClick={close}>Cancel</button><button className="export-confirm" onClick={startRender}>Export MP4 <span>↗</span></button></footer>}</section></div>;
}

function formatTime(seconds: number) { const whole = Math.floor(seconds); const hundredths = Math.floor((seconds - whole) * 100); return `00:${String(whole).padStart(2,"0")}.${String(hundredths).padStart(2,"0")}`; }
