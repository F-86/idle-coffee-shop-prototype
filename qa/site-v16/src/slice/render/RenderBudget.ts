/** Presentation choices never change the simulation step or saved business state. */
export type RenderMode = 'smooth' | 'clear-60' | 'balanced' | 'low-power';
export const RENDER_MODE_KEY = 'mellow-bean-render-mode-v1';
export const DEFAULT_RENDER_MODE: RenderMode = 'smooth';
export const RENDER_MODES = {
  smooth: { fps: null, maxDpr: 2, maxPixels: 8_000_000 },
  'clear-60': { fps: 60, maxDpr: 2, maxPixels: 8_000_000 },
  balanced: { fps: 60, maxDpr: 1.5, maxPixels: 4_500_000 },
  'low-power': { fps: 30, maxDpr: 1, maxPixels: 2_000_000 },
} as const;

export function isRenderMode(value: unknown): value is RenderMode {
  return typeof value === 'string' && Object.hasOwn(RENDER_MODES, value);
}
export function readRenderMode(storage: Pick<Storage, 'getItem'>): RenderMode {
  try { const mode = storage.getItem(RENDER_MODE_KEY); return isRenderMode(mode) ? mode : DEFAULT_RENDER_MODE; }
  catch { return DEFAULT_RENDER_MODE; }
}
export function renderPixelRatio(width: number, height: number, devicePixelRatio: number, mode: RenderMode = DEFAULT_RENDER_MODE): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixels = Math.max(1, width) * Math.max(1, height);
  const budget = RENDER_MODES[mode];
  return Math.min(dpr, budget.maxDpr, Math.sqrt(budget.maxPixels / pixels));
}

/** Smooth follows display RAF; explicit capped modes skip redundant refreshes. */
export class RenderBudget {
  private deadline = 0;
  private last = 0;
  private interval = 0;
  constructor(now: number, mode: RenderMode = DEFAULT_RENDER_MODE) {
    this.setMode(mode, now);
    this.reset(now);
  }
  /** Preserve the unconsumed visible tail when changing quality between RAFs. */
  setMode(mode: RenderMode, now: number): void {
    const fps = RENDER_MODES[mode].fps;
    this.interval = fps === null ? 0 : 1000 / fps;
    this.deadline = now + this.interval;
  }
  reset(now: number): void { this.last = now; this.deadline = now + this.interval; }
  /** Settle a visible tail before lifecycle saving, without submitting a render. */
  flush(now: number): number {
    if (!Number.isFinite(now) || now < this.last) return 0;
    const elapsed = (now - this.last) / 1000;
    this.reset(now);
    return elapsed;
  }
  take(now: number): number | null {
    if (!Number.isFinite(now) || now <= this.last || now + .1 < this.deadline) return null;
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (this.interval > 0) {
      // Preserve fractional cadence, never submit a burst of stale catch-up frames.
      this.deadline += (Math.floor(Math.max(0, now - this.deadline + .1) / this.interval) + 1) * this.interval;
    }
    return dt;
  }
}
