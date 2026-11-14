/**
 * The vertical rhythm-game lane renderer. alphaTab's notation SVG is never
 * painted here: the lane is drawn from the played-order note projection, which
 * is what makes the scroll time-linear, the digits upright and the note length
 * proportional to the written duration.
 */
import type {
  AppearanceSettings,
  LaneNote,
  LoadedScore,
  NoteShape,
  ProjectSettings,
  TrackScore,
} from '../types';
import { TICKS_PER_QUARTER, tempoAtTick, tickAtTime, timeAtTick } from '../timeline';
import type { HitEffects } from './effects';

export interface LaneGeometry {
  width: number;
  height: number;
  unit: number;
  stringCount: number;
  cx: number;
  gap: number;
  span: number;
  left: number;
  right: number;
  stringXs: number[];
  hitY: number;
  noteW: number;
  noteH: number;
  fontSize: number;
  pxPerTick: number;
  pxPerMs: number;
  hudPad: number;
  titleSize: number;
  metaSize: number;
}

export interface LaneFrame {
  /** Raw score clock in ms; negative during the pre-roll. */
  clockMs: number;
  visualTick: number;
  visualMs: number;
  scoreDurationMs: number;
  leadInMs: number;
  combo: number;
  playing: boolean;
}

export interface LaneAssets {
  backgroundImage: HTMLImageElement | null;
}

interface VisibleNote {
  note: LaneNote;
  x: number;
  headY: number;
  endY: number;
  hit: boolean;
}

const NOTE_COLORS: Record<string, string> = {
  bend: '#ffb454',
  harmonic: '#ff6ad5',
  palmMute: '#8fa3b8',
  letRing: '#7cf7b0',
  legato: '#ffd166',
  slide: '#ff8f5e',
  vibrato: '#c4b5fd',
  tap: '#a78bfa',
  trill: '#fca5a5',
  tremolo: '#fca5a5',
  dead: '#9aa4b2',
};

const TECHNIQUE_LABEL: Record<string, string> = {
  bend: 'b',
  harmonic: '◇',
  palmMute: 'PM',
  letRing: '○',
  legato: 'H',
  slide: '↗',
  vibrato: '~',
  dead: 'X',
  staccato: '·',
  ghost: '( )',
  tap: 'T',
  trill: 'tr',
  tremolo: '≡',
  accent: '>',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function computeGeometry(
  width: number,
  height: number,
  track: TrackScore,
  settings: ProjectSettings,
): LaneGeometry {
  const layout = settings.layout;
  const stringCount = Math.max(1, track.info.stringCount || 6);
  const unit = clamp(Math.min(width, height) / 1080, 0.35, 3.2);
  const portrait = height > width * 1.04;
  const baseGap = (portrait ? 139 : 119) * unit;
  const gap = clamp(baseGap * layout.laneWidth, 18 * unit, width * 0.19);
  const span = gap * (stringCount - 1);
  const cx = width * (0.5 + layout.laneOffset);
  const left = cx - span / 2;
  const right = cx + span / 2;
  const hitY = height * clamp(layout.hitLineRatio, 0.35, 0.96);
  const noteScale = clamp(layout.noteScale, 0.5, 1.6);
  const noteH = clamp(gap * 0.48 * noteScale * settings.appearance.noteHeight, 10, gap * 0.9);
  const noteW = clamp(gap * 0.66 * noteScale * settings.appearance.noteWidth, noteH * 0.9, gap * 0.94);
  const stringXs: number[] = [];
  for (let s = 1; s <= stringCount; s += 1) {
    // alphaTab numbers strings from the lowest (1) to the highest, so the high
    // string is the last one: "high-right" puts string N on the right edge.
    stringXs.push(settings.appearance.stringOrder === 'high-right'
      ? left + (s - 1) * gap
      : right - (s - 1) * gap);
  }
  return {
    width,
    height,
    unit,
    stringCount,
    cx,
    gap,
    span,
    left,
    right,
    stringXs,
    hitY,
    noteW,
    noteH,
    fontSize: noteH * 0.6,
    pxPerTick: clamp(layout.pxPerBeat, 30, 500) * unit / TICKS_PER_QUARTER,
    pxPerMs: clamp(layout.pxPerSecond, 30, 1200) * unit / 1000,
    hudPad: 28 * unit,
    titleSize: 42 * unit * clamp(settings.appearance.titleSize, 0.6, 2),
    metaSize: 14.5 * unit,
  };
}

function isLightBackground(appearance: AppearanceSettings): boolean {
  // A pure black canvas is always the dark theme, whatever the gradient colours say.
  return appearance.backgroundMode !== 'black' && luminance(appearance.backgroundTop) > 0.55;
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const parsed = full.length === 6 ? Number.parseInt(full, 16) : Number.NaN;
  if (!Number.isFinite(parsed)) return `rgba(62, 232, 255, ${clamp01(alpha)})`;
  return `rgba(${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}, ${clamp01(alpha)})`;
}

function mix(hex: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const raw = value.replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
    const n = Number.parseInt(full, 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
  };
  const a = parse(hex);
  const b = parse(target);
  const t = clamp01(amount);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function tuningName(value: number): string {
  if (!Number.isFinite(value)) return '';
  const pitch = ((Math.round(value) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(value) / 12) - 1;
  return `${PITCH_NAMES[pitch]}${octave}`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function diamondPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

function fontStack(value: string, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

const glowSprites = new Map<string, HTMLCanvasElement>();
function noteGlow(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cached = glowSprites.get(color);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.22, color);
  g.addColorStop(0.6, rgba(color, 0.25));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowSprites.set(color, canvas);
  return canvas;
}

/** Harmonic notes force a diamond head unless the user disabled the override. */
export function resolvedNoteShape(note: LaneNote, appearance: AppearanceSettings): NoteShape {
  return note.tags.includes('harmonic') && appearance.harmonicDiamond ? 'diamond' : appearance.noteShape;
}

export function laneNoteColor(note: LaneNote, appearance: AppearanceSettings): string {
  if (appearance.noteColorMode === 'accent') return appearance.accent;
  if (appearance.noteColorMode === 'technique') {
    for (const tag of note.tags) {
      if (NOTE_COLORS[tag]) return NOTE_COLORS[tag];
    }
    return appearance.accent;
  }
  const palette = appearance.stringColors;
  if (!palette.length) return appearance.accent;
  return palette[(note.string - 1) % palette.length];
}

function techniqueColor(note: LaneNote, appearance: AppearanceSettings): string | null {
  for (const tag of note.tags) {
    if (NOTE_COLORS[tag]) return NOTE_COLORS[tag];
  }
  return null;
}

export function mapY(note: LaneNote, settings: ProjectSettings, frame: LaneFrame, geometry: LaneGeometry): { headY: number; endY: number } {
  if (settings.layout.spacing === 'time') {
    return {
      headY: geometry.hitY - (note.timeMs - frame.visualMs) * geometry.pxPerMs,
      endY: geometry.hitY - (note.endTimeMs - frame.visualMs) * geometry.pxPerMs,
    };
  }
  return {
    headY: geometry.hitY - (note.tick - frame.visualTick) * geometry.pxPerTick,
    endY: geometry.hitY - (note.endTick - frame.visualTick) * geometry.pxPerTick,
  };
}

/** One cached blurred backdrop per (image, frame size, blur) — see drawBackground. */
const backgroundBlurCache = new WeakMap<HTMLImageElement, { key: string; canvas: HTMLCanvasElement }>();

function blurredBackground(
  image: HTMLImageElement,
  width: number,
  height: number,
  blur: number,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${width}x${height}@${blur.toFixed(1)}`;
  const cached = backgroundBlurCache.get(image);
  if (cached && cached.key === key) return cached.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.drawImage(
    image,
    (width - image.naturalWidth * scale) / 2,
    (height - image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  backgroundBlurCache.set(image, { key, canvas });
  return canvas;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  assets: LaneAssets,
): void {
  const { width, height } = geometry;
  if (appearance.backgroundMode === 'black') {
    // Exactly #000: no gradient, image or vignette, so the frame can be
    // composited over another video with additive / screen blending.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, appearance.backgroundTop);
  gradient.addColorStop(1, appearance.backgroundBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (assets.backgroundImage) {
    const image = assets.backgroundImage;
    const blur = Math.max(0, appearance.backgroundImageBlur) * geometry.unit;
    // Blurring a full frame is by far the most expensive per-frame operation
    // when a photo is set, and the result never changes: render it once into an
    // offscreen canvas and blit that instead.
    const blurred = blur > 0.3 ? blurredBackground(image, width, height, blur) : null;
    if (blurred) {
      ctx.drawImage(blurred, 0, 0);
    } else {
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.save();
      if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.globalAlpha = 1;
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
      ctx.restore();
    }
    const dim = clamp01(appearance.backgroundImageDim);
    if (dim > 0) {
      ctx.fillStyle = rgba(appearance.backgroundTop, dim * 0.92);
      ctx.fillRect(0, 0, width, height);
    }
  }

  // Vignette keeps the lane readable and gives the frame depth.
  const vignette = ctx.createRadialGradient(
    width / 2, geometry.hitY * 0.72, Math.min(width, height) * 0.12,
    width / 2, geometry.hitY * 0.72, Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Lane glow for pure-black frames: an ellipse whose radius stops exactly at the
 * frame borders, so the glow reaches alpha 0 before any edge. Compositing the
 * clip over another video then shows no hard seam at the frame boundary.
 */
function drawEdgeSafeLaneGlow(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
): void {
  const { left, right, hitY, width, height } = geometry;
  const cx = (left + right) / 2;
  const cy = hitY;
  const rx = Math.max(1, Math.min(cx, width - cx));
  const ry = Math.max(1, Math.min(cy, height - cy));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, rgba(appearance.accent, 0.3 * appearance.laneGlow));
  glow.addColorStop(0.55, rgba(appearance.accent2, 0.08 * appearance.laneGlow));
  glow.addColorStop(1, rgba(appearance.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/**
 * Fade every non-HUD layer to black at the frame border. Together with the pure
 * black background this guarantees the exported clip has exactly zero at its
 * edges (no hard cut of a glow when it is composited over another video).
 */
function drawFrameEdgeFade(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  // At least two 16px codec blocks, so the border blocks stay dark after encoding.
  const fade = Math.max(32, Math.min(width, height) * 0.055);
  const edges: Array<[number, number, number, number]> = [
    [0, 0, 0, fade],
    [0, height, 0, height - fade],
    [0, 0, fade, 0],
    [width, 0, width - fade, 0],
  ];
  for (const [x0, y0, x1, y1] of edges) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    if (y0 === y1) {
      ctx.fillRect(x0 === 0 ? 0 : width - fade, 0, fade, height);
    } else {
      ctx.fillRect(0, y0 === 0 ? 0 : height - fade, width, fade);
    }
  }
  // Gradients are sampled at pixel centres, so the outermost row keeps a
  // fraction of a percent of the content. A solid safety border makes the
  // encoded frame exactly 0 at the border.
  ctx.fillStyle = '#000000';
  const border = 2;
  ctx.fillRect(0, 0, width, border);
  ctx.fillRect(0, height - border, width, border);
  ctx.fillRect(0, 0, border, height);
  ctx.fillRect(width - border, 0, border, height);
}

function drawLanePanel(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
): void {
  const { left, right, gap, height, hitY, width } = geometry;
  if (appearance.backgroundMode === 'black') {
    drawEdgeSafeLaneGlow(ctx, geometry, appearance);
    return;
  }
  const pad = gap * 1.05;
  const panelLeft = Math.max(-gap, left - pad);
  const panelRight = Math.min(width + gap, right + pad);
  const light = isLightBackground(appearance);
  const panelColor = light ? '#ffffff' : '#04070d';

  const glow = ctx.createRadialGradient(
    (left + right) / 2, hitY, 0,
    (left + right) / 2, hitY, Math.max(gap * 7, width * 0.35),
  );
  glow.addColorStop(0, rgba(appearance.accent, 0.3 * appearance.laneGlow));
  glow.addColorStop(0.55, rgba(appearance.accent2, 0.08 * appearance.laneGlow));
  glow.addColorStop(1, rgba(appearance.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  const panel = ctx.createLinearGradient(0, 0, 0, height);
  panel.addColorStop(0, rgba(panelColor, appearance.lanePanel * 0.35));
  panel.addColorStop(0.55, rgba(panelColor, appearance.lanePanel));
  panel.addColorStop(1, rgba(panelColor, appearance.lanePanel * 0.8));
  ctx.fillStyle = panel;
  ctx.fillRect(panelLeft, 0, panelRight - panelLeft, height);

  ctx.restore();
}

function drawStringLines(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
): void {
  const { stringXs, height, unit } = geometry;
  // On a pure-black frame the strings fade to 0 at both ends as well, so the
  // exported clip has no bright hairline touching the frame border.
  const softEnds = appearance.backgroundMode === 'black';
  ctx.save();
  const stroke = ctx.createLinearGradient(0, 0, 0, height);
  stroke.addColorStop(0, rgba(appearance.stringColor, softEnds ? 0 : appearance.stringOpacity * 0.4));
  stroke.addColorStop(0.22, rgba(appearance.stringColor, appearance.stringOpacity));
  stroke.addColorStop(0.78, rgba(appearance.stringColor, appearance.stringOpacity));
  stroke.addColorStop(1, rgba(appearance.stringColor, softEnds ? 0 : appearance.stringOpacity * 0.18));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(0.8, appearance.stringWidth * unit * 1.15);
  ctx.beginPath();
  for (const x of stringXs) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBeatGuides(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  score: LoadedScore,
  settings: ProjectSettings,
  frame: LaneFrame,
): void {
  const opacity = clamp01(appearance.beatGuideOpacity);
  if (opacity <= 0.001) return;
  const { hitY, pxPerTick, pxPerMs, left, right, gap, unit } = geometry;
  const maxY = hitY + gap * 0.4;
  const minY = -gap;
  // Collect the visible quarter-note pulses (and every bar downbeat brighter).
  const beats: Array<{ y: number; bar: boolean }> = [];
  if (settings.layout.spacing === 'time') {
    const pastMs = Math.max(0, (hitY - maxY) / Math.max(0.0001, pxPerMs));
    const aheadMs = Math.max(0, (hitY - minY) / Math.max(0.0001, pxPerMs));
    const firstTick = tickAtTime(score.timeline, Math.max(0, frame.visualMs - pastMs));
    const lastTick = tickAtTime(score.timeline, Math.min(score.timeline.durationMs, frame.visualMs + aheadMs));
    const step = TICKS_PER_QUARTER / 2;
    for (let tick = Math.ceil(firstTick / step) * step; tick <= lastTick; tick += step) {
      const ms = timeAtTick(score.timeline, tick);
      const y = hitY - (ms - frame.visualMs) * pxPerMs;
      if (y < minY || y > maxY) continue;
      beats.push({ y, bar: Math.abs(tick % (TICKS_PER_QUARTER * 4)) < 0.5 });
    }
  } else {
    const first = Math.ceil((frame.visualTick - (hitY - minY) / Math.max(0.0001, pxPerTick)) / (TICKS_PER_QUARTER / 2)) * (TICKS_PER_QUARTER / 2);
    const last = frame.visualTick + (maxY - hitY) / Math.max(0.0001, pxPerTick);
    for (let tick = first; tick <= last; tick += TICKS_PER_QUARTER / 2) {
      const y = hitY - (tick - frame.visualTick) * pxPerTick;
      if (y < minY || y > maxY) continue;
      beats.push({ y, bar: Math.abs(tick % (TICKS_PER_QUARTER * 4)) < 0.5 });
    }
  }
  ctx.save();
  ctx.strokeStyle = rgba(appearance.stringColor, opacity);
  ctx.lineWidth = Math.max(0.6, unit * 0.9);
  for (const beat of beats) {
    ctx.globalAlpha = beat.bar ? 1 : 0.45;
    ctx.beginPath();
    ctx.moveTo(left - gap * 0.26, beat.y);
    ctx.lineTo(right + gap * 0.26, beat.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the connector between a hammer-on / pull-off / slur / slide origin and
 * its destination. The connector is drawn before the note heads, so both
 * capsules look joined; once the origin is hit, the link grows out of the hit
 * line until the destination itself reaches it.
 */
export interface MergedGroup {
  notes: LaneNote[];
}

export interface MergedPlan {
  groups: MergedGroup[];
  /** Every note that participates in a merged body. */
  mergedIds: Set<number>;
  /** Source notes whose link is replaced by a merged body. */
  mergedSourceIds: Set<number>;
}

/**
 * Decide which connected notes are close enough to become one continuous
 * shape. Only same-string, non-harmonic/non-text links can merge; everything
 * else keeps a connector line. The distance is measured in the current layout
 * (note heights), so it stays proportional on every resolution.
 */
export function planMergedGroups(
  notes: LaneNote[],
  settings: ProjectSettings,
  appearance: AppearanceSettings,
  geometry: LaneGeometry,
): MergedPlan {
  const empty: MergedPlan = { groups: [], mergedIds: new Set(), mergedSourceIds: new Set() };
  if (!appearance.mergeNearShapes) return empty;
  const withLinks = notes.filter((note) => note.link);
  if (withLinks.length === 0) return empty;

  const byId = new Map<number, LaneNote>();
  for (const note of notes) byId.set(note.id, note);
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let current = id;
    while (parent.has(current) && parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  const union = (a: number, b: number): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const limit = geometry.noteH * clamp(appearance.mergeDistance || 1.6, 0.5, 4);
  const timeMode = settings.layout.spacing === 'time';
  const eligibleShape = (note: LaneNote): boolean => {
    const shape = resolvedNoteShape(note, appearance);
    return shape === 'circle' || shape === 'capsule' || shape === 'square';
  };
  const mergedSourceIds = new Set<number>();

  for (const note of withLinks) {
    const link = note.link!;
    if (link.kind === 'legato' && !appearance.connectLegato) continue;
    if (link.kind === 'slide' && !appearance.connectSlide) continue;
    const target = byId.get(link.targetId);
    if (!target || target.tick <= note.tick) continue;
    if (note.string !== target.string) continue;
    if (!eligibleShape(note) || !eligibleShape(target)) continue;
    const distance = timeMode
      ? Math.abs(target.timeMs - note.timeMs) * geometry.pxPerMs
      : Math.abs(target.tick - note.tick) * geometry.pxPerTick;
    if (!(distance <= limit)) continue;
    union(note.id, target.id);
    mergedSourceIds.add(note.id);
  }

  if (parent.size === 0) return empty;
  const buckets = new Map<number, LaneNote[]>();
  for (const note of notes) {
    if (!parent.has(note.id)) continue;
    const root = find(note.id);
    const list = buckets.get(root);
    if (list) list.push(note);
    else buckets.set(root, [note]);
  }
  const groups: MergedGroup[] = [];
  const mergedIds = new Set<number>();
  for (const groupNotes of buckets.values()) {
    if (groupNotes.length < 2) continue;
    groupNotes.sort((a, b) => a.tick - b.tick || a.string - b.string);
    groups.push({ notes: groupNotes });
    for (const note of groupNotes) mergedIds.add(note.id);
  }
  return { groups, mergedIds, mergedSourceIds };
}

/** Paint the continuous body shared by a merged group of notes. */
function drawMergedBodies(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  settings: ProjectSettings,
  frame: LaneFrame,
  groups: MergedGroup[],
): void {
  if (groups.length === 0) return;
  for (const group of groups) {
    const positioned = group.notes.map((note) => ({
      note,
      headY: mapY(note, settings, frame, geometry).headY,
      hit: frame.clockMs > note.timeMs + 0.01,
    }));
    const centers = positioned.map((entry) => entry.headY);
    const topCenter = Math.min(...centers);
    const bottomCenter = Math.max(...centers);
    if (bottomCenter < -geometry.noteH * 3) continue;
    if (topCenter > geometry.hitY + geometry.noteH * 2) continue;

    const first = positioned[0]?.note ?? group.notes[0];
    const last = positioned[positioned.length - 1]?.note ?? group.notes[group.notes.length - 1];
    const shape = resolvedNoteShape(first, appearance);
    const font = `900 ${geometry.fontSize.toFixed(1)}px ${fontStack(appearance.noteFont, 'sans-serif')}`;
    ctx.save();
    ctx.font = font;
    let width = shape === 'circle' ? geometry.noteH : geometry.noteW;
    const pad = shape === 'circle' ? geometry.noteH * 0.72 : geometry.noteH * 0.55;
    for (const entry of positioned) {
      width = Math.max(width, ctx.measureText(entry.note.text).width + pad);
    }
    width = Math.min(width, geometry.gap * 0.98);
    const top = topCenter - geometry.noteH / 2;
    const bottom = bottomCenter + geometry.noteH / 2;
    const radius = shape === 'circle'
      ? width / 2
      : shape === 'square'
        ? Math.min(width, geometry.noteH) * 0.1
        : Math.min(width, geometry.noteH) * appearance.noteRadius;
    const bottomColor = laneNoteColor(first, appearance);
    const topColor = laneNoteColor(last, appearance);
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, mix(topColor, '#ffffff', 0.16));
    gradient.addColorStop(0.5, topColor);
    gradient.addColorStop(1, mix(bottomColor, '#000000', 0.16));
    ctx.beginPath();
    ctx.rect(0, 0, geometry.width, geometry.hitY + geometry.noteH * 0.25);
    ctx.clip();
    const centerX = visibleCenter(first, geometry);
    const centerY = (top + bottom) / 2;
    const proximity = clamp01(1 - (geometry.hitY - bottomCenter) / Math.max(1, geometry.noteH * 4.5));
    // The merged capsule needs the same halo as a single head; a radial sprite
    // stretched along the body keeps the glow hugging the full shape.
    const halo = noteGlow(bottomColor);
    if (halo && appearance.noteGlow > 0.02) {
      const haloW = width * (1.9 + appearance.noteGlow * 1.3 + proximity * 0.5);
      const haloH = (bottom - top) * (1.1 + appearance.noteGlow * 0.5) + haloW * 0.45;
      ctx.globalAlpha = 0.3 + appearance.noteGlow * 0.4 + proximity * 0.25;
      ctx.drawImage(halo, centerX - haloW / 2, centerY - haloH / 2, haloW, haloH);
      ctx.globalAlpha = 1;
    }
    roundRectPath(ctx, centerX - width / 2, top, width, Math.max(geometry.noteH, bottom - top), radius);
    ctx.fillStyle = gradient;
    ctx.shadowColor = rgba(bottomColor, 0.72);
    ctx.shadowBlur = geometry.unit * (6 + appearance.noteGlow * 16 + proximity * 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${(0.28 + appearance.noteBorder * 0.36).toFixed(3)})`;
    ctx.lineWidth = Math.max(0.8, geometry.unit * 1.3);
    ctx.stroke();
    // A single soft inner highlight along the body makes it read as one piece.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = Math.max(0.8, geometry.unit * 2.2);
    ctx.beginPath();
    ctx.moveTo(visibleCenter(first, geometry) + width * 0.24, top + radius * 0.8);
    ctx.lineTo(visibleCenter(first, geometry) + width * 0.24, bottom - radius * 0.8);
    ctx.stroke();
    ctx.restore();
  }
}

function visibleCenter(note: LaneNote, geometry: LaneGeometry): number {
  return geometry.stringXs[clamp(note.string - 1, 0, geometry.stringXs.length - 1)] ?? geometry.cx;
}

function drawNoteLinks(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  settings: ProjectSettings,
  frame: LaneFrame,
  notes: LaneNote[],
  mergedSourceIds: Set<number>,
): void {
  const timeMode = settings.layout.spacing === 'time';
  const style = appearance.connectionStyle;
  for (const note of notes) {
    const link = note.link;
    if (!link) continue;
    if (mergedSourceIds.has(note.id)) continue;
    if (link.kind === 'legato' && !appearance.connectLegato) continue;
    if (link.kind === 'slide' && !appearance.connectSlide) continue;

    const targetY = timeMode
      ? geometry.hitY - (link.targetTimeMs - frame.visualMs) * geometry.pxPerMs
      : geometry.hitY - (link.targetTick - frame.visualTick) * geometry.pxPerTick;
    const originY = timeMode
      ? geometry.hitY - (note.timeMs - frame.visualMs) * geometry.pxPerMs
      : geometry.hitY - (note.tick - frame.visualTick) * geometry.pxPerTick;
    const originHit = frame.clockMs > note.timeMs + 0.01;
    const y0 = originHit ? geometry.hitY : Math.min(originY, geometry.hitY);
    const x0 = geometry.stringXs[clamp(note.string - 1, 0, geometry.stringXs.length - 1)] ?? geometry.cx;
    const x1 = geometry.stringXs[clamp(link.targetString - 1, 0, geometry.stringXs.length - 1)] ?? geometry.cx;
    const endY = targetY + geometry.noteH * 0.46;
    if (endY >= y0 - 2) continue;
    if (y0 > geometry.height + geometry.noteH * 2) continue;
    if (targetY < -geometry.noteH * 8) continue;
    if (y0 < -geometry.noteH * 8 && targetY < -geometry.noteH * 8) continue;

    const color = laneNoteColor(note, appearance);
    const sameString = Math.abs(x1 - x0) < 1;
    // Bow the connector to the outside of the lane: a slur beside the capsules
    // reads as a link, while a straight vertical band would look like a tail.
    const side = note.string > geometry.stringCount / 2 ? -1 : 1;
    const bow = sameString
      ? Math.min(geometry.noteW * 0.92, Math.abs(endY - y0) * 0.22)
      : Math.min(geometry.noteW * 0.7, Math.hypot(x1 - x0, endY - y0) * 0.12);
    const ctrlX = (x0 + x1) / 2 + side * bow;
    const ctrlY = (y0 + endY) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, geometry.width, geometry.hitY + geometry.noteH * 0.25);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(ctrlX, ctrlY, x1, endY);
    };

    if (style === 'ribbon') {
      const gradient = ctx.createLinearGradient(x0, y0, x1, endY);
      gradient.addColorStop(0, rgba(color, originHit ? 0.18 : 0.32));
      gradient.addColorStop(0.6, rgba(color, 0.4));
      gradient.addColorStop(1, rgba(color, 0.58));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(2, geometry.noteW * 0.2);
      ctx.shadowColor = rgba(color, 0.42);
      ctx.shadowBlur = geometry.unit * 9;
      path();
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Two thin rails make the wide stroke read as a ribbon.
      ctx.strokeStyle = rgba('#ffffff', 0.18);
      ctx.lineWidth = Math.max(0.6, geometry.unit * 0.8);
      path();
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.34);
      ctx.lineWidth = Math.max(0.6, geometry.unit * 0.9);
      path();
      ctx.stroke();
    } else {
      const gradient = ctx.createLinearGradient(x0, y0, x1, endY);
      gradient.addColorStop(0, rgba(color, originHit ? 0.26 : 0.55));
      gradient.addColorStop(1, rgba(color, 0.78));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(1, geometry.noteW * 0.12);
      if (style === 'dashed') ctx.setLineDash([geometry.noteH * 0.55, geometry.noteH * 0.36]);
      ctx.shadowColor = rgba(color, 0.4);
      ctx.shadowBlur = geometry.unit * 7;
      path();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }

    if (link.kind === 'slide') {
      // Arrow at the destination edge, following the curve's final tangent.
      const angle = Math.atan2(endY - ctrlY, x1 - ctrlX);
      const size = Math.max(4, geometry.noteW * 0.2);
      ctx.fillStyle = rgba(color, 0.88);
      ctx.beginPath();
      ctx.moveTo(x1, endY);
      ctx.lineTo(x1 - Math.cos(angle - 0.42) * size, endY - Math.sin(angle - 0.42) * size);
      ctx.lineTo(x1 - Math.cos(angle + 0.42) * size, endY - Math.sin(angle + 0.42) * size);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawTail(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  note: LaneNote,
  visible: VisibleNote,
  color: string,
): void {
  if (appearance.tailMode === 'off') return;
  const isLong = note.tieCount > 0 || note.endTick - note.tick >= TICKS_PER_QUARTER;
  if (appearance.tailMode === 'long' && !isLong) return;
  const top = visible.endY;
  const bottom = visible.headY;
  if (bottom - top < geometry.noteH * 0.3) return;
  const width = Math.max(3, visible.note.chordSize > 3 ? geometry.noteW * appearance.tailWidth * 0.34 : geometry.noteW * appearance.tailWidth * 0.52);
  const x = visible.x - width / 2;
  const alpha = clamp01(appearance.tailOpacity) * (visible.hit ? 0.42 : 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, geometry.width, geometry.hitY + geometry.noteH * 0.25);
  ctx.clip();
  const gradient = ctx.createLinearGradient(0, top, 0, bottom + 4);
  gradient.addColorStop(0, rgba(color, alpha * 0.05));
  gradient.addColorStop(0.35, rgba(color, alpha * 0.4));
  gradient.addColorStop(1, rgba(color, alpha * 0.82));
  ctx.fillStyle = gradient;
  roundRectPath(ctx, x, top, width, bottom - top + 4, width / 2);
  ctx.fill();
  ctx.strokeStyle = rgba('#ffffff', alpha * 0.24);
  ctx.lineWidth = Math.max(0.5, geometry.unit * 0.8);
  ctx.stroke();
  ctx.restore();
}

function techniqueBadge(note: LaneNote): { label: string; color: string } | null {
  for (const tag of note.tags) {
    const label = TECHNIQUE_LABEL[tag];
    if (label && NOTE_COLORS[tag]) return { label, color: NOTE_COLORS[tag] };
  }
  return null;
}

function drawNoteHead(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  note: LaneNote,
  visible: VisibleNote,
  color: string,
  isLight: boolean,
  merged = false,
): void {
  const harmonic = note.tags.includes('harmonic');
  const shape = resolvedNoteShape(note, appearance);
  const h = geometry.noteH * (shape === 'diamond' ? 1.14 : 1);
  const baseW = geometry.noteW;
  ctx.save();
  let fontSize = geometry.fontSize;
  let textWidth = 0;
  const textOnly = shape === 'text';
  const padX = shape === 'diamond' ? h * 0.9 : h * 0.52;
  let w = baseW;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    ctx.font = `900 ${fontSize.toFixed(1)}px ${fontStack(appearance.noteFont, 'sans-serif')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    textWidth = ctx.measureText(note.text).width;
    w = textOnly
      ? Math.max(baseW * 0.6, textWidth + h * 0.55)
      : clamp(textWidth + padX, baseW * (shape === 'diamond' ? 1.1 : 1), geometry.gap * 0.98);
    if (textOnly || textWidth + padX <= geometry.gap * 0.98) break;
    fontSize *= 0.86;
  }
  ctx.font = `900 ${fontSize.toFixed(1)}px ${fontStack(appearance.noteFont, 'sans-serif')}`;
  const x = visible.x - w / 2;
  const y = visible.headY - h / 2;
  const proximity = clamp01(1 - (geometry.hitY - visible.headY) / Math.max(1, h * 4.5));
  const radius = shape === 'circle'
    ? Math.min(w, h) / 2
    : shape === 'square'
      ? Math.min(w, h) * 0.12
      : Math.min(w, h) * appearance.noteRadius;
  const textColor = appearance.noteAutoText
    ? (luminance(color) > 0.58 ? '#081018' : '#ffffff')
    : appearance.noteTextColor;

  if (merged) {
    // The group body already supplies the shape and border; draw only the
    // fret number so several close notes read as one continuous capsule.
    ctx.fillStyle = textColor;
    ctx.shadowColor = rgba('#000000', isLight ? 0.22 : 0.5);
    ctx.shadowBlur = geometry.unit * 3;
    ctx.fillText(note.text, visible.x, visible.headY + h * 0.02);
    ctx.shadowBlur = 0;
    ctx.restore();
    return;
  }

  if (textOnly) {
    // Digits only: a soft halo keeps them legible over any background.
    const glow = noteGlow(color);
    if (glow && appearance.noteGlow > 0.02) {
      const radiusPx = Math.max(w, h) * (1.1 + appearance.noteGlow * 1.6 + proximity * 0.5);
      ctx.globalAlpha = 0.34 + appearance.noteGlow * 0.4 + proximity * 0.25;
      ctx.drawImage(glow, visible.x - radiusPx / 2, visible.headY - radiusPx / 2, radiusPx, radiusPx);
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = geometry.unit * (6 + appearance.noteGlow * 18 + proximity * 12);
    ctx.fillStyle = color;
    ctx.fillText(note.text, visible.x, visible.headY + geometry.unit * 0.5);
    ctx.shadowBlur = 0;
  } else {
    const glow = noteGlow(color);
    if (glow && appearance.noteGlow > 0.02) {
      const radiusPx = Math.max(w, h) * (1.2 + appearance.noteGlow * 1.5 + proximity * 0.7);
      ctx.globalAlpha = 0.22 + appearance.noteGlow * 0.34 + proximity * 0.28;
      ctx.drawImage(glow, visible.x - radiusPx / 2, visible.headY - radiusPx / 2, radiusPx, radiusPx);
      ctx.globalAlpha = 1;
    }
    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    gradient.addColorStop(0, mix(color, '#ffffff', 0.36));
    gradient.addColorStop(0.55, color);
    gradient.addColorStop(1, mix(color, '#000000', isLight ? 0.05 : 0.24));
    ctx.fillStyle = gradient;
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(visible.x, visible.headY, Math.min(w, h) / 2, 0, Math.PI * 2);
    } else if (shape === 'diamond') {
      diamondPath(ctx, visible.x, visible.headY, w, h);
    } else {
      roundRectPath(ctx, x, y, w, h, radius);
    }
    ctx.fill();
    if (appearance.noteBorder > 0.01) {
      ctx.strokeStyle = `rgba(255,255,255,${(0.22 + appearance.noteBorder * 0.48).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.7, geometry.unit * 1.35);
      ctx.stroke();
    }
    if (shape === 'diamond') {
      // A smaller inner diamond reads as a gem and makes harmonics obvious.
      diamondPath(ctx, visible.x, visible.headY, w * 0.62, h * 0.62);
      ctx.strokeStyle = `rgba(255,255,255,${(0.26 + proximity * 0.2).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, geometry.unit * 1.1);
      ctx.stroke();
    } else {
      // Top highlight line.
      ctx.strokeStyle = `rgba(255,255,255,${(0.24 + proximity * 0.2).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, geometry.unit * 1.1);
      ctx.beginPath();
      ctx.moveTo(x + radius * 0.9, y + h * 0.24);
      ctx.lineTo(x + w - radius * 0.9, y + h * 0.24);
      ctx.stroke();
    }
    ctx.fillStyle = textColor;
    ctx.shadowColor = rgba('#000000', isLight ? 0.2 : 0.45);
    ctx.shadowBlur = geometry.unit * 3;
    ctx.fillText(note.text, visible.x, visible.headY + h * 0.02);
    ctx.shadowBlur = 0;
  }

  if (appearance.showTechniqueTags) {
    const badge = techniqueBadge(note);
    if (badge) {
      const size = Math.max(8, geometry.unit * 10);
      ctx.font = `800 ${size.toFixed(1)}px ${fontStack(appearance.noteFont, 'sans-serif')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bx = visible.x + w / 2 - size * 0.28;
      const by = y - size * 0.82;
      ctx.fillStyle = rgba('#04070d', 0.66);
      roundRectPath(ctx, bx - size * 1.05, by - size * 0.7, size * (badge.label.length > 1 ? 2.2 : 1.5), size * 1.4, size * 0.45);
      ctx.fill();
      ctx.fillStyle = badge.color;
      ctx.fillText(badge.label, bx, by);
    }
  }

  // Proximity ring: a subtle "about to hit" cue.
  if (proximity > 0.05 && shape !== 'text') {
    ctx.strokeStyle = rgba(color, 0.18 + proximity * 0.36);
    ctx.lineWidth = Math.max(0.8, geometry.unit * 1.2);
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(visible.x, visible.headY, Math.min(w, h) / 2 + geometry.unit * (3 + proximity * 4), 0, Math.PI * 2);
    } else if (shape === 'diamond') {
      diamondPath(ctx, visible.x, visible.headY, w + geometry.unit * 2 * (3 + proximity * 4), h + geometry.unit * 2 * (3 + proximity * 4));
    } else {
      roundRectPath(ctx, x - geometry.unit * (3 + proximity * 4), y - geometry.unit * (3 + proximity * 4), w + geometry.unit * 2 * (3 + proximity * 4), h + geometry.unit * 2 * (3 + proximity * 4), radius + geometry.unit * 3);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawHitLine(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  energy: number,
): void {
  if (!appearance.showHitLine) return;
  const { hitY, left, right, gap, unit } = geometry;
  const ext = gap * (0.3 + 1.2 * clamp01(appearance.hitLineExtension));
  const x0 = left - ext;
  const x1 = right + ext;
  const y = hitY;
  const color = appearance.hitLineColor || appearance.accent;
  const glow = clamp01(appearance.hitLineGlow);
  const pulse = clamp01(energy);
  ctx.save();
  ctx.lineCap = 'round';
  // Wide halo.
  const halo = ctx.createLinearGradient(x0, 0, x1, 0);
  halo.addColorStop(0, rgba(color, 0));
  halo.addColorStop(0.12, rgba(color, 0.16 + pulse * 0.18));
  halo.addColorStop(0.5, rgba(color, 0.4 + pulse * 0.3));
  halo.addColorStop(0.88, rgba(color, 0.16 + pulse * 0.18));
  halo.addColorStop(1, rgba(color, 0));
  ctx.strokeStyle = halo;
  ctx.lineWidth = Math.max(2, appearance.hitLineWidth * unit * (5 + glow * 5 + pulse * 4));
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  // Core.
  const core = ctx.createLinearGradient(x0, 0, x1, 0);
  core.addColorStop(0, rgba(color, 0));
  core.addColorStop(0.1, rgba(color, 0.7));
  core.addColorStop(0.5, rgba('#ffffff', 0.85));
  core.addColorStop(0.9, rgba(color, 0.7));
  core.addColorStop(1, rgba(color, 0));
  ctx.strokeStyle = core;
  ctx.lineWidth = Math.max(1, appearance.hitLineWidth * unit * (1 + pulse * 0.3));
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  // End caps.
  ctx.strokeStyle = rgba(color, 0.85);
  ctx.lineWidth = Math.max(1, appearance.hitLineWidth * unit * 0.9);
  for (const x of [x0, x1]) {
    ctx.beginPath();
    ctx.moveTo(x, y - gap * 0.16);
    ctx.lineTo(x, y + gap * 0.16);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStringLegend(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  track: TrackScore,
  isLight: boolean,
): void {
  if (!appearance.showStringLabels && !appearance.showStringNumbers) return;
  const { stringXs, hitY, gap, unit, width } = geometry;
  const labels = track.info.tuning;
  // Pure-black frames fade the outer band to 0 and the legend is drawn after
  // that fade, so it has to stay out of the band instead of sitting 16px above
  // the bottom edge.
  const edgeGuard = appearance.backgroundMode === 'black'
    ? Math.max(32, Math.min(width, geometry.height) * 0.055) + unit * 6
    : 0;
  const y = Math.min(geometry.height - unit * 16 - edgeGuard, hitY + gap * 0.72);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${(unit * 10.5).toFixed(1)}px ${fontStack(appearance.noteFont, 'sans-serif')}`;
  for (let i = 0; i < stringXs.length; i += 1) {
    const parts: string[] = [];
    if (appearance.showStringNumbers) parts.push(String(i + 1));
    if (appearance.showStringLabels) {
      // tuning[] is ordered high -> low, while columns are low -> high.
      const value = labels[labels.length - 1 - i];
      if (Number.isFinite(value)) parts.push(tuningName(value));
    }
    const text = parts.filter(Boolean).join(' ');
    if (!text) continue;
    ctx.fillStyle = rgba(appearance.stringColor, isLight ? 0.62 : 0.55);
    ctx.fillText(text, stringXs[i], y);
  }
  ctx.restore();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, Math.max(1, low))}…`;
}

/** Shared HUD inset; pure-black frames keep text away from the edge fade. */
function hudPadding(geometry: LaneGeometry, appearance: AppearanceSettings): number {
  return appearance.backgroundMode === 'black'
    ? Math.max(geometry.hudPad, Math.min(geometry.width, geometry.height) * 0.075)
    : geometry.hudPad;
}

/**
 * READY countdown and combo counter live on the lane plane, so they are drawn
 * into the lane layer and follow the perspective view instead of floating flat
 * over a tilted lane.
 */
function drawLaneHud(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  frame: LaneFrame,
  light: boolean,
): void {
  const { width, unit } = geometry;
  const hudPad = hudPadding(geometry, appearance);
  const text = light ? '#241b10' : '#f4f8ff';
  if (appearance.combo && frame.combo > 0) {
    const comboScale = clamp(Number(appearance.comboScale) || 1, 0.4, 3);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `900 ${(unit * 54 * comboScale).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = text;
    ctx.fillText(String(frame.combo), width - hudPad, hudPad + unit * 62 * comboScale);
    ctx.font = `800 ${(unit * 10 * comboScale).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = rgba(appearance.accent, 0.9);
    ctx.fillText('COMBO', width - hudPad, hudPad + unit * 78 * comboScale);
  }
  if (frame.clockMs < 0) {
    const readyScale = clamp(Number(appearance.readyScale) || 1, 0.4, 3);
    const seconds = Math.max(1, Math.ceil(-frame.clockMs / 1000));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${(unit * 16 * readyScale).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = rgba(appearance.accent, 0.8);
    ctx.fillText('READY', width / 2, geometry.hitY - unit * 118 * readyScale);
    ctx.font = `900 ${(unit * 46 * readyScale).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = rgba(text, 0.82);
    ctx.fillText(String(seconds), width / 2, geometry.hitY - unit * 70 * readyScale);
  }
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  appearance: AppearanceSettings,
  score: LoadedScore,
  track: TrackScore,
  frame: LaneFrame,
  trackLabel: string,
): void {
  const { width, height, unit } = geometry;
  const hudPad = hudPadding(geometry, appearance);
  const light = isLightBackground(appearance);
  const text = light ? '#241b10' : '#f4f8ff';
  const soft = light ? 'rgba(36,27,16,0.62)' : 'rgba(226,238,252,0.6)';
  const portrait = height >= width * 0.96;
  // In landscape the lane sits in the middle of the frame. Keep the header text
  // out of the falling-note columns instead of letting a long song title run
  // over the play area.
  const laneLeftEdge = geometry.left - geometry.gap * 1.1;
  const textLimit = portrait
    ? width - hudPad * 2
    : Math.max(120, Math.min(width - hudPad * 2, laneLeftEdge - hudPad * 1.4));
  if (appearance.backgroundMode !== 'black'
    && portrait && (appearance.showTitle || appearance.showArtist || appearance.showMeta)) {
    // A portrait lane spans almost the full frame, so the header sits on top of
    // the falling notes. A short top scrim keeps it readable without hiding the
    // play area.
    const hudBottom = hudPad + geometry.titleSize * 2.55 + geometry.metaSize * 2;
    const scrim = ctx.createLinearGradient(0, 0, 0, hudBottom);
    scrim.addColorStop(0, rgba(appearance.backgroundTop, 0.96));
    scrim.addColorStop(0.58, rgba(appearance.backgroundTop, 0.72));
    scrim.addColorStop(1, rgba(appearance.backgroundTop, 0));
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, hudBottom);
  }
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  let titleSizeUsed = geometry.titleSize;
  let cursorY = hudPad;
  if (appearance.showTitle) {
    const title = score.meta.title || trackLabel || 'Untitled';
    let titleFont = geometry.titleSize;
    ctx.font = `800 ${titleFont.toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    const natural = ctx.measureText(title).width;
    if (natural > textLimit) {
      // Prefer a slightly smaller complete title over an ellipsis; long song
      // names are common and the header is part of the video.
      titleFont = Math.max(geometry.titleSize * 0.62, titleFont * textLimit / natural * 0.98);
      ctx.font = `800 ${titleFont.toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    }
    titleSizeUsed = titleFont;
    ctx.fillStyle = text;
    const displayTitle = truncate(ctx, title, Math.max(80, textLimit));
    const baseline = cursorY + titleFont * 0.9;
    const x = portrait ? width / 2 : hudPad;
    ctx.textAlign = portrait ? 'center' : 'left';
    ctx.fillText(displayTitle, x, baseline);
    // Accent underline.
    const measured = ctx.measureText(displayTitle).width;
    const lineY = baseline + titleFont * 0.2;
    const lineX = portrait ? width / 2 - measured / 2 : hudPad;
    const line = ctx.createLinearGradient(lineX, 0, lineX + measured, 0);
    line.addColorStop(0, rgba(appearance.accent, 0.9));
    line.addColorStop(1, rgba(appearance.accent2, 0.1));
    ctx.fillStyle = line;
    ctx.fillRect(lineX, lineY, measured, Math.max(1.5, unit * 2.4));
    cursorY = lineY + geometry.metaSize * 0.8;
  } else {
    cursorY = hudPad + geometry.metaSize * 0.4;
  }

  if (appearance.showArtist && (score.meta.artist || score.meta.album)) {
    ctx.font = `600 ${(geometry.metaSize * 1.05).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = soft;
    ctx.textAlign = portrait ? 'center' : 'left';
    const artistLine = [score.meta.artist, score.meta.album].filter(Boolean).join('  ·  ');
    const baseline = cursorY + geometry.metaSize * 1.1;
    ctx.fillText(truncate(ctx, artistLine, textLimit), portrait ? width / 2 : hudPad, baseline);
    cursorY = baseline + geometry.metaSize * 0.38;
  }

  if (appearance.showMeta) {
    const tick = frame.visualTick;
    const bpm = tempoAtTick(score.timeline, Math.max(0, tick));
    const tuning = track.info.tuning.length > 0
      ? track.info.tuning.map((value) => tuningName(value)).filter(Boolean).join(' ')
      : '';
    const meta = [
      `${Math.round(bpm)} BPM`,
      trackLabel ? `${trackLabel}` : '',
      tuning ? `TUNING ${tuning}` : '',
      appearsPortrait(geometry) ? '' : `${track.info.stringCount} STRINGS`,
    ].filter(Boolean).join('  ·  ');
    ctx.font = `600 ${(geometry.metaSize * 0.88).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = soft;
    ctx.textAlign = portrait ? 'center' : 'left';
    const baseline = cursorY + geometry.metaSize * 1.05;
    ctx.fillText(truncate(ctx, meta, textLimit), portrait ? width / 2 : hudPad, baseline);
  }

  // On pure-black frames the progress bar is inset: a full-bleed bar would put
  // bright pixels on the frame border and create a seam when compositing.
  const progressInset = appearance.backgroundMode === 'black'
    ? Math.max(10, Math.min(width, height) * 0.03)
    : 0;
  const barH = Math.max(2, unit * 3);
  if (appearance.showProgress && frame.scoreDurationMs > 0) {
    const progress = clamp01(frame.clockMs / frame.scoreDurationMs);
    const barX = progressInset;
    const barW = width - progressInset * 2;
    const y = height - barH - progressInset;
    ctx.fillStyle = rgba('#ffffff', light ? 0.16 : 0.12);
    ctx.fillRect(barX, y, barW, barH);
    const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    gradient.addColorStop(0, appearance.accent);
    gradient.addColorStop(1, appearance.accent2);
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, y, barW * progress, barH);
    // Playhead tick.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(barX + Math.round(barW * progress) - Math.max(1, unit), y - barH * 1.2, Math.max(2, unit * 2), barH * 3.4);
  }

  if (appearance.showWatermark && appearance.watermark.trim()) {
    ctx.textAlign = 'right';
    ctx.font = `700 ${(unit * 9.5).toFixed(1)}px ${fontStack(appearance.titleFont, 'sans-serif')}`;
    ctx.fillStyle = light ? 'rgba(36,27,16,0.42)' : 'rgba(226,238,252,0.4)';
    const y = appearance.showProgress
      ? height - barH - progressInset - unit * 5
      : height - unit * 7;
    ctx.fillText(`${appearance.watermark.trim()}  ·  alphaTab`, width - hudPad * 0.7, y);
  }

  ctx.restore();
}

function appearsPortrait(geometry: LaneGeometry): boolean {
  return geometry.height >= geometry.width * 0.96;
}

/** Cached transparent layer used for the perspective warp (one per frame size). */
const laneLayerCache = new Map<string, HTMLCanvasElement>();

function acquireLaneLayer(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${width}x${height}`;
  let canvas = laneLayerCache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    laneLayerCache.set(key, canvas);
    if (laneLayerCache.size > 3) {
      const oldest = laneLayerCache.keys().next().value;
      if (oldest !== undefined) laneLayerCache.delete(oldest);
    }
  }
  return canvas;
}

/** Camera distance in normalized units; controls how much the far edge shrinks. */
const PERSPECTIVE_CAMERA = 2.4;

/**
 * Draws the lane layer as a plane rotated about the horizontal or vertical axis.
 * No element is ever enlarged: the near edge keeps scale 1 and the far edge
 * shrinks, so the projected picture is narrower than the frame (by cos on the
 * depth axis) and the margins show the background. The result is centred on the
 * rotation axis, matching a real camera looking at a tilted plane.
 */
function drawPerspective(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  width: number,
  height: number,
  axis: 'vertical' | 'horizontal',
  angleDeg: number,
): void {
  const radians = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const absSin = Math.abs(sin);
  const vertical = axis === 'vertical';
  const length = vertical ? height : width;
  const halfLength = length / 2;
  const steps = Math.max(64, Math.round(length / 3));
  const positions = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * 2 - 1;
    // Near edge scale = 1; far edge = (d - |sin|) / (d + |sin|).
    const scale = (PERSPECTIVE_CAMERA - absSin) / (PERSPECTIVE_CAMERA - t * sin);
    positions[i] = halfLength + t * cos * scale * halfLength;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const srcStep = length / steps;
  for (let i = 0; i < steps; i += 1) {
    const start = Math.round(Math.min(positions[i], positions[i + 1]));
    const end = Math.round(Math.max(positions[i], positions[i + 1]));
    if (end <= start) continue;
    const mid = ((i + 0.5) / steps) * 2 - 1;
    const scale = (PERSPECTIVE_CAMERA - absSin) / (PERSPECTIVE_CAMERA - mid * sin);
    if (vertical) {
      const destW = width * scale;
      ctx.drawImage(
        layer,
        0, i * srcStep, width, srcStep,
        (width - destW) / 2, start, destW, end - start,
      );
    } else {
      const destH = height * scale;
      ctx.drawImage(
        layer,
        i * srcStep, 0, srcStep, height,
        start, (height - destH) / 2, end - start, destH,
      );
    }
  }
  ctx.restore();
}

/** All lane layers between the background and the flat HUD. */
function drawLaneScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  score: LoadedScore,
  track: TrackScore,
  settings: ProjectSettings,
  frame: LaneFrame,
  effects: HitEffects,
  geometry: LaneGeometry,
  light: boolean,
): void {
  const appearance = settings.appearance;
  const timeMode = settings.layout.spacing === 'time';
  drawLanePanel(ctx, geometry, appearance);
  drawStringLines(ctx, geometry, appearance);
  if (appearance.showBeatGuides) drawBeatGuides(ctx, geometry, appearance, score, settings, frame);

  const visible: VisibleNote[] = [];
  const pastMargin = timeMode
    ? (height - geometry.hitY + geometry.noteH * 2) / Math.max(0.0001, geometry.pxPerMs)
    : (height - geometry.hitY + geometry.noteH * 2) / Math.max(0.0001, geometry.pxPerTick);
  const aheadMargin = timeMode
    ? (geometry.hitY + geometry.noteH * 3) / Math.max(0.0001, geometry.pxPerMs)
    : (geometry.hitY + geometry.noteH * 3) / Math.max(0.0001, geometry.pxPerTick);
  for (const note of track.notes) {
    if (timeMode) {
      if (note.endTimeMs < frame.visualMs - pastMargin) continue;
      if (note.timeMs > frame.visualMs + aheadMargin) break;
    } else {
      if (note.endTick < frame.visualTick - pastMargin) continue;
      if (note.tick > frame.visualTick + aheadMargin) break;
    }
    const { headY, endY } = mapY(note, settings, frame, geometry);
    if (endY > height + geometry.noteH * 2) continue;
    if (headY < -geometry.noteH * 3) continue;
    const x = geometry.stringXs[clamp(note.string - 1, 0, geometry.stringXs.length - 1)] ?? geometry.cx;
    const hit = frame.clockMs > note.timeMs + 0.01;
    visible.push({ note, x, headY, endY, hit });
  }

  const merged = planMergedGroups(track.notes, settings, appearance, geometry);
  // The judgement line acts as a mask: a note keeps the part that is still
  // above the line until its top has crossed too. The hit effect still fires at
  // the centre crossing, but the shape is clipped, not popped out.
  const clipBottom = geometry.hitY + Math.max(0.5, geometry.unit * 0.4);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, clipBottom);
  ctx.clip();
  drawMergedBodies(ctx, geometry, appearance, settings, frame, merged.groups);
  drawNoteLinks(ctx, geometry, appearance, settings, frame, track.notes, merged.mergedSourceIds);

  // Tails first, so capsule heads always sit above their own body.
  for (const entry of visible) {
    const color = laneNoteColor(entry.note, appearance);
    drawTail(ctx, geometry, appearance, entry.note, entry, color);
  }

  // Note heads: draw them even after the hit until their top is below the line;
  // the clip above supplies the natural cut.
  for (const entry of visible) {
    if (entry.headY - geometry.noteH * 1.2 > geometry.hitY) continue;
    const color = laneNoteColor(entry.note, appearance);
    drawNoteHead(ctx, geometry, appearance, entry.note, entry, color, light, merged.mergedIds.has(entry.note.id));
  }
  ctx.restore();

  const energy = effects.energy(frame.clockMs);
  if (appearance.hitFlash > 0 && energy > 0.001) {
    const flash = ctx.createRadialGradient(
      geometry.cx, geometry.hitY, 0,
      geometry.cx, geometry.hitY, Math.max(width * 0.25, geometry.span * 0.9),
    );
    flash.addColorStop(0, rgba(appearance.accent, 0.22 * energy * appearance.hitFlash));
    flash.addColorStop(0.55, rgba(appearance.accent2, 0.07 * energy * appearance.hitFlash));
    flash.addColorStop(1, rgba(appearance.accent, 0));
    ctx.fillStyle = flash;
    ctx.fillRect(0, 0, width, height);
  }

  drawHitLine(ctx, geometry, appearance, energy);
  effects.draw(ctx, frame.clockMs, { unit: geometry.unit, hitY: geometry.hitY });
  drawLaneHud(ctx, geometry, appearance, frame, light);
}

/** Paint one complete preview/export frame. */
export function drawLaneFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  score: LoadedScore,
  track: TrackScore,
  settings: ProjectSettings,
  frame: LaneFrame,
  effects: HitEffects,
  assets: LaneAssets,
): LaneGeometry {
  const geometry = computeGeometry(width, height, track, settings);
  const appearance = settings.appearance;
  const light = isLightBackground(appearance);
  const axis = settings.layout.perspectiveAxis;
  const angle = clamp(Number(settings.layout.perspectiveAngle) || 0, -60, 60);
  const perspective = (axis === 'vertical' || axis === 'horizontal') && Math.abs(angle) > 0.5;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, geometry, appearance, assets);

  let warped = false;
  if (perspective) {
    const layer = acquireLaneLayer(width, height);
    const layerCtx = layer?.getContext('2d') ?? null;
    if (layerCtx) {
      layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      layerCtx.clearRect(0, 0, width, height);
      drawLaneScene(layerCtx, width, height, score, track, settings, frame, effects, geometry, light);
      drawPerspective(ctx, layer as HTMLCanvasElement, width, height, axis as 'vertical' | 'horizontal', angle);
      warped = true;
    }
  }
  if (!warped) {
    drawLaneScene(ctx, width, height, score, track, settings, frame, effects, geometry, light);
  }

  if (appearance.backgroundMode === 'black') drawFrameEdgeFade(ctx, width, height);
  drawStringLegend(ctx, geometry, appearance, track, light);
  drawHud(ctx, geometry, appearance, score, track, frame, track.info.name);
  return geometry;
}
