/**
 * Turns an alphaTab score into the flat, played-order note lane used by the
 * rhythm-game renderer. alphaTab owns file parsing, repeats, tempo automation
 * and (from the engine) audio playback; this module only projects the model
 * onto "string + tick" events.
 */
import * as alphaTab from '@coderline/alphatab';
import {
  TICKS_PER_QUARTER,
  beatTicks,
  buildTimeline,
  timeAtTick,
  type ScoreTimeline,
} from './timeline';
import type {
  LaneNote,
  LoadedScore,
  ScoreMeta,
  TechniqueTag,
  TrackInfo,
  TrackScore,
} from './types';

interface ParseOptions {
  bytes?: Uint8Array | null;
  tex?: string | null;
  fileName?: string;
  /** Use the exact tick lookup alphaTab built for playback when available. */
  tickLookup?: any | null;
}

/** A no-op IMidiFileHandler: MidiFileGenerator builds the tick lookup as a side effect. */
function makeTickHandler(): any {
  return {
    addTimeSignature() {},
    addRest() {},
    addNote() {},
    addControlChange() {},
    addProgramChange() {},
    addTempo() {},
    addNoteBend() {},
    addBend() {},
    addTickShift() {},
    addMetronome() {},
    finishTrack() {},
  };
}

export function buildTickLookup(score: any): any {
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), makeTickHandler());
  generator.generate();
  return generator.tickLookup;
}

function countTrackNotes(track: any): number {
  let count = 0;
  for (const staff of track.staves ?? []) {
    for (const bar of staff.bars ?? []) {
      for (const voice of bar.voices ?? []) {
        for (const beat of voice.beats ?? []) {
          for (const note of beat.notes ?? []) {
            if (note.isVisible !== false && !note.isTieDestination) count += 1;
          }
        }
      }
    }
  }
  return count;
}

function trackInfo(track: any): TrackInfo {
  const staves: any[] = track.staves ?? [];
  const stringStaff = staves.find((staff) => staff?.isStringed && !staff?.isPercussion)
    ?? staves.find((staff) => staff?.isStringed);
  const tuning: number[] = Array.isArray(stringStaff?.stringTuning?.tunings)
    ? [...stringStaff.stringTuning.tunings]
    : [];
  const stringCount = tuning.length;
  return {
    index: Number(track.index) || 0,
    name: String(track.name || `Track ${Number(track.index) + 1}`),
    instrument: String(stringStaff?.tuningName || track.name || ''),
    stringCount,
    tuning,
    noteCount: countTrackNotes(track),
    isPercussion: !!track.isPercussion,
    isStringed: !!stringStaff,
  };
}

function noteTags(note: any, beat: any): TechniqueTag[] {
  const tags: TechniqueTag[] = [];
  if (note.hasBend || note.isContinuedBend) tags.push('bend');
  if (note.isHarmonic) tags.push('harmonic');
  if (note.isPalmMute || beat.isPalmMute) tags.push('palmMute');
  if (note.isLetRing || beat.isLetRing) tags.push('letRing');
  if (note.isHammerPullOrigin || note.isHammerPullDestination || note.isSlurOrigin || note.isSlurDestination) tags.push('legato');
  if ((note.slideInType ?? 0) !== 0 || (note.slideOutType ?? 0) !== 0) tags.push('slide');
  if ((note.vibrato ?? 0) !== 0) tags.push('vibrato');
  if (note.isDead) tags.push('dead');
  if (note.isStaccato) tags.push('staccato');
  if (note.isGhost) tags.push('ghost');
  if (note.isLeftHandTapped || beat.tap) tags.push('tap');
  if (note.isTrill) tags.push('trill');
  if (beat.isTremolo) tags.push('tremolo');
  if ((note.accentuated ?? 0) !== 0) tags.push('accent');
  return tags;
}

function tieLengthTicks(note: any): { ticks: number; heads: number } {
  let ticks = beatTicks(note.beat);
  let heads = 1;
  let cursor = note.tieDestination;
  let guard = 0;
  while (cursor && guard < 64) {
    ticks += beatTicks(cursor.beat);
    heads += 1;
    cursor = cursor.tieDestination;
    guard += 1;
  }
  return { ticks, heads };
}

function noteVelocity(note: any): number {
  const dynamic = Number(note.dynamics);
  const base = Number.isFinite(dynamic) ? Math.min(1, Math.max(0.25, (dynamic + 1) / 9)) : 0.75;
  return Number.isFinite(base) ? Math.round(base * 1000) / 1000 : 0.75;
}

function makeNote(
  note: any,
  beat: any,
  startTick: number,
  occurrence: number,
  chordSize: number,
  endTickLimit: number,
  timeline: ScoreTimeline,
  id: number,
): LaneNote | null {
  if (note.isVisible === false || note.isTieDestination) return null;
  const { ticks, heads } = tieLengthTicks(note);
  let length = ticks;
  if (note.isStaccato) length = Math.max(1, Math.round(length * 0.5));
  const endTick = Math.min(endTickLimit, startTick + length);
  const timeMs = timeAtTick(timeline, startTick);
  const endTimeMs = timeAtTick(timeline, endTick);
  const tags = noteTags(note, beat);
  if (heads > 1) tags.push('tie');
  const fret = Number(note.fret) || 0;
  return {
    id,
    tick: startTick,
    endTick,
    timeMs,
    endTimeMs,
    durationMs: Math.max(0, endTimeMs - timeMs),
    string: Number(note.string) || 1,
    fret,
    text: note.isDead ? 'X' : String(fret),
    velocity: noteVelocity(note),
    barIndex: Number(beat?.voice?.bar?.index) || 0,
    beatIndex: Number(beat?.index) || 0,
    occurrence,
    chordSize,
    tags,
    tieCount: heads - 1,
  };
}

const MAX_LINK_TICKS = 8 * TICKS_PER_QUARTER;

/**
 * alphaTab stores the destination of hammer-ons, pull-offs, slurs and slides
 * on the origin note. Project those model pointers onto the played-order
 * events so the renderer can join the two note shapes. A destination may be
 * absent from the played events (tied notes are merged), in which case the
 * nearest later note on the same string is a reasonable fallback.
 */
function attachLinks(
  notes: LaneNote[],
  sourceOf: WeakMap<LaneNote, any>,
  eventsOfNote: Map<any, LaneNote[]>,
): void {
  if (notes.length === 0) return;
  const byString = new Map<number, LaneNote[]>();
  for (const note of notes) {
    const list = byString.get(note.string);
    if (list) list.push(note);
    else byString.set(note.string, [note]);
  }

  const nextOnString = (event: LaneNote, kind: 'legato' | 'slide'): LaneNote | null => {
    const list = byString.get(event.string);
    if (!list) return null;
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (list[mid].tick <= event.tick + 0.5) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < list.length; i += 1) {
      const candidate = list[i];
      if (candidate.tick - event.tick > MAX_LINK_TICKS) break;
      // Prefer the same repeat occurrence, but accept the next note if the
      // repeat map is ambiguous.
      if (candidate.occurrence === event.occurrence) return candidate;
      if (kind === 'legato') return candidate;
    }
    return null;
  };

  for (const event of notes) {
    const source = sourceOf.get(event);
    if (!source) continue;
    const kind: 'legato' | 'slide' | null = source.slideTarget
      ? 'slide'
      : (source.hammerPullDestination || source.slurDestination ? 'legato' : null);
    if (!kind) continue;
    const targetModel = source.slideTarget ?? source.hammerPullDestination ?? source.slurDestination ?? null;
    let target: LaneNote | null = null;
    if (targetModel) {
      const candidates = eventsOfNote.get(targetModel) ?? [];
      const later = candidates.filter((candidate) => candidate.tick > event.tick + 0.5);
      const sameOccurrence = later.filter((candidate) => candidate.occurrence === event.occurrence);
      const pool = sameOccurrence.length > 0 ? sameOccurrence : later;
      pool.sort((a, b) => a.tick - b.tick);
      target = pool[0] ?? null;
    }
    if (!target) target = nextOnString(event, kind);
    if (!target || target.tick <= event.tick || target.tick - event.tick > MAX_LINK_TICKS) continue;
    event.link = {
      kind,
      targetId: target.id,
      targetTick: target.tick,
      targetTimeMs: target.timeMs,
      targetString: target.string,
    };
  }
}

/**
 * Build every track's lane events from one traversal of the played-order tick
 * lookup. The same beat object appears again on repeats, so the occurrence
 * counter (and the per-masterbar dedupe set) keeps those as separate hits.
 */
export function parseScore(score: any, options: ParseOptions = {}): LoadedScore {
  let tickLookup = options.tickLookup;
  if (!tickLookup || !Array.isArray(tickLookup.masterBars) || tickLookup.masterBars.length === 0) {
    tickLookup = buildTickLookup(score);
  }
  const timeline = buildTimeline(tickLookup.masterBars, Number(score.tempo) || 120);
  const trackInfos: TrackInfo[] = (score.tracks ?? []).map(trackInfo);
  const noteBuckets = new Map<number, LaneNote[]>();
  for (const info of trackInfos) noteBuckets.set(info.index, []);
  const occurrences = new Map<number, number>();
  const sourceOf = new WeakMap<LaneNote, any>();
  const eventsOfNote = new Map<any, LaneNote[]>();
  let nextId = 1;

  for (const masterBar of tickLookup.masterBars ?? []) {
    const barModelIndex = Number(masterBar?.masterBar?.index);
    if (!Number.isFinite(barModelIndex)) continue;
    const occurrence = (occurrences.get(barModelIndex) ?? 0) + 1;
    occurrences.set(barModelIndex, occurrence);
    const seen = new Set<any>();
    let slice = masterBar.firstBeat;
    let guard = 0;
    while (slice && guard++ < 100_000) {
      for (const item of slice.highlightedBeats ?? []) {
        const beat = item.beat;
        if (!beat || seen.has(beat)) continue;
        const bar = beat.voice?.bar;
        if (!bar || Number(bar.index) !== barModelIndex) continue;
        seen.add(beat);
        const trackIndex = Number(bar.staff?.track?.index);
        if (!Number.isFinite(trackIndex)) continue;
        const bucket = noteBuckets.get(trackIndex);
        if (!bucket) continue;
        const startTick = Math.max(Number(masterBar.start) || 0, (Number(masterBar.start) || 0) + (Number(item.playbackStart) || 0));
        const attacks = (beat.notes ?? []).filter((note: any) => note.isVisible !== false && !note.isTieDestination);
        if (attacks.length === 0) continue;
        const chordSize = attacks.length;
        for (const note of attacks) {
          const event = makeNote(note, beat, startTick, occurrence, chordSize, timeline.endTick, timeline, nextId);
          if (event) {
            bucket.push(event);
            sourceOf.set(event, note);
            const existing = eventsOfNote.get(note);
            if (existing) existing.push(event);
            else eventsOfNote.set(note, [event]);
            nextId += 1;
          }
        }
      }
      slice = slice.nextBeat;
    }
  }

  for (const notes of noteBuckets.values()) {
    notes.sort((a, b) => a.tick - b.tick || a.string - b.string || a.id - b.id);
    attachLinks(notes, sourceOf, eventsOfNote);
  }

  const tracks: TrackScore[] = trackInfos.map((info) => ({
    info,
    notes: noteBuckets.get(info.index) ?? [],
  }));

  const meta: ScoreMeta = {
    title: String(score.title || ''),
    subtitle: String(score.subTitle || ''),
    artist: String(score.artist || ''),
    album: String(score.album || ''),
    tempo: Number(score.tempo) || 120,
    barCount: (score.masterBars ?? []).length,
    trackCount: tracks.length,
    durationMs: timeline.durationMs,
    endTick: timeline.endTick,
    hasBackingTrack: !!score.backingTrack?.rawAudioFile,
    tracks: trackInfos,
  };

  return {
    meta,
    bytes: options.bytes ?? null,
    tex: options.tex ?? null,
    fileName: options.fileName || '',
    timeline,
    tracks,
    rawScore: score,
  };
}

/**
 * Preferred track: stringed, non-percussion, many notes, and not silent for
 * the first minutes of the song. A pure note-count pick tends to land on a
 * solo track that only enters halfway through, which makes the initial preview
 * look empty; the first-note time is the tie-breaker that avoids that.
 */
export function pickDefaultTrack(tracks: TrackScore[]): number {
  const rank = (track: TrackScore) => {
    const first = track.notes[0]?.timeMs ?? Number.POSITIVE_INFINITY;
    return track.notes.length / (1 + Math.max(0, first) / 15_000);
  };
  const stringed = tracks
    .filter((track) => track.info.isStringed && !track.info.isPercussion && track.notes.length > 0)
    .sort((a, b) => rank(b) - rank(a));
  if (stringed.length > 0) return stringed[0].info.index;
  const withNotes = tracks.filter((track) => track.notes.length > 0).sort((a, b) => rank(b) - rank(a));
  return withNotes[0]?.info.index ?? tracks[0]?.info.index ?? 0;
}

export function tuningLabels(tuning: number[]): string[] {
  return tuning.map((value) => {
    try {
      return alphaTab.model.Tuning.getTextForTuning(value, false);
    } catch {
      return '';
    }
  });
}
