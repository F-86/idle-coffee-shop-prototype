import type { Counter, Customer, GridPoint, SliceEvent, SliceState } from './types';
import { actorReservations, findGridPath, getLayout, GRID, gridKey, interactionPoint, layoutExitAnchor, layoutExit } from './layout';

export const DINING_SECONDS = 6;

const round = (value: number): number => Math.round(value * 1e9) / 1e9;
interface Rules {
  stepSeconds: number;
  customerSpeed: number;
  emit(type: SliceEvent['type'], payload?: Omit<Partial<SliceEvent>, 'id' | 'type'>): void;
  canStart(counter: Counter): boolean;
  startBrew(counter: Counter, customer: Customer): boolean;
  traceCustomer(kind: 'spawn' | 'phase' | 'despawn', customer: Customer): void;
}
/** All walkers reserve one whole route. Stations remain independently reachable
 * while the others are occupied, as checked by validateLayout. Disjoint complete
 * routes may move concurrently; overlapping routes wait safely at stations. This conservative
 * traffic controller is deterministic across saves and has no wait-cycle escape
 * teleports, hidden timers or browser-only state. */
export function createLayoutSimulation(state: SliceState, rules: Rules) {
  const STEP = rules.stepSeconds;
  const furniture = () => getLayout(state).furniture.filter(item => !item.stored);
  const placedCounters = () => furniture().filter(item => item.kind === 'counter');
  const at = (a: GridPoint, b: GridPoint): boolean => Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.z - b.z) < 1e-8;
  const unpaid = (customer: Customer): boolean => ['entering', 'queue', 'serving', 'receiving'].includes(customer.phase);
  function occupied(skip: Customer): Set<string> {
    return new Set([...state.customers].filter(actor => actor !== skip).flatMap(actor => [...actorReservations(actor)]));
  }
  let cachedLayout: SliceState['layout'];
  const failedPaths = new Set<string>();
  const baseDistances = new Map<string, number>();
  function path(actor: Customer, target: GridPoint): GridPoint[] | null {
    const start = { x: Math.max(GRID.minX, Math.round(actor.x)), z: Math.round(actor.z) };
    if (state.layout !== cachedLayout) { failedPaths.clear(); baseDistances.clear(); cachedLayout = state.layout; }
    const blocked = occupied(actor);
    if (blocked.has(gridKey(start))) return null;
    const key = `${gridKey(start)}>${gridKey(target)}:${[...blocked].sort().join(';')}`;
    if (failedPaths.has(key)) return null;
    const result = findGridPath(getLayout(state), start, target, blocked);
    if (!result) { if (failedPaths.size >= 1024) failedPaths.clear(); failedPaths.add(key); }
    if (!result) return null;
    const baseKey = `${gridKey(start)}>${gridKey(target)}`;
    if (!baseDistances.has(baseKey)) {
      // Compare against a route that already avoids every stationary service,
      // seat and exit port. A real station detour must never become an
      // artificial waiting condition; only transient moving routes may wait.
      const stable = [state.layout!.version === 2 ? { x: -7, z: 6 } : layoutExitAnchor(state.layout!), ...furniture().map(item => interactionPoint(item, item.kind === 'counter' ? 'service' : 'seat'))];
      const stableBlocked = new Set(stable.filter(point => !at(point, start) && !at(point, target)).map(gridKey));
      baseDistances.set(baseKey, findGridPath(getLayout(state), start, target, stableBlocked)?.length ?? Infinity);
    }
    if (result.length > baseDistances.get(baseKey)! + 4) { if (failedPaths.size >= 1024) failedPaths.clear(); failedPaths.add(key); return null; }
    return at(actor, start) ? result : [start, ...result];
  }
  // Conservative bounded queue: one unpaid guest per counter and at most one
  // guest waiting outside. Independent disjoint routes can enter concurrently.
  function arrive(): boolean {
    if (state.customers.length >= 32 || state.customers.some(customer => actorReservations(customer).has('-8,5'))) return false;
    const counters = placedCounters().map(item => state.counters.find(counter => counter.id === item.counterId)!);
    const start = (state.nextCustomerId - 1) % counters.length;
    const counter = Array.from({ length: counters.length }, (_, index) => counters[(start + index) % counters.length]).find(counter => rules.canStart(counter) && !state.customers.some(customer => customer.counterId === counter.id && unpaid(customer)));
    if (!counter) return false;
    const id = state.nextCustomerId++;
    const customer: Customer = { id, x: -8, z: 5, phase: 'entering', counterId: counter.id, timer: 0, hasCup: false, skin: (id * 37 + 11) % 6 };
    state.customers.push(customer); rules.traceCustomer('spawn', customer); rules.emit('arrived', { counterId: counter.id }); return true;
  }
  function advanceCustomers(): void {
    for (const customer of state.customers) {
      const counter = state.counters.find(counter => counter.id === customer.counterId)!;
      if (customer.phase === 'queue' && !counter.brew) {
        if (rules.startBrew(counter, customer)) customer.phase = 'serving';
        else { customer.phase = 'leaving'; customer.departureReason = 'stockout'; }
        rules.traceCustomer('phase', customer);
      } else if (customer.phase === 'receiving') {
        customer.timer = round(customer.timer + STEP);
        if (customer.timer >= .7 && counter.brew?.customerId === customer.id) {
          const price = counter.brew.price;
          state.wallet += price; state.totalEarned += price; state.totalServed++;
          counter.brew = null; customer.timer = 0;
          // Reserving a reachable free seat happens only after payment. A full
          // dining room immediately falls back to takeaway, never a second bill.
          const table = furniture().find(item => item.kind === 'table' && !state.customers.some(other => other.seatId === item.id) && path(customer, interactionPoint(item, 'seat')) !== null);
          if (table) { customer.seatId = table.id; customer.phase = 'seeking-seat'; }
          else customer.phase = 'leaving';
          rules.emit('served', { counterId: counter.id, amount: price }); rules.traceCustomer('phase', customer);
        }
      } else if (customer.phase === 'dining') {
        customer.timer = round(customer.timer + STEP);
        if (customer.timer >= DINING_SECONDS) {
          delete customer.seatId; customer.phase = 'leaving'; customer.timer = 0; rules.traceCustomer('phase', customer);
        }
      }
    }
  }
  function customerRoute(customer: Customer): GridPoint[] | null {
    if (customer.phase === 'entering') {
      const item = placedCounters().find(item => item.counterId === customer.counterId)!;
      const target = interactionPoint(item, 'service');
      if (state.customers.some(other => other !== customer && at(other, target))) return null;
      return path(customer, target);
    }
    if (customer.phase === 'seeking-seat') {
      const table = furniture().find(item => item.id === customer.seatId);
      return table ? path(customer, interactionPoint(table, 'seat')) : null;
    }
    if (customer.phase === 'leaving') {
      const legacy = state.layout!.version === 2;
      const result = path(customer, legacy ? { x: -7, z: 6 } : layoutExitAnchor(state.layout!)); return result ? [...result, legacy ? { x: -8, z: 6 } : layoutExit(state.layout!)] : null;
    }
    return null;
  }
  function finished(customer: Customer): void {
    delete customer.nav;
    if (customer.phase === 'entering') customer.phase = 'queue';
    else if (customer.phase === 'seeking-seat') customer.phase = 'dining';
    else if (customer.phase === 'leaving') {
      state.customers = state.customers.filter(other => other !== customer);
      rules.traceCustomer('despawn', customer); return;
    }
    customer.timer = 0; rules.traceCustomer('phase', customer);
  }
  function advanceMovement(): void {
    const tryCustomer = (): void => {
      const candidates = state.customers.filter(customer => !customer.nav && ['entering', 'seeking-seat', 'leaving'].includes(customer.phase)).sort((a, b) => (a.phase === 'entering' ? 1 : 0) - (b.phase === 'entering' ? 1 : 0) || a.id - b.id);
      for (const customer of candidates) {
        const route = customerRoute(customer);
        if (route?.length) customer.nav = route;
        else if (route) finished(customer);
      }
    };
    tryCustomer();
    for (const actor of [...state.customers]) {
      if (!actor.nav?.length) continue;
      const target = actor.nav[0], dx = target.x - actor.x, dz = target.z - actor.z, distance = Math.hypot(dx, dz), step = rules.customerSpeed * STEP;
      if (distance <= step + 1e-9) {
        actor.x = target.x; actor.z = target.z; actor.nav.shift();
        if (!actor.nav.length) finished(actor);
      } else { actor.x += dx / distance * step; actor.z += dz / distance * step; }
    }
  }
  return { arrive, advanceCustomers, advanceMovement };
}
