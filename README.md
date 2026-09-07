# Clipwire

An editor-first workspace for turning long-form footage into short-form video. Upload a recording, let AI find the moments worth clipping, then cut, caption, reframe, and export polished vertical clips from a timeline you control.

Clipwire is built for a fast loop: import once, generate candidates, pick the ones that work, and refine them in a real editor rather than a black-box "auto clip" button.

## What it does

- **Moment finding.** Transcribes your source video with word-level timestamps, then asks Claude to propose clip candidates. Each candidate has a hook-style title, a rationale, a score broken down into hook, self-containment, payoff, and clean cut, and one or more source ranges to stitch together.
- **Clip types.** Ask for the best moments overall, or target hot takes, educational segments, stories, hooks, or product mentions.
- **Timeline editor.** Multi-track timeline with video, caption, B-roll, audio, and elements tracks. Trim, split, reposition, scale, and layer items. Group items into composites that move and fade as one unit.
- **Styled captions.** Eight caption presets (Beasty, Mozi, Deep Diver, Popline, Karaoke, Simple, Pod P, Think Media) with word-level animation driven by the transcript, plus accent-color overrides.
- **Auto reframe.** Local MediaPipe face and body tracking turns 16:9 footage into a 9:16 crop that follows the speaker, with offline smoothing, dead zones, and a two-shot fallback. Focus, split, and gameplay layouts.
- **Generated assets.** AI voiceover and AI still images (B-roll, product shots, backgrounds) enter the same asset system as uploaded media, with provenance recorded on the asset. Identical generation requests are cached and never re-billed.
- **HTML overlays.** Playhead-driven overlay templates painted into the frame, such as a phone notification or a price badge. Adding a template is one component plus one registry entry.
- **Export formats.** 9:16 for Shorts, Reels, and TikTok; 1:1 for feed posts; 4:5 for Instagram portrait; 16:9 for YouTube.
- **One render pipeline.** A project compiles to a deterministic render plan. The same plan drives the live in-browser preview and the server-side H.264 export, so what you see is what you get.

## Architecture

```
app/          Next.js editor UI, served by vinext on Cloudflare Workers
shared/       Timeline model, render plan, caption cues, overlays, timeline math
sidecar/      Local Express service: storage, transcription, AI, face tracking, rendering
worker/       Cloudflare Worker entry point
tests/        Timeline math and rendered-HTML tests
```

The **editor** is a Next.js app that runs on Cloudflare via vinext. It talks to a **sidecar** running on your machine, which owns the SQLite database, media files, and everything that needs ffmpeg, Python, or an API key.

The **shared** package is the contract between them. A `Project` holds tracks, media assets, transcripts, and face tracks. `buildRenderPlan` turns a project into a pure `RenderPlan` with a stable hash. The Remotion composition in `shared/RenderPlanComposition.tsx` renders that plan both in the browser player and in the sidecar's headless renderer.

### Sidecar endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET/POST` | `/projects` | List and create projects |
| `GET/PUT` | `/projects/:id` | Load and save a project timeline |
| `POST` | `/projects/:id/media` | Upload a media file |
| `POST` | `/projects/:id/transcribe` | Word-level transcription via Whisper |
| `POST` | `/projects/:id/find-moments` | Propose clip candidates via Claude |
| `POST` | `/projects/:id/track-faces` | Run local face tracking |
| `POST` | `/projects/:id/generate/voice` | AI voiceover |
| `POST` | `/projects/:id/generate/image` | AI still image |
| `POST` | `/projects/:id/render` | Render the project to H.264 |
| `GET` | `/media/:mediaId/file` | Serve an uploaded or generated asset |
| `GET` | `/renders/:id/file` | Download a finished render |

## Requirements

- Node.js 22.13 or newer
- `ffmpeg` and `ffprobe` on your PATH
- An OpenAI API key for transcription, voiceover, and image generation
- An Anthropic API key for moment finding
- Python 3.12, only if you want face tracking

## Getting started

Install dependencies for the editor and the sidecar:

```bash
npm install
cd sidecar && npm install && cd ..
```

Configure the sidecar:

```bash
cp sidecar/.env.example sidecar/.env
```

Fill in `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. The sidecar loads this file on start.

Optionally set up face tracking. This creates a virtualenv and downloads the MediaPipe models:

```bash
cd sidecar && npm run facetrack:setup
```

Run the sidecar and the editor in two terminals:

```bash
cd sidecar && npm run dev
```

```bash
npm run dev
```

The editor expects the sidecar at `http://localhost:4310`. Override with `NEXT_PUBLIC_SIDECAR_URL` if you run it elsewhere.

## Scripts

Editor, from the repo root:

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the editor with hot reload |
| `npm run build` | Production build |
| `npm run test` | Build, then run rendered-HTML tests |
| `npm run test:timeline` | Timeline math unit tests |
| `npm run lint` | ESLint |

Sidecar, from `sidecar/`:

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the sidecar with file watching |
| `npm run test` | Sidecar tests, including subprocess hardening |
| `npm run facetrack:setup` | Create the Python venv and fetch models |
| `npm run facetrack:test` | Face-tracking unit tests, no inference |

## Data and storage

Projects are stored as JSON in a SQLite database under `sidecar/storage/`, alongside uploaded media and finished renders. That folder is ignored by git. Every project is normalized on read, so older project files keep loading as the schema evolves.

## Status

Clipwire is a personal tool under active development. The timeline model, render plan, and caption system are stable. AI video generation is stubbed and returns a clear error until a general-purpose video API is available.
