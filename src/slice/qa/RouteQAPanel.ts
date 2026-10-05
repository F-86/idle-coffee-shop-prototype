import type { CounterId, SliceState } from '../core/types';
import { RouteDiagnostics, type TraceRecord, type SceneCustomerPose } from './RouteDiagnostics';

const point = (pose: { x: number; z: number }) => `(${pose.x.toFixed(3)}, ${pose.z.toFixed(3)})`;
const stop = (target: number | undefined, counterCount = 2) => target === counterCount ? 'vault' : target !== undefined && target >= 0 && target < counterCount ? String.fromCharCode(65 + target) : '?';
const route = (pose: { phase: string; routeLeg?: number; hasCup?: boolean; legacy?: boolean }) => `${pose.phase}/${pose.routeLeg ?? '-'} cup=${pose.hasCup ? 'yes' : 'no'}${pose.legacy ? ' LEGACY route' : ''}`;
const eventText = (event: TraceRecord, counterCount = 2): string => {
  const who = event.actor === 'customer' ? `#${event.customerId} ${event.counterId?.slice(-1).toUpperCase() ?? '?'}` : 'manager';
  const data = event.actor === 'customer' ? route(event) : `${event.phase} →${stop(event.target, counterCount)}`;
  const cash = event.amount === undefined ? '' : ` ¥${(event.amount / 100).toFixed(2)} carry ${event.carryingBefore}→${event.carryingAfter} wallet ${event.walletBefore}→${event.walletAfter} (分)`;
  return `${event.time.toFixed(2)}s [${event.sequence}] ${who} ${event.kind} ${data} ${point(event)}${event.crossingX === undefined ? '' : ` junction x=${event.crossingX}`}${cash}`;
};

/** Opt-in DOM annotation. A projection identifies a mesh, not proof that its pixels are unoccluded. */
export class RouteQAPanel {
  private readonly panel: HTMLDetailsElement;
  private readonly summary: HTMLElement;
  private readonly text: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly listeners = new AbortController();
  private elapsed = Infinity;
  private disposed = false;
  private displayedSession = 0;
  private readonly diagnostics: RouteDiagnostics;

  constructor(host: HTMLElement, diagnostics: RouteDiagnostics, readState: () => Readonly<SliceState>) {
    this.diagnostics = diagnostics;
    const document = host.ownerDocument;
    this.panel = document.createElement('details'); this.panel.className = 'route-qa'; this.panel.open = true;
    this.panel.setAttribute('aria-label', '路线 QA 诊断');
    this.summary = document.createElement('summary'); this.summary.textContent = 'Route QA';
    this.panel.append(this.summary);
    for (const [label, counterId] of [['下一位', undefined], ['下一位 A', 'counter-a'], ['下一位 B', 'counter-b']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => { diagnostics.selectNext(readState(), counterId as CounterId | undefined); this.elapsed = Infinity; }, { signal: this.listeners.signal });
      this.panel.append(button);
    }
    this.text = document.createElement('pre'); this.panel.append(this.text);
    this.marker = document.createElement('span'); this.marker.className = 'route-qa-marker'; this.marker.hidden = true;
    this.marker.setAttribute('aria-hidden', 'true');
    host.append(this.panel, this.marker);
    this.panel.addEventListener('toggle', () => {
      if (!this.panel.open) this.marker.hidden = true;
      this.elapsed = Infinity;
    }, { signal: this.listeners.signal });
  }
  get active(): boolean { return !this.disposed && this.panel.open; }
  update(authority: Readonly<SliceState>, presented: Readonly<SliceState>, rendererAvailable: boolean, pose: SceneCustomerPose | null, dt: number): void {
    if (!this.active) return;
    this.diagnostics.capture(authority, presented, rendererAvailable, pose);
    this.marker.hidden = !pose?.inViewport;
    if (pose?.inViewport) {
      this.marker.textContent = `#${this.diagnostics.trackedId}`;
      this.marker.style.left = `${pose.screenX}px`; this.marker.style.top = `${pose.screenY}px`;
    }
    if (this.displayedSession !== this.diagnostics.generation) {
      this.displayedSession = this.diagnostics.generation; this.elapsed = Infinity;
    }
    this.elapsed += dt;
    if (this.elapsed < .15) return;
    this.elapsed = 0;
    const read = this.diagnostics.read(), sample = read.sample!;
    this.summary.textContent = `Route QA · #${read.selectedId ?? '-'} · ${sample.time.toFixed(2)}s`;
    const sceneStatus = !sample.rendererAvailable ? 'renderer unavailable' : sample.scene ? `${point(sample.scene)} viewport=${sample.scene.inViewport}` : 'mesh absent';
    this.text.textContent = [
      '仅辅助识别人/状态；不能证明无遮挡、无穿模或视觉验收通过。',
      `session ${read.session}: ${read.reason}; retained ${read.records.length}/128, dropped ${read.dropped}`,
      '提示：请在独立测试 origin / 浏览器存储使用。QA 不隔离或修改保存逻辑。',
      `tracked #${read.selectedId ?? '-'} (本次会话保持；恢复页面/重载后重选)`,
      `core ${sample.authority ? `${route(sample.authority)} ${point(sample.authority)}` : 'absent'}`,
      `presentation ${sample.presented ? `${route(sample.presented)} ${point(sample.presented)}` : 'absent'} (最多延迟一个 0.05s 步)`,
      `scene ${sceneStatus} (投影标签不判断遮挡)`,
      read.terminal ? `terminal ${eventText(read.terminal, authority.counters.length)}` : 'terminal: not observed in this session',
      `manager ${sample.manager.phase} →${stop(sample.manager.target, authority.counters.length)} ${point(sample.manager)} carry=${sample.manager.carrying}分`,
      'TRACKED events (最近 16):', ...read.trackedRecords.map(event => eventText(event, authority.counters.length)),
      'MANAGER events (最近 16; passage 仅经过, collected/deposited 为实际转账):', ...read.managerRecords.map(event => eventText(event, authority.counters.length)),
    ].join('\n');
  }
  dispose(): void {
    this.disposed = true; this.listeners.abort(); this.panel.remove(); this.marker.remove();
  }
}
