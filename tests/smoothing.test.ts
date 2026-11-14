import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOOKAHEAD_FACTOR,
  ScrollSmoother,
  TICKS_PER_QUARTER,
  buildTimeline,
  smoothingLookaheadMs,
  smoothingTau,
  tickAtTimeUnclamped,
} from '../core/timeline';

// AGENTS.md pins `smoothingTau = 0.02 + 0.34 s²` and `lookahead = tau * factor`
// and asks for the documentation and the tests to move together, so the curve
// itself is asserted here instead of only being exercised end to end.
test('smoothing tau follows the documented quadratic curve', () => {
  assert.equal(smoothingTau(0), 0);
  assert.equal(smoothingTau(-1), 0);
  for (const strength of [0.25, 0.5, 0.6, 0.8, 1]) {
    const expected = 0.02 + 0.34 * strength * strength;
    assert.ok(Math.abs(smoothingTau(strength) - expected) < 1e-12, `tau(${strength})`);
  }
  assert.ok(Math.abs(smoothingTau(1) - 0.36) < 1e-12);
});

test('lookahead is tau scaled by the lookahead factor', () => {
  for (const mode of ['off', 'conservative', 'normal', 'aggressive'] as const) {
    const expected = smoothingTau(0.6) * 1000 * LOOKAHEAD_FACTOR[mode];
    assert.ok(Math.abs(smoothingLookaheadMs(0.6, mode) - expected) < 1e-9, mode);
  }
  assert.equal(smoothingLookaheadMs(0, 'aggressive'), 0);
  assert.equal(LOOKAHEAD_FACTOR.conservative < LOOKAHEAD_FACTOR.normal, true);
});

test('smoother snaps without strength and eases without overshooting', () => {
  const smoother = new ScrollSmoother();
  // No strength: the drawn position is the anchor, never a filtered one.
  assert.equal(smoother.update(100, { strength: 0, dt: 1 / 60, mode: 'off', anchor: 90 }), 90);

  smoother.reset(0);
  let previous = 0;
  for (let i = 0; i < 60; i += 1) {
    const value = smoother.update(1000, { strength: 0.6, dt: 1 / 60, mode: 'normal', anchor: 0 });
    assert.ok(value >= previous, 'monotonic approach');
    assert.ok(value <= 1000, 'never overshoots the target');
    previous = value;
  }
  assert.ok(previous > 500, `converges towards the target (got ${previous})`);

  // A jump larger than the snap distance lands on the anchor immediately, which
  // is what a seek has to do.
  smoother.reset(0);
  assert.equal(smoother.update(9000, { strength: 0.6, dt: 1 / 60, mode: 'normal', anchor: 8000 }, 1000), 8000);
});

test('pre-roll extrapolation scales the first tempo segment', () => {
  const timeline = buildTimeline([{ start: 0, end: 4 * TICKS_PER_QUARTER }], 120);
  // 120 BPM: one quarter note = 500 ms = 960 ticks.
  assert.ok(Math.abs(tickAtTimeUnclamped(timeline, 500) - TICKS_PER_QUARTER) < 1e-6);
  const half = tickAtTimeUnclamped(timeline, -250);
  assert.ok(Math.abs(half - (-TICKS_PER_QUARTER * 0.5)) < 1e-6, `got ${half}`);
  const after = tickAtTimeUnclamped(timeline, timeline.durationMs + 250);
  assert.ok(after > timeline.endTick, 'extrapolates past the last segment');
});
