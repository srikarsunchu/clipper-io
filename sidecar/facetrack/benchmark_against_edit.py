#!/usr/bin/env python3
"""Ground-truth benchmark: how close does our auto-reframing crop path land to
a real human editor's actual crop choices?

This is an EVALUATION TOOL, not a product feature -- standalone script, not
wired into any API route.

Methodology (and its honest limitations):

1. The "edited short" is assumed to be a single continuous cut from the "raw
   source" (true for the SNEAKO reaction clip this was built against; a short
   assembled from multiple non-contiguous cuts of the source would need a
   per-segment alignment this script does not attempt).

2. Alignment is found via a coarse-then-fine approach, not audio alone: audio
   cross-correlation of short-time RMS energy envelopes shortlists several
   candidate offsets (no scipy dependency -- numpy only, in keeping with this
   project's existing pinned dependencies), then each candidate is visually
   verified by template-matching the edited short's first frame against the
   raw source at that offset, picking whichever candidate actually matches
   content-wise. This was NOT optional polish -- audio-only correlation, tried
   first, confidently (6x background) locked onto a completely wrong scene on
   this project's real test files (a subway interview short matched to an
   unrelated dinner-table scene of the same person), caught only by manually
   inspecting the extracted frames. Both `audioConfidence` and
   `visualConfidence` are reported; a low `visualConfidence` means even the
   verification step wasn't sure, and downstream results should be treated as
   unverified. A source with repetitive audio *and* repetitive visual
   framing (e.g. multiple similar-looking talking-head segments) could still
   defeat both signals at once -- this is a real, unclosed gap.

3. "The real edit's actual crop" is estimated per sampled frame via
   multi-scale template matching (cv2.matchTemplate): the edited short's frame
   is treated as a template and searched for within the corresponding raw
   source frame at several candidate scales, since the exact crop width the
   real editor used isn't known ahead of time. This assumes the edited frame
   is a straightforward crop-then-scale of the raw frame with no additional
   color grading, added graphics, or an editorial recrop/zoom mid-shot -- any
   of which would depress the match score or bias the estimated position.
   `match_confidence` (the normalized cross-correlation score at the best
   scale) is reported per sample; low-confidence samples should be treated as
   noise, not signal.

4. Our own tracker's output is produced by running the real, unmodified
   track_faces.py once over the full aligned raw-source span (the same code
   path the product actually uses), then linearly interpolating its point
   sequence to each sample timestamp.

Given all of the above, treat the reported error as an approximate, directional
signal (are we in the right neighborhood at all, roughly how far off) --
not a precise, publishable accuracy figure.
"""
import json
import os
import subprocess
import sys
import tempfile
import wave

import cv2
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRACK_FACES_SCRIPT = os.path.join(SCRIPT_DIR, "track_faces.py")
PYTHON_BIN = sys.executable

ENVELOPE_WINDOW_SEC = 0.05
CANDIDATE_TEMPLATE_SCALES = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6]  # fraction of raw-frame width the crop might be


def extract_mono_wav(video_path, out_path, sample_rate=16000):
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", str(sample_rate), "-f", "wav", out_path],
        check=True,
        capture_output=True,
    )


def read_wav_mono(path):
    with wave.open(path, "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        n_frames = wav_file.getnframes()
        sample_width = wav_file.getsampwidth()
        raw = wav_file.readframes(n_frames)
    dtype = {1: np.int8, 2: np.int16, 4: np.int32}[sample_width]
    samples = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    return samples, sample_rate


def rms_envelope(samples, sample_rate, window_sec=ENVELOPE_WINDOW_SEC):
    window_size = max(1, int(sample_rate * window_sec))
    n_windows = len(samples) // window_size
    trimmed = samples[: n_windows * window_size].reshape(n_windows, window_size)
    return np.sqrt(np.mean(trimmed**2, axis=1) + 1e-12)


def _local_maxima_offsets(correlation, top_k=5, min_separation_sec=5.0):
    """Top-K distinct correlation peaks, each at least `min_separation_sec`
    apart -- picking only the single global argmax risks locking onto a
    coincidentally-louder-but-wrong segment on a long, repetitive-energy
    source (verified against this exact project's real footage: the global
    peak alone pointed at a visually unrelated scene). Returns a list of
    (index, correlation_value), highest first."""
    min_separation_samples = max(1, int(min_separation_sec / ENVELOPE_WINDOW_SEC))
    order = np.argsort(correlation)[::-1]
    picked = []
    for index in order:
        if any(abs(int(index) - picked_index) < min_separation_samples for picked_index, _ in picked):
            continue
        picked.append((int(index), float(correlation[index])))
        if len(picked) >= top_k:
            break
    return picked


def find_alignment_offset_sec(raw_video_path, edited_video_path, top_k=5):
    """Finds where in `raw_video_path` the (assumed single continuous cut)
    `edited_video_path` comes from, via a coarse-then-fine approach:

    1. Cross-correlate RMS energy envelopes to shortlist the `top_k` most
       plausible offsets. Audio energy alone is a weak, ambiguous signal on a
       long source with repeated speech cadences -- it narrows the search
       space but should not be trusted as the final answer on its own.
    2. Visually verify each shortlisted candidate: multi-scale template-match
       the edited short's very first frame against the raw source's frame at
       that candidate offset, and pick whichever candidate's frame content
       actually matches -- a direct, content-based tiebreaker the audio signal
       alone cannot provide.

    Returns (offset_sec, audio_confidence, visual_confidence). Both
    confidences are reported so a caller can judge whether either stage was
    actually decisive, rather than assuming success."""
    with tempfile.TemporaryDirectory() as tmp:
        raw_wav = os.path.join(tmp, "raw.wav")
        edited_wav = os.path.join(tmp, "edited.wav")
        extract_mono_wav(raw_video_path, raw_wav)
        extract_mono_wav(edited_video_path, edited_wav)

        raw_samples, raw_sr = read_wav_mono(raw_wav)
        edited_samples, edited_sr = read_wav_mono(edited_wav)

    raw_env = rms_envelope(raw_samples, raw_sr)
    edited_env = rms_envelope(edited_samples, edited_sr)

    # Normalize so cross-correlation reflects the *shape* of the envelopes,
    # not their absolute loudness (the two files may have been mixed/exported
    # at different levels).
    raw_env = (raw_env - raw_env.mean()) / (raw_env.std() + 1e-9)
    edited_env = (edited_env - edited_env.mean()) / (edited_env.std() + 1e-9)

    correlation = np.correlate(raw_env, edited_env, mode="valid")
    background = np.mean(np.abs(correlation)) + 1e-9
    candidates = _local_maxima_offsets(correlation, top_k=top_k)

    edited_cap = cv2.VideoCapture(edited_video_path)
    raw_cap = cv2.VideoCapture(raw_video_path)
    edited_first_frame = read_frame_at(edited_cap, 0.0)
    edited_cap.release()

    best = None  # (offset_sec, audio_confidence, visual_confidence)
    for index, peak in candidates:
        offset_sec = index * ENVELOPE_WINDOW_SEC
        audio_confidence = float(peak / background)
        raw_frame = read_frame_at(raw_cap, offset_sec)
        if raw_frame is None or edited_first_frame is None:
            continue
        estimate = estimate_real_crop_center(edited_first_frame, raw_frame)
        visual_confidence = estimate[2] if estimate is not None else 0.0
        if best is None or visual_confidence > best[2]:
            best = (offset_sec, audio_confidence, visual_confidence)
    raw_cap.release()

    if best is None:
        # No candidate could even be visually checked (e.g. very short raw
        # source) -- fall back to the raw top audio peak with zero visual
        # confidence, clearly signaling it is unverified.
        index, peak = candidates[0]
        return index * ENVELOPE_WINDOW_SEC, float(peak / background), 0.0
    return best


def run_tracker(video_path, start_sec, end_sec, sample_fps=6.0):
    result = subprocess.run(
        [PYTHON_BIN, TRACK_FACES_SCRIPT, video_path, str(start_sec), str(end_sec), str(sample_fps)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def interpolate_our_points(points, t):
    if not points:
        return None
    if t <= points[0]["timeSec"]:
        return points[0]["centerX"], points[0]["centerY"]
    if t >= points[-1]["timeSec"]:
        return points[-1]["centerX"], points[-1]["centerY"]
    for a, b in zip(points, points[1:]):
        if a["timeSec"] <= t <= b["timeSec"]:
            span = b["timeSec"] - a["timeSec"]
            ratio = (t - a["timeSec"]) / span if span > 0 else 0.0
            return (
                a["centerX"] + (b["centerX"] - a["centerX"]) * ratio,
                a["centerY"] + (b["centerY"] - a["centerY"]) * ratio,
            )
    return points[-1]["centerX"], points[-1]["centerY"]


def read_frame_at(cap, t_sec):
    cap.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000)
    ok, frame = cap.read()
    return frame if ok else None


def estimate_real_crop_center(edited_frame, raw_frame, candidate_scales=CANDIDATE_TEMPLATE_SCALES):
    """Multi-scale template match: treat `edited_frame` as a crop of
    `raw_frame` at an unknown scale/position. Tries each candidate crop width
    (as a fraction of the raw frame's width, holding the edited frame's aspect
    ratio), resizes the edited frame down to that candidate size, and searches
    for its best-matching location in the raw frame. Returns
    (center_x_norm, center_y_norm, confidence) for the best-scoring scale, or
    None if the raw frame is smaller than every candidate (shouldn't happen
    given a landscape source and a portrait crop, but guarded defensively)."""
    raw_h, raw_w = raw_frame.shape[:2]
    edited_h, edited_w = edited_frame.shape[:2]
    aspect = edited_h / edited_w

    best = None
    for scale in candidate_scales:
        crop_w = int(raw_w * scale)
        crop_h = int(crop_w * aspect)
        if crop_w < 8 or crop_h < 8 or crop_h >= raw_h or crop_w >= raw_w:
            continue
        template = cv2.resize(edited_frame, (crop_w, crop_h), interpolation=cv2.INTER_AREA)
        result = cv2.matchTemplate(raw_frame, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)
        if best is None or max_val > best[0]:
            center_x = (max_loc[0] + crop_w / 2) / raw_w
            center_y = (max_loc[1] + crop_h / 2) / raw_h
            best = (max_val, center_x, center_y)

    if best is None:
        return None
    confidence, center_x, center_y = best
    return center_x, center_y, confidence


def main():
    if len(sys.argv) < 3:
        print("usage: benchmark_against_edit.py <raw_source_path> <edited_short_path> [sample_interval_sec]", file=sys.stderr)
        sys.exit(1)

    raw_path = sys.argv[1]
    edited_path = sys.argv[2]
    sample_interval_sec = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

    print("Aligning edited short against raw source via audio cross-correlation...", file=sys.stderr)
    offset_sec, audio_confidence, visual_confidence = find_alignment_offset_sec(raw_path, edited_path)
    print(
        f"Estimated offset: raw source {offset_sec:.2f}s == edited short 0.00s "
        f"(audio confidence {audio_confidence:.2f}, visual confidence {visual_confidence:.2f})",
        file=sys.stderr,
    )
    if visual_confidence < 0.3:
        print(
            "WARNING: visual confidence is low -- this alignment may well be wrong. "
            "Treat downstream results as unverified.",
            file=sys.stderr,
        )

    edited_cap = cv2.VideoCapture(edited_path)
    edited_duration = edited_cap.get(cv2.CAP_PROP_FRAME_COUNT) / (edited_cap.get(cv2.CAP_PROP_FPS) or 30.0)

    raw_cap = cv2.VideoCapture(raw_path)

    print(f"Running our tracker across the aligned raw-source span [{offset_sec:.2f}, {offset_sec + edited_duration:.2f}]...", file=sys.stderr)
    tracker_output = run_tracker(raw_path, offset_sec, offset_sec + edited_duration)
    our_points = tracker_output["points"]

    samples = []
    t = 0.0
    while t < edited_duration:
        source_t = offset_sec + t
        edited_frame = read_frame_at(edited_cap, t)
        raw_frame = read_frame_at(raw_cap, source_t)
        if edited_frame is None or raw_frame is None:
            t += sample_interval_sec
            continue

        real_estimate = estimate_real_crop_center(edited_frame, raw_frame)
        our_point = interpolate_our_points(our_points, source_t)
        if real_estimate is None or our_point is None:
            t += sample_interval_sec
            continue

        real_x, real_y, match_confidence = real_estimate
        our_x, our_y = our_point
        error = ((real_x - our_x) ** 2 + (real_y - our_y) ** 2) ** 0.5
        samples.append(
            {
                "editTimeSec": round(t, 2),
                "sourceTimeSec": round(source_t, 2),
                "ourCenter": {"x": round(our_x, 4), "y": round(our_y, 4)},
                "realEstimatedCenter": {"x": round(real_x, 4), "y": round(real_y, 4)},
                "matchConfidence": round(match_confidence, 4),
                "normalizedError": round(error, 4),
            }
        )
        t += sample_interval_sec

    edited_cap.release()
    raw_cap.release()

    if not samples:
        print(json.dumps({"error": "No usable samples -- check alignment and file paths"}))
        sys.exit(1)

    errors = [s["normalizedError"] for s in samples]
    confidences = [s["matchConfidence"] for s in samples]
    high_confidence = [s for s in samples if s["matchConfidence"] >= 0.5]
    high_confidence_errors = [s["normalizedError"] for s in high_confidence] or errors

    report = {
        "alignment": {
            "offsetSec": round(offset_sec, 2),
            "audioConfidence": round(audio_confidence, 2),
            "visualConfidence": round(visual_confidence, 2),
        },
        "sampleCount": len(samples),
        "highConfidenceSampleCount": len(high_confidence),
        "meanNormalizedError": round(sum(errors) / len(errors), 4),
        "meanNormalizedErrorHighConfidenceOnly": round(sum(high_confidence_errors) / len(high_confidence_errors), 4),
        "meanMatchConfidence": round(sum(confidences) / len(confidences), 4),
        "samples": samples,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
