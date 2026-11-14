import {
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  DEFAULT_VIDEO,
  RESOLUTIONS,
  type AppearanceSettings,
  type ProjectSettings,
} from '../core/types';

const STORAGE_KEY = 'tabfall.settings.v1';

export function defaultSettings(): ProjectSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as ProjectSettings;
}

export function loadSettings(): ProjectSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<ProjectSettings>;
    const appearance: AppearanceSettings = {
      ...JSON.parse(JSON.stringify(DEFAULT_APPEARANCE)),
      ...(parsed.appearance ?? {}),
      // Data URLs are intentionally session-only: a large background photo
      // would blow through the localStorage quota and break saving.
      backgroundImage: null,
    };
    if (!Array.isArray(appearance.stringColors) || appearance.stringColors.length < 8) {
      appearance.stringColors = [...DEFAULT_APPEARANCE.stringColors];
    }
    return {
      layout: { ...DEFAULT_LAYOUT, ...(parsed.layout ?? {}) },
      appearance,
      video: { ...DEFAULT_VIDEO, ...(parsed.video ?? {}) },
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: ProjectSettings): void {
  try {
    const copy: ProjectSettings = {
      ...settings,
      appearance: { ...settings.appearance, backgroundImage: null },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
  } catch {
    // Quota or privacy mode: settings are a convenience, never a blocker.
  }
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) ms = 0;
  if (ms < 0) return `预备 ${Math.max(0.1, (-ms / 1000)).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function resolutionId(width: number, height: number): string {
  const found = RESOLUTIONS.find((entry) => entry.width === width && entry.height === height);
  return found?.id ?? 'custom';
}

export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`;
}

export function estimateExportBytes(settings: ProjectSettings, durationMs: number): number {
  const { width, height, fps, quality } = settings.video;
  const factor = quality === 'low' ? 0.45 : quality === 'high' ? 1.7 : 1;
  const bitrate = Math.min(30_000_000, Math.max(2_000_000, width * height * (fps >= 50 ? 8 : 4.5))) * factor;
  const seconds = (durationMs + settings.layout.leadInSec * 1000 + settings.layout.outroSec * 1000) / 1000;
  return Math.round((bitrate / 8 + 160_000 / 8) * seconds);
}
