export const FRAME_SAMPLE_LIMIT = 4096;
export const FRAME_WINDOW_MS = 10_000;

/** Bounded, allocation-free recording of render-submission RAF timestamps.
 * These are scheduling intervals, not simulation time, GPU duration, presented frames or temperature.
 */
export class FrameDiagnostics {
  private readonly ends = new Float64Array(FRAME_SAMPLE_LIMIT);
  private readonly intervals = new Float64Array(FRAME_SAMPLE_LIMIT);
  private cursor = 0;
  private retained = 0;
  private previous: number | null = null;
  private totalIntervals = 0;
  private totalMs = 0;
  private totalOver50 = 0;
  private totalOver100 = 0;
  private lastDroppedEnd: number | null = null;
  private reason = 'panel opened';

  reset(reason: string): void {
    this.cursor = 0; this.retained = 0; this.previous = null;
    this.totalIntervals = 0; this.totalMs = 0; this.totalOver50 = 0; this.totalOver100 = 0;
    this.lastDroppedEnd = null;
    this.reason = reason;
  }
  frame(now: number): void {
    if (!Number.isFinite(now)) return;
    if (this.previous === null) { this.previous = now; return; }
    if (now <= this.previous) return;
    const interval = now - this.previous;
    this.previous = now;
    if (this.retained === FRAME_SAMPLE_LIMIT) this.lastDroppedEnd = this.ends[this.cursor];
    this.ends[this.cursor] = now; this.intervals[this.cursor] = interval;
    this.cursor = (this.cursor + 1) % FRAME_SAMPLE_LIMIT;
    this.retained = Math.min(FRAME_SAMPLE_LIMIT, this.retained + 1);
    this.totalIntervals++; this.totalMs += interval;
    if (interval > 50) this.totalOver50++;
    if (interval > 100) this.totalOver100++;
  }
  /** Snapshot/sort is deliberately called only by the panel's 1 Hz refresh or explicit read. */
  read() {
    const values: number[] = [];
    let spanMs = 0, over50 = 0, over100 = 0;
    const cutoff = (this.previous ?? 0) - FRAME_WINDOW_MS;
    for (let i = 0; i < this.retained; i++) {
      const index = (this.cursor - this.retained + i + FRAME_SAMPLE_LIMIT) % FRAME_SAMPLE_LIMIT;
      if (this.ends[index] <= cutoff) continue;
      const interval = this.intervals[index];
      values.push(interval); spanMs += interval;
      if (interval > 50) over50++;
      if (interval > 100) over100++;
    }
    values.sort((a, b) => a - b);
    const percentile = (fraction: number): number | null => values.length ? values[Math.ceil(values.length * fraction) - 1] : null;
    return {
      reason: this.reason, retained: this.retained, capacity: FRAME_SAMPLE_LIMIT,
      windowMs: FRAME_WINDOW_MS, intervals: values.length, spanMs,
      fps: spanMs > 0 ? values.length * 1000 / spanMs : null,
      p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: values.at(-1) ?? null, over50, over100,
      capacityLimited: this.lastDroppedEnd !== null && this.lastDroppedEnd > cutoff,
      totalIntervals: this.totalIntervals, totalMs: this.totalMs,
      totalFps: this.totalMs > 0 ? this.totalIntervals * 1000 / this.totalMs : null,
      totalOver50: this.totalOver50, totalOver100: this.totalOver100,
    };
  }
}
