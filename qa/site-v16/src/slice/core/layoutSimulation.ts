import type { Counter, Customer, FurniturePlacement, GridPoint, SliceEvent, SliceState } from './types';
import { actorReservations, createGridNavigator, type GridNavigator, type GridBlockMask, getLayout, GRID, gridKey, interactionPoint, layoutBounds, layoutExitAnchor, layoutExit } from './layout';

export const DINING_SECONDS = 6;

const round = (value: number): number => Math.round(value * 1e9) / 1e9;
interface Rules {
  stepSeconds: number;
  customerSpeed: number;
  tipForSeat(item:FurniturePlacement):number;
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
  let cachedLayout: SliceState['layout'], navigate: GridNavigator | undefined;
  let placed: FurniturePlacement[] = [], counters: FurniturePlacement[] = [], stablePorts: GridPoint[] = [];
  const failedPaths = new Set<string>();
  const baseDistances = new Map<string, number>();
  type Occupancy = { mask: GridBlockMask; key: string; has(key:string):boolean };
  type ReservationMemo = { nav: GridPoint[]|undefined; length:number; x0:number; x1:number; z0:number; z1:number; cells:Set<string> };
  const actorCache=new WeakMap<Customer,ReservationMemo>();
  let contextDirty=true,cellIndices=new Map<string,number>(),maskWidth=0,maskDepth=0,cellCount=0;
  let context:{parts:Set<string>[];counts:Uint16Array;bits:Uint16Array;skipped:WeakMap<Customer,Occupancy>}|undefined;
  function prepareLayout(): void {
    if (navigate && state.layout === cachedLayout) return;
    const layout = getLayout(state);
    cachedLayout = state.layout; navigate = createGridNavigator(layout);
    placed = layout.furniture.filter(item => !item.stored); counters = placed.filter(item => item.kind === 'counter');
    stablePorts = [layout.version === 2 ? { x: -7, z: 6 } : layoutExitAnchor(layout), ...placed.map(item => interactionPoint(item, item.kind === 'counter' ? 'service' : 'seat'))];
    failedPaths.clear(); baseDistances.clear();
    const bounds=layoutBounds(layout);maskWidth=bounds.width;maskDepth=bounds.depth;cellIndices=new Map();cellCount=0;
    for(let z=bounds.minZ;z<=bounds.maxZ;z++)for(let x=bounds.minX-1;x<=bounds.maxX+1;x++)cellIndices.set(`${x},${z}`,cellCount++);
    context=undefined;contextDirty=true;
  }
  const furniture = () => { prepareLayout(); return placed; };
  const placedCounters = () => { prepareLayout(); return counters; };
  const at = (a: GridPoint, b: GridPoint): boolean => Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.z - b.z) < 1e-8;
  const unpaid = (customer: Customer): boolean => ['entering', 'queue', 'serving', 'receiving'].includes(customer.phase);
  function reservations(actor:Customer):Set<string>{
    const x0=Math.floor(actor.x+1e-8),x1=Math.ceil(actor.x-1e-8),z0=Math.floor(actor.z+1e-8),z1=Math.ceil(actor.z-1e-8),length=actor.nav?.length??0,prior=actorCache.get(actor);
    // Nav mutates only by shift; a new route replaces the array. Between grid
    // boundaries these reserved cells do not change, even while meshes move.
    if(prior&&prior.nav===actor.nav&&prior.length===length&&prior.x0===x0&&prior.x1===x1&&prior.z0===z0&&prior.z1===z1)return prior.cells;
    const cells=actorReservations(actor);actorCache.set(actor,{nav:actor.nav,length,x0,x1,z0,z1,cells});return cells;
  }
  function occupied(skip: Customer): Occupancy {
    prepareLayout();
    if(contextDirty||!context){
      const parts=state.customers.map(reservations);
      if(!context||context.parts.length!==parts.length||parts.some((part,i)=>part!==context!.parts[i])){
        const counts=new Uint16Array(cellCount),bits=new Uint16Array(Math.ceil(cellCount/16));
        for(const part of parts)for(const key of part){const id=cellIndices.get(key);if(id!==undefined){counts[id]++;bits[id>>4]|=1<<(id&15);}}
        context={parts,counts,bits,skipped:new WeakMap()};
      }
      contextDirty=false;
    }
    const cached=context.skipped.get(skip);if(cached)return cached;
    const bits=context.bits.slice(),indices=cellIndices;
    for(const key of reservations(skip)){const id=indices.get(key);if(id!==undefined&&context.counts[id]===1)bits[id>>4]&=~(1<<(id&15));}
    const value:Occupancy={mask:{kind:'grid-mask',width:maskWidth,depth:maskDepth,bits},key:String.fromCharCode(...bits),has(key){const id=indices.get(key);return id!==undefined&&!!(bits[id>>4]&(1<<(id&15)));}};
    context.skipped.set(skip,value);return value;
  }
  function path(actor: Customer, target: GridPoint): GridPoint[] | null {
    const start = { x: Math.max(GRID.minX, Math.round(actor.x)), z: Math.round(actor.z) };
    prepareLayout();
    const blocked = occupied(actor);
    if (blocked.has(gridKey(start)) || blocked.has(gridKey(target))) return null;
    const key = `${gridKey(start)}>${gridKey(target)}:${blocked.key}`;
    if (failedPaths.has(key)) return null;
    const result = navigate!(start, target, blocked.mask);
    if (!result) { if (failedPaths.size >= 1024) failedPaths.clear(); failedPaths.add(key); }
    if (!result) return null;
    const baseKey = `${gridKey(start)}>${gridKey(target)}`;
    if (!baseDistances.has(baseKey)) {
      // Compare against a route that already avoids every stationary service,
      // seat and exit port. A real station detour must never become an
      // artificial waiting condition; only transient moving routes may wait.
      const stableBlocked = new Set(stablePorts.filter(point => !at(point, start) && !at(point, target)).map(gridKey));
      baseDistances.set(baseKey, navigate!(start, target, stableBlocked)?.length ?? Infinity);
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
    state.customers.push(customer); contextDirty=true; rules.traceCustomer('spawn', customer); rules.emit('arrived', { counterId: counter.id }); return true;
  }
  function advanceCustomers(): void {
    contextDirty=true;
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
          const tip=customer.tipDue??0;delete customer.tipDue;delete customer.seatId; customer.phase = 'leaving'; customer.timer = 0;
          if(tip){state.wallet+=tip;state.totalEarned+=tip;rules.emit('tipped',{amount:tip});} rules.traceCustomer('phase', customer);
        }
      }
    }
  }
  function customerRoute(customer: Customer): GridPoint[] | null {
    if (customer.phase === 'entering') {
      const counters = placedCounters(), preferred = counters.findIndex(item => item.counterId === customer.counterId);
      const routeTo = (item: FurniturePlacement): GridPoint[] | null => {
        const target = interactionPoint(item, 'service');
        if (state.customers.some(other => other !== customer &&
          (at(other, target) || other.counterId === item.counterId && unpaid(other)))) return null;
        return path(customer, target);
      };
      // Arrival's round-robin assignment is only provisional. A paid guest or
      // another walking route can still block that counter while another is free.
      // Choose and reserve together, after departures have had their routing turn.
      // Once inside/on a route, keep the assignment and every in-flight order.
      if (preferred >= 0 && at(customer, { x: -8, z: 5 }) && !customer.nav) {
        for (let offset = 0; offset < counters.length; offset++) {
          const item = counters[(preferred + offset) % counters.length];
          const counter = state.counters.find(counter => counter.id === item.counterId)!;
          if (!rules.canStart(counter)) continue;
          const route = routeTo(item);
          if (route === null) continue;
          if (customer.counterId !== counter.id) { customer.counterId = counter.id; rules.traceCustomer('phase', customer); }
          return route;
        }
      }
      // If stock ran out after arrival, retain the old route so the unstarted
      // guest can leave normally at the counter; closing/edit-drain cannot strand it.
      return preferred < 0 ? null : routeTo(counters[preferred]);
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
    contextDirty=true;
    delete customer.nav;
    if (customer.phase === 'entering') customer.phase = 'queue';
    else if (customer.phase === 'seeking-seat'){customer.phase = 'dining';const table=furniture().find(item=>item.id===customer.seatId)!;customer.tipDue=rules.tipForSeat(table);}
    else if (customer.phase === 'leaving') {
      state.customers = state.customers.filter(other => other !== customer);
      rules.traceCustomer('despawn', customer); return;
    }
    customer.timer = 0; rules.traceCustomer('phase', customer);
  }
  function advanceMovement(): void {
    contextDirty=true;
    const tryCustomer = (): void => {
      const candidates = state.customers.filter(customer => !customer.nav && ['entering', 'seeking-seat', 'leaving'].includes(customer.phase)).sort((a, b) => (a.phase === 'entering' ? 1 : 0) - (b.phase === 'entering' ? 1 : 0) || a.id - b.id);
      for (const customer of candidates) {
        const route = customerRoute(customer);
        if (route?.length) { customer.nav = route; contextDirty=true; }
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
