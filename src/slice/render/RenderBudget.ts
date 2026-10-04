/** A modest idle-game presentation budget, independent of simulation time. */
export const RENDER_FPS = 30;
export const MAX_RENDER_DPR = 1.25;
export const MAX_RENDER_PIXELS = 2_000_000;

export function renderPixelRatio(width: number, height: number, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixels = Math.max(1, width) * Math.max(1, height);
  return Math.min(dpr, MAX_RENDER_DPR, Math.sqrt(MAX_RENDER_PIXELS / pixels));
}

/** Drops redundant display refreshes; never loses elapsed business time or catches up renders. */
export class RenderBudget {
  private deadline = 0;
  private last = 0;
  private readonly interval = 1000 / RENDER_FPS;
  constructor(now: number) { this.reset(now); }
  reset(now: number): void { this.last = now; this.deadline = now + this.interval; }
  /** Settle a visible tail before lifecycle saving, without submitting a render. */
  flush(now: number): number {
    if (!Number.isFinite(now) || now < this.last) return 0;
    const elapsed = (now - this.last) / 1000;
    this.reset(now);
    return elapsed;
  }
  take(now: number): number | null {
    if (!Number.isFinite(now) || now < this.last || now + .1 < this.deadline) return null;
    const dt = (now - this.last) / 1000;
    this.last = now;
    // Keep the fractional cadence on 60/120/144 Hz screens, but do not replay stale frames.
    this.deadline += (Math.floor(Math.max(0, now - this.deadline + .1) / this.interval) + 1) * this.interval;
    return dt;
  }
}
