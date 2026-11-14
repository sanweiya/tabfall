import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as alphaTab from '@coderline/alphatab';
import { parseScore, pickDefaultTrack } from '../core/score-data';
import { DEMO_TEX } from '../core/demo';

test('built-in demo parses and has playable notes', () => {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(DEMO_TEX, new alphaTab.Settings());
  const score = importer.readScore();
  const loaded = parseScore(score, { tex: DEMO_TEX, fileName: 'demo.alphatex' });
  const trackIndex = pickDefaultTrack(loaded.tracks);
  const track = loaded.tracks.find((entry) => entry.info.index === trackIndex);
  assert.ok(track);
  assert.ok(track.notes.length > 100, `expected many notes, got ${track.notes.length}`);
  assert.ok(loaded.timeline.durationMs > 25_000, `demo length ${loaded.timeline.durationMs}`);
  assert.ok(track.notes.some((note) => note.chordSize >= 3), 'chords are present');
  assert.ok(track.notes.some((note) => note.tags.includes('palmMute')));
  assert.ok(track.notes.some((note) => note.tags.includes('bend')));
  assert.ok(track.notes.some((note) => note.tags.includes('harmonic')));
  assert.ok(track.notes.every((note) => note.endTick >= note.tick));
});

test('ties merge into one long note and chords keep their simultaneous strings', () => {
  const tex = String.raw`\tempo 120
:4 0.6 0.6{t} 0.6{t} 0.6{t} |
:4 (0.6 2.5 3.4) 5.5 3.4 0.6 |
:8 0.1{tu 3} 2.2{tu 3} 3.3{tu 3} 4.4 5.5 6.6 0.1 2.2 |`;
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  const score = importer.readScore();
  const loaded = parseScore(score, { tex });
  const notes = loaded.tracks[0].notes;
  const tied = notes.find((note) => note.tick === 0);
  assert.ok(tied);
  assert.equal(tied.tieCount, 3, 'three destination heads are merged');
  assert.equal(tied.endTick, 4 * 960, 'the tie chain lasts four quarter notes');
  assert.equal(notes.filter((note) => note.tick > 0 && note.tick < 3840).length, 0, 'tie destinations are not separate hits');
  const chord = notes.filter((note) => note.tick === 3840);
  assert.equal(chord.length, 3);
  assert.equal(chord[0].chordSize, 3);
  assert.deepEqual([...new Set(chord.map((note) => note.string))].sort(), [1, 2, 3]);
  const firstTuplet = notes.find((note) => note.tick === 7680);
  assert.ok(firstTuplet);
  assert.equal(firstTuplet.endTick - firstTuplet.tick, 320, 'eighth-note triplet');
});
