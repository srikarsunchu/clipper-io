#!/usr/bin/env bash
# Provisions the local Python environment face tracking needs: a venv, its
# pinned dependencies, and the MediaPipe model files. Safe to re-run -- every
# step is skipped if it's already done, so this can also serve as a preflight
# check (rerun it if `npm run dev` reports face tracking isn't set up).
set -euo pipefail
cd "$(dirname "$0")"

# MediaPipe's Python bindings require CPython 3.12 specifically -- newer/older
# minor versions are known not to have compatible prebuilt wheels as of this
# writing.
PYTHON_BIN="${FACETRACK_SETUP_PYTHON:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "error: '$PYTHON_BIN' not found on PATH." >&2
  echo "MediaPipe needs Python 3.12 specifically. Install it (e.g. \`brew install python@3.12\`)" >&2
  echo "or set FACETRACK_SETUP_PYTHON to point at an existing 3.12 interpreter." >&2
  exit 1
fi

if [ ! -d venv ]; then
  echo "creating venv with $PYTHON_BIN..."
  "$PYTHON_BIN" -m venv venv
else
  echo "venv already exists, skipping creation"
fi

venv/bin/pip install --quiet --upgrade pip
venv/bin/pip install --quiet -r requirements.txt
echo "python dependencies installed"

mkdir -p models

download_model() {
  local name="$1" url="$2"
  if [ -f "models/$name" ]; then
    echo "models/$name already present, skipping download"
    return
  fi
  echo "downloading models/$name..."
  curl -sL --fail -o "models/$name.partial" "$url"
  mv "models/$name.partial" "models/$name"
}

# Full-range (not short-range) BlazeFace: short-range is tuned for close-up,
# front-facing selfie-style video and misses smaller/farther/off-angle faces
# common in interview/podcast footage.
download_model blaze_face_full_range.tflite \
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite"
download_model face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
download_model pose_landmarker_lite.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"

echo "face tracking setup complete."
echo "run 'npm run facetrack:test' (from sidecar/) to sanity-check the pure tracker logic."
