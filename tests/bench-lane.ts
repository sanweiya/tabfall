/**
 * Standalone benchmark for the lane renderer's per-frame scan costs.
 * Not part of `npm test`; run it with:  npx tsx tests/bench-lane.ts
 *
 * It exists to quantify the "per-frame full scan" fix from known-issues.md on
 * a large synthetic score: before the fix, every frame scanned the track from
 * note 0 and rebuilt the merge plan (union-find over every link) from scratch.
 * The iteration counts below mirror the loops in core/render/lane.ts; the
 * timing section measures the real exported functions directly.
 */
import { performance } from 'node:perf_hooks';
import { computeGeometry, planMergedGroups } from '../core/render/lane';
import { DEFAULT_SETTINGS, type LaneNote, type TrackScore } from '../core/types';

const TICKS_PER_QUARTER = 960;

/** 16th notes at 132 BPM with a legato link every 8th note. */
function syntheticTrack(noteCount: number): TrackScore {
  const step = TICKS_PER_QUARTER / 4;
  const quarterMs = 60_000 / 132;
  const notes: LaneNote[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    const tick = i * step;
    // Notes share a string in pairs so the legato link below is same-string
    // and close enough to merge into one continuous body.
    const string = 1 + (Math.floor(i / 2) % 6);
    const note: LaneNote = {
      id: i + 1,
      tick,
      endTick: tick + step,
      timeMs: (tick / TICKS_PER_QUARTER) * quarterMs,
      endTimeMs: ((tick + step) / TICKS_PER_QUARTER) * quarterMs,
      durationMs: (step / TICKS_PER_QUARTER) * quarterMs,
      string,
      fret: i % 13,
      text: String(i % 13),
      velocity: 0.8,
      barIndex: Math.floor(i / 16),
      beatIndex: i % 4,
      occurrence: 1,
      chordSize: 1,
      tags: [],
      tieCount: 0,
    };
    if (i % 8 === 0 && i + 1 < noteCount) {
      note.tags.push('legato');
      note.link = {
        kind: 'legato',
        targetId: i + 2,
        targetTick: tick + step,
        targetTimeMs: ((tick + step) / TICKS_PER_QUARTER) * quarterMs,
        targetString: string,
      };
    }
    notes.push(note);
  }
  return {
    info: {
      index: 0, name: 'Bench', instrument: 'Standard', stringCount: 6,
      tuning: [64, 59, 55, 50, 45, 40], noteCount, isPercussion: false, isStringed: true,
    },
    notes,
  };
}

/** Mirrors the (unexported) binary search in core/render/lane.ts. */
function lowerBound(notes: LaneNote[], tick: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (notes[mid].tick < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

function main(): void {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const noteCount = 6000;
  const track = syntheticTrack(noteCount);
  const geometry = computeGeometry(1920, 1080, track, settings);
  const frame = { clockMs: 0, visualTick: 0, visualMs: 0, scoreDurationMs: 0, leadInMs: 0, combo: 0, playing: true };

  console.log(`synthetic score: ${noteCount} notes (16ths @ 132 BPM), 1 link per 8 notes, 1920x1080`);

  // --- Timing: merge plan rebuild (once) vs cache hits (per frame) ---------
  let start = performance.now();
  planMergedGroups(track.notes, settings, settings.appearance, geometry);
  const buildMs = performance.now() - start;
  const calls = 2000;
  start = performance.now();
  for (let i = 0; i < calls; i += 1) {
    planMergedGroups(track.notes, settings, settings.appearance, geometry);
  }
  const cachedMs = (performance.now() - start) / calls;
  console.log(`merge plan : rebuild ${buildMs.toFixed(3)} ms  |  cached ${cachedMs.toFixed(6)} ms/frame  (${Math.round(buildMs / Math.max(cachedMs, 1e-9))}x cheaper per frame)`);

  // --- Counts: visible-note scan, old linear skip vs binary-search window --
  const pastMargin = (1080 - geometry.hitY + geometry.noteH * 2) / Math.max(0.0001, geometry.pxPerTick);
  const aheadMargin = (geometry.hitY + geometry.noteH * 3) / Math.max(0.0001, geometry.pxPerTick);
  let noteSpanTicks = 0;
  let linkSpanTicks = 0;
  for (const note of track.notes) {
    noteSpanTicks = Math.max(noteSpanTicks, note.endTick - note.tick);
    if (note.link) linkSpanTicks = Math.max(linkSpanTicks, note.link.targetTick - note.tick);
  }
  const songTicks = track.notes[track.notes.length - 1].tick;
  const frames = 200;
  let oldExamined = 0;
  let newExamined = 0;
  let oldLinks = 0;
  let newLinks = 0;
  for (let f = 0; f < frames; f += 1) {
    frame.visualTick = songTicks * (0.1 + (0.8 * f) / frames);
    frame.clockMs = (frame.visualTick / TICKS_PER_QUARTER) * (60_000 / 132);
    const end = lowerBound(track.notes, frame.visualTick + aheadMargin);
    const first = lowerBound(track.notes, frame.visualTick - pastMargin - noteSpanTicks);
    oldExamined += end; // the old loop ran from index 0 up to the break point
    newExamined += end - first;
    const linkPast = Math.min(frame.visualTick - pastMargin, frame.visualTick - linkSpanTicks - 1);
    const linkAhead = (geometry.hitY + geometry.noteH * 8) / Math.max(0.0001, geometry.pxPerTick);
    oldLinks += track.notes.length; // the old loop visited every note on the track
    newLinks += Math.max(0, lowerBound(track.notes, frame.visualTick + linkAhead) - lowerBound(track.notes, linkPast));
  }
  console.log(`visible scan : ${(oldExamined / frames).toFixed(0)} notes examined/frame (old)  ->  ${(newExamined / frames).toFixed(0)} (binary window)`);
  console.log(`link pass    : ${(oldLinks / frames).toFixed(0)} notes visited/frame (old)  ->  ${(newLinks / frames).toFixed(0)} (windowed)`);

  // --- Counts: merged-group mapping, every member vs endpoint cull -------
  const plan = planMergedGroups(track.notes, settings, settings.appearance, geometry);
  const groupedNotes = plan.groups.reduce((sum, group) => sum + group.notes.length, 0);
  console.log(`merged groups: ${plan.groups.length} groups / ${groupedNotes} notes; old mapped all ${groupedNotes} per frame, new maps 2 per group + only visible groups' members`);
}

main();
