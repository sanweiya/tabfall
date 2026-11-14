import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';
import { parseScore, pickDefaultTrack } from '../core/score-data';

function load(name: string) {
  const bytes = new Uint8Array(readFileSync(new URL(`../samples/${name}`, import.meta.url)));
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
  return { bytes, score };
}

test('parses an original GP7 file into played-order lane events', () => {
  const { bytes, score } = load('tabfall-demo.gp');
  const loaded = parseScore(score, { bytes, fileName: 'tabfall-demo.gp' });
  assert.ok(loaded.timeline.durationMs > 25_000, 'demo is over 25 seconds');
  assert.equal(loaded.meta.barCount, 13);
  assert.ok(loaded.tracks.length >= 1);
  const trackIndex = pickDefaultTrack(loaded.tracks);
  const track = loaded.tracks.find((entry) => entry.info.index === trackIndex);
  assert.ok(track && track.notes.length > 100, 'default track has notes');
  let lastTick = -1;
  for (const note of track.notes) {
    assert.ok(note.tick >= lastTick, 'notes sorted by tick');
    lastTick = note.tick;
    assert.ok(note.string >= 1 && note.string <= track.info.stringCount);
    assert.ok(note.endTick >= note.tick);
    assert.ok(note.timeMs >= 0 && note.timeMs <= loaded.timeline.durationMs + 1);
    assert.ok(!note.tags.includes('tie') || note.tieCount >= 1);
  }
  assert.ok(track.notes.some((note) => note.chordSize >= 3), 'chords survive the round-trip');
  assert.ok(track.notes.some((note) => note.tags.includes('palmMute')));
  assert.ok(track.notes.some((note) => note.tags.includes('bend')));
});

test('resolves repeats into repeated lane events', () => {
  const { bytes, score } = load('tabfall-repeat.gp');
  const loaded = parseScore(score, { bytes, fileName: 'tabfall-repeat.gp' });
  const track = loaded.tracks[0];
  assert.ok(track.notes.length > 0);
  const occurrenceCounts = new Set(track.notes.map((note) => `${note.barIndex}:${note.occurrence}`));
  assert.ok(occurrenceCounts.has('0:1'));
  assert.ok(occurrenceCounts.has('0:2'), 'bar 0 is played twice');
  assert.ok(occurrenceCounts.has('1:2'), 'bar 1 is played twice');
  assert.ok(occurrenceCounts.has('2:2'), 'bar 2 is played twice');
  assert.equal(new Set(track.notes.map((note) => note.id)).size, track.notes.length);
  assert.ok(loaded.timeline.durationMs > 10_000);
});

test('tempo map is monotonic and invertible', async () => {
  const { score } = load('tabfall-demo.gp');
  const loaded = parseScore(score, {});
  const { tickAtTime, timeAtTick } = await import('../core/timeline');
  const timeline = loaded.timeline;
  assert.ok(timeline.segments.length > 0);
  for (const seg of timeline.segments) {
    assert.ok(seg.endMs >= seg.startMs);
    assert.ok(seg.endTick > seg.startTick);
  }
  for (let i = 0; i <= 20; i++) {
    const t = timeline.durationMs * i / 20;
    const tick = tickAtTime(timeline, t);
    const back = timeAtTick(timeline, tick);
    assert.ok(Math.abs(back - t) < 2, `roundtrip ${t} -> ${tick} -> ${back}`);
  }
});

test('GP7 tie chains are merged and destinations are not separate hits', () => {
  const { bytes, score } = load('tabfall-tie.gp');
  const loaded = parseScore(score, { bytes });
  const track = loaded.tracks[0];
  const tied = track.notes.find((note) => note.tick === 0);
  assert.ok(tied);
  assert.equal(tied.tieCount, 3);
  assert.equal(tied.endTick, 3840);
  assert.equal(track.notes.filter((note) => note.tick > 0 && note.tick < 3840).length, 0);
  assert.ok(track.notes.some((note) => note.chordSize === 3));
});
