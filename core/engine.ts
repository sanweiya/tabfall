/**
 * Owns the alphaTab player, the preview animation loop and the transition from
 * audio ticks to the falling lane. The renderer is stateless; this class is the
 * only place where wall time, audio time and presentation smoothing meet.
 *
 * Audio contract: alphaTab's `timePosition` is the single source of truth.
 * A small local predictor keeps the scroll fluid between its coarse updates,
 * and a presentation-only filter (the same first-order filter used by the
 * GP Studio horizontal camera) damps the drawing position without touching the
 * audio or the hit timestamps.
 */
import * as alphaTab from '@coderline/alphatab';
import { parseScore, pickDefaultTrack } from './score-data';
import {
  ScrollSmoother,
  smoothingLookaheadMs,
  tickAtTimeUnclamped,
  TICKS_PER_QUARTER,
} from './timeline';
import { HitEffects } from './render/effects';
import {
  computeGeometry,
  drawLaneFrame,
  laneNoteColor,
  type LaneAssets,
  type LaneFrame,
} from './render/lane';
import type {
  AppStatus,
  LaneNote,
  LoadedScore,
  ProjectSettings,
  TrackScore,
} from './types';
import { exportVideo, type ExportVideoResult } from './export-video';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneSettings(settings: ProjectSettings): ProjectSettings {
  return {
    layout: { ...settings.layout },
    appearance: { ...settings.appearance, stringColors: [...settings.appearance.stringColors] },
    video: { ...settings.video },
  };
}

export interface EngineCallbacks {
  onStatus?: (status: AppStatus) => void;
  onLoaded?: (loaded: LoadedScore, trackIndex: number) => void;
  onTrackChange?: (trackIndex: number) => void;
  onTime?: (clockMs: number, durationMs: number, playing: boolean) => void;
  onPlaying?: (playing: boolean) => void;
  onPlayerReady?: (ready: boolean) => void;
  onError?: (message: string) => void;
}

export interface EngineOptions {
  assetBase: string;
  settings: ProjectSettings;
  callbacks?: EngineCallbacks;
}

interface SourceBuffer {
  bytes: Uint8Array | null;
  tex: string | null;
  fileName: string;
}

export class LaneEngine {
  readonly canvas: HTMLCanvasElement;
  readonly host: HTMLElement;
  private readonly api: alphaTab.AlphaTabApi;
  private readonly callbacks: EngineCallbacks;
  private readonly assetBase: string;
  private readonly effects = new HitEffects();
  private readonly smoother = new ScrollSmoother();
  private readonly assets: LaneAssets = { backgroundImage: null };

  private settings: ProjectSettings;
  private loaded: LoadedScore | null = null;
  private trackIndex = 0;
  private track: TrackScore | null = null;
  private source: SourceBuffer = { bytes: null, tex: null, fileName: '' };
  private loadToken = 0;
  private status: AppStatus = { kind: 'empty' };
  private playerReady = false;
  private destroyed = false;

  private playing = false;
  private preRoll = false;
  private preRollWall = 0;
  private preRollFrom = 0;
  private holdUntil = 0;
  private holdActive = false;
  private audioStarted = false;
  private clockMs = 0;
  private lastWall = 0;
  private lastUi = 0;
  private hitIndex = 0;
  private combo = 0;
  private backgroundToken = 0;
  private raf = 0;
  private lastFrameError = 0;
  private volume = 1;
  private lastFrame: LaneFrame | null = null;
  private needsDraw = true;

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, options: EngineOptions) {
    this.host = host;
    this.canvas = canvas;
    this.callbacks = options.callbacks ?? {};
    this.assetBase = options.assetBase.endsWith('/') ? options.assetBase : `${options.assetBase}/`;
    this.settings = cloneSettings(options.settings);

    Object.assign(host.style, {
      position: 'fixed',
      left: '-24000px',
      top: '0',
      width: '1200px',
      height: '400px',
      overflow: 'hidden',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1',
    });

    this.api = new alphaTab.AlphaTabApi(host, this.alphaTabSettings());
    this.attachApiEvents();
    this.lastWall = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private alphaTabSettings(): any {
    return {
      core: {
        scriptFile: `${this.assetBase}alphaTab.worker.js`,
        fontDirectory: `${this.assetBase}font/`,
        useWorkers: false,
        enableLazyLoading: false,
        logLevel: alphaTab.LogLevel.Error,
      },
      display: {
        layoutMode: alphaTab.LayoutMode.Page,
        scale: 1,
        stretchForce: 1,
        spacingRatio: 1.3,
        padding: [10, 10],
        resources: {
          mainGlyphColor: '#ffffff',
          staffLineColor: '#888888',
          barSeparatorColor: '#888888',
          barNumberColor: '#888888',
          scoreInfoColor: '#888888',
        },
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: `${this.assetBase}soundfont/sonivox.sf2`,
        enableCursor: false,
        enableAnimatedBeatCursor: false,
        scrollElement: 'html,body',
        // Same constraint as the reference project: the ScriptProcessor output
        // only keeps half the configured buffer in flight, so < 350 ms would
        // run at 0.5x with constant crackle.
        bufferTimeInMilliseconds: 500,
      },
    };
  }

  private attachApiEvents(): void {
    this.api.scoreLoaded.on((score: any) => this.handleScoreLoaded(score));
    this.api.playerReady.on(() => {
      this.playerReady = true;
      this.callbacks.onPlayerReady?.(true);
      this.applySolo();
      try { this.api.masterVolume = this.volume; } catch { /* ignore */ }
    });
    this.api.playerStateChanged.on((args: any) => {
      if (args.state === alphaTab.synth.PlayerState.Playing) {
        this.holdActive = false;
      }
    });
    const player: any = this.api.player;
    player?.soundFontLoadFailed?.on((error: any) => {
      this.callbacks.onError?.(`音色库加载失败：${error?.message ?? error}`);
    });
    this.api.error.on((error: any) => {
      const message = error?.message ? String(error.message) : String(error);
      this.setStatus({ kind: 'error', message });
      this.callbacks.onError?.(message);
    });
  }

  private setStatus(status: AppStatus): void {
    this.status = status;
    this.callbacks.onStatus?.(status);
  }

  getStatus(): AppStatus {
    return this.status;
  }

  getPlayerReady(): boolean {
    return this.playerReady;
  }

  getLoaded(): LoadedScore | null {
    return this.loaded;
  }

  getTrack(): TrackScore | null {
    return this.track;
  }

  getTrackIndex(): number {
    return this.trackIndex;
  }

  getSettings(): ProjectSettings {
    return this.settings;
  }

  get playingNow(): boolean {
    return this.playing;
  }

  get currentClock(): number {
    return this.clockMs;
  }

  get currentCombo(): number {
    return this.combo;
  }

  private handleScoreLoaded(score: any): void {
    const token = this.loadToken;
    const source = this.source;
    try {
      // alphaTab built its playback lookup by now for regular loads. Using it
      // verbatim keeps the lane and the soundtrack on the exact same ticks;
      // alphaTex/score-only paths fall back to a locally generated lookup.
      const tickLookup = this.api.tickCache && this.api.tickCache.masterBars?.length > 0
        ? this.api.tickCache
        : null;
      const loaded = parseScore(score, {
        bytes: source.bytes,
        tex: source.tex,
        fileName: source.fileName,
        tickLookup,
      });
      if (token !== this.loadToken || this.destroyed) return;
      this.loaded = loaded;
      const trackIndex = pickDefaultTrack(loaded.tracks);
      this.trackIndex = trackIndex;
      this.track = loaded.tracks.find((entry) => entry.info.index === trackIndex) ?? loaded.tracks[0] ?? null;
      this.clockMs = 0;
      this.preRoll = false;
      this.playing = false;
      this.audioStarted = false;
      this.hitIndex = 0;
      this.combo = 0;
      this.effects.clear();
      this.smoother.reset(0);
      this.setStatus({ kind: 'ready' });
      this.applySolo();
      try { this.api.timePosition = 0; } catch { /* not ready yet */ }
      this.needsDraw = true;
      this.callbacks.onLoaded?.(loaded, trackIndex);
      this.callbacks.onTrackChange?.(trackIndex);
      this.callbacks.onPlaying?.(false);
      this.emitTime(true);
      this.draw();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ kind: 'error', message });
      this.callbacks.onError?.(message);
    }
  }

  private applySolo(): void {
    const score = this.api.score as any;
    if (!score?.tracks) return;
    const tracks = score.tracks as any[];
    try {
      this.api.changeTrackSolo(tracks, false);
      const selected = tracks.find((track) => Number(track.index) === this.trackIndex);
      if (selected) this.api.changeTrackSolo([selected], true);
    } catch {
      // Soloing is a convenience: playback still works if it is unavailable.
    }
  }

  /** Load a Guitar Pro / MusicXML file. All tracks are parsed; only the selected one sounds. */
  async loadFile(file: File): Promise<void> {
    const token = ++this.loadToken;
    this.pause();
    this.loaded = null;
    this.track = null;
    this.setStatus({ kind: 'loading', message: `正在解析 ${file.name}…` });
    try {
      const name = file.name.toLowerCase();
      if (/\.(tex|alphatex)$/.test(name)) {
        const text = await file.text();
        if (token !== this.loadToken) return;
        this.source = { bytes: null, tex: text, fileName: file.name };
        this.api.tex(text);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (token !== this.loadToken) return;
      this.source = { bytes, tex: null, fileName: file.name };
      const ok = this.api.load(bytes);
      if (!ok) throw new Error('alphaTab 无法读取该文件（可能是受保护或损坏的曲谱）');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ kind: 'error', message });
      this.callbacks.onError?.(message);
    }
  }

  loadDemo(tex: string, fileName = 'demo.alphatex'): void {
    this.loadToken += 1;
    this.pause();
    this.loaded = null;
    this.track = null;
    this.setStatus({ kind: 'loading', message: '正在载入示例…' });
    this.source = { bytes: null, tex, fileName };
    try {
      this.api.tex(tex);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ kind: 'error', message });
      this.callbacks.onError?.(message);
    }
  }

  setTrack(trackIndex: number): void {
    if (!this.loaded) return;
    const next = this.loaded.tracks.find((entry) => entry.info.index === trackIndex);
    if (!next) return;
    this.trackIndex = trackIndex;
    this.track = next;
    this.hitIndex = 0;
    this.combo = 0;
    this.effects.clear();
    this.resetHitState(this.clockMs);
    this.applySolo();
    this.callbacks.onTrackChange?.(trackIndex);
    this.needsDraw = true;
    this.draw();
  }

  setSettings(settings: ProjectSettings): void {
    this.settings = cloneSettings(settings);
    this.needsDraw = true;
    this.draw();
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    try { this.api.masterVolume = this.volume; } catch { /* player not ready */ }
  }

  getVolume(): number {
    return this.volume;
  }

  setBackgroundImage(dataUrl: string | null): void {
    const token = ++this.backgroundToken;
    if (!dataUrl) {
      this.assets.backgroundImage = null;
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (token !== this.backgroundToken || this.destroyed) return;
      this.assets.backgroundImage = image;
      this.needsDraw = true;
      this.draw();
    };
    image.onerror = () => {
      if (token !== this.backgroundToken) return;
      this.assets.backgroundImage = null;
    };
    image.src = dataUrl;
  }

  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1): void {
    const width = Math.max(1, Math.round(cssWidth * Math.min(2, Math.max(1, dpr))));
    const height = Math.max(1, Math.round(cssHeight * Math.min(2, Math.max(1, dpr))));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.needsDraw = true;
    this.draw();
  }

  private leadInMs(): number {
    return Math.max(0, this.settings.layout.leadInSec) * 1000;
  }

  private outroMs(): number {
    return Math.max(0, this.settings.layout.outroSec) * 1000;
  }

  play(): void {
    if (!this.loaded || !this.track) return;
    if (this.playing) return;
    const duration = this.loaded.meta.durationMs;
    if (this.clockMs >= duration - 1) {
      this.seek(0);
    }
    this.playing = true;
    this.lastWall = performance.now();
    this.combo = 0;
    if (this.clockMs < 0) {
      this.preRoll = true;
      this.preRollFrom = this.clockMs;
      this.preRollWall = performance.now();
      this.audioStarted = false;
      // Start the countdown from the extrapolated position, not from tick 0:
      // otherwise the first frames draw every note sitting on the hit line and
      // the column visibly slides up into place (the exporter has no such jump).
      this.smoother.reset(this.anchorFor(this.clockMs));
      try { this.api.pause(); } catch { /* ignore */ }
    } else if (this.clockMs <= 0.5 && this.leadInMs() > 0) {
      this.preRoll = true;
      this.preRollFrom = -this.leadInMs();
      this.preRollWall = performance.now();
      this.clockMs = this.preRollFrom;
      this.audioStarted = false;
      this.resetHitState(this.clockMs);
      this.smoother.reset(this.anchorFor(this.clockMs));
      try { this.api.pause(); } catch { /* ignore */ }
    } else {
      this.startAudioAt(this.clockMs, performance.now());
    }
    this.needsDraw = true;
    this.callbacks.onPlaying?.(true);
    this.emitTime(true);
  }

  pause(): void {
    if (this.playing) {
      this.playing = false;
      this.preRoll = false;
      this.holdActive = false;
      try { this.api.pause(); } catch { /* ignore */ }
      this.callbacks.onPlaying?.(false);
    }
    this.audioStarted = false;
    this.effects.clear();
    this.emitTime(true);
    this.needsDraw = true;
    this.draw();
  }

  seek(timeMs: number): void {
    if (!this.loaded) return;
    const target = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, this.loaded.meta.durationMs);
    this.clockMs = target;
    this.preRoll = false;
    this.holdActive = false;
    this.effects.clear();
    this.resetHitState(target);
    this.smoother.reset(this.anchorFor(target));
    try {
      if (this.api.score) this.api.timePosition = target;
    } catch {
      // The player may not be initialized yet; the clock still moves.
    }
    if (this.playing) {
      if (target <= 0.5 && this.leadInMs() > 0) {
        this.preRoll = true;
        this.preRollFrom = -this.leadInMs();
        this.preRollWall = performance.now();
        this.clockMs = this.preRollFrom;
        this.audioStarted = false;
        this.resetHitState(this.clockMs);
        this.smoother.reset(this.anchorFor(this.clockMs));
        try { this.api.pause(); } catch { /* ignore */ }
      } else {
        this.startAudioAt(target, performance.now());
      }
    }
    this.emitTime(true);
    this.needsDraw = true;
    this.draw();
  }

  restart(): void {
    this.seek(0);
    if (!this.playing) this.play();
  }

  private startAudioAt(timeMs: number, now: number): void {
    this.preRoll = false;
    this.audioStarted = true;
    this.clockMs = timeMs;
    this.holdActive = true;
    this.holdUntil = now + 1400;
    this.lastWall = now;
    try {
      this.api.playbackSpeed = 1;
      this.api.metronomeVolume = 0;
      this.api.countInVolume = 0;
      this.api.isLooping = false;
      this.api.timePosition = timeMs;
      this.api.play();
    } catch {
      // Playback continues visually even if the audio context cannot start.
      this.holdActive = false;
    }
  }

  private sourceTime(): number | null {
    if (!this.audioStarted) return null;
    try {
      if (this.api.playerState !== alphaTab.synth.PlayerState.Playing) return null;
      const value = Number(this.api.timePosition);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  private advance(dt: number, now: number): void {
    if (!this.loaded) return;
    const duration = this.loaded.meta.durationMs;
    if (this.preRoll) {
      this.clockMs = this.preRollFrom + (now - this.preRollWall);
      if (this.clockMs >= 0) {
        this.clockMs = 0;
        this.preRoll = false;
        this.startAudioAt(0, now);
      }
    } else {
      if (this.holdActive) {
        if (now >= this.holdUntil) {
          this.holdActive = false;
        } else if (!this.audioStarted) {
          this.holdActive = false;
        }
      }
      if (!this.holdActive) {
        this.clockMs += dt * 1000;
        const source = this.sourceTime();
        if (source !== null) {
          const error = source - this.clockMs;
          if (Math.abs(error) > 420) {
            this.clockMs = source;
          } else {
            this.clockMs += error * 0.08;
          }
        }
      } else {
        const source = this.sourceTime();
        if (source !== null) {
          this.clockMs = source;
          this.holdActive = false;
        } else {
          this.clockMs = Math.max(this.clockMs, 0);
        }
      }
      if (this.clockMs < 0) this.clockMs = 0;
    }

    if (this.clockMs >= duration + this.outroMs()) {
      this.clockMs = duration;
      this.playing = false;
      this.preRoll = false;
      this.audioStarted = false;
      this.holdActive = false;
      // The clock freezes here, so anything still animating would be drawn at a
      // constant age forever: `loop` keeps drawing while effects exist, but
      // `updateHits` (the only ageing pump) stops with playback.
      this.effects.clear();
      try { this.api.pause(); } catch { /* ignore */ }
      this.needsDraw = true;
      this.callbacks.onPlaying?.(false);
    }
  }

  private anchorFor(timeMs: number): number {
    if (this.settings.layout.spacing === 'time') return timeMs;
    return tickAtTimeUnclamped(this.loaded?.timeline ?? emptyTimeline, timeMs);
  }

  private resetHitState(timeMs: number): void {
    if (!this.track) {
      this.hitIndex = 0;
      return;
    }
    let low = 0;
    let high = this.track.notes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      // A note exactly at the seek position is still an upcoming hit: the user
      // may have scrubbed onto the transient to inspect its effect.
      if (this.track.notes[mid].timeMs < timeMs - 0.5) low = mid + 1;
      else high = mid;
    }
    this.hitIndex = low;
    this.combo = 0;
  }

  private updateHits(now: number): void {
    if (!this.track || !this.loaded) return;
    if (this.holdActive) return;
    const geometry = computeGeometry(this.canvas.width, this.canvas.height, this.track, this.settings);
    while (this.hitIndex < this.track.notes.length && this.track.notes[this.hitIndex].timeMs <= this.clockMs + 0.5) {
      const note = this.track.notes[this.hitIndex];
      this.hitIndex += 1;
      this.combo += 1;
      if (this.clockMs - note.timeMs > 260) continue;
      const x = geometry.stringXs[clamp(note.string - 1, 0, geometry.stringXs.length - 1)] ?? geometry.cx;
      const color = laneNoteColor(note, this.settings.appearance);
      this.effects.spawn(
        x,
        geometry.hitY,
        color,
        this.settings.appearance.accent2,
        note.timeMs,
        this.settings.appearance.hitEffect,
        this.settings.appearance.effectIntensity * (note.chordSize > 2 ? 0.72 : 1),
        this.settings.appearance.effectDuration,
      );
    }
    this.effects.update(this.clockMs);
  }

  private currentFrame(dt = 1 / 60): LaneFrame {
    const loaded = this.loaded;
    if (!loaded) {
      return {
        clockMs: 0, visualTick: 0, visualMs: 0,
        scoreDurationMs: 0, leadInMs: this.leadInMs(), combo: 0, playing: this.playing,
      };
    }
    const timeMode = this.settings.layout.spacing === 'time';
    const anchor = timeMode ? this.clockMs : tickAtTimeUnclamped(loaded.timeline, this.clockMs);
    const smoothing = clamp(this.settings.layout.smoothing, 0, 1);
    let visual: number;
    if (!this.playing || smoothing <= 0.001) {
      this.smoother.reset(anchor);
      visual = anchor;
    } else {
      const lookahead = smoothingLookaheadMs(smoothing, this.settings.layout.lookahead);
      const target = timeMode
        ? this.clockMs + lookahead
        : tickAtTimeUnclamped(loaded.timeline, this.clockMs + lookahead);
      visual = this.smoother.update(
        target,
        { strength: smoothing, dt, mode: this.settings.layout.lookahead, anchor },
        timeMode ? 6000 : TICKS_PER_QUARTER * 8,
      );
    }
    const scoreTime = clamp(this.clockMs, 0, loaded.meta.durationMs);
    return {
      clockMs: this.clockMs,
      visualTick: timeMode ? tickAtTimeUnclamped(loaded.timeline, scoreTime) : visual,
      visualMs: timeMode ? visual : this.clockMs,
      scoreDurationMs: loaded.meta.durationMs,
      leadInMs: this.leadInMs(),
      combo: this.combo,
      playing: this.playing,
    };
  }

  private draw(dt = 1 / 60): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width < 2 || height < 2) return;
    if (!this.loaded || !this.track) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    const frame = this.currentFrame(dt);
    this.lastFrame = frame;
    this.needsDraw = false;
    drawLaneFrame(ctx, width, height, this.loaded, this.track, this.settings, frame, this.effects, this.assets);
  }

  private emitTime(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastUi < 80) return;
    this.lastUi = now;
    const duration = this.loaded?.meta.durationMs ?? 0;
    this.callbacks.onTime?.(this.clockMs, duration, this.playing);
  }

  private loop = (now: number): void => {
    if (this.destroyed) return;
    const dt = clamp((now - this.lastWall) / 1000, 0, 0.1);
    this.lastWall = now;
    try {
      if (this.playing) this.advance(dt, now);
      if (this.playing && this.track) this.updateHits(now);
      if (this.playing || this.effects.size > 0 || this.needsDraw) this.draw(dt);
      this.emitTime();
    } catch (error) {
      // Without this, one bad frame (a malformed setting from localStorage, a
      // tainted canvas) kills the animation loop permanently and silently.
      this.playing = false;
      this.reportFrameError(error);
    } finally {
      if (!this.destroyed) this.raf = requestAnimationFrame(this.loop);
    }
  };

  private reportFrameError(error: unknown): void {
    const now = performance.now();
    if (now - this.lastFrameError < 1000) return;
    this.lastFrameError = now;
    const message = error instanceof Error ? error.message : String(error);
    this.callbacks.onError?.(`渲染出错：${message}`);
  }

  /** Snapshot used by the automated visual tests (and handy in the console). */
  debugState(): any {
    return {
      clock: this.clockMs,
      playing: this.playing,
      combo: this.combo,
      canvas: { width: this.canvas.width, height: this.canvas.height },
      frame: this.lastFrame,
      effects: this.effects.size,
      trackIndex: this.trackIndex,
      tracks: (this.api.score as any)?.tracks?.map((track: any) => ({
        index: track.index,
        mute: track.playbackInfo?.isMute,
        solo: track.playbackInfo?.isSolo,
      })) ?? [],
      settings: this.settings,
    };
  }

  async exportCurrent(options: {
    width: number;
    height: number;
    fps: number;
    container: 'mp4' | 'webm';
    quality: 'low' | 'normal' | 'high';
    includeAudio: boolean;
    onProgress: (progress: number, phase: 'audio' | 'video' | 'finalize') => void;
    isCancelled: () => boolean;
  }): Promise<ExportVideoResult> {
    if (!this.loaded || !this.track) throw new Error('还没有可导出的曲谱');
    this.pause();
    return exportVideo(this.api, this.loaded, this.track, this.settings, {
      width: options.width,
      height: options.height,
      fps: options.fps,
      container: options.container,
      quality: options.quality,
      includeAudio: options.includeAudio,
      leadInMs: this.leadInMs(),
      outroMs: this.outroMs(),
      soundfontUrl: `${this.assetBase}soundfont/sonivox.sf2`,
      assets: this.assets,
      onProgress: options.onProgress,
      isCancelled: options.isCancelled,
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.effects.clear();
    try { this.api.pause(); } catch { /* ignore */ }
    try { this.api.destroy(); } catch { /* ignore */ }
    this.host.innerHTML = '';
  }
}

const emptyTimeline = {
  segments: [],
  changes: [],
  endTick: 0,
  durationMs: 0,
  initialBpm: 120,
};
