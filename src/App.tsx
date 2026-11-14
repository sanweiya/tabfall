import * as React from 'react';
import { LaneEngine } from '../core/engine';
import { estimateExportDurationMs } from '../core/export-video';
import { DEMO_TEX } from '../core/demo';
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  RESOLUTIONS,
  type AppStatus,
  type AppearanceSettings,
  type LayoutSettings,
  type LoadedScore,
  type ProjectSettings,
  type VideoSettings,
} from '../core/types';
import { EffectsPanel, LayoutPanel, LookPanel, VideoPanel } from './panels';
import { Icons, Select, TextInput, Toggle } from './ui/controls';
import {
  formatBytes,
  formatClock,
  formatResolution,
  loadSettings,
  resolutionId,
  saveSettings,
} from './storage';

type PanelTab = 'layout' | 'look' | 'effects' | 'video';

interface ToastState {
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface ExportUi {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  phase: 'audio' | 'video' | 'finalize' | '';
  error: string;
  warning: string;
  url: string;
  name: string;
  size: number;
}

const IDLE_EXPORT: ExportUi = {
  status: 'idle', progress: 0, phase: '', error: '', warning: '', url: '', name: '', size: 0,
};

const TABS: Array<{ id: PanelTab; label: string; icon: React.ReactNode }> = [
  { id: 'layout', label: '布局', icon: Icons.layout },
  { id: 'look', label: '外观', icon: Icons.palette },
  { id: 'effects', label: '特效', icon: Icons.spark },
  { id: 'video', label: '视频', icon: Icons.video },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '').trim();
}

function ScoreCard(props: {
  loaded: LoadedScore | null;
  trackIndex: number;
  fileName: string;
  onTrack: (index: number) => void;
  onSeek: (ms: number) => void;
  status: AppStatus;
}): React.ReactElement {
  const { loaded } = props;
  if (!loaded) {
    return (
      <div className="tf-score-card is-empty">
        <div className="tf-score-empty-icon">{Icons.music}</div>
        <div>
          <strong>还没有载入曲谱</strong>
          <p>拖入 Guitar Pro / MusicXML 文件，或先播放示例。</p>
        </div>
      </div>
    );
  }
  const track = loaded.tracks.find((entry) => entry.info.index === props.trackIndex);
  const noteCount = track?.notes.length ?? 0;
  return (
    <div className="tf-score-card">
      <div className="tf-score-kicker">
        <span className={`tf-pill ${loaded.meta.hasBackingTrack ? 'is-good' : ''}`}>
          {loaded.meta.hasBackingTrack ? '内置伴奏' : '合成音轨'}
        </span>
        <span className="tf-score-file" title={props.fileName}>{props.fileName || '未命名曲谱'}</span>
      </div>
      <h2>{loaded.meta.title || '未命名曲谱'}</h2>
      <p className="tf-score-artist">{loaded.meta.artist || '未知艺术家'}{loaded.meta.album ? ` · ${loaded.meta.album}` : ''}</p>
      <div className="tf-score-stats">
        <span><b>{Math.round(loaded.meta.tempo)}</b> BPM</span>
        <span><b>{loaded.meta.barCount}</b> 小节</span>
        <span><b>{formatClock(loaded.meta.durationMs)}</b> 时长</span>
        <span><b>{noteCount.toLocaleString()}</b> 音符</span>
      </div>
      <Select
        label="轨道"
        value={props.trackIndex}
        options={loaded.meta.tracks.map((trackInfo) => {
          const lane = loaded.tracks.find((entry) => entry.info.index === trackInfo.index);
          const first = lane?.notes[0]?.timeMs ?? 0;
          const firstLabel = first > 5000 ? ` · ${formatClock(first)} 起` : '';
          return {
            value: trackInfo.index,
            label: `${trackInfo.name}${trackInfo.isStringed ? ` · ${trackInfo.stringCount} 弦` : ' · 非弦乐'} · ${lane?.notes.length ?? 0} 音${firstLabel}`,
          };
        })}
        onChange={props.onTrack}
      />
      {track && track.notes.length > 0 && track.notes[0].timeMs > 3000 && (
        <button
          type="button"
          className="tf-jump"
          onClick={() => props.onSeek(Math.max(0, track.notes[0].timeMs - 1200))}
        >
          <span>{Icons.play}</span>
          跳到首音 · {formatClock(track.notes[0].timeMs)}
        </button>
      )}
      {track && !track.info.isStringed && (
        <p className="tf-hint is-warn">这个轨道不是弦乐器，仍会按单弦投影显示，建议换用吉他 / 贝斯轨道。</p>
      )}
    </div>
  );
}

function StageOverlay(props: {
  status: AppStatus;
  loaded: LoadedScore | null;
  ready: boolean;
  onOpen: () => void;
}): React.ReactElement | null {
  if (props.loaded && props.status.kind !== 'error') return null;
  if (props.status.kind === 'loading') {
    return (
      <div className="tf-stage-overlay">
        <span className="tf-spinner" aria-hidden="true" />
        <strong>{props.status.message || '正在解析曲谱…'}</strong>
        <p>alphaTab 正在读取文件与节奏信息</p>
      </div>
    );
  }
  if (props.status.kind === 'error') {
    return (
      <div className="tf-stage-overlay is-error">
        <strong>曲谱加载失败</strong>
        <p>{props.status.message}</p>
        <button type="button" className="tf-btn is-ghost" onClick={props.onOpen}>{Icons.upload} 换一个文件</button>
      </div>
    );
  }
  return (
    <div className="tf-stage-overlay">
      <span className="tf-stage-orb">{Icons.music}</span>
      <strong>把曲谱拖进来</strong>
      <p>支持 Guitar Pro 3–8、MusicXML、alphaTex</p>
      <button type="button" className="tf-btn is-primary" onClick={props.onOpen}>{Icons.upload} 选择文件</button>
    </div>
  );
}

function ExportDialog(props: {
  open: boolean;
  settings: ProjectSettings;
  loaded: LoadedScore | null;
  durationMs: number;
  state: ExportUi;
  onClose: () => void;
  onVideo: (patch: Partial<VideoSettings>) => void;
  onStart: () => void;
  onCancel: () => void;
  onDownload: () => void;
}): React.ReactElement | null {
  const { settings, loaded, state } = props;
  if (!props.open) return null;
  const video = settings.video;
  const totalMs = loaded
    ? estimateExportDurationMs(loaded, settings.layout.leadInSec * 1000, settings.layout.outroSec * 1000)
    : props.durationMs + settings.layout.leadInSec * 1000 + settings.layout.outroSec * 1000;
  const running = state.status === 'running';
  const currentResolution = resolutionId(video.width, video.height);
  const close = () => { if (!running) props.onClose(); };
  return (
    <div className="tf-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="tf-modal" role="dialog" aria-modal="true" aria-label="导出视频">
        <header className="tf-modal-head">
          <div>
            <span className="tf-kicker">OFFLINE RENDER</span>
            <h2>{state.status === 'done' ? '视频已生成' : '导出视频'}</h2>
          </div>
          <button type="button" className="tf-icon-btn" onClick={close} disabled={running} aria-label="关闭">{Icons.close}</button>
        </header>

        {state.status === 'running' ? (
          <div className="tf-export-progress">
            <div className="tf-export-ring" style={{ '--p': `${state.progress}%` } as React.CSSProperties}>
              <span>{Math.round(state.progress)}%</span>
            </div>
            <div className="tf-export-progress-text">
              <strong>{state.phase === 'audio' ? '正在渲染音轨' : state.phase === 'video' ? '正在逐帧绘制' : '正在封装文件'}</strong>
              <p>
                {state.phase === 'audio'
                  ? 'alphaTab 正在离线合成音频 / 解码内置伴奏。'
                  : state.phase === 'video'
                    ? '音游谱面逐帧渲染，不会录屏；导出期间请保持标签页在前台。'
                    : 'WebCodecs 正在写入容器索引。'}
              </p>
              <div className="tf-progress-track"><span style={{ width: `${state.progress}%` }} /></div>
            </div>
            <button type="button" className="tf-btn is-ghost" onClick={props.onCancel}>取消导出</button>
          </div>
        ) : state.status === 'done' ? (
          <div className="tf-export-done">
            <div className="tf-done-mark">{Icons.download}</div>
            <h3>{state.name}</h3>
            <p>{formatBytes(state.size)} · 已自动开始下载</p>
            {state.warning && <p className="tf-warning">{state.warning}</p>}
            <div className="tf-modal-actions">
              <button type="button" className="tf-btn is-primary" onClick={props.onDownload}>{Icons.download} 再次下载</button>
              <button type="button" className="tf-btn is-ghost" onClick={props.onClose}>完成</button>
            </div>
          </div>
        ) : (
          <>
            <div className="tf-export-summary">
              <div className="tf-export-thumb">
                <span>{loaded ? (loaded.meta.title || 'Untitled') : 'No score'}</span>
                <small>{formatResolution(video.width, video.height)} · {video.fps} fps · {video.container.toUpperCase()}</small>
              </div>
              <div className="tf-export-facts">
                <span><b>{formatClock(totalMs)}</b> 成片时长</span>
                <span><b>{Math.ceil(totalMs / 1000 * video.fps).toLocaleString()}</b> 帧</span>
                <span><b>{video.includeAudio ? '有音轨' : '静音'}</b> 声音</span>
              </div>
            </div>

            <div className="tf-modal-grid">
              <Select
                label="画幅"
                value={currentResolution}
                options={[
                  ...RESOLUTIONS.map((entry) => ({ value: entry.id, label: entry.label })),
                  { value: 'custom', label: '自定义（在视频面板调整）' },
                ]}
                onChange={(value) => {
                  if (value === 'custom') return;
                  const entry = RESOLUTIONS.find((resolution) => resolution.id === value);
                  if (entry) props.onVideo({ width: entry.width, height: entry.height });
                }}
                disabled={running}
              />
              <Select
                label="帧率"
                value={String(video.fps)}
                options={[
                  { value: '30', label: '30 fps' },
                  { value: '60', label: '60 fps' },
                ]}
                onChange={(value) => props.onVideo({ fps: Number(value) })}
                disabled={running}
              />
              <Select
                label="格式"
                value={video.container}
                options={[
                  { value: 'mp4', label: 'MP4 · H.264' },
                  { value: 'webm', label: 'WebM · VP9' },
                ]}
                onChange={(value) => props.onVideo({ container: value as VideoSettings['container'] })}
                disabled={running}
              />
              <Select
                label="质量"
                value={video.quality}
                options={[
                  { value: 'low', label: '流畅' },
                  { value: 'normal', label: '标准' },
                  { value: 'high', label: '高码率' },
                ]}
                onChange={(value) => props.onVideo({ quality: value as VideoSettings['quality'] })}
                disabled={running}
              />
            </div>
            <div className="tf-modal-grid">
              <TextInput
                label="文件名"
                value={video.filename}
                onChange={(value) => props.onVideo({ filename: value })}
                placeholder={loaded ? `${loaded.meta.title || 'tabfall'}` : 'tabfall'}
              />
              <div className="tf-modal-toggle">
                <Toggle label="包含音轨" checked={video.includeAudio} onChange={(value) => props.onVideo({ includeAudio: value })} />
                <p className="tf-hint">无内置伴奏时用 alphaTab 合成器离线渲染。</p>
              </div>
            </div>

            {!('VideoEncoder' in window) && (
              <p className="tf-warning">当前浏览器不支持 WebCodecs 离线编码，请使用 Chrome / Edge 最新版。</p>
            )}
            {state.error && <p className="tf-warning is-error">{state.error}</p>}
            <p className="tf-hint">导出使用与预览完全相同的渲染函数；不会进行屏幕录制，成片不会有浏览器 UI 或掉帧。</p>

            <div className="tf-modal-actions">
              <button type="button" className="tf-btn is-ghost" onClick={props.onClose}>取消</button>
              <button
                type="button"
                className="tf-btn is-primary"
                onClick={props.onStart}
                disabled={!loaded || !('VideoEncoder' in window)}
              >
                {Icons.download} 开始导出
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function App(): React.ReactElement {
  const [settings, setSettings] = React.useState<ProjectSettings>(() => loadSettings());
  const settingsRef = React.useRef(settings);
  // Keep the synchronous mirror fresh during render: a slider change followed
  // by a click in the same frame must reach the engine/exporter immediately.
  settingsRef.current = settings;
  const [loaded, setLoaded] = React.useState<LoadedScore | null>(null);
  const [trackIndex, setTrackIndex] = React.useState(0);
  const [status, setStatus] = React.useState<AppStatus>({ kind: 'empty' });
  const [playing, setPlaying] = React.useState(false);
  const [clock, setClock] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [fileName, setFileName] = React.useState('');
  const [tab, setTab] = React.useState<PanelTab>('layout');
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportState, setExportState] = React.useState<ExportUi>(IDLE_EXPORT);
  const [volume, setVolume] = React.useState(0.85);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const engineRef = React.useRef<LaneEngine | null>(null);
  const cancelRef = React.useRef<boolean>(false);
  const toastTimer = React.useRef<number>(0);
  const dragDepth = React.useRef(0);

  const notify = React.useCallback((kind: ToastState['kind'], text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ kind, text });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const showStatus = React.useCallback((next: AppStatus) => setStatus(next), []);

  React.useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const engine = new LaneEngine(host, canvas, {
      assetBase: new URL('assets/', document.baseURI).href,
      settings: settingsRef.current,
      callbacks: {
        onStatus: (next) => {
          showStatus(next);
          if (next.kind === 'loading') {
            setLoaded(null);
            setDuration(0);
            setClock(0);
            setPlaying(false);
          }
        },
        onLoaded: (next, index) => {
          setLoaded(next);
          setFileName(next.fileName);
          setTrackIndex(index);
          setDuration(next.meta.durationMs);
          setClock(0);
          setPlaying(false);
          document.title = `${next.meta.title || 'Untitled'} · TABFALL`;
          window.setTimeout(() => notify('success', `已载入「${next.meta.title || next.fileName || '曲谱'}」`), 60);
        },
        onTrackChange: (index) => setTrackIndex(index),
        onTime: (time, total) => {
          setClock(time);
          setDuration(total);
        },
        onPlaying: (value) => setPlaying(value),
        onPlayerReady: () => setReady(true),
        onError: (message) => notify('error', message),
      },
    });
    engineRef.current = engine;
    (window as any).__tabfall = { engine };
    engine.setVolume(volume);
    engine.loadDemo(DEMO_TEX);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // The engine owns the alphaTab instance for the lifetime of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, showStatus]);

  React.useEffect(() => {
    settingsRef.current = settings;
    engineRef.current?.setSettings(settings);
    saveSettings(settings);
  }, [settings]);

  React.useEffect(() => {
    engineRef.current?.setBackgroundImage(settings.appearance.backgroundImage);
  }, [settings.appearance.backgroundImage]);

  React.useEffect(() => {
    // Belt and braces for browsers that scroll a focused control into view even
    // when the layout is pinned: the tool itself only ever scrolls the sidebar.
    const resetWindowScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      const scrolling = document.scrollingElement;
      if (scrolling && (scrolling.scrollTop !== 0 || scrolling.scrollLeft !== 0)) {
        scrolling.scrollTop = 0;
        scrolling.scrollLeft = 0;
      }
      // `overflow: clip` should make this impossible, but older engines may
      // still move an overflow-hidden ancestor when a control receives focus.
      const app = document.querySelector<HTMLElement>('.tf-app');
      if (app && (app.scrollTop !== 0 || app.scrollLeft !== 0)) {
        app.scrollTop = 0;
        app.scrollLeft = 0;
      }
    };
    const onFocus = () => requestAnimationFrame(resetWindowScroll);
    window.addEventListener('scroll', resetWindowScroll, { passive: true });
    window.addEventListener('focusin', onFocus);
    resetWindowScroll();
    return () => {
      window.removeEventListener('scroll', resetWindowScroll);
      window.removeEventListener('focusin', onFocus);
    };
  }, []);

  React.useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = React.useMemo(() => {
    const aspect = settings.video.width / Math.max(1, settings.video.height);
    const maxW = Math.max(0, viewport.width - 28);
    const maxH = Math.max(0, viewport.height - 28);
    const width = Math.min(maxW, maxH * aspect);
    return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(width / aspect)) };
  }, [viewport, settings.video.width, settings.video.height]);

  React.useEffect(() => {
    if (fit.width > 2 && fit.height > 2) {
      engineRef.current?.resize(fit.width, fit.height, window.devicePixelRatio || 1);
    }
  }, [fit]);

  const updateLayout = React.useCallback((patch: Partial<LayoutSettings>) => {
    setSettings((previous) => ({ ...previous, layout: { ...previous.layout, ...patch } }));
  }, []);

  const updateAppearance = React.useCallback((patch: Partial<AppearanceSettings>) => {
    setSettings((previous) => ({
      ...previous,
      appearance: {
        ...previous.appearance,
        ...patch,
        preset: patch.preset ?? (Object.keys(patch).length > 0 ? 'custom' : previous.appearance.preset),
      },
    }));
  }, []);

  const updateVideo = React.useCallback((patch: Partial<VideoSettings>) => {
    setSettings((previous) => ({ ...previous, video: { ...previous.video, ...patch } }));
  }, []);

  const applyPreset = React.useCallback((id: string) => {
    const preset = APPEARANCE_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setSettings((previous) => ({
      ...previous,
      appearance: { ...previous.appearance, ...preset.patch, preset: id },
    }));
  }, []);

  const resetLayout = React.useCallback(() => {
    setSettings((previous) => ({ ...previous, layout: { ...DEFAULT_LAYOUT } }));
    notify('info', '布局已恢复默认');
  }, [notify]);

  const resetAppearance = React.useCallback(() => {
    setSettings((previous) => ({
      ...previous,
      appearance: { ...JSON.parse(JSON.stringify(DEFAULT_APPEARANCE)), backgroundImage: previous.appearance.backgroundImage },
    }));
    notify('info', '外观已重置');
  }, [notify]);

  const openFilePicker = React.useCallback(() => fileInputRef.current?.click(), []);

  const loadFile = React.useCallback((file: File) => {
    // Swapping the score mid-render would leave the exporter drawing the old
    // one while the UI shows the new one.
    if (exportState.status === 'running') {
      notify('info', '正在导出，完成或取消后再换谱');
      return;
    }
    setExportState((previous) => {
      // The previous result's blob URL lives until the dialog closes; dropping a
      // new score used to replace it without revoking, leaking the whole video.
      if (previous.url) URL.revokeObjectURL(previous.url);
      return IDLE_EXPORT;
    });
    setFileName(file.name);
    engineRef.current?.loadFile(file);
  }, [exportState.status, notify]);

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
    event.target.value = '';
  };

  const onBackgroundFile = React.useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      if (value) updateAppearance({ backgroundImage: value });
    };
    reader.readAsDataURL(file);
  }, [updateAppearance]);

  const togglePlay = React.useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.playingNow) engine.pause();
    else engine.play();
  }, []);

  const restart = React.useCallback(() => {
    engineRef.current?.restart();
  }, []);

  const seek = React.useCallback((value: number) => {
    engineRef.current?.seek(value);
    setClock(value);
  }, []);

  const changeTrack = React.useCallback((index: number) => {
    engineRef.current?.setTrack(index);
    setTrackIndex(index);
  }, []);

  const changeVolume = React.useCallback((value: number) => {
    setVolume(value);
    engineRef.current?.setVolume(value);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      // Text fields, selects and sliders own the arrow keys. Buttons do not, and
      // clicking play/restart leaves one focused — swallowing every shortcut
      // afterwards would make ← / → / Home silently dead right when the user
      // wants them most.
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      if (event.code === 'Space') {
        // A focused button activates natively on Space; handling it here as well
        // would toggle playback twice.
        if (tag === 'button') return;
        event.preventDefault();
        togglePlay();
      } else if (event.code === 'Home') {
        event.preventDefault();
        seek(0);
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        const engine = engineRef.current;
        if (engine) seek(Math.max(0, engine.currentClock - 1000));
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        const engine = engineRef.current;
        if (engine) seek(Math.min(duration, engine.currentClock + 1000));
      } else if (event.key === 'e' || event.key === 'E') {
        if (loaded && !event.metaKey && !event.ctrlKey && !event.altKey) setExportOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duration, loaded, seek, togglePlay]);

  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const startExport = React.useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !loaded) return;
    cancelRef.current = false;
    setExportState({ ...IDLE_EXPORT, status: 'running', phase: 'audio', progress: 0 });
    engine.setSettings(settingsRef.current);
    try {
      const result = await engine.exportCurrent({
        width: settingsRef.current.video.width,
        height: settingsRef.current.video.height,
        fps: settingsRef.current.video.fps,
        container: settingsRef.current.video.container,
        quality: settingsRef.current.video.quality,
        includeAudio: settingsRef.current.video.includeAudio,
        onProgress: (progress, phase) => {
          setExportState((previous) => ({ ...previous, progress, phase }));
        },
        isCancelled: () => cancelRef.current,
      });
      const extension = settingsRef.current.video.container === 'mp4' ? 'mp4' : 'webm';
      const base = sanitizeName(settingsRef.current.video.filename)
        || sanitizeName(`${loaded.meta.title || 'tabfall'}${loaded.meta.artist ? ` - ${loaded.meta.artist}` : ''}`)
        || 'tabfall';
      const name = `${base.replace(new RegExp(`\\.${extension}$`, 'i'), '')}.${extension}`;
      const url = URL.createObjectURL(result.blob);
      setExportState({
        status: 'done', progress: 100, phase: 'finalize', error: '', warning: result.warning ?? '',
        url, name, size: result.blob.size,
      });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify('success', '视频已导出');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cancelRef.current || message === 'cancelled') {
        setExportState({ ...IDLE_EXPORT, status: 'error', error: '已取消导出' });
      } else {
        setExportState((previous) => ({ ...previous, status: 'error', progress: 0, error: message }));
      }
    }
  }, [loaded, notify]);

  const closeExport = React.useCallback(() => {
    setExportOpen(false);
    if (exportState.status !== 'running') {
      window.setTimeout(() => {
        setExportState((previous) => {
          if (previous.url) URL.revokeObjectURL(previous.url);
          return IDLE_EXPORT;
        });
      }, 120);
    }
  }, [exportState.status]);

  const downloadResult = React.useCallback(() => {
    if (!exportState.url) return;
    const anchor = document.createElement('a');
    anchor.href = exportState.url;
    anchor.download = exportState.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [exportState]);

  const totalDuration = loaded?.meta.durationMs ?? 0;
  const progress = totalDuration > 0 ? clamp(clock / totalDuration, 0, 1) : 0;
  const phaseLabel = clock < 0 ? '预备' : status.kind === 'ready' ? (playing ? '播放中' : '已就绪') : status.kind === 'loading' ? '解析中' : '待机';
  const audioLabel = loaded ? (loaded.meta.hasBackingTrack ? '内置伴奏' : 'alphaTab 合成') : '—';
  const currentTrack = loaded?.tracks.find((entry) => entry.info.index === trackIndex);
  const notes = currentTrack?.notes.length ?? 0;

  return (
    <div
      className="tf-app"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => { event.preventDefault(); }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) loadFile(file);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.musicxml,.mxl,.xml,.tex,.alphatex"
        hidden
        onChange={onFileInput}
      />
      <div ref={hostRef} aria-hidden="true" />

      <header className="tf-topbar">
        <div className="tf-brand">
          <span className="tf-brand-mark" aria-hidden="true">
            <i /><i /><i />
            <b />
          </span>
          <div>
            <strong>TABFALL</strong>
            <small>音游谱面视频工坊</small>
          </div>
        </div>
        <div className="tf-topbar-file">
          <span className={`tf-dot ${status.kind}`} />
          <span>{fileName || '未载入曲谱'}</span>
          {loaded && <em>{formatResolution(settings.video.width, settings.video.height)} · {settings.video.fps}fps</em>}
        </div>
        <div className="tf-topbar-actions">
          <button type="button" className="tf-btn is-ghost" onClick={openFilePicker}>{Icons.upload} 打开曲谱</button>
          <button type="button" className="tf-btn is-ghost" onClick={() => engineRef.current?.loadDemo(DEMO_TEX)}>载入示例</button>
          <button type="button" className="tf-btn is-primary" onClick={() => setExportOpen(true)} disabled={!loaded}>
            {Icons.download} 导出视频
          </button>
        </div>
      </header>

      <main className="tf-main">
        <aside className="tf-sidebar">
          <ScoreCard loaded={loaded} trackIndex={trackIndex} fileName={fileName} onTrack={changeTrack} onSeek={seek} status={status} />
          <nav className="tf-tabs" aria-label="设置分类">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={tab === item.id ? 'is-active' : ''}
                onClick={() => setTab(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="tf-sidebar-scroll">
            {tab === 'layout' && (
              <LayoutPanel
                settings={settings}
                loaded={loaded}
                trackIndex={trackIndex}
                durationMs={totalDuration}
                onLayout={updateLayout}
                onReset={resetLayout}
              />
            )}
            {tab === 'look' && (
              <LookPanel
                settings={settings}
                loaded={loaded}
                trackIndex={trackIndex}
                durationMs={totalDuration}
                onAppearance={updateAppearance}
                onPreset={applyPreset}
                onReset={resetAppearance}
                onBackgroundFile={onBackgroundFile}
                onClearBackground={() => updateAppearance({ backgroundImage: null })}
              />
            )}
            {tab === 'effects' && <EffectsPanel settings={settings} onAppearance={updateAppearance} />}
            {tab === 'video' && (
              <VideoPanel
                settings={settings}
                loaded={loaded}
                trackIndex={trackIndex}
                durationMs={totalDuration}
                onVideo={updateVideo}
                onExport={() => setExportOpen(true)}
                exporting={exportState.status === 'running'}
              />
            )}
          </div>
          <footer className="tf-sidebar-foot">
            <span>解析 / 音源 <b>alphaTab</b></span>
            <span className="tf-credit">本地处理 · 不上传</span>
          </footer>
        </aside>

        <section className="tf-stage">
          <div className="tf-stage-top">
            <div className="tf-stage-chips">
              <span className={`tf-chip ${phaseLabel === '播放中' ? 'is-live' : ''}`}>{phaseLabel}</span>
              <span className="tf-chip">{audioLabel}</span>
              <span className="tf-chip">{ready ? '音色就绪' : '音色按需加载'}</span>
            </div>
            <div className="tf-stage-meta">
              {loaded && <span>{Math.round(loaded.meta.tempo)} BPM</span>}
              {currentTrack && <span>{currentTrack.info.stringCount} 弦 · {notes.toLocaleString()} 音符</span>}
            </div>
          </div>

          <div className="tf-stage-body" ref={stageRef}>
            <div className={`tf-preview-shell ${dragging ? 'is-dragging' : ''}`} style={{ width: fit.width, height: fit.height }}>
              <canvas
                ref={canvasRef}
                className="tf-canvas"
                style={{ width: fit.width, height: fit.height }}
                aria-label="音游风格六线谱预览"
              />
              <StageOverlay status={status} loaded={loaded} ready={ready} onOpen={openFilePicker} />
              {dragging && <div className="tf-drop-hint">{Icons.uploadCloud}<strong>松开以载入曲谱</strong><small>GP3 / GP4 / GP5 / GPX / MusicXML</small></div>}
            </div>
          </div>

          <div className="tf-transport">
            <button type="button" className="tf-play" onClick={togglePlay} disabled={!loaded} aria-label={playing ? '暂停' : '播放'}>
              {playing ? Icons.pause : Icons.play}
            </button>
            <button type="button" className="tf-icon-btn" onClick={restart} disabled={!loaded} aria-label="从头开始" title="从头开始 (Home)">{Icons.restart}</button>
            <div className="tf-time">
              <strong>{formatClock(clock)}</strong>
              <span>/ {formatClock(totalDuration)}</span>
            </div>
            <div className="tf-seek">
              <input
                type="range"
                min={0}
                max={Math.max(1, totalDuration)}
                step={10}
                value={clamp(clock, 0, totalDuration)}
                disabled={!loaded}
                onChange={(event) => seek(Number(event.target.value))}
                style={{ '--fill': `${progress * 100}%` } as React.CSSProperties}
                aria-label="播放进度"
              />
            </div>
            <div className="tf-volume">
              <span aria-hidden="true">VOL</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                onChange={(event) => changeVolume(Number(event.target.value))}
                style={{ '--fill': `${volume * 100}%` } as React.CSSProperties}
                aria-label="音量"
              />
            </div>
            <div className="tf-transport-hint">Space 播放 / ← → 跳转 / Home 重开</div>
          </div>
        </section>
      </main>

      <ExportDialog
        open={exportOpen}
        settings={settings}
        loaded={loaded}
        durationMs={totalDuration}
        state={exportState}
        onClose={closeExport}
        onVideo={updateVideo}
        onStart={startExport}
        onCancel={() => { cancelRef.current = true; }}
        onDownload={downloadResult}
      />
      {toast && <div className={`tf-toast is-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
