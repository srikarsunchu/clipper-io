#!/usr/bin/env python3
"""Unit tests for track_faces.py's pure logic -- no video I/O or ML inference,
per the project's testing conventions: fast, deterministic, mocked fixtures.

Run with: sidecar/facetrack/venv/bin/python -m unittest sidecar.facetrack.test_track_faces -v
(or `cd sidecar/facetrack && venv/bin/python -m unittest test_track_faces -v`)
"""
import unittest

from track_faces import (
    Track,
    age_out_tracks,
    apply_dead_zone,
    assign_detections_to_tracks,
    body_anchor_point,
    choose_speaker,
    is_speech_active,
    parse_speech_intervals,
    resolve_crop_point,
    resolve_fallback_point,
    should_reset_for_cut,
    smooth_points,
)


class FakeTrack:
    """Stand-in for Track with a directly-settable activity score, so speaker
    hysteresis can be tested without deriving jaw_open_history variance by hand."""

    def __init__(self, track_id, size, score):
        self.id = track_id
        self.size = size
        self._score = score

    def activity_score(self):
        return self._score


class FakeLandmark:
    def __init__(self, x, y, visibility):
        self.x = x
        self.y = y
        self.visibility = visibility


class AssignDetectionsToTracksTest(unittest.TestCase):
    def test_stable_assignment_across_crossing_trajectories(self):
        # Two tracks close together in position (as if crossing paths), but
        # distinct in size. A naive "resolve tracks in order, nearest detection
        # wins" greedy would swap identities here because position alone is
        # ambiguous; global least-cost-first (distance + size) should not.
        track0 = Track(0, cx=0.5, cy=0.5, size=0.10)
        track1 = Track(1, cx=0.52, cy=0.5, size=0.05)
        detections = [
            {"cx": 0.51, "cy": 0.5, "size": 0.095},  # matches track0 by size
            {"cx": 0.505, "cy": 0.5, "size": 0.052},  # matches track1 by size, despite being positionally closer to track0
        ]
        assignments = assign_detections_to_tracks([track0, track1], detections)
        self.assertIs(assignments[0], track0)
        self.assertIs(assignments[1], track1)

    def test_detection_far_from_every_track_is_unassigned(self):
        track0 = Track(0, cx=0.1, cy=0.1, size=0.1)
        detections = [{"cx": 0.9, "cy": 0.9, "size": 0.1}]
        assignments = assign_detections_to_tracks([track0], detections)
        self.assertEqual(assignments, {})

    def test_one_detection_never_claims_two_tracks(self):
        track0 = Track(0, cx=0.5, cy=0.5, size=0.1)
        track1 = Track(1, cx=0.51, cy=0.5, size=0.1)
        detections = [{"cx": 0.505, "cy": 0.5, "size": 0.1}]
        assignments = assign_detections_to_tracks([track0, track1], detections)
        self.assertEqual(len(assignments), 1)


class AgeOutTracksTest(unittest.TestCase):
    def test_lost_faces_expire_after_max_missed(self):
        tracks = [Track(0, 0.5, 0.5, 0.1)]
        tracks = age_out_tracks(tracks, matched_ids=set(), max_missed=2)
        self.assertEqual(len(tracks), 1)  # missed=1
        tracks = age_out_tracks(tracks, matched_ids=set(), max_missed=2)
        self.assertEqual(len(tracks), 1)  # missed=2, still within budget
        tracks = age_out_tracks(tracks, matched_ids=set(), max_missed=2)
        self.assertEqual(len(tracks), 0)  # missed=3, expired

    def test_a_seen_track_does_not_age(self):
        track = Track(0, 0.5, 0.5, 0.1)
        tracks = age_out_tracks([track], matched_ids={0}, max_missed=2)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0].missed, 0)


class ChooseSpeakerTest(unittest.TestCase):
    def test_no_visible_tracks_returns_none(self):
        self.assertIsNone(choose_speaker([], current_speaker_id=None))

    def test_falls_back_to_largest_when_nothing_scoreable(self):
        small = FakeTrack(0, size=0.05, score=None)
        big = FakeTrack(1, size=0.2, score=None)
        chosen = choose_speaker([small, big], current_speaker_id=None)
        self.assertEqual(chosen.id, 1)

    def test_hysteresis_blocks_a_challenger_that_does_not_clear_the_margin(self):
        current = FakeTrack(0, size=0.1, score=0.10)
        weak_challenger = FakeTrack(1, size=0.1, score=0.12)  # higher, but below 1.5x
        chosen = choose_speaker([current, weak_challenger], current_speaker_id=0, switch_margin=1.5)
        self.assertEqual(chosen.id, 0)

    def test_hysteresis_allows_a_challenger_that_clears_the_margin(self):
        current = FakeTrack(0, size=0.1, score=0.10)
        strong_challenger = FakeTrack(1, size=0.1, score=0.20)  # clears 1.5x
        chosen = choose_speaker([current, strong_challenger], current_speaker_id=0, switch_margin=1.5)
        self.assertEqual(chosen.id, 1)

    def test_speech_inactive_keeps_current_speaker_regardless_of_scores(self):
        # A silent pause: even a huge jaw-open-variance "winner" shouldn't be
        # trusted as a real speaker change when Whisper says no one is talking.
        current = FakeTrack(0, size=0.1, score=0.05)
        loud_but_silent = FakeTrack(1, size=0.1, score=0.90)
        chosen = choose_speaker([current, loud_but_silent], current_speaker_id=0, speech_active=False)
        self.assertEqual(chosen.id, 0)

    def test_speech_inactive_falls_through_when_current_speaker_not_visible(self):
        only_visible = FakeTrack(1, size=0.1, score=0.05)
        chosen = choose_speaker([only_visible], current_speaker_id=0, speech_active=False)
        self.assertEqual(chosen.id, 1)


class BodyAnchorPointTest(unittest.TestCase):
    def test_needs_at_least_two_visible_landmarks(self):
        landmarks = [FakeLandmark(0, 0, 0.0) for _ in range(33)]
        landmarks[11] = FakeLandmark(0.4, 0.3, 0.9)
        self.assertIsNone(body_anchor_point(landmarks))

    def test_averages_visible_shoulder_landmarks(self):
        landmarks = [FakeLandmark(0, 0, 0.0) for _ in range(33)]
        landmarks[11] = FakeLandmark(0.4, 0.3, 0.9)
        landmarks[12] = FakeLandmark(0.6, 0.3, 0.9)
        result = body_anchor_point(landmarks)
        self.assertAlmostEqual(result[0], 0.5)
        self.assertAlmostEqual(result[1], 0.3)


class ResolveFallbackPointTest(unittest.TestCase):
    def test_no_face_or_body_or_history_produces_centered_output(self):
        point = resolve_fallback_point(0.0, body_point=None, last_point=None)
        self.assertEqual(point, {"centerX": 0.5, "centerY": 0.5})

    def test_prefers_body_point_over_last_known(self):
        point = resolve_fallback_point(0.0, body_point=(0.2, 0.3), last_point={"centerX": 0.9, "centerY": 0.9})
        self.assertEqual(point, {"centerX": 0.2, "centerY": 0.3})

    def test_holds_last_known_when_no_body_point(self):
        point = resolve_fallback_point(0.0, body_point=None, last_point={"centerX": 0.7, "centerY": 0.4})
        self.assertEqual(point, {"centerX": 0.7, "centerY": 0.4})


class ResolveCropPointTest(unittest.TestCase):
    def test_no_visible_tracks_returns_none_none(self):
        point, chosen = resolve_crop_point([], current_speaker_id=None)
        self.assertIsNone(point)
        self.assertIsNone(chosen)

    def test_clear_winner_delegates_to_choose_speaker(self):
        quiet = FakeTrack(0, size=0.1, score=0.02)
        clear_winner = FakeTrack(1, size=0.1, score=0.30)
        clear_winner.cx, clear_winner.cy = 0.7, 0.4
        quiet.cx, quiet.cy = 0.2, 0.2
        point, chosen = resolve_crop_point([quiet, clear_winner], current_speaker_id=None)
        self.assertEqual(chosen.id, 1)
        self.assertEqual(point, {"cx": 0.7, "cy": 0.4})

    def test_comparably_active_tracks_widen_to_midpoint_and_pick_no_single_track(self):
        a = FakeTrack(0, size=0.1, score=0.20)
        b = FakeTrack(1, size=0.1, score=0.19)  # within AMBIGUOUS_ACTIVITY_MARGIN of a
        a.cx, a.cy = 0.2, 0.5
        b.cx, b.cy = 0.8, 0.5
        point, chosen = resolve_crop_point([a, b], current_speaker_id=None)
        self.assertIsNone(chosen)  # no single track attributed -- caller must not update current_speaker_id
        self.assertAlmostEqual(point["cx"], 0.5)
        self.assertAlmostEqual(point["cy"], 0.5)

    def test_both_silent_does_not_spuriously_widen(self):
        a = FakeTrack(0, size=0.1, score=0.0)
        b = FakeTrack(1, size=0.12, score=0.0)
        a.cx, a.cy = 0.3, 0.3
        b.cx, b.cy = 0.6, 0.6
        point, chosen = resolve_crop_point([a, b], current_speaker_id=None)
        self.assertIsNotNone(chosen)  # falls through to the largest-face fallback, not a midpoint

    def test_speech_inactive_suppresses_widening(self):
        a = FakeTrack(0, size=0.1, score=0.20)
        b = FakeTrack(1, size=0.1, score=0.19)
        a.cx, a.cy = 0.2, 0.5
        b.cx, b.cy = 0.8, 0.5
        point, chosen = resolve_crop_point([a, b], current_speaker_id=None, speech_active=False)
        self.assertIsNotNone(chosen)  # gated choose_speaker path, not the ambiguous-widen path


class ShouldResetForCutTest(unittest.TestCase):
    def test_reset_state_machine_advances_monotonically(self):
        cut_times = [10.0, 20.0]
        self.assertEqual(should_reset_for_cut(9.9, cut_times, 0), (False, 0))
        self.assertEqual(should_reset_for_cut(10.0, cut_times, 0), (True, 1))
        self.assertEqual(should_reset_for_cut(15.0, cut_times, 1), (False, 1))
        self.assertEqual(should_reset_for_cut(20.5, cut_times, 1), (True, 2))
        self.assertEqual(should_reset_for_cut(99.0, cut_times, 2), (False, 2))


class SmoothPointsTest(unittest.TestCase):
    def test_output_never_exceeds_the_window_it_averaged(self):
        points = [
            {"timeSec": 0.0, "centerX": 0.5, "centerY": 0.5, "shotId": 0},
            {"timeSec": 0.1, "centerX": 0.9, "centerY": 0.5, "shotId": 0},
            {"timeSec": 0.2, "centerX": 0.5, "centerY": 0.5, "shotId": 0},
        ]
        smoothed = smooth_points(points)
        for point in smoothed:
            self.assertGreaterEqual(point["centerX"], 0.5 - 1e-9)
            self.assertLessEqual(point["centerX"], 0.9 + 1e-9)

    def test_does_not_blend_across_a_shot_boundary(self):
        points = [
            {"timeSec": 0.0, "centerX": 0.2, "centerY": 0.5, "shotId": 0},
            {"timeSec": 0.1, "centerX": 0.8, "centerY": 0.5, "shotId": 1},
        ]
        smoothed = smooth_points(points)
        self.assertEqual(smoothed[0]["centerX"], 0.2)
        self.assertEqual(smoothed[1]["centerX"], 0.8)

    def test_whittaker_smoothing_reduces_jitter_across_a_longer_shot(self):
        # A noisy oscillation around 0.5 -- non-causal, whole-shot smoothing
        # (unlike the old 3-point causal average) should meaningfully flatten
        # this, since it can see the entire shot's shape at once.
        points = [
            {"timeSec": i * 0.1, "centerX": 0.5 + (0.15 if i % 2 == 0 else -0.15), "centerY": 0.5, "shotId": 0}
            for i in range(20)
        ]
        smoothed = smooth_points(points)
        raw_variance = sum((p["centerX"] - 0.5) ** 2 for p in points) / len(points)
        smoothed_variance = sum((p["centerX"] - 0.5) ** 2 for p in smoothed) / len(smoothed)
        self.assertLess(smoothed_variance, raw_variance * 0.5)

    def test_smoothing_never_exceeds_the_shots_own_raw_range(self):
        points = [
            {"timeSec": i * 0.1, "centerX": 0.5 + (0.2 if i % 3 == 0 else -0.1), "centerY": 0.5, "shotId": 0}
            for i in range(15)
        ]
        smoothed = smooth_points(points)
        raw_values = [p["centerX"] for p in points]
        lo, hi = min(raw_values), max(raw_values)
        for point in smoothed:
            self.assertGreaterEqual(point["centerX"], lo - 1e-6)
            self.assertLessEqual(point["centerX"], hi + 1e-6)

    def test_short_shot_below_fit_minimum_passes_through_unchanged(self):
        points = [
            {"timeSec": 0.0, "centerX": 0.3, "centerY": 0.4, "shotId": 0},
            {"timeSec": 0.1, "centerX": 0.7, "centerY": 0.6, "shotId": 0},
        ]
        smoothed = smooth_points(points)
        self.assertEqual(smoothed[0]["centerX"], 0.3)
        self.assertEqual(smoothed[1]["centerX"], 0.7)


class ApplyDeadZoneTest(unittest.TestCase):
    def test_small_drift_within_zone_holds_the_committed_center(self):
        points = [
            {"timeSec": 0.0, "centerX": 0.5, "centerY": 0.5, "shotId": 0},
            {"timeSec": 0.1, "centerX": 0.55, "centerY": 0.5, "shotId": 0},  # within 0.20 half-width
        ]
        result = apply_dead_zone(points)
        self.assertEqual(result[1]["centerX"], 0.5)

    def test_large_drift_outside_zone_recenters(self):
        points = [
            {"timeSec": 0.0, "centerX": 0.5, "centerY": 0.5, "shotId": 0},
            {"timeSec": 0.1, "centerX": 0.9, "centerY": 0.5, "shotId": 0},  # outside 0.20 half-width
        ]
        result = apply_dead_zone(points)
        self.assertEqual(result[1]["centerX"], 0.9)

    def test_resets_committed_center_at_a_new_shot(self):
        points = [
            {"timeSec": 0.0, "centerX": 0.5, "centerY": 0.5, "shotId": 0},
            {"timeSec": 0.1, "centerX": 0.9, "centerY": 0.5, "shotId": 1},  # new shot -- must not be treated as drift
        ]
        result = apply_dead_zone(points)
        self.assertEqual(result[1]["centerX"], 0.9)


class SpeechIntervalsTest(unittest.TestCase):
    def test_parse_speech_intervals_handles_empty_and_malformed_input(self):
        self.assertIsNone(parse_speech_intervals(""))
        self.assertIsNone(parse_speech_intervals(None))
        self.assertIsNone(parse_speech_intervals("garbage,,1.5"))

    def test_parse_speech_intervals_parses_valid_pairs(self):
        self.assertEqual(parse_speech_intervals("1.0-2.5,4.0-6.25"), [(1.0, 2.5), (4.0, 6.25)])

    def test_is_speech_active_true_when_no_signal_available(self):
        self.assertTrue(is_speech_active(5.0, None))

    def test_is_speech_active_respects_intervals_with_padding(self):
        intervals = [(2.0, 4.0)]
        self.assertTrue(is_speech_active(3.0, intervals))
        self.assertTrue(is_speech_active(1.9, intervals))  # inside default 0.15s padding
        self.assertFalse(is_speech_active(1.0, intervals))


if __name__ == "__main__":
    unittest.main()
