import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as alphaTab from '@coderline/alphatab';
import { parseScore } from '../core/score-data';
import { computeGeometry, planMergedGroups, resolvedNoteShape } from '../core/render/lane';
import { DEFAULT_SETTINGS, type LaneNote } from '../core/types';

const TEX = String.raw`\title "Links"
\tempo 120
\ts 4 4
.
:4 12.2{nh} 10.2 5.3{h} 7.3 |
:4 7.3{sl} 5.3 3.3 5.3 |`;

function parseTex() {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(TEX, new alphaTab.Settings());
  return parseScore(importer.readScore(), { tex: TEX });
}

test('hammer-ons and slides carry a destination for the renderer', () => {
  const loaded = parseTex();
  const notes = loaded.tracks[0].notes;
  const legato = notes.find((note) => note.link?.kind === 'legato');
  const slide = notes.find((note) => note.link?.kind === 'slide');
  assert.ok(legato, 'hammer-on/pull-off link exists');
  assert.ok(slide, 'slide link exists');
  assert.ok(legato!.link!.targetTick > legato!.tick);
  assert.ok(slide!.link!.targetTick > slide!.tick);
  assert.ok(legato!.link!.targetTimeMs > legato!.timeMs);
  assert.ok(legato!.link!.targetString >= 1);
});

test('harmonic notes resolve to a diamond head by default', () => {
  const loaded = parseTex();
  const harmonic = loaded.tracks[0].notes.find((note) => note.tags.includes('harmonic'));
  assert.ok(harmonic);
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  assert.equal(resolvedNoteShape(harmonic!, settings.appearance), 'diamond');
  settings.appearance.harmonicDiamond = false;
  assert.equal(resolvedNoteShape(harmonic!, settings.appearance), settings.appearance.noteShape);
  settings.appearance.noteShape = 'diamond';
  const plain: LaneNote = { ...harmonic!, tags: [] };
  assert.equal(resolvedNoteShape(plain, settings.appearance), 'diamond');
});


function linkedNote(id: number, tick: number, targetId: number, targetTick: number, string = 3): LaneNote {
  return {
    id, tick, endTick: tick + 240, timeMs: tick / 1.92, endTimeMs: (tick + 240) / 1.92,
    durationMs: 125, string, fret: 5, text: '5', velocity: 0.8, barIndex: 0, beatIndex: 0,
    occurrence: 1, chordSize: 1, tags: ['legato'], tieCount: 0,
    link: { kind: 'legato', targetId, targetTick, targetTimeMs: targetTick / 1.92, targetString: string },
  };
}

test('near connected notes merge into one body; far ones keep a connector', () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.appearance.noteShape = 'circle';
  const track = {
    info: {
      index: 0, name: 'Guitar', instrument: 'Standard', stringCount: 6,
      tuning: [64, 59, 55, 50, 45, 40], noteCount: 4, isPercussion: false, isStringed: true,
    },
    notes: [],
  };
  const geometry = computeGeometry(1920, 1080, track, settings);
  const nearA = linkedNote(1, 0, 2, 480);
  const nearB = { ...linkedNote(2, 480, 0, 0), link: undefined };
  const farA = linkedNote(3, 0, 4, 3840);
  const farB = { ...linkedNote(4, 3840, 0, 0), link: undefined };
  const plan = planMergedGroups([nearA, nearB, farA, farB], settings, settings.appearance, geometry);
  assert.deepEqual(plan.groups.map((group) => group.notes.map((note) => note.id)), [[1, 2]]);
  assert.ok(plan.mergedIds.has(1) && plan.mergedIds.has(2));
  assert.ok(plan.mergedSourceIds.has(1));
  assert.ok(!plan.mergedIds.has(3) && !plan.mergedIds.has(4), 'far link is not merged');

  settings.appearance.mergeNearShapes = false;
  assert.equal(planMergedGroups([nearA, nearB], settings, settings.appearance, geometry).groups.length, 0);
});
