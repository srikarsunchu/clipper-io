#!/usr/bin/env python3
# Known limitation: this reads frames via OpenCV's VideoCapture, which does not
# reliably auto-apply a video's rotation/display-matrix metadata across
# platforms/builds -- a portrait clip stored as landscape pixels with a 90deg
# display-rotation tag can be read pre-rotation, which would throw off the
# normalized centerX/centerY this script emits. ffprobe.ts already extracts
# width/height for other purposes; plumbing its rotation tag through here and
# rotating the frame (or the emitted coordinates) before detection would close
# this gap, but is not implemented. Content captured/exported without a
# separate rotation tag (the common case for this project's source videos) is
# unaffected.
import json
import os
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from scenedetect import detect as detect_scenes, ContentDetector

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
DETECTOR_MODEL_PATH = os.path.join(MODELS_DIR, "blaze_face_full_range.tflite")
LANDMARKER_MODEL_PATH = os.path.join(MODELS_DIR, "face_landmarker.task")
POSE_MODEL_PATH = os.path.join(MODELS_DIR, "pose_landmarker_lite.task")

MAX_FACES_PER_FRAME = 4
MATCH_THRESHOLD = 0.15  # normalized center-distance gate to even consider two detections the same track
SIZE_COST_WEIGHT = 0.5  # tie-breaks near-equidistant matches by bbox-size similarity, reducing swaps when faces cross
TRACK_HISTORY_LEN = 6
MIN_HISTORY_FOR_SCORE = 3
SWITCH_MARGIN = 1.5  # a challenger must beat the current speaker's score by this ratio to take over
POSE_MIN_VISIBILITY = 0.5
SHOULDER_HIP_INDICES = [11, 12, 23, 24]  # left/right shoulder, left/right hip
AMBIGUOUS_ACTIVITY_MARGIN = 1.2  # top-2 scores within this ratio => treat as comparably active, widen instead of guessing
DEAD_ZONE_HALF_WIDTH = 0.20  # each side of the committed center; ~40% of frame width/height total
SMOOTHING_STRENGTH = 8.0  # Whittaker smoother regularization weight; 0 = raw passthrough
SPEECH_GAP_MERGE_SEC = 0.6  # gaps under this don't split a speech-active interval (matches shared/timeline-math.ts's caption-cue grouping)


class Track:
    def __init__(self, track_id, cx, cy, size):
        self.id = track_id
        self.cx = cx
        self.cy = cy
        self.size = size
        self.jaw_open_history = []
        self.missed = 0

    def update(self, cx, cy, size, jaw_open):
        self.cx = cx
        self.cy = cy
        self.size = size
        self.missed = 0
        if jaw_open is not None:
            self.jaw_open_history.append(jaw_open)
            if len(self.jaw_open_history) > TRACK_HISTORY_LEN:
                self.jaw_open_history.pop(0)

    def activity_score(self):
        # Variance of recent mouth-open values: a talking mouth opens and closes
        # repeatedly (high variance); a listening/still mouth barely moves (low
        # variance). None means we don't have enough landmark data to judge this
        # face at all (e.g. it's in profile and the landmark mesh model couldn't
        # fit), so it should never outrank a face we *can* actually score.
        if len(self.jaw_open_history) < MIN_HISTORY_FOR_SCORE:
            return None
        mean = sum(self.jaw_open_history) / len(self.jaw_open_history)
        return sum((x - mean) ** 2 for x in self.jaw_open_history) / len(self.jaw_open_history)


def assign_detections_to_tracks(tracks, detections):
    """Matches each detection (a dict with cx/cy/size) against the existing
    tracks list, greedily taking the globally-cheapest (track, detection) pair
    first rather than resolving in raw detection order. Resolving in raw order
    is what causes identity swaps when two faces cross: a worse match can claim
    a track before a better match for a different detection gets a turn. Cost
    blends center distance (primary) with bbox-size similarity (tie-breaker),
    since two crossing faces are often momentarily equidistant from a track but
    rarely the same apparent size.

    Returns a dict mapping detection index -> matched Track, omitting any
    detection that should start a new track instead.
    """
    candidates = []
    for track_index, track in enumerate(tracks):
        for detection_index, detection in enumerate(detections):
            dist = ((track.cx - detection["cx"]) ** 2 + (track.cy - detection["cy"]) ** 2) ** 0.5
            if dist >= MATCH_THRESHOLD:
                continue
            size_diff = abs(track.size - detection["size"]) / max(track.size, detection["size"], 1e-6)
            cost = dist + SIZE_COST_WEIGHT * size_diff
            candidates.append((cost, track_index, detection_index))
    candidates.sort(key=lambda c: c[0])

    assignments = {}
    matched_track_indices = set()
    matched_detection_indices = set()
    for _cost, track_index, detection_index in candidates:
        if track_index in matched_track_indices or detection_index in matched_detection_indices:
            continue
        matched_track_indices.add(track_index)
        matched_detection_indices.add(detection_index)
        assignments[detection_index] = tracks[track_index]
    return assignments


def get_jaw_open(landmarker, rgb_frame, bbox, width, height):
    pad = int(max(bbox.width, bbox.height) * 0.6)
    x0 = max(0, bbox.origin_x - pad)
    y0 = max(0, bbox.origin_y - pad)
    x1 = min(width, bbox.origin_x + bbox.width + pad)
    y1 = min(height, bbox.origin_y + bbox.height + pad)
    if x1 <= x0 or y1 <= y0:
        return None
    crop = np.ascontiguousarray(rgb_frame[y0:y1, x0:x1])
    crop_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=crop)
    result = landmarker.detect(crop_image)
    if not result.face_blendshapes:
        return None
    for category in result.face_blendshapes[0]:
        if category.category_name == "jawOpen":
            return category.score
    return None


def body_anchor_point(pose_landmarks):
    # Midpoint of the visible shoulder/hip landmarks. Used as a fallback crop
    # anchor when no face is detectable at all -- shoulders/hips stay visible
    # when a subject turns away or walks off, unlike a face detector, which
    # has zero signal the moment the face itself isn't visible.
    pts = []
    for idx in SHOULDER_HIP_INDICES:
        lm = pose_landmarks[idx]
        visibility = lm.visibility if lm.visibility is not None else 1.0
        if visibility >= POSE_MIN_VISIBILITY:
            pts.append((lm.x, lm.y))
    if len(pts) < 2:
        return None
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return cx, cy


def find_cut_times(video_path, start_sec, end_sec):
    try:
        scenes = detect_scenes(video_path, ContentDetector(), start_time=start_sec, end_time=end_sec)
    except Exception:
        return []
    # scenes[0] starts at start_sec by construction -- that's not a cut, it's
    # just where our segment begins, so only later scene starts count as cuts.
    return [scene[0].seconds for scene in scenes[1:]]


def age_out_tracks(tracks, matched_ids, max_missed=2):
    """Increments the miss counter for tracks not seen this frame and drops any
    that have been missing for too long -- so a face that's briefly occluded
    keeps its identity, but one that's genuinely gone eventually expires
    instead of lingering forever."""
    for track in tracks:
        if track.id not in matched_ids:
            track.missed += 1
    return [track for track in tracks if track.missed <= max_missed]


def choose_speaker(visible_tracks, current_speaker_id, switch_margin=SWITCH_MARGIN, speech_active=True):
    """Picks which visible track is "the speaker" this frame. Prefers whoever
    scores highest on mouth-activity variance, but only lets a challenger take
    over from the current speaker if it beats them by `switch_margin` -- this
    hysteresis stops the crop flicking between two people who are both talking
    at similar levels. Falls back to the largest face when nobody has enough
    landmark history to score at all (e.g. everyone visible is in profile).
    Returns None if there's nothing visible to choose from.

    `speech_active=False` (a coarse Whisper-transcript-derived "no one is
    talking right now" signal) blocks switching entirely: mouth-movement noise
    during a pause -- a yawn, chewing, a silent reaction -- shouldn't be
    trusted as evidence of who's now talking. The current speaker is kept as
    long as they're still visible; only falls through to the normal pick if
    they're not (we have no better option than to guess at that point)."""
    if not visible_tracks:
        return None
    if not speech_active:
        current = next((track for track in visible_tracks if track.id == current_speaker_id), None)
        if current is not None:
            return current
    scored = [(track, track.activity_score()) for track in visible_tracks]
    scoreable = [(track, score) for track, score in scored if score is not None]

    if not scoreable:
        return max(visible_tracks, key=lambda track: track.size)

    chosen, chosen_score = max(scoreable, key=lambda pair: pair[1])
    current = next((track for track, _ in scoreable if track.id == current_speaker_id), None)
    if current is not None and current.id != chosen.id:
        current_score = next(score for track, score in scoreable if track.id == current.id)
        if chosen_score < current_score * switch_margin:
            return current
    return chosen


def resolve_crop_point(visible_tracks, current_speaker_id, switch_margin=SWITCH_MARGIN, speech_active=True, ambiguous_margin=AMBIGUOUS_ACTIVITY_MARGIN):
    """Decides the (cx, cy) crop target for this frame's visible face tracks.
    Normally just delegates to `choose_speaker`'s single-track pick. But when
    two tracks are simultaneously active at comparable levels (neither a clear
    winner, even before hysteresis gets a say) it commits to the midpoint
    between the two most active tracks instead of confidently guessing one --
    an approximation of a wider two-shot for a crosstalk/both-reacting moment.

    IMPORTANT LIMITATION, not solved in this pass: this only shifts *where*
    the existing fixed-scale crop centers. There is no variable-zoom concept
    anywhere in the pipeline (FaceTrackPoint/RenderFacePoint only carry a
    center point, and both crop-math implementations -- PreviewStage.tsx's
    `computeAutoFrameStyle` and CaptionedTimeline.tsx's `TrackedVideo` --
    always cover-fit at a single fixed scale). If the two people are further
    apart than the crop's own width, centering between them still won't show
    either of them fully in frame. A true fix needs a scale/zoom field added
    to the schema and both crop-math implementations updated to support it --
    real scope, deliberately not attempted here.

    Returns (point_dict_or_None, chosen_track_or_None). `chosen_track` is None
    whenever this frame resolved to the ambiguous wide-midpoint case (no single
    track was actually picked, so the caller should leave `current_speaker_id`
    unchanged rather than attribute the frame to either person)."""
    if not visible_tracks:
        return None, None

    if speech_active and len(visible_tracks) >= 2:
        scored = [(track, track.activity_score()) for track in visible_tracks]
        scoreable = sorted([(t, s) for t, s in scored if s is not None], key=lambda pair: pair[1], reverse=True)
        if len(scoreable) >= 2:
            (top_track, top_score), (second_track, second_score) = scoreable[0], scoreable[1]
            if top_score > 1e-6 and second_score >= top_score / ambiguous_margin:
                point = {
                    "cx": (top_track.cx + second_track.cx) / 2,
                    "cy": (top_track.cy + second_track.cy) / 2,
                }
                return point, None

    chosen = choose_speaker(visible_tracks, current_speaker_id, switch_margin=switch_margin, speech_active=speech_active)
    if chosen is None:
        return None, None
    return {"cx": chosen.cx, "cy": chosen.cy}, chosen


def resolve_fallback_point(t, body_point, last_point):
    """The position to report when no face was detected this frame, in order
    of preference: a pose-derived body anchor (keeps following a subject who's
    turned away or walked off), else the last known good position (briefly
    holds through a missed detection), else dead center (nothing has ever been
    seen in this shot -- a sensible, neutral default rather than an arbitrary
    stale guess)."""
    if body_point is not None:
        return {"centerX": round(body_point[0], 4), "centerY": round(body_point[1], 4)}
    if last_point is not None:
        return {"centerX": last_point["centerX"], "centerY": last_point["centerY"]}
    return {"centerX": 0.5, "centerY": 0.5}


def should_reset_for_cut(t, cut_times, next_cut_index):
    """Whether time `t` has crossed the next known hard-cut boundary, and the
    advanced cut index to carry forward. Crossing a cut means the shot changed,
    so any tracked position from before it is meaningless in the new shot."""
    if next_cut_index < len(cut_times) and t >= cut_times[next_cut_index]:
        return True, next_cut_index + 1
    return False, next_cut_index


def _second_difference_matrix(n):
    """n x n matrix whose product with a signal gives its discrete second
    difference at each interior index (zero rows at the two endpoints, where a
    centered second difference doesn't exist)."""
    matrix = np.zeros((n, n))
    for i in range(1, n - 1):
        matrix[i, i - 1] = 1.0
        matrix[i, i] = -2.0
        matrix[i, i + 1] = 1.0
    return matrix


def _whittaker_smooth(values, smoothness=SMOOTHING_STRENGTH):
    """Non-causal smoothing over an *entire* sequence at once -- the value at
    every index is free to depend on the whole signal, not just what came
    before it. Solves for the sequence that best balances staying close to the
    raw values against minimizing pan acceleration (its discrete second
    derivative), in the spirit of AutoFlip-style camera-path planning, rather
    than reacting frame-by-frame the way a causal rolling average does.
    `smoothness` trades fidelity for a straighter path; 0 returns the raw
    values unchanged. Closed-form ridge solution: s = (I + smoothness * D^T D)^-1 @ raw.

    A quadratic fidelity/roughness objective is well-behaved but not
    guaranteed to stay within the exact min/max of the input (a small overshoot
    near a sharp transition is possible), so the result is clamped into the
    input's own range afterward -- the crop math downstream assumes a real,
    previously-seen position, not an extrapolated one."""
    n = len(values)
    if n < 3 or smoothness <= 0:
        return list(values)
    raw = np.array(values, dtype=np.float64)
    d = _second_difference_matrix(n)
    solved = np.linalg.solve(np.eye(n) + smoothness * (d.T @ d), raw)
    lo, hi = float(np.min(raw)), float(np.max(raw))
    return [float(min(hi, max(lo, v))) for v in solved]


def smooth_points(points, smoothness=SMOOTHING_STRENGTH):
    """Smooths each shot's full point sequence at once (see `_whittaker_smooth`)
    rather than a small causal window -- this pipeline runs offline on an
    already-fully-decoded segment, so nothing prevents looking at the whole
    shot before deciding a value, and doing so produces a straighter,
    more-intentional-looking camera path than reacting frame-by-frame. Never
    blends across a `shotId` boundary, or the crop would drift toward the
    wrong shot's position for a frame right at a cut."""
    if not points:
        return []
    smoothed = []
    for shot_id in sorted(set(p["shotId"] for p in points)):
        shot_points = [p for p in points if p["shotId"] == shot_id]
        xs = _whittaker_smooth([p["centerX"] for p in shot_points], smoothness)
        ys = _whittaker_smooth([p["centerY"] for p in shot_points], smoothness)
        for p, x, y in zip(shot_points, xs, ys):
            smoothed.append({"timeSec": p["timeSec"], "centerX": round(x, 4), "centerY": round(y, 4), "shotId": shot_id})
    return sorted(smoothed, key=lambda p: p["timeSec"])


def apply_dead_zone(points, half_width=DEAD_ZONE_HALF_WIDTH):
    """Only moves the "committed" crop center when a point drifts outside a
    dead zone around it (roughly the middle 40% of frame, `half_width` on each
    side) -- otherwise holds the previous committed position. A camera
    operator doesn't chase every small head movement; this keeps the crop
    still for small drifts and only recenters on a genuine move. Resets at
    each shot boundary, since a new shot has no committed center yet."""
    if not points:
        return []
    result = []
    committed = None
    current_shot = None
    for p in points:
        if p["shotId"] != current_shot or committed is None:
            committed = {"centerX": p["centerX"], "centerY": p["centerY"]}
            current_shot = p["shotId"]
        else:
            dx = abs(p["centerX"] - committed["centerX"])
            dy = abs(p["centerY"] - committed["centerY"])
            if dx > half_width or dy > half_width:
                committed = {"centerX": p["centerX"], "centerY": p["centerY"]}
        result.append({"timeSec": p["timeSec"], "centerX": committed["centerX"], "centerY": committed["centerY"], "shotId": p["shotId"]})
    return result


def parse_speech_intervals(raw):
    """Parses the optional CLI-provided speech-active intervals: a comma-
    separated list of `start-end` pairs (source-media-relative seconds, e.g.
    from Whisper word timestamps merged in shared/timeline-math.ts's
    `buildSpeechIntervals`). Returns None (meaning "no signal available, treat
    the whole segment as speech-active") for anything empty or malformed --
    this is a purely additive refinement, never a hard requirement."""
    if not raw:
        return None
    intervals = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk or "-" not in chunk:
            continue
        start_str, _, end_str = chunk.partition("-")
        try:
            start, end = float(start_str), float(end_str)
        except ValueError:
            continue
        if not (start >= 0 and end > start):
            continue
        intervals.append((start, end))
    return intervals or None


def is_speech_active(t, intervals, padding_sec=0.15):
    """Whether time `t` falls within a known speech interval, with a small
    padding since Whisper's word boundaries are themselves approximate.
    `intervals=None` means no signal was available at all -- always permissive
    in that case, matching the tracker's pre-existing behavior."""
    if intervals is None:
        return True
    return any(start - padding_sec <= t <= end + padding_sec for start, end in intervals)


def require_model_file(path, label):
    if not os.path.isfile(path):
        print(json.dumps({"error": f"{label} model file is missing at {os.path.basename(path)}. Run sidecar/facetrack/setup.sh to provision it."}))
        sys.exit(1)
    if not os.access(path, os.R_OK):
        print(json.dumps({"error": f"{label} model file at {os.path.basename(path)} is not readable."}))
        sys.exit(1)


def main():
    video_path = sys.argv[1]
    start_sec = float(sys.argv[2])
    end_sec = float(sys.argv[3])
    sample_fps = float(sys.argv[4]) if len(sys.argv) > 4 else 6.0
    speech_intervals = parse_speech_intervals(sys.argv[5]) if len(sys.argv) > 5 else None

    require_model_file(DETECTOR_MODEL_PATH, "Face detector")
    require_model_file(LANDMARKER_MODEL_PATH, "Face landmarker")
    require_model_file(POSE_MODEL_PATH, "Pose landmarker")

    cut_times = find_cut_times(video_path, start_sec, end_sec)

    detector = vision.FaceDetector.create_from_options(
        vision.FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=DETECTOR_MODEL_PATH),
            running_mode=vision.RunningMode.IMAGE,
            min_detection_confidence=0.3,
        )
    )
    landmarker = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=LANDMARKER_MODEL_PATH),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.1,
            output_face_blendshapes=True,
        )
    )
    pose_landmarker = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=POSE_MODEL_PATH),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=4,
            min_pose_detection_confidence=0.3,
        )
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Could not open video {video_path}"}))
        sys.exit(1)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    native_fps = cap.get(cv2.CAP_PROP_FPS)
    if not native_fps or native_fps <= 0:
        native_fps = 30.0

    # Repeated CAP_PROP_POS_MSEC seeks are imprecise on long-GOP video (each
    # seek can land on the nearest keyframe rather than the exact timestamp).
    # Seek once to the segment start, then decode sequentially and only run
    # detection on the frames nearest our sample times -- monotonic decoding is
    # both faster and frame-accurate; seeking repeatedly is neither.
    start_frame = max(0, int(round(start_sec * native_fps)))
    end_frame = int(round(end_sec * native_fps))
    frame_step = max(1, round(native_fps / sample_fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    points = []
    last_point = None
    tracks = []
    next_track_id = 0
    current_speaker_id = None
    next_cut_index = 0
    shot_id = 0

    frame_index = start_frame
    next_sample_frame = start_frame
    while frame_index <= end_frame:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index != next_sample_frame:
            frame_index += 1
            continue
        next_sample_frame += frame_step
        t = frame_index / native_fps
        frame_index += 1

        reset, next_cut_index = should_reset_for_cut(t, cut_times, next_cut_index)
        if reset:
            tracks = []
            current_speaker_id = None
            last_point = None
            shot_id += 1

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect(mp_image)

        detections = sorted(result.detections, key=lambda d: d.bounding_box.width * d.bounding_box.height, reverse=True)
        detections = detections[:MAX_FACES_PER_FRAME]
        detection_infos = []
        for detection in detections:
            bbox = detection.bounding_box
            detection_infos.append(
                {
                    "cx": (bbox.origin_x + bbox.width / 2) / width,
                    "cy": (bbox.origin_y + bbox.height / 2) / height,
                    "size": (bbox.width * bbox.height) / (width * height),
                    "bbox": bbox,
                }
            )

        assignments = assign_detections_to_tracks(tracks, detection_infos)
        matched_ids = set()
        for detection_index, info in enumerate(detection_infos):
            jaw_open = get_jaw_open(landmarker, rgb, info["bbox"], width, height)
            best_track = assignments.get(detection_index)
            if best_track is None:
                best_track = Track(next_track_id, info["cx"], info["cy"], info["size"])
                next_track_id += 1
                tracks.append(best_track)
            best_track.update(info["cx"], info["cy"], info["size"], jaw_open)
            matched_ids.add(best_track.id)

        tracks = age_out_tracks(tracks, matched_ids)
        visible = [track for track in tracks if track.id in matched_ids]
        speech_active = is_speech_active(t, speech_intervals)
        crop_point, chosen = resolve_crop_point(visible, current_speaker_id, speech_active=speech_active)
        if chosen is not None:
            current_speaker_id = chosen.id

        if crop_point is not None:
            point = {"timeSec": round(t, 2), "centerX": round(crop_point["cx"], 4), "centerY": round(crop_point["cy"], 4)}
            last_point = point
        else:
            # No face detected at all this frame -- try to keep following the
            # subject by body position instead of freezing. A person walking
            # away or turning still has visible shoulders/hips long after
            # their face is gone.
            pose_result = pose_landmarker.detect(mp_image)
            body_point = None
            best_size = 0.0
            for pose_landmarks in pose_result.pose_landmarks:
                anchor = body_anchor_point(pose_landmarks)
                if anchor is None:
                    continue
                xs = [lm.x for lm in pose_landmarks]
                ys = [lm.y for lm in pose_landmarks]
                size = (max(xs) - min(xs)) * (max(ys) - min(ys))
                if size > best_size:
                    best_size = size
                    body_point = anchor

            fallback = resolve_fallback_point(t, body_point, last_point)
            point = {"timeSec": round(t, 2), **fallback}
            if body_point is not None:
                last_point = point

        point["shotId"] = shot_id
        points.append(point)

    cap.release()
    final_points = apply_dead_zone(smooth_points(points))
    output_points = [{"timeSec": p["timeSec"], "centerX": p["centerX"], "centerY": p["centerY"]} for p in final_points]
    print(json.dumps({"points": output_points, "sourceWidth": width, "sourceHeight": height}))


if __name__ == "__main__":
    main()
