"use client";

export type EditorTool = "media" | "captions" | "broll" | "audio" | "elements" | "ai";

const tools: { id: EditorTool; icon: string; label: string; available: boolean }[] = [
  { id: "media", icon: "▧", label: "Media", available: true },
  { id: "captions", icon: "CC", label: "Captions", available: true },
  { id: "broll", icon: "◫", label: "B-roll", available: false },
  { id: "audio", icon: "♫", label: "Audio", available: true },
  { id: "elements", icon: "◇", label: "Elements", available: true },
  { id: "ai", icon: "✦", label: "AI edit", available: true },
];

export function EditorTopbar({
  projectName,
  duration,
  onExport,
  onFormat,
}: {
  projectName: string;
  duration: string;
  onExport: () => void;
  onFormat: () => void;
}) {
  return (
    <header className="editor-topbar">
      <div className="brand"><span className="brand-glyph">C</span><strong>clipwire</strong><i>studio</i></div>
      <div className="project-title"><span><strong>{projectName}</strong><small>Draft · saved locally</small></span></div>
      <div className="history" aria-label="Edit history">
        <button aria-label="Undo" disabled title="Undo is coming soon">↶</button>
        <button aria-label="Redo" disabled title="Redo is coming soon">↷</button>
        <span>{duration}</span>
      </div>
      <div className="top-actions">
        <button className="format-pill" onClick={onFormat}><span>▯</span> 9:16 <b>⌄</b></button>
        <button className="share-button" disabled title="Review links are coming soon">Share</button>
        <button className="export-main" onClick={onExport}>Export <span>↗</span></button>
      </div>
    </header>
  );
}

export function ToolRail({ tool, onChange }: { tool: EditorTool; onChange: (tool: EditorTool) => void }) {
  return (
    <nav className="tool-rail" aria-label="Editor tools">
      {tools.map((item) => (
        <button
          className={tool === item.id ? "tool active" : "tool"}
          onClick={() => onChange(item.id)}
          key={item.id}
          aria-pressed={tool === item.id}
          title={item.available ? item.label : `${item.label} workspace preview`}
        >
          <span>{item.icon}</span>
          <small>{item.label}</small>
          {!item.available && <i className="tool-planned">Soon</i>}
        </button>
      ))}
      <div className="rail-spacer" />
      <button className="tool" disabled><span>?</span><small>Help</small></button>
    </nav>
  );
}
