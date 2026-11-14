/**
 * Offline video export: renders the same lane as the preview, frame by frame,
 * and muxes it with an offline soundtrack using WebCodecs + Mediabunny.
 */
import * as alphaTab from '@coderline/alphatab';
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import type { LaneAssets } from './render/lane';
import { computeGeometry, drawLaneFrame, laneNoteColor, type LaneFrame } from './render/lane';
import { HitEffects } from './render/effects';
import { ScrollSmoother, TICKS_PER_QUARTER, smoothingLookaheadMs, tickAtTimeUnclamped } from './timeline';
import type { ExportContainer, LoadedScore, ProjectSettings, TrackScore } from './types';

export interface ExportVideoOptions {
  width: number;
  height: number;
  fps: number;
  container: ExportContainer;
  quality: 'low' | 'normal' | 'high';
  includeAudio: boolean;
  leadInMs: number;
  outroMs: number;
  soundfontUrl: string;
  assets: LaneAssets;
  onProgress(progress: number, phase: 'audio' | 'video' | 'finalize'): void;
  isCancelled(): boolean;
}

export interface ExportVideoResult {
  blob: Blob;
  audioSource: 'synth' | 'backing' | null;
  warning?: string;
}

const AUDIO_RATE = 48000;
const AUDIO_CHUNK = 960;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function makeAudioBuffer(frames: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(frames));
  const context = new OfflineAudioContext(2, 1, AUDIO_RATE);
  return context.createBuffer(2, length, AUDIO_RATE);
}

/**
 * Same glyph-count defaults as the preview: no audio is silently dropped when
 * the browser lacks a specific encoder; the caller receives a warning instead.
 */
async function decodeAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const context = new OfflineAudioContext(2, 1, AUDIO_RATE);
  return context.decodeAudioData(copy.buffer);
}

function encodeStereoFromChunks(chunks: Float32Array[]): AudioBuffer {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const frames = Math.max(1, Math.floor(totalSamples / 2));
  const buffer = makeAudioBuffer(frames);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let frame = 0;
  for (const chunk of chunks) {
    for (let i = 0; i + 1 < chunk.length && frame < frames; i += 2) {
      left[frame] = chunk[i];
      right[frame] = chunk[i + 1];
      frame += 1;
    }
  }
  return buffer;
}

async function synthesizeScoreAudio(
  api: any,
  soundfontUrl: string,
  selectedTrackIndex: number,
  onProgress?: (ratio: number) => void,
  isCancelled?: () => boolean,
): Promise<AudioBuffer> {
  const soundFonts: Uint8Array[] = [];
  try {
    const response = await fetch(soundfontUrl);
    if (response.ok) soundFonts.push(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // The synth still renders without a custom soundfont.
  }
  // The preview plays the selected track solo. The offline synthesizer needs
  // the same treatment; otherwise the export mixes every instrument in the
  // score even though the lane shows only one. Track 0 is a valid key, so the
  // map is filled for every track instead of relying on "missing = default".
  const trackVolume = new Map<number, number>();
  for (const track of api.score?.tracks ?? []) {
    trackVolume.set(Number(track.index), Number(track.index) === selectedTrackIndex ? 1 : 0);
  }
  const exporter = await api.exportAudio({
    soundFonts,
    sampleRate: AUDIO_RATE,
    useSyncPoints: false,
    masterVolume: 1,
    metronomeVolume: 0,
    trackVolume,
    trackTranspositionPitches: new Map(),
  });
  const chunks: Float32Array[] = [];
  let renderedMs = 0;
  const expected = Math.max(1, Number(api.endTime) || 1);
  try {
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      if (isCancelled?.()) throw new Error('cancelled');
      const chunk = await exporter.render(4000);
      if (!chunk) break;
      chunks.push(chunk.samples);
      renderedMs = Number(chunk.endTime) || renderedMs;
      onProgress?.(clamp(renderedMs / expected, 0, 1));
    }
  } finally {
    try { exporter.destroy(); } catch { /* already destroyed */ }
  }
  if (chunks.length === 0) throw new Error('合成器没有返回音频');
  return encodeStereoFromChunks(chunks);
}

interface SyncMapPoint {
  scoreMs: number;
  audioMs: number;
}

function buildBackingMap(score: any): SyncMapPoint[] {
  const points: SyncMapPoint[] = [];
  try {
    const raw = alphaTab.midi.MidiFileGenerator.generateSyncPoints(score);
    for (const point of raw ?? []) {
      const scoreMs = Number(point.synthTime);
      const audioMs = Number(point.syncTime);
      if (Number.isFinite(scoreMs) && Number.isFinite(audioMs)) points.push({ scoreMs, audioMs });
    }
  } catch {
    // No sync points: fall back to an identity map below.
  }
  points.sort((a, b) => a.scoreMs - b.scoreMs);
  // Deduplicate points at the same tick, and keep the map strictly monotonic:
  // the inverse (audio -> score) needs an increasing audio axis, and a broken
  // pair of sync points would otherwise make the extraction jump backwards.
  const deduped: SyncMapPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && (Math.abs(last.scoreMs - point.scoreMs) < 0.01 || point.audioMs <= last.audioMs)) continue;
    deduped.push(point);
  }
  return deduped;
}

function mapScoreToAudio(points: SyncMapPoint[]): (scoreMs: number) => number {
  if (points.length === 0) return (scoreMs) => scoreMs;
  if (points.length === 1) {
    const offset = points[0].audioMs - points[0].scoreMs;
    return (scoreMs) => scoreMs + offset;
  }
  return (scoreMs: number) => {
    if (scoreMs <= points[0].scoreMs) {
      return points[0].audioMs + (scoreMs - points[0].scoreMs);
    }
    const last = points[points.length - 1];
    if (scoreMs >= last.scoreMs) {
      // Continue with the slope of the last interval, not 1:1: mapAudioToScore
      // extrapolates the tail with that slope, and a mismatch would desync the
      // video tail from the recording whenever the audio and the tempo map run
      // at slightly different speeds.
      return last.audioMs + (scoreMs - last.scoreMs) * tailAudioPerScore(points);
    }
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (points[mid].scoreMs <= scoreMs) low = mid;
      else high = mid - 1;
    }
    const a = points[low];
    const b = points[Math.min(points.length - 1, low + 1)];
    const span = b.scoreMs - a.scoreMs;
    const ratio = span > 0 ? clamp((scoreMs - a.scoreMs) / span, 0, 1) : 0;
    return a.audioMs + (b.audioMs - a.audioMs) * ratio;
  };
}

/** Slope (audio ms per score ms) of the last sync-point interval. */
function tailAudioPerScore(points: SyncMapPoint[]): number {
  if (points.length < 2) return 1;
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  const scoreSpan = last.scoreMs - previous.scoreMs;
  const audioSpan = last.audioMs - previous.audioMs;
  return scoreSpan > 0 && audioSpan > 0 ? audioSpan / scoreSpan : 1;
}

/** Inverse of {@link mapScoreToAudio}: audio position -> played-order score time. */
function mapAudioToScore(points: SyncMapPoint[]): (audioMs: number) => number {
  if (points.length === 0) return (audioMs) => audioMs;
  if (points.length === 1) {
    const offset = points[0].audioMs - points[0].scoreMs;
    return (audioMs) => audioMs - offset;
  }
  const last = points[points.length - 1];
  const tailSlope = 1 / tailAudioPerScore(points);
  return (audioMs: number) => {
    if (audioMs <= points[0].audioMs) return points[0].scoreMs + (audioMs - points[0].audioMs);
    if (audioMs >= last.audioMs) return last.scoreMs + (audioMs - last.audioMs) * tailSlope;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (points[mid].audioMs <= audioMs) low = mid;
      else high = mid - 1;
    }
    const a = points[low];
    const b = points[Math.min(points.length - 1, low + 1)];
    const span = b.audioMs - a.audioMs;
    const ratio = span > 0 ? clamp((audioMs - a.audioMs) / span, 0, 1) : 0;
    return a.scoreMs + (b.scoreMs - a.scoreMs) * ratio;
  };
}

interface SoundtrackTiming {
  /** Full video length, lead-in and outro included. */
  totalDurationMs: number;
  /** Length of the region that actually carries sound. */
  audioSpanMs: number;
  /** Played-order score time at a wall-clock offset from the start of the video. */
  scoreAtClock(clockMs: number): number;
}

interface SoundtrackResult {
  buffer: AudioBuffer | null;
  source: 'synth' | 'backing' | null;
  timing: SoundtrackTiming;
  warning?: string;
}

function straightTiming(leadInMs: number, scoreDurationMs: number, outroMs: number): SoundtrackTiming {
  return {
    totalDurationMs: leadInMs + scoreDurationMs + outroMs,
    audioSpanMs: scoreDurationMs,
    scoreAtClock: (clockMs) => clamp(clockMs, 0, scoreDurationMs),
  };
}

async function buildSoundtrack(
  api: any,
  loaded: LoadedScore,
  trackIndex: number,
  options: ExportVideoOptions,
  onProgress: (ratio: number) => void,
): Promise<SoundtrackResult> {
  const leadInMs = options.leadInMs;
  const outroMs = options.outroMs;
  const scoreDurationMs = loaded.meta.durationMs;
  if (!options.includeAudio) {
    return { buffer: null, source: null, timing: straightTiming(leadInMs, scoreDurationMs, outroMs) };
  }

  const backing = loaded.rawScore?.backingTrack?.rawAudioFile as Uint8Array | undefined;
  if (backing && backing.byteLength > 0) {
    try {
      onProgress(0.05);
      const decoded = await decodeAudio(backing);
      const points = buildBackingMap(loaded.rawScore);
      const scoreToAudio = mapScoreToAudio(points);
      const audioToScore = mapAudioToScore(points);
      const audioDurationMs = decoded.duration * 1000;
      // The backing track is a real recording: it must be moved at its native
      // rate or the pitch changes. Only the window that covers the score is
      // kept, and the video timeline is then derived from the audio clock the
      // same way alphaTab's preview does (audio -> score), instead of warping
      // the audio onto the score's tempo map.
      const startAudioMs = clamp(scoreToAudio(0), 0, audioDurationMs);
      const endAudioMs = clamp(scoreToAudio(scoreDurationMs), startAudioMs, audioDurationMs);
      const spanMs = Math.max(0, endAudioMs - startAudioMs);
      const totalDurationMs = leadInMs + spanMs + outroMs;
      const totalFrames = Math.max(1, Math.ceil(totalDurationMs / 1000 * AUDIO_RATE));
      const output = makeAudioBuffer(totalFrames);
      const offsetFrames = Math.round(leadInMs / 1000 * AUDIO_RATE);
      const startFrame = Math.round(startAudioMs / 1000 * AUDIO_RATE);
      const frames = Math.max(0, Math.min(
        Math.round(spanMs / 1000 * AUDIO_RATE),
        decoded.length - startFrame,
        totalFrames - offsetFrames,
      ));
      for (let channel = 0; channel < 2; channel += 1) {
        const source = decoded.getChannelData(Math.min(channel, decoded.numberOfChannels - 1));
        output.getChannelData(channel).set(source.subarray(startFrame, startFrame + frames), offsetFrames);
      }
      onProgress(0.98);
      if (options.isCancelled()) throw new Error('cancelled');
      return {
        buffer: output,
        source: 'backing',
        timing: {
          totalDurationMs,
          audioSpanMs: spanMs,
          scoreAtClock(clockMs: number) {
            if (clockMs <= 0) return 0;
            return clamp(audioToScore(startAudioMs + clockMs), 0, scoreDurationMs);
          },
        },
      };
    } catch (error) {
      if ((error as Error).message === 'cancelled') throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        buffer: null,
        source: null,
        timing: straightTiming(leadInMs, scoreDurationMs, outroMs),
        warning: `内置伴奏解码失败：${message}`,
      };
    }
  }

  try {
    const synthesized = await synthesizeScoreAudio(
      api,
      options.soundfontUrl,
      trackIndex,
      (ratio) => onProgress(ratio * 0.6),
      options.isCancelled,
    );
    if (options.isCancelled()) throw new Error('cancelled');
    const totalDurationMs = leadInMs + scoreDurationMs + outroMs;
    const totalFrames = Math.max(1, Math.ceil(totalDurationMs / 1000 * AUDIO_RATE));
    const output = makeAudioBuffer(totalFrames);
    const offsetFrames = Math.round(leadInMs / 1000 * AUDIO_RATE);
    const left = output.getChannelData(0);
    const right = output.getChannelData(1);
    const srcLeft = synthesized.getChannelData(0);
    const srcRight = synthesized.numberOfChannels > 1 ? synthesized.getChannelData(1) : srcLeft;
    const sourceFrames = Math.min(synthesized.length, Math.max(0, totalFrames - offsetFrames));
    for (let i = 0; i < sourceFrames; i += 1) {
      left[offsetFrames + i] = srcLeft[i];
      right[offsetFrames + i] = srcRight[i];
      if (i % 96_000 === 0) onProgress(0.6 + (i / Math.max(1, sourceFrames)) * 0.38);
    }
    onProgress(1);
    return {
      buffer: output,
      source: 'synth',
      timing: straightTiming(leadInMs, scoreDurationMs, outroMs),
    };
  } catch (error) {
    if ((error as Error).message === 'cancelled') throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      buffer: null,
      source: null,
      timing: straightTiming(leadInMs, scoreDurationMs, outroMs),
      warning: `离线合成失败：${message}`,
    };
  }
}

async function chooseVideoCodec(
  container: ExportContainer,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<{ encoderCodec: string; sourceCodec: 'avc' | 'vp9' | 'vp8' }> {
  if (!('VideoEncoder' in window)) throw new Error('当前浏览器不支持 WebCodecs，无法离线导出');
  const candidates: Array<{ encoderCodec: string; sourceCodec: 'avc' | 'vp9' | 'vp8' }> = container === 'mp4'
    ? [
      { encoderCodec: 'avc1.640034', sourceCodec: 'avc' },
      { encoderCodec: 'avc1.640033', sourceCodec: 'avc' },
      { encoderCodec: 'avc1.64002a', sourceCodec: 'avc' },
      { encoderCodec: 'avc1.4d002a', sourceCodec: 'avc' },
      { encoderCodec: 'avc1.42002a', sourceCodec: 'avc' },
    ]
    : [
      { encoderCodec: 'vp09.00.51.08', sourceCodec: 'vp9' },
      { encoderCodec: 'vp09.00.41.08', sourceCodec: 'vp9' },
      { encoderCodec: 'vp09.00.10.08', sourceCodec: 'vp9' },
      { encoderCodec: 'vp8', sourceCodec: 'vp8' },
    ];
  for (const candidate of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.encoderCodec,
        width,
        height,
        framerate: fps,
        bitrate,
      });
      if (support.supported) return candidate;
    } catch {
      // Try the next profile.
    }
  }
  throw new Error(container === 'mp4'
    ? '当前浏览器无法编码 H.264，请改用 WebM 格式'
    : '当前浏览器无法编码 VP9/VP8，请改用 MP4 格式');
}

function baselineBitrate(width: number, height: number, fps: number, quality: ExportVideoOptions['quality']): number {
  const factor = quality === 'low' ? 0.45 : quality === 'high' ? 1.7 : 1;
  const pixels = width * height;
  return Math.round(Math.min(30_000_000, Math.max(2_000_000, pixels * (fps >= 50 ? 8 : 4.5))) * factor);
}

async function audioCodecSupported(codec: 'aac' | 'opus'): Promise<boolean> {
  if (!('AudioEncoder' in window) || !('AudioData' in window)) return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
      sampleRate: AUDIO_RATE,
      numberOfChannels: 2,
      bitrate: 160_000,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

async function chooseAudioCodec(container: ExportContainer): Promise<'aac' | 'opus' | null> {
  if (container === 'webm') return (await audioCodecSupported('opus')) ? 'opus' : null;
  if (await audioCodecSupported('aac')) return 'aac';
  if (await audioCodecSupported('opus')) return 'opus';
  return null;
}

async function encodeAudio(
  source: EncodedAudioPacketSource,
  buffer: AudioBuffer,
  codec: 'aac' | 'opus',
  isCancelled: () => boolean,
): Promise<void> {
  let error: Error | null = null;
  const pending: Promise<void>[] = [];
  const encoder = new AudioEncoder({
    output: (chunk, meta) => { pending.push(source.add(EncodedPacket.fromEncodedChunk(chunk), meta)); },
    error: (reason) => { error = reason; },
  });
  encoder.configure({
    codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
    sampleRate: AUDIO_RATE,
    numberOfChannels: 2,
    bitrate: 160_000,
  });
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  try {
    for (let offset = 0; offset < buffer.length; offset += AUDIO_CHUNK) {
      if (isCancelled()) throw new Error('cancelled');
      if (error) throw error;
      const frames = Math.min(AUDIO_CHUNK, buffer.length - offset);
      const data = new Float32Array(frames * 2);
      data.set(left.subarray(offset, offset + frames), 0);
      data.set(right.subarray(offset, offset + frames), frames);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: AUDIO_RATE,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round(offset / AUDIO_RATE * 1_000_000),
        data,
      });
      try { encoder.encode(audioData); } finally { audioData.close(); }
      while (encoder.encodeQueueSize > 8) await sleep(1);
      if (pending.length) await Promise.all(pending.splice(0));
    }
    await encoder.flush();
    if (pending.length) await Promise.all(pending.splice(0));
  } finally {
    try { encoder.close(); } catch { /* closed */ }
  }
  if (error) throw error;
}

function fadeEdges(buffer: AudioBuffer, leadInMs: number, spanMs: number): void {
  const fade = Math.min(0.03, spanMs / 3000) * AUDIO_RATE;
  const start = Math.round(leadInMs / 1000 * AUDIO_RATE);
  const end = Math.min(buffer.length, Math.round((leadInMs + spanMs) / 1000 * AUDIO_RATE));
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < fade; i += 1) {
      const gain = i / fade;
      if (start + i < data.length) data[start + i] *= gain;
      if (end - 1 - i >= 0) data[end - 1 - i] *= gain;
    }
  }
}

/** Keep the synthesized / backing mix below full scale so Opus does not clip. */
function limitPeak(buffer: AudioBuffer, target = 0.97): void {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  if (!(peak > target) || peak <= 0) return;
  const gain = target / peak;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) data[i] *= gain;
  }
}

/**
 * Estimated output length. With an embedded backing track the video follows
 * the audio's native span rather than the score's tempo map, which can differ
 * by a few percent; the UI uses this so the "成片时长" hint matches the file.
 */
export function estimateExportDurationMs(
  loaded: LoadedScore,
  leadInMs: number,
  outroMs: number,
): number {
  const scoreDurationMs = loaded.meta.durationMs;
  const straight = leadInMs + scoreDurationMs + outroMs;
  if (!loaded.rawScore?.backingTrack?.rawAudioFile) return straight;
  try {
    const points = buildBackingMap(loaded.rawScore);
    if (points.length === 0) return straight;
    const map = mapScoreToAudio(points);
    const span = Math.max(0, map(scoreDurationMs) - map(0));
    return leadInMs + span + outroMs;
  } catch {
    return straight;
  }
}

/** Render and mux the whole video. */
export async function exportVideo(
  api: any,
  loaded: LoadedScore,
  track: TrackScore,
  settings: ProjectSettings,
  options: ExportVideoOptions,
): Promise<ExportVideoResult> {
  if (!(loaded.meta.durationMs > 0)) throw new Error('曲谱还没有准备好');
  const leadInMs = Math.max(0, options.leadInMs);
  const outroMs = Math.max(0, options.outroMs);
  const scoreDurationMs = loaded.meta.durationMs;
  const fps = clamp(Math.round(options.fps), 10, 120);
  const width = clamp(Math.round(options.width), 160, 4096);
  const height = clamp(Math.round(options.height), 90, 4096);

  options.onProgress(1, 'audio');
  const soundtrack = await buildSoundtrack(api, loaded, track.info.index, { ...options, width, height, fps }, (ratio) => {
    options.onProgress(2 + ratio * 12, 'audio');
  });
  if (options.isCancelled()) throw new Error('cancelled');
  const totalDurationMs = soundtrack.timing.totalDurationMs;

  if (soundtrack.buffer) limitPeak(soundtrack.buffer);
  const audioCodec = soundtrack.buffer ? await chooseAudioCodec(options.container) : null;
  const withAudio = !!(soundtrack.buffer && audioCodec);
  const bitrate = baselineBitrate(width, height, fps, options.quality);
  const videoCodec = await chooseVideoCodec(options.container, width, height, fps, bitrate);

  const target = new BufferTarget();
  const output = new Output({
    format: options.container === 'mp4'
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : new WebMOutputFormat(),
    target,
  });
  const videoSource = new EncodedVideoPacketSource(videoCodec.sourceCodec);
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = new EncodedAudioPacketSource(withAudio ? audioCodec! : 'opus');
  if (withAudio) output.addAudioTrack(audioSource);
  await output.start();

  let completed = false;
  let encodeError: Error | null = null;
  try {
    if (withAudio && soundtrack.buffer && audioCodec) {
      fadeEdges(soundtrack.buffer, leadInMs, soundtrack.timing.audioSpanMs);
      await encodeAudio(audioSource, soundtrack.buffer, audioCodec, options.isCancelled);
      options.onProgress(15, 'video');
    }
    if (options.isCancelled()) throw new Error('cancelled');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('无法创建画布');
    // Declared before the encoder: its output callback closes over this list and
    // must not touch it in the temporal dead zone if the encoder fails early.
    const pending: Promise<void>[] = [];
    const encoder = new VideoEncoder({
      output: (chunk, meta) => { pending.push(videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta)); },
      error: (reason) => { encodeError = reason; },
    });
    encoder.configure({
      codec: videoCodec.encoderCodec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: 'quality',
    });
    const gopFrames = Math.max(1, Math.round(fps * 2));
    const frameCount = Math.max(1, Math.ceil(totalDurationMs / 1000 * fps));
    const effects = new HitEffects();
    const smoother = new ScrollSmoother();
    const smoothing = clamp(settings.layout.smoothing, 0, 1);
    const lookaheadMs = smoothingLookaheadMs(smoothing, settings.layout.lookahead);
    const timeMode = settings.layout.spacing === 'time';
    let hitIndex = 0;
    let combo = 0;
    let lastTick = 0;
    try {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        if (options.isCancelled()) throw new Error('cancelled');
        if (encodeError) throw encodeError;
        const timeMs = frameIndex / fps * 1000;
        const clockMs = timeMs - leadInMs;
        const scoreTime = soundtrack.timing.scoreAtClock(clockMs);
        // Mirror the preview: the countdown runs on the negative (extrapolated)
        // timeline so the first notes are already falling above the hit line
        // when the audio starts. Clamping to score 0 during the lead-in would
        // freeze every note at its start position for the whole countdown.
        // Past the end of the score the preview keeps the clock running through
        // the outro (tickAtTimeUnclamped extrapolates), while scoreAtClock is
        // clamped for hit detection; add that overrun back for the drawing clock.
        const overrunMs = Math.max(0, clockMs - (leadInMs + soundtrack.timing.audioSpanMs));
        const laneTime = clockMs < 0 ? clockMs : scoreTime + overrunMs;
        const anchor = timeMode ? laneTime : tickAtTimeUnclamped(loaded.timeline, laneTime);
        const targetPosition = timeMode ? laneTime + lookaheadMs : tickAtTimeUnclamped(loaded.timeline, laneTime + lookaheadMs);
        const dt = 1 / fps;
        const visual = smoothPosition(smoother, targetPosition, anchor, dt, smoothing, timeMode);
        lastTick = timeMode ? tickAtTimeUnclamped(loaded.timeline, laneTime) : visual;
        const geometry = computeGeometry(width, height, track, settings);
        // Hits only exist once the score clock is running; during the lead-in
        // scoreTime stays at 0 and would otherwise fire every note at time 0.
        while (clockMs >= 0 && hitIndex < track.notes.length && track.notes[hitIndex].timeMs <= scoreTime + 0.01) {
          const note = track.notes[hitIndex];
          hitIndex += 1;
          combo += 1;
          if (scoreTime - note.timeMs <= 240) {
            const x = geometry.stringXs[clamp(note.string - 1, 0, geometry.stringXs.length - 1)] ?? geometry.cx;
            const color = laneNoteColor(note, settings.appearance);
            effects.spawn(
              x, geometry.hitY, color, settings.appearance.accent2, note.timeMs,
              settings.appearance.hitEffect,
              settings.appearance.effectIntensity * (note.chordSize > 2 ? 0.72 : 1),
              settings.appearance.effectDuration,
            );
          }
        }
        effects.update(laneTime);
        const frame: LaneFrame = {
          clockMs: laneTime,
          visualTick: timeMode ? tickAtTimeUnclamped(loaded.timeline, laneTime) : visual,
          visualMs: timeMode ? visual : laneTime,
          scoreDurationMs,
          leadInMs,
          combo,
          playing: true,
        };
        drawLaneFrame(ctx, width, height, loaded, track, settings, frame, effects, options.assets);
        const videoFrame = new VideoFrame(canvas, {
          timestamp: Math.round(frameIndex * 1_000_000 / fps),
          duration: Math.round(1_000_000 / fps),
        });
        try {
          encoder.encode(videoFrame, { keyFrame: frameIndex % gopFrames === 0 });
        } finally {
          videoFrame.close();
        }
        while (encoder.encodeQueueSize > 8) await sleep(1);
        if (pending.length) await Promise.all(pending.splice(0));
        if (frameIndex % 4 === 0) {
          options.onProgress(15 + (frameIndex / frameCount) * 79, 'video');
          await sleep(0);
        }
      }
      options.onProgress(95, 'finalize');
      await encoder.flush();
      if (pending.length) await Promise.all(pending.splice(0));
    } finally {
      try { encoder.close(); } catch { /* closed */ }
    }
    if (encodeError) throw encodeError;
    if (options.isCancelled()) throw new Error('cancelled');
    await output.finalize();
    completed = true;
  } finally {
    if (!completed) {
      try { await output.cancel(); } catch { /* already gone */ }
    }
  }

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('导出的视频为空');
  const mimeType = options.container === 'mp4' ? 'video/mp4' : 'video/webm';
  options.onProgress(100, 'finalize');
  let warning = soundtrack.warning;
  if (withAudio && options.container === 'mp4' && audioCodec === 'opus') {
    warning = '当前浏览器不支持 AAC 编码，MP4 使用 Opus 音轨（Chrome / VLC 可播放）';
  } else if (soundtrack.buffer && !withAudio) {
    warning = '浏览器没有可用的音频编码器，已导出无声视频';
  }
  return {
    blob: new Blob([buffer], { type: mimeType }),
    audioSource: withAudio ? soundtrack.source : null,
    warning,
  };
}

function smoothPosition(
  smoother: ScrollSmoother,
  target: number,
  anchor: number,
  dt: number,
  strength: number,
  timeMode: boolean,
): number {
  if (!(strength > 0.001)) {
    smoother.reset(anchor);
    return anchor;
  }
  return smoother.update(target, { strength, dt, mode: 'normal', anchor }, timeMode ? 6000 : TICKS_PER_QUARTER * 8);
}
