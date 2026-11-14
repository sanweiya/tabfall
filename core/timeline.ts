/** Tempo-map math shared by the lane renderer and the offline exporter. */

export const TICKS_PER_QUARTER = 960;

export interface TempoSegment {
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;
  bpm: number;
}

export interface TempoChange {
  tick: number;
  ms: number;
  bpm: number;
}

export interface ScoreTimeline {
  segments: TempoSegment[];
  changes: TempoChange[];
  endTick: number;
  durationMs: number;
  initialBpm: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Convert alphaTab's played-order MasterBarTickLookup list into a time map. */
export function buildTimeline(masterBars: any[], fallbackBpm = 120): ScoreTimeline {
  const segments: TempoSegment[] = [];
  const changes: TempoChange[] = [];
  let time = 0;
  let cursorTick = 0;
  let bpm = Number(fallbackBpm) || 120;
  const bars = Array.isArray(masterBars) ? masterBars : [];

  const push = (startTick: number, endTick: number, tempo: number) => {
    if (endTick <= startTick) return;
    const startMs = time;
    const endMs = startMs + (endTick - startTick) * 60_000 / (tempo * TICKS_PER_QUARTER);
    segments.push({ startTick, endTick, startMs, endMs, bpm: tempo });
    time = endMs;
    cursorTick = endTick;
  };

  for (const bar of bars) {
    const start = Number(bar?.start);
    const end = Number(bar?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (start > cursorTick) {
      // A gap between played master bars (rare, but keep the clock monotonic).
      push(cursorTick, start, bpm);
    } else if (start < cursorTick) {
      continue;
    }
    if (changes.length === 0 || Math.abs(changes[changes.length - 1].tick - start) > 0.5) {
      changes.push({ tick: start, ms: time, bpm });
    }
    const barChanges = (Array.isArray(bar.tempoChanges) ? bar.tempoChanges : [])
      .map((change: any) => ({ tick: Number(change.tick), bpm: Number(change.tempo) }))
      .filter((change: any) => Number.isFinite(change.tick) && Number.isFinite(change.bpm) && change.bpm > 0)
      .sort((a: any, b: any) => a.tick - b.tick);
    let tick = start;
    for (const change of barChanges) {
      const at = clamp(change.tick, start, end);
      if (at > tick) {
        push(tick, at, bpm);
        tick = at;
      }
      if (Math.abs(change.bpm - bpm) > 0.001) {
        bpm = change.bpm;
        changes.push({ tick, ms: time, bpm });
      }
    }
    if (tick < end) push(tick, end, bpm);
  }

  if (segments.length === 0) {
    const tempo = Number(fallbackBpm) || 120;
    segments.push({
      startTick: 0,
      endTick: 4 * TICKS_PER_QUARTER,
      startMs: 0,
      endMs: 4 * TICKS_PER_QUARTER * 60_000 / (tempo * TICKS_PER_QUARTER),
      bpm: tempo,
    });
    changes.push({ tick: 0, ms: 0, bpm: tempo });
  }

  return {
    segments,
    changes,
    endTick: segments[segments.length - 1].endTick,
    durationMs: segments[segments.length - 1].endMs,
    initialBpm: segments[0].bpm,
  };
}

export function tickAtTime(timeline: ScoreTimeline, timeMs: number): number {
  const segments = timeline.segments;
  if (segments.length === 0) return 0;
  const time = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, timeline.durationMs);
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (segments[mid].startMs <= time) low = mid;
    else high = mid - 1;
  }
  const seg = segments[low];
  const span = seg.endMs - seg.startMs;
  const ratio = span > 0 ? clamp((time - seg.startMs) / span, 0, 1) : 0;
  return seg.startTick + (seg.endTick - seg.startTick) * ratio;
}

export function timeAtTick(timeline: ScoreTimeline, tick: number): number {
  const segments = timeline.segments;
  if (segments.length === 0) return 0;
  const value = clamp(Number.isFinite(tick) ? tick : 0, 0, timeline.endTick);
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (segments[mid].startTick <= value) low = mid;
    else high = mid - 1;
  }
  const seg = segments[low];
  const span = seg.endTick - seg.startTick;
  const ratio = span > 0 ? clamp((value - seg.startTick) / span, 0, 1) : 0;
  return seg.startMs + (seg.endMs - seg.startMs) * ratio;
}

export function tempoAtTick(timeline: ScoreTimeline, tick: number): number {
  const segments = timeline.segments;
  if (segments.length === 0) return timeline.initialBpm;
  const value = clamp(tick, 0, timeline.endTick);
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (segments[mid].startTick <= value) low = mid;
    else high = mid - 1;
  }
  return segments[low].bpm;
}

export function tempoAtTime(timeline: ScoreTimeline, timeMs: number): number {
  return tempoAtTick(timeline, tickAtTime(timeline, timeMs));
}

/** Beat index (quarter-note pulse) at a tick, used for optional beat guides. */
export function beatAtTick(tick: number): number {
  return tick / TICKS_PER_QUARTER;
}

/** Written tick duration of one alphaTab beat (dots and tuplets included). */
export function beatTicks(beat: any): number {
  const raw = Number(beat?.duration);
  if (!Number.isFinite(raw) || raw === 0) return TICKS_PER_QUARTER;
  let ticks = raw < 0 ? 3840 * -raw : 3840 / raw;
  const dots = Math.max(0, Math.min(4, Number(beat?.dots) || 0));
  if (dots > 0) ticks *= 2 - Math.pow(2, -dots);
  const numerator = Number(beat?.tupletNumerator);
  const denominator = Number(beat?.tupletDenominator);
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0 && denominator > 0 && numerator !== 1) {
    ticks *= denominator / numerator;
  }
  return Math.max(1, Math.round(ticks));
}

export interface ClockSmoothingOptions {
  strength: number;
  mode: 'off' | 'conservative' | 'normal' | 'aggressive';
  dt: number;
  /** Tick (beat mode) or millisecond (time mode) value shown without filtering. */
  anchor: number;
}

export const LOOKAHEAD_FACTOR: Record<ClockSmoothingOptions['mode'], number> = {
  off: 0,
  conservative: 0.6,
  normal: 0.9,
  aggressive: 1,
};

/** Reference filter used by the horizontal camera in the GP Studio project. */
export function smoothingTau(strength: number): number {
  const s = clamp(Number(strength) || 0, 0, 1);
  return s > 0.001 ? 0.02 + 0.34 * s * s : 0;
}

export function smoothingLookaheadMs(strength: number, mode: ClockSmoothingOptions['mode']): number {
  return smoothingTau(strength) * 1000 * (LOOKAHEAD_FACTOR[mode] ?? 0.9);
}

/**
 * Presentation-only low-pass filter for the scroll position. The score clock,
 * audio and hit detection are never filtered; only the drawn position is.
 */
export class ScrollSmoother {
  private value: number | null = null;

  reset(value?: number): void {
    this.value = value !== undefined && Number.isFinite(value) ? value : null;
  }

  get current(): number | null {
    return this.value;
  }

  update(target: number, options: ClockSmoothingOptions, snapDistance = Infinity): number {
    const { strength, dt, anchor } = options;
    const previous = this.value;
    if (previous === null || !Number.isFinite(previous)
      || Math.abs(target - previous) > snapDistance
      || !(clamp(strength, 0, 1) > 0.001)) {
      // Snap to the un-advanced anchor, then let the filter ease towards the
      // look-ahead sample on subsequent frames (same as GP Studio).
      this.value = Number.isFinite(anchor) ? anchor : target;
      return this.value;
    }
    const tau = smoothingTau(strength);
    const step = Math.min(Math.max(0, dt), 0.05);
    const alpha = Math.min(1, 1 - Math.exp(-step / tau));
    this.value = previous + (target - previous) * alpha;
    return this.value;
  }
}

/**
 * Like {@link tickAtTime} but extrapolates outside the score, using the first /
 * last tempo segment. The pre-roll uses this so the first notes start above the
 * hit line and fall into it while the audio has not started yet.
 */
export function tickAtTimeUnclamped(timeline: ScoreTimeline, timeMs: number): number {
  const segments = timeline.segments;
  if (segments.length === 0) return 0;
  const ms = Number.isFinite(timeMs) ? timeMs : 0;
  if (ms < 0) {
    const first = segments[0];
    return first.startTick + (ms - first.startMs) * first.bpm * TICKS_PER_QUARTER / 60_000;
  }
  if (ms > timeline.durationMs) {
    const last = segments[segments.length - 1];
    return last.endTick + (ms - last.endMs) * last.bpm * TICKS_PER_QUARTER / 60_000;
  }
  return tickAtTime(timeline, ms);
}
