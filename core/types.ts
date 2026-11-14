/** Public data model shared by the parser, renderer, UI and exporter. */

export type SpacingMode = 'beat' | 'time';
export type NoteShape = 'capsule' | 'circle' | 'square' | 'text' | 'diamond';
export type NoteColorMode = 'string' | 'accent' | 'technique';
export type HitEffectKind = 'phigros' | 'smoke' | 'spark' | 'none';
export type TailMode = 'off' | 'long' | 'all';
export type SmoothLookahead = 'off' | 'conservative' | 'normal' | 'aggressive';
export type StringOrder = 'high-right' | 'high-left';
export type BackgroundMode = 'gradient' | 'black';
export type PerspectiveAxis = 'off' | 'vertical' | 'horizontal';
export type ConnectionStyle = 'line' | 'ribbon' | 'dashed';

export interface TrackInfo {
  index: number;
  name: string;
  instrument: string;
  stringCount: number;
  tuning: number[];
  noteCount: number;
  isPercussion: boolean;
  isStringed: boolean;
}

export interface ScoreMeta {
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  tempo: number;
  barCount: number;
  trackCount: number;
  durationMs: number;
  endTick: number;
  hasBackingTrack: boolean;
  tracks: TrackInfo[];
}

export type TechniqueTag =
  | 'bend'
  | 'harmonic'
  | 'palmMute'
  | 'letRing'
  | 'legato'
  | 'slide'
  | 'vibrato'
  | 'dead'
  | 'staccato'
  | 'ghost'
  | 'tap'
  | 'trill'
  | 'tremolo'
  | 'accent'
  | 'tie';

export interface NoteLink {
  kind: 'legato' | 'slide';
  targetId: number;
  targetTick: number;
  targetTimeMs: number;
  targetString: number;
}

export interface LaneNote {
  id: number;
  /** Absolute MIDI tick in the played timeline (repeats resolved). */
  tick: number;
  /** Absolute end tick derived from the written duration (ties merged). */
  endTick: number;
  timeMs: number;
  endTimeMs: number;
  durationMs: number;
  string: number;
  fret: number;
  text: string;
  velocity: number;
  barIndex: number;
  beatIndex: number;
  occurrence: number;
  /** Number of notes sounding at the same instant (a chord has > 1). */
  chordSize: number;
  tags: TechniqueTag[];
  /** Number of tied note heads merged into this one. */
  tieCount: number;
  /** Hammer-on / pull-off / slide target, when this note starts a connection. */
  link?: NoteLink;
}

export interface TrackScore {
  info: TrackInfo;
  notes: LaneNote[];
}

export interface ProjectSettings {
  layout: LayoutSettings;
  appearance: AppearanceSettings;
  video: VideoSettings;
}

export interface LayoutSettings {
  /** Spacing mode: beat-linear (musical length) or time-linear (seconds). */
  spacing: SpacingMode;
  /** Pixels per quarter note at a 1080 px reference height (beat mode). */
  pxPerBeat: number;
  /** Pixels per second at a 1080 px reference height (time mode). */
  pxPerSecond: number;
  /** Hit line position as a fraction of the frame height. */
  hitLineRatio: number;
  /** String gap multiplier around a responsive base. */
  laneWidth: number;
  /** Lane center offset as a fraction of the frame width. */
  laneOffset: number;
  /** Note size multiplier. */
  noteScale: number;
  leadInSec: number;
  outroSec: number;
  /** Perspective view of the lane: 'vertical' / 'horizontal' rotates the plane. */
  perspectiveAxis: PerspectiveAxis;
  /** Tilt in degrees, -60..60; sign flips the near edge. */
  perspectiveAngle: number;
  /** 0..1 first-order smoothing strength for the scroll motion. */
  smoothing: number;
  lookahead: SmoothLookahead;
}

export interface AppearanceSettings {
  /** Named preset currently active (for the UI chip state). */
  preset: string;
  /** 'black' renders a pure #000 frame for additive/screen compositing. */
  backgroundMode: BackgroundMode;
  backgroundTop: string;
  backgroundBottom: string;
  backgroundImage: string | null;
  backgroundImageDim: number;
  backgroundImageBlur: number;
  lanePanel: number;
  laneGlow: number;
  accent: string;
  accent2: string;

  stringColor: string;
  stringWidth: number;
  stringOpacity: number;
  showStringLabels: boolean;
  showStringNumbers: boolean;
  stringOrder: StringOrder;

  noteWidth: number;
  noteHeight: number;
  noteRadius: number;
  noteShape: NoteShape;
  noteColorMode: NoteColorMode;
  /** Twelve colours; the first six map to strings 1..6. */
  stringColors: string[];
  noteTextColor: string;
  noteAutoText: boolean;
  noteGlow: number;
  noteBorder: number;
  noteFont: string;
  showTechniqueTags: boolean;
  /** Draw harmonic note heads as diamonds regardless of the global shape. */
  harmonicDiamond: boolean;
  /** Connect hammer-on / pull-off / slur notes with a visible link. */
  connectLegato: boolean;
  /** Connect slide origin and target notes with a visible link. */
  connectSlide: boolean;
  connectionStyle: ConnectionStyle;
  /** Merge the shapes of very close connected notes into one continuous body. */
  mergeNearShapes: boolean;
  /** Merge when the note centers are within this many note heights. */
  mergeDistance: number;
  tailMode: TailMode;
  tailWidth: number;
  tailOpacity: number;

  showHitLine: boolean;
  hitLineColor: string;
  hitLineWidth: number;
  hitLineGlow: number;
  hitLineExtension: number;
  showBeatGuides: boolean;
  beatGuideOpacity: number;

  hitEffect: HitEffectKind;
  effectIntensity: number;
  effectDuration: number;
  hitFlash: number;
  combo: boolean;

  showTitle: boolean;
  showArtist: boolean;
  showMeta: boolean;
  showProgress: boolean;
  showWatermark: boolean;
  watermark: string;
  titleFont: string;
  titleSize: number;
  /** Scale of the READY countdown block. */
  readyScale: number;
  /** Scale of the combo counter in the top-right corner. */
  comboScale: number;
}

export type ExportContainer = 'mp4' | 'webm';
export type ExportQuality = 'low' | 'normal' | 'high';
export type ExportAudioMode = 'synth' | 'backing' | 'none';

export interface VideoSettings {
  width: number;
  height: number;
  fps: number;
  container: ExportContainer;
  quality: ExportQuality;
  includeAudio: boolean;
  filename: string;
}

export interface LoadedScore {
  meta: ScoreMeta;
  /** The original GP/MusicXML bytes, kept for reloads and backing-track export. */
  bytes: Uint8Array | null;
  tex: string | null;
  fileName: string;
  /** Played-order master bars (repeats already resolved). */
  timeline: import('./timeline').ScoreTimeline;
  tracks: TrackScore[];
  /** Raw alphaTab score, used for embedded backing track and sync points. */
  rawScore: any;
}

export interface AppStatus {
  kind: 'empty' | 'loading' | 'ready' | 'error';
  message?: string;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  spacing: 'beat',
  pxPerBeat: 150,
  pxPerSecond: 300,
  hitLineRatio: 0.8,
  laneWidth: 1,
  laneOffset: 0,
  noteScale: 1,
  leadInSec: 2,
  outroSec: 1.5,
  smoothing: 0.6,
  lookahead: 'normal',
  perspectiveAxis: 'off',
  perspectiveAngle: 20,
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: 'neon-cyan',
  backgroundMode: 'gradient',
  backgroundTop: '#05080f',
  backgroundBottom: '#0b1526',
  backgroundImage: null,
  backgroundImageDim: 0.45,
  backgroundImageBlur: 8,
  lanePanel: 0.34,
  laneGlow: 0.75,
  accent: '#3ee8ff',
  accent2: '#ff4fd8',

  stringColor: '#a9c4d8',
  stringWidth: 1.25,
  stringOpacity: 0.32,
  showStringLabels: false,
  showStringNumbers: false,
  stringOrder: 'high-right',

  noteWidth: 1,
  noteHeight: 1,
  noteRadius: 0.28,
  noteShape: 'capsule',
  noteColorMode: 'string',
  stringColors: ['#3ee8ff', '#7cf7b0', '#ffd166', '#ff8f5e', '#ff6ad5', '#a78bfa', '#f6f7fb', '#f6f7fb'],
  noteTextColor: '#ffffff',
  noteAutoText: true,
  noteGlow: 0.7,
  noteBorder: 0.55,
  noteFont: '"Arial Black", "Avenir Next", "PingFang SC", system-ui, sans-serif',
  showTechniqueTags: false,
  harmonicDiamond: true,
  connectLegato: true,
  connectSlide: true,
  connectionStyle: 'ribbon',
  mergeNearShapes: true,
  mergeDistance: 1.6,
  tailMode: 'long',
  tailWidth: 0.5,
  tailOpacity: 0.42,

  showHitLine: true,
  hitLineColor: '#3ee8ff',
  hitLineWidth: 4,
  hitLineGlow: 0.9,
  hitLineExtension: 0.55,
  showBeatGuides: false,
  beatGuideOpacity: 0.14,

  hitEffect: 'phigros',
  effectIntensity: 0.8,
  effectDuration: 0.7,
  hitFlash: 0.6,
  combo: false,

  showTitle: true,
  showArtist: true,
  showMeta: true,
  showProgress: true,
  showWatermark: true,
  watermark: 'TABFALL',
  titleFont: '"Avenir Next", "PingFang SC", ui-sans-serif, system-ui, sans-serif',
  titleSize: 1,
  readyScale: 1.6,
  comboScale: 1.3,
};

export const DEFAULT_VIDEO: VideoSettings = {
  width: 1920,
  height: 1080,
  fps: 60,
  container: 'mp4',
  quality: 'normal',
  includeAudio: true,
  filename: '',
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  layout: DEFAULT_LAYOUT,
  appearance: DEFAULT_APPEARANCE,
  video: DEFAULT_VIDEO,
};

export interface AppearancePreset {
  id: string;
  label: string;
  patch: Partial<AppearanceSettings>;
}

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  {
    id: 'neon-cyan',
    label: '霓虹青',
    patch: {
      backgroundTop: '#05080f', backgroundBottom: '#0b1526',
      lanePanel: 0.34, laneGlow: 0.75, accent: '#3ee8ff', accent2: '#ff4fd8',
      stringColor: '#a9c4d8', stringOpacity: 0.32, stringWidth: 1.25,
      stringColors: ['#3ee8ff', '#7cf7b0', '#ffd166', '#ff8f5e', '#ff6ad5', '#a78bfa', '#f6f7fb', '#f6f7fb'],
      noteColorMode: 'string', noteTextColor: '#ffffff', noteGlow: 0.7,
      hitLineColor: '#3ee8ff', hitLineGlow: 0.9, hitEffect: 'phigros',
      hitFlash: 0.6, showTitle: true, showArtist: true, showMeta: true, showProgress: true, showWatermark: true,
      watermark: 'TABFALL', combo: false,
    },
  },
  {
    id: 'cyber-pink',
    label: '赛博粉',
    patch: {
      backgroundTop: '#120617', backgroundBottom: '#230a2b',
      lanePanel: 0.4, laneGlow: 0.9, accent: '#ff4fd8', accent2: '#7cf7ff',
      stringColor: '#e7b9e8', stringOpacity: 0.36, stringWidth: 1.3,
      stringColors: ['#ff7ce5', '#ff9bb0', '#ffd166', '#ffb86b', '#b98cff', '#66e6ff', '#ffffff', '#ffffff'],
      noteColorMode: 'string', noteTextColor: '#160614', noteAutoText: true, noteGlow: 0.85,
      hitLineColor: '#ff4fd8', hitLineGlow: 1, hitEffect: 'phigros',
      hitFlash: 0.75, showTitle: true, showArtist: true, showMeta: true, showProgress: true, showWatermark: true,
      watermark: 'TABFALL', combo: true,
    },
  },
  {
    id: 'midnight-gold',
    label: '暗夜金',
    patch: {
      backgroundTop: '#0a0803', backgroundBottom: '#1a1408',
      lanePanel: 0.38, laneGlow: 0.6, accent: '#f6c453', accent2: '#ff8f5e',
      stringColor: '#cbb88d', stringOpacity: 0.3, stringWidth: 1.2,
      stringColors: ['#f6c453', '#ffd98a', '#ffefc2', '#ff9e6b', '#e8c07a', '#b99a5c', '#fff3cf', '#fff3cf'],
      noteColorMode: 'string', noteTextColor: '#1a1204', noteAutoText: true, noteGlow: 0.6,
      hitLineColor: '#f6c453', hitLineGlow: 0.85, hitEffect: 'smoke',
      hitFlash: 0.5, showTitle: true, showArtist: true, showMeta: true, showProgress: true, showWatermark: true,
      watermark: 'TABFALL', combo: false,
    },
  },
  {
    id: 'paper',
    label: '纸面',
    patch: {
      backgroundTop: '#f1ece2', backgroundBottom: '#e2dacb',
      lanePanel: 0.22, laneGlow: 0.25, accent: '#9a5b2a', accent2: '#c4472f',
      stringColor: '#6f6658', stringOpacity: 0.42, stringWidth: 1.1,
      stringColors: ['#b4472f', '#3f7d5a', '#9a5b2a', '#b06a1f', '#6b5a91', '#3f6f9a', '#222222', '#222222'],
      noteColorMode: 'string', noteTextColor: '#241b10', noteAutoText: true, noteGlow: 0.15,
      hitLineColor: '#9a5b2a', hitLineGlow: 0.5, hitEffect: 'spark',
      hitFlash: 0.35, showTitle: true, showArtist: true, showMeta: true, showProgress: true, showWatermark: true,
      watermark: 'TABFALL', combo: false,
    },
  },
  {
    id: 'mono',
    label: '极简白',
    patch: {
      backgroundTop: '#0a0a0b', backgroundBottom: '#141417',
      lanePanel: 0.28, laneGlow: 0.35, accent: '#ffffff', accent2: '#a8a8b3',
      stringColor: '#b9b9c4', stringOpacity: 0.34, stringWidth: 1.15,
      stringColors: ['#ffffff', '#e6e6ee', '#cfcfda', '#ffffff', '#d7d7e2', '#bdbdc9', '#ffffff', '#ffffff'],
      noteColorMode: 'accent', noteTextColor: '#0a0a0b', noteAutoText: true, noteGlow: 0.45,
      hitLineColor: '#ffffff', hitLineGlow: 0.7, hitEffect: 'smoke',
      hitFlash: 0.5, showTitle: true, showArtist: true, showMeta: true, showProgress: true, showWatermark: true,
      watermark: 'TABFALL', combo: false,
    },
  },
];

export const RESOLUTIONS = [
  { id: '1080p', label: '横屏 1080p · 16:9', width: 1920, height: 1080 },
  { id: '720p', label: '横屏 720p · 16:9', width: 1280, height: 720 },
  { id: 'portrait', label: '竖屏 1080×1920 · 9:16', width: 1080, height: 1920 },
  { id: 'portrait720', label: '竖屏 720×1280 · 9:16', width: 720, height: 1280 },
  { id: 'square', label: '方形 1080×1080 · 1:1', width: 1080, height: 1080 },
  { id: 'vertical', label: '竖版 1080×1350 · 4:5', width: 1080, height: 1350 },
] as const;
