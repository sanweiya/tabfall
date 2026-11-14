import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGeometry, mapY } from '../core/render/lane';
import { buildTimeline, beatTicks, tickAtTimeUnclamped } from '../core/timeline';
import {
  DEFAULT_SETTINGS,
  type LaneNote,
  type LoadedScore,
  type TrackScore,
} from '../core/types';

function makeTrack(): TrackScore {
  return {
    info: {
      index: 0, name: 'Guitar', instrument: 'Standard', stringCount: 6,
      tuning: [64, 59, 55, 50, 45, 40], noteCount: 3, isPercussion: false, isStringed: true,
    },
    notes: [],
  };
}

function note(tick: number, endTick: number, string = 1): LaneNote {
  return {
    id: tick, tick, endTick, timeMs: tick / 1.92, endTimeMs: endTick / 1.92,
    durationMs: (endTick - tick) / 1.92, string, fret: 0, text: '0', velocity: 0.8,
    barIndex: 0, beatIndex: 0, occurrence: 1, chordSize: 1, tags: [], tieCount: 0,
  };
}

test('beat-mode spacing is strictly proportional to written duration', () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const track = makeTrack();
  const geometry = computeGeometry(1920, 1080, track, settings);
  const frame = {
    clockMs: 0, visualTick: 0, visualMs: 0, scoreDurationMs: 10_000,
    leadInMs: 0, combo: 0, playing: false,
  };
  const quarter = mapY(note(0, 960), settings, frame, geometry);
  const sixteenth = mapY(note(0, 240), settings, frame, geometry);
  const quarterLength = quarter.headY - quarter.endY;
  const sixteenthLength = sixteenth.headY - sixteenth.endY;
  assert.ok(Math.abs(quarterLength / sixteenthLength - 4) < 1e-6, `${quarterLength} / ${sixteenthLength}`);
  assert.ok(Math.abs(quarterLength - 150) < 1e-6, 'a quarter is 150 px at the default 1080p scale');
});

test('time-mode spacing follows seconds, which is the same 4:1 at a constant tempo', () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.layout.spacing = 'time';
  const track = makeTrack();
  const geometry = computeGeometry(1920, 1080, track, settings);
  const frame = {
    clockMs: 0, visualTick: 0, visualMs: 0, scoreDurationMs: 10_000,
    leadInMs: 0, combo: 0, playing: false,
  };
  const quarter = mapY(note(0, 960), settings, frame, geometry);
  const sixteenth = mapY(note(0, 240), settings, frame, geometry);
  const ratio = (quarter.headY - quarter.endY) / (sixteenth.headY - sixteenth.endY);
  assert.ok(Math.abs(ratio - 4) < 1e-6);
});

test('string columns follow alphaTab low-to-high string numbering', () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const track = makeTrack();
  const geometry = computeGeometry(1920, 1080, track, settings);
  assert.equal(geometry.stringXs.length, 6);
  // alphaTab: string 1 is the lowest string. "high-right" keeps string 1 on the
  // left, so the high string ends up on the right.
  assert.ok(geometry.stringXs[0] < geometry.stringXs[5], 'string 1 / low E is on the left by default');
  settings.appearance.stringOrder = 'high-left';
  const flipped = computeGeometry(1920, 1080, track, settings);
  assert.ok(flipped.stringXs[0] > flipped.stringXs[5], 'string 1 / low E moves to the right');
});

test('pre-roll extrapolates before the first tick', () => {
  const timeline = buildTimeline([{ start: 0, end: 3840, tempoChanges: [{ tick: 0, tempo: 120 }] }], 120);
  const before = tickAtTimeUnclamped(timeline, -1000);
  assert.ok(before < 0);
  assert.ok(Math.abs(before + 1920) < 1, 'at 120 BPM one second is two quarter notes');
  const after = tickAtTimeUnclamped(timeline, timeline.durationMs + 500);
  assert.ok(after > timeline.endTick);
});

test('written durations cover dots, tuplets and double whole notes', () => {
  assert.equal(beatTicks({ duration: 4 }), 960);
  assert.equal(beatTicks({ duration: 4, dots: 1 }), 1440);
  assert.equal(beatTicks({ duration: 8, tupletNumerator: 3, tupletDenominator: 2 }), 320);
  assert.equal(beatTicks({ duration: -2 }), 7680);
});
