# Face tracking (sidecar/facetrack)

Local, free, MediaPipe-based face + body tracking used to auto-reframe 16:9
source footage into a 9:16 crop. Runs as a Python subprocess spawned by
`sidecar/src/faceTrack.ts` -- there is no cloud API involved.

## Setup

```
npm run facetrack:setup   # from sidecar/
```

This creates `venv/`, installs the pinned dependencies in `requirements.txt`,
and downloads the three MediaPipe model files into `models/` (skipped if
already present, so it's safe to re-run any time as a preflight check).

Requires Python **3.12** specifically on PATH as `python3.12` (MediaPipe's
prebuilt wheels don't yet cover 3.13+, as of this writing). Override the
interpreter with `FACETRACK_SETUP_PYTHON=/path/to/python3.12` if it's not on
PATH under that name.

## Overriding the interpreter at runtime

`sidecar/src/faceTrack.ts` normally spawns `venv/bin/python` (or
`venv\Scripts\python.exe` on Windows) next to this README. Set
`FACETRACK_PYTHON_BIN` in the sidecar's environment to point at a different
interpreter instead (e.g. a system-wide install, or a differently-located venv).

## Testing

```
npm run facetrack:test   # from sidecar/ -- pure-logic unit tests, no video/ML inference
npm run test              # from sidecar/ -- includes faceTrack.ts subprocess-hardening tests
```

## Known limitations

- No rotation/display-matrix handling: a portrait clip stored as landscape
  pixels with a rotation tag can be read pre-rotation. See the comment at the
  top of `track_faces.py`.
- `opencv-python`, `opencv-contrib-python`, and `opencv-python-headless` are
  all installed side by side (see the comment in `requirements.txt`) --
  `scenedetect`'s own dependency on plain `opencv-python` isn't satisfied by
  the contrib build, so both end up in the venv. This is the tested-working
  configuration, not a mistake to "clean up" by removing one.
