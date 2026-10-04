import { FrameDiagnostics } from './FrameDiagnostics';

const fixed = (value: number | null) => value === null ? '—' : value.toFixed(2);

/** No timers/RAF owner: opt-in sampling piggybacks on successful application renders. */
export class PerformanceQAPanel {
  private readonly panel: HTMLDetailsElement;
  private readonly text: HTMLElement;
  private readonly sampler = new FrameDiagnostics();
  private readonly listeners = new AbortController();
  private nextDisplay = -Infinity;
  private frozen = false;
  private disposed = false;
  private readonly readContext: () => string;

  constructor(host: HTMLElement, readContext: () => string) {
    this.readContext = readContext;
    const document = host.ownerDocument;
    this.panel = document.createElement('details'); this.panel.className = 'performance-qa';
    this.panel.open = false; this.panel.setAttribute('aria-label', '性能 QA 诊断');
    const summary = document.createElement('summary'); summary.textContent = 'Performance QA · 展开计时';
    this.panel.append(summary);
    for (const label of ['重新开始计时', '冻结读数']) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => {
        if (label === '重新开始计时') this.reset('manual restart');
        else {
          if (this.frozen) return;
          this.frozen = true;
          // Preserve the last displayed snapshot and its matching scene context.
          this.text.textContent = `FROZEN（最后一次 1Hz 读数）\n${this.text.textContent}`;
        }
      }, { signal: this.listeners.signal });
      this.panel.append(button);
    }
    this.text = document.createElement('pre');
    this.text.textContent = '展开后从下一次实际绘制开始；收起即停止并清空。';
    this.panel.append(this.text); host.append(this.panel);
    this.panel.addEventListener('toggle', () => this.reset(this.panel.open ? 'panel opened' : 'panel closed'), { signal: this.listeners.signal });
  }
  reset(reason: string): void {
    this.sampler.reset(reason); this.nextDisplay = -Infinity; this.frozen = false;
  }
  get active(): boolean { return !this.disposed && this.panel.open && !this.frozen; }
  update(now: number, rendererAvailable: boolean, focused: boolean): void {
    if (!this.active) return;
    if (rendererAvailable && focused) this.sampler.frame(now);
    if (now < this.nextDisplay) return;
    this.nextDisplay = now + 1000;
    const s = this.sampler.read();
    this.text.textContent = [
      '实际提交绘制的 RAF 时间戳间隔；不是模拟时间、GPU耗时、上屏帧或温度。',
      '仅页面 visible 且 focus 时采样；1Hz 显示。关闭 Route QA 减少额外诊断工作。',
      !rendererAvailable ? `BLOCKED · renderer unavailable (${s.reason})，未采集绘制帧` : focused ? `LIVE · ${s.reason}` : 'PAUSED · page unfocused，未采集绘制帧',
      `最近 ${s.windowMs / 1000}s 的间隔终点：${s.intervals} 个 / 覆盖 ${(s.spanMs / 1000).toFixed(2)}s${s.capacityLimited ? '（容量截断）' : ''}`,
      `FPS ${fixed(s.fps)} · p50 ${fixed(s.p50Ms)}ms · p95 ${fixed(s.p95Ms)}ms · max ${fixed(s.maxMs)}ms`,
      `长间隔 >50ms ${s.over50} · >100ms ${s.over100}（不是 Long Tasks API）`,
      `本段 ${(s.totalMs / 1000).toFixed(2)}s / ${s.totalIntervals} 间隔 · FPS ${fixed(s.totalFps)} · >50ms ${s.totalOver50} · >100ms ${s.totalOver100}`,
      this.readContext(),
      '后台/焦点、尺寸、模式、读档/新店均重开段；隐藏时间不计入。',
      'QA不隔离存档。使用独立测试存储；温度/功耗需要单独设备测量。',
    ].join('\n');
  }
  read() { return this.sampler.read(); }
  dispose(): void { this.disposed = true; this.listeners.abort(); this.panel.remove(); }
}
