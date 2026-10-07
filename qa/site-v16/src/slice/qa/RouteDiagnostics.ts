import type { Customer, CounterId, SliceState } from '../core/types';
import type { RouteObserver, RouteTraceEvent } from '../core/routeTrace';

export const ROUTE_TRACE_LIMIT = 128;
export const TRACKED_TRACE_LIMIT = 16;
export const MANAGER_TRACE_LIMIT = 16;
export const isRouteQA = (search: string): boolean => new URLSearchParams(search).get('qa') === '1';
export interface TraceRecord extends RouteTraceEvent { sequence: number }
export interface SceneCustomerPose { x: number; z: number; screenX: number; screenY: number; inViewport: boolean }
const customerPose = (customer?: Customer) => customer ? {
  id: customer.id, counterId: customer.counterId, phase: customer.phase, routeLeg: customer.routeLeg,
  x: customer.x, z: customer.z, hasCup: customer.hasCup, legacy: !!customer.finishLegacyRoute,
} : null;
function append<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) items.shift();
}

/** Local bounded record. No storage, network, timers, simulation controls or persistent IDs. */
export class RouteDiagnostics {
  private sequence = 0;
  private session = 1;
  private reason = 'page load';
  private records: TraceRecord[] = [];
  private trackedRecords: TraceRecord[] = [];
  private managerRecords: TraceRecord[] = [];
  private selectedId: number | null = null;
  private terminal: TraceRecord | null = null;
  private dropped = 0;
  private sample: {
    time: number; presentedTime: number; authority: ReturnType<typeof customerPose>;
    presented: ReturnType<typeof customerPose>; scene: SceneCustomerPose | null;
    rendererAvailable: boolean; manager: SliceState['manager'];
  } | null = null;

  readonly observe: RouteObserver = event => {
    if (this.selectedId === null && event.actor === 'customer' && event.customerId !== undefined) this.selectedId = event.customerId;
    const record = { ...event, sequence: ++this.sequence };
    if (this.records.length === ROUTE_TRACE_LIMIT) this.dropped++;
    append(this.records, record, ROUTE_TRACE_LIMIT);
    if (event.actor === 'manager') append(this.managerRecords, record, MANAGER_TRACE_LIMIT);
    if (event.actor === 'customer' && event.customerId === this.selectedId) {
      append(this.trackedRecords, record, TRACKED_TRACE_LIMIT);
      if (event.kind === 'despawn') this.terminal = record;
    }
  };
  get generation(): number { return this.session; }
  get trackedId(): number | null { return this.selectedId; }
  selectNext(state: Readonly<SliceState>, counterId?: CounterId): void {
    const ids = state.customers.filter(customer => !counterId || customer.counterId === counterId).map(customer => customer.id).sort((a, b) => a - b);
    const next = ids.find(id => id > (this.selectedId ?? -1)) ?? ids[0];
    if (next === undefined || next === this.selectedId) return;
    this.selectedId = next;
    this.trackedRecords = this.records.filter(event => event.actor === 'customer' && event.customerId === next).slice(-TRACKED_TRACE_LIMIT);
    this.terminal = null;
    this.sample = null;
  }
  capture(authority: Readonly<SliceState>, presented: Readonly<SliceState>, rendererAvailable: boolean, pose: SceneCustomerPose | null): void {
    if (this.selectedId === null) this.selectNext(authority);
    this.sample = {
      time: authority.elapsed, presentedTime: presented.elapsed,
      authority: customerPose(authority.customers.find(customer => customer.id === this.selectedId)),
      presented: customerPose(presented.customers.find(customer => customer.id === this.selectedId)),
      scene: pose ? { ...pose } : null, rendererAvailable, manager: { ...authority.manager },
    };
  }
  reset(reason: string): void {
    this.session++; this.reason = reason; this.sequence = 0; this.dropped = 0;
    this.records = []; this.trackedRecords = []; this.managerRecords = [];
    this.selectedId = null; this.terminal = null; this.sample = null;
  }
  read() {
    return structuredClone({ session: this.session, reason: this.reason, selectedId: this.selectedId,
      sequence: this.sequence, dropped: this.dropped, records: this.records, trackedRecords: this.trackedRecords,
      managerRecords: this.managerRecords, terminal: this.terminal, sample: this.sample });
  }
}
