/**
 * Canvas hit effects. Everything is deterministic per spawn seed so the
 * offline exporter and the live preview look identical at the same timestamp.
 */
import type { HitEffectKind } from '../types';

export interface EffectGeometry {
  unit: number;
  hitY: number;
  ok?: boolean;
}

interface Particle {
  angle: number;
  speed: number;
  size: number;
  life: number;
  delay: number;
  spin: number;
  wobble: number;
  gravity: number;
  drag: number;
  /** 0 = crisp shape, > 0 = soft (pre-blurred) shape with that much extra spread. */
  soft?: number;
}

interface EffectInstance {
  kind: Exclude<HitEffectKind, 'none'>;
  x: number;
  y: number;
  color: string;
  accent: string;
  born: number;
  duration: number;
  intensity: number;
  seed: number;
  particles: Particle[];
  ringOnly: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  const p = 1 - clamp01(t);
  return 1 - p * p * p;
}

function easeOutQuint(t: number): number {
  const p = 1 - clamp01(t);
  return 1 - p * p * p * p * p;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(hex: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const raw = value.replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
    const n = Number.parseInt(full, 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [200, 210, 220];
  };
  const a = parse(hex);
  const b = parse(target);
  const t = Math.min(1, Math.max(0, amount));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

const smokeSpriteCache = new Map<string, HTMLCanvasElement>();
const glowSpriteCache = new Map<string, HTMLCanvasElement>();
const softShardCache = new Map<string, HTMLCanvasElement>();

function smokeSprite(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cached = smokeSpriteCache.get(color);
  if (cached) return cached;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(0.72, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  // A few soft lobes break up the perfect circle and read as smoke.
  const rng = mulberry32(0x51f0a3);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i += 1) {
    const cx = size / 2 + (rng() - 0.5) * size * 0.36;
    const cy = size / 2 + (rng() - 0.5) * size * 0.36;
    const radius = size * (0.2 + rng() * 0.2);
    const lobe = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    lobe.addColorStop(0, color);
    lobe.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.12 + rng() * 0.1;
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  smokeSpriteCache.set(color, canvas);
  return canvas;
}

function glowSprite(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cached = glowSpriteCache.get(color);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glowSpriteCache.set(color, canvas);
  return canvas;
}

/** Pre-blurred square: baking the blur once keeps the export fast and deterministic. */
function softShardSprite(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cached = softShardCache.get(color);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // The core square is half the sprite, so callers draw it at 2x the shard size.
  ctx.filter = 'blur(9px)';
  ctx.fillStyle = color;
  ctx.fillRect(size / 4, size / 4, size / 2, size / 2);
  softShardCache.set(color, canvas);
  return canvas;
}

function makeParticles(kind: EffectInstance['kind'], intensity: number, rng: () => number): Particle[] {
  const particles: Particle[] = [];
  if (kind === 'smoke') {
    const count = Math.round(12 + 20 * intensity);
    for (let i = 0; i < count; i += 1) {
      const spread = 0.35 + rng() * 0.65;
      particles.push({
        angle: -Math.PI / 2 + (rng() - 0.5) * 2.1 * spread,
        speed: 18 + rng() * 90 * (0.6 + intensity),
        size: 0.3 + rng() * 0.5,
        life: 0.55 + rng() * 0.55,
        delay: rng() * 0.12,
        spin: (rng() - 0.5) * 1.6,
        wobble: rng() * Math.PI * 2,
        gravity: -8 - rng() * 16,
        drag: 0.7 + rng() * 0.25,
      });
    }
  } else if (kind === 'phigros') {
    const count = Math.round(5 + 8 * intensity);
    for (let i = 0; i < count; i += 1) {
      const softRoll = rng();
      particles.push({
        angle: rng() * Math.PI * 2,
        speed: 34 + rng() * 150 * (0.5 + intensity),
        size: 0.28 + rng() * 0.72,
        life: 0.35 + rng() * 0.48,
        delay: rng() * 0.035,
        spin: (rng() - 0.5) * 5.2,
        wobble: rng() * Math.PI * 2,
        gravity: 0,
        drag: 1,
        // Roughly a third of the shards are out of focus; the rest stay crisp.
        soft: softRoll < 0.36 ? 0.45 + softRoll * 1.1 : 0,
      });
    }
  } else {
    const count = Math.round(14 + 18 * intensity);
    for (let i = 0; i < count; i += 1) {
      particles.push({
        angle: -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.4,
        speed: 60 + rng() * 230 * (0.5 + intensity),
        size: 0.05 + rng() * 0.09,
        life: 0.35 + rng() * 0.5,
        delay: rng() * 0.03,
        spin: 0,
        wobble: 0,
        gravity: 220,
        drag: 0.98,
      });
    }
  }
  return particles;
}

export class HitEffects {
  private items: EffectInstance[] = [];
  private cooldown = 0;
  private spawnCount = 0;

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }

  spawn(
    x: number,
    y: number,
    color: string,
    accent: string,
    born: number,
    kind: HitEffectKind,
    intensity: number,
    duration: number,
  ): void {
    if (kind === 'none') return;
    const clamped = clamp01(intensity);
    if (clamped <= 0.01) return;
    // Keep chords or very fast passages from flooding the canvas.
    if (this.items.length > 160) return;
    this.spawnCount += 1;
    const seed = (Math.floor(x * 7919) ^ Math.floor(born * 13) ^ this.spawnCount * 2654435761) >>> 0;
    const rng = mulberry32(seed);
    this.items.push({
      kind,
      x,
      y,
      color,
      accent,
      born,
      duration: Math.max(0.18, duration),
      intensity: clamped,
      seed,
      particles: makeParticles(kind, clamped, rng),
      ringOnly: false,
    });
  }

  /** Recent hit energy (0..1), used for the hit-line flash and screen flash. */
  energy(now: number): number {
    let sum = 0;
    for (const item of this.items) {
      const age = (now - item.born) / 1000;
      if (age < 0 || age > 0.24) continue;
      const p = age / 0.24;
      sum += (1 - p) * (1 - p) * item.intensity;
    }
    return Math.min(1.4, sum);
  }

  update(now: number): void {
    if (this.items.length === 0) return;
    this.items = this.items.filter((item) => now - item.born < item.duration * 1000 + 200);
  }

  draw(ctx: CanvasRenderingContext2D, now: number, geometry: EffectGeometry): void {
    const unit = geometry.unit;
    for (const item of this.items) {
      const ageMs = now - item.born;
      const age = ageMs / (item.duration * 1000);
      if (age < 0 || age > 1.02) continue;
      const t = clamp01(age);
      const intensity = item.intensity;
      ctx.save();
      ctx.translate(item.x, item.y);
      if (item.kind === 'smoke') this.drawSmoke(ctx, item, t, unit);
      else if (item.kind === 'phigros') this.drawPhigros(ctx, item, t, unit);
      else this.drawSpark(ctx, item, t, unit);
      ctx.restore();
      void intensity;
    }
  }

  private drawSmoke(ctx: CanvasRenderingContext2D, item: EffectInstance, t: number, unit: number): void {
    const p = clamp01(t);
    const life = 1 - p;
    const smokeColor = mixColor(item.color, '#e2eaf3', 0.55);
    const sprite = smokeSprite(smokeColor);
    ctx.globalCompositeOperation = 'source-over';
    // A few large, overlapping puffs form the plume; the small particles below
    // break its silhouette so it reads as smoke rather than a glowing ball.
    if (sprite) {
      const baseScale = unit * (46 + 86 * item.intensity);
      const puffs = [
        { dx: -0.22, dy: -0.05, scale: 1, phase: 0 },
        { dx: 0.24, dy: -0.18, scale: 0.86, phase: 0.12 },
        { dx: -0.02, dy: -0.42, scale: 0.78, phase: 0.2 },
      ];
      for (const puff of puffs) {
        const local = clamp01((p - puff.phase) / Math.max(0.1, 1 - puff.phase));
        if (local <= 0) continue;
        const size = baseScale * puff.scale * (0.6 + easeOutCubic(local) * 1.45);
        const alpha = Math.pow(1 - local, 1.4) * 0.34 * (0.55 + item.intensity * 0.45);
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sprite,
          puff.dx * size * 1.2 - size / 2,
          puff.dy * size * 2 - size / 2 - unit * 16 * easeOutCubic(local),
          size,
          size,
        );
      }
    }
    for (const particle of item.particles) {
      const pt = clamp01((t - particle.delay) / Math.max(0.05, particle.life));
      if (pt <= 0 || pt >= 1) continue;
      const spread = 1 - Math.exp(-2.1 * pt);
      const distance = particle.speed * spread * unit * 1.6;
      const angle = particle.angle + Math.sin(pt * 2.6 + particle.wobble) * 0.22;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance + particle.gravity * pt * pt * 0.55 * unit;
      const size = unit * (26 + 44 * particle.size + 46 * pt) * (0.7 + item.intensity * 0.6);
      const alpha = Math.pow(1 - pt, 1.35) * life * 0.3 * (0.55 + item.intensity * 0.55);
      if (!sprite) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2 + particle.spin * pt * 0.4);
      ctx.scale(1.22, 0.68);
      ctx.globalAlpha = Math.min(0.55, alpha);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    // A very short white kiss at the impact keeps the hit punchy.
    if (p < 0.16) {
      const flash = 1 - p / 0.16;
      const radius = unit * (14 + 26 * item.intensity) * (1 + p * 2);
      const glow = glowSprite('#ffffff');
      if (glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = flash * 0.4;
        ctx.drawImage(glow, -radius / 2, -radius / 2, radius, radius);
      }
    }
    // Faint expansion ring, far weaker than the Phigros shockwave.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = life * 0.15 * item.intensity;
    ctx.strokeStyle = mixColor(item.color, '#ffffff', 0.25);
    ctx.lineWidth = Math.max(1, unit * 1.4 * life);
    ctx.beginPath();
    ctx.arc(0, 0, unit * (10 + 70 * easeOutQuint(p)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawPhigros(ctx: CanvasRenderingContext2D, item: EffectInstance, t: number, unit: number): void {
    const p = clamp01(t);
    const life = 1 - p;
    const intensity = item.intensity;
    const grow = easeOutQuint(p);
    const scale = unit * (0.72 + intensity * 0.42);
    // Phigros is flat geometry: thin outlines, translucent flat discs and
    // square shards. No additive glow, no starburst.
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'miter';

    // Flat translucent halo, then the small central disc from the reference.
    ctx.globalAlpha = life * 0.19 * intensity;
    ctx.fillStyle = item.accent;
    ctx.beginPath();
    ctx.arc(0, 0, unit * (21 + 51 * grow) * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = life * 0.38;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(0, 0, unit * (9 + 9 * intensity) * scale, 0, Math.PI * 2);
    ctx.fill();

    const square = unit * (51 + 64 * intensity) * (0.78 + 1.68 * grow) * scale;
    // Rotated square / diamond frame, slightly larger than the square.
    ctx.globalAlpha = life * 0.58;
    ctx.strokeStyle = item.accent;
    ctx.lineWidth = Math.max(2, unit * 3);
    const diamond = square * 0.74;
    ctx.beginPath();
    ctx.moveTo(0, -diamond);
    ctx.lineTo(diamond, 0);
    ctx.lineTo(0, diamond);
    ctx.lineTo(-diamond, 0);
    ctx.closePath();
    ctx.stroke();

    // Axis-aligned square frame.
    ctx.globalAlpha = life * 0.95;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = Math.max(2.4, unit * 3.8);
    ctx.strokeRect(-square / 2, -square / 2, square, square);

    // Two opposite arcs, slowly rotating; the broken ring from the close-up.
    ctx.save();
    ctx.rotate(p * 2.4 + (item.seed % 360) * Math.PI / 1800);
    const arcRadius = square * 0.62;
    ctx.lineWidth = Math.max(2.6, unit * 5);
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i += 1) {
      ctx.globalAlpha = life * (i === 0 ? 0.95 : 0.72);
      ctx.strokeStyle = i === 0 ? item.color : item.accent;
      const start = -0.62 + Math.PI * i;
      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, start, start + 1.5);
      ctx.stroke();
    }
    ctx.restore();

    // Center dot.
    ctx.globalAlpha = Math.max(0, 1 - p * 2.4);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, unit * (2.4 + 2 * intensity) * scale), 0, Math.PI * 2);
    ctx.fill();

    // Flat square shards: a mix of filled and outlined pieces.
    let index = 0;
    for (const particle of item.particles) {
      const pt = clamp01((t - particle.delay) / Math.max(0.05, particle.life));
      if (pt <= 0 || pt >= 1) continue;
      const distance = particle.speed * easeOutCubic(pt) * unit * 1.2;
      const x = Math.cos(particle.angle) * distance;
      const y = Math.sin(particle.angle) * distance;
      const size = unit * (7 + 13 * particle.size) * (1 - pt * 0.25);
      const alpha = (1 - pt) * 0.85;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(particle.spin + pt * 2.8);
      ctx.globalAlpha = alpha;
      const color = index % 4 === 1 ? '#ffffff' : (index % 2 === 0 ? item.color : item.accent);
      const soft = particle.soft ?? 0;
      const sprite = soft > 0 ? softShardSprite(color) : null;
      if (sprite) {
        const box = size * 2 * (1 + soft * 0.2);
        ctx.globalAlpha = alpha * 0.8;
        ctx.drawImage(sprite, -box / 2, -box / 2, box, box);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(-size / 2, -size / 2, size, size);
      }
      ctx.restore();
      index += 1;
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSpark(ctx: CanvasRenderingContext2D, item: EffectInstance, t: number, unit: number): void {
    const p = clamp01(t);
    const life = 1 - p;
    ctx.globalCompositeOperation = 'lighter';
    const glow = glowSprite(item.color);
    if (glow) {
      const radius = unit * (10 + 32 * easeOutCubic(Math.min(1, p * 2))) * (0.7 + item.intensity);
      ctx.globalAlpha = life * 0.8;
      ctx.drawImage(glow, -radius / 2, -radius / 2, radius, radius);
    }
    for (const particle of item.particles) {
      const pt = clamp01((t - particle.delay) / Math.max(0.05, particle.life));
      if (pt <= 0 || pt >= 1) continue;
      const distance = particle.speed * (1 - Math.exp(-3.4 * pt)) / 3.4 * unit * 3;
      const x = Math.cos(particle.angle) * distance;
      const y = Math.sin(particle.angle) * distance + particle.gravity * pt * pt * 0.38 * unit;
      const radius = unit * (1.6 + 2.2 * particle.size * 10) * (1 - pt * 0.5);
      ctx.globalAlpha = (1 - pt) * 0.95;
      ctx.fillStyle = pt < 0.35 ? '#ffffff' : item.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, radius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = life * 0.35;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = Math.max(0.8, unit * 2 * life);
    ctx.beginPath();
    ctx.arc(0, 0, unit * (8 + 46 * easeOutQuint(p)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
}
