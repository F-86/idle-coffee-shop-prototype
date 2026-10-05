import { canBrew, consumeIngredients, createInitialIngredients, purchaseIngredient, quoteIngredient, validateIngredients } from './ingredients';
import { copyLayout, initialLayout, layoutCost, normalizeLayout, validateLayout, migrateLayoutDoors } from './layout';
import { createLayoutSimulation } from './layoutSimulation';
import type { RouteObserver, RouteTraceEvent } from './routeTrace';
import type { Counter, CounterId, CounterQuote, CoffeeQuote, Customer, OfflineJob, OfflinePolicyVersion, Recipe, RecipeId, SliceEngine, SliceEvent, SliceState } from './types';

/** Draft balance for this small playable slice, expressed in cents and metres. */
export const STEP_SECONDS = .05;
export const MAX_LEVEL = 20;
export const ECONOMY_VERSION = 5;
/** Temporary feature values, not a settled balance design. */
export const COFFEE_UPGRADE_CONFIG = Object.freeze({
  maxLevel: 10, pricePerLevel: .08, speedPerLevel: .025, costGrowth: 1.55,
  baseCosts: Object.freeze({ espresso: 1200, latte: 2000 })
});
export const COFFEE_MAX_LEVEL = COFFEE_UPGRADE_CONFIG.maxLevel;
export const INITIAL_WALLET = 1200;
export const QUEUE_CAPACITY = 8;
export const INVITE_COOLDOWN_SECONDS = 18;
export const OFFLINE_EFFICIENCY = .8;
export const LEGACY_OFFLINE_CAP_SECONDS = 7200;
/** Existing save-schema precision limit, not an offline gameplay cap. */
export const MAX_ELAPSED_SECONDS = 4e9;
export function offlineWallSeconds(seconds: number, policy: OfflinePolicyVersion = 4): number {
  if (!Number.isFinite(seconds) || seconds < 0 || policy === 1 && seconds < 30) return 0;
  return policy >= 3 ? seconds : Math.min(LEGACY_OFFLINE_CAP_SECONDS, seconds);
}
/** Uniform 80% for new intervals; old outstanding intervals retain their own rules once. */
export function offlineEffectiveSeconds(seconds: number, policy: OfflinePolicyVersion = 4): number {
  return offlineWallSeconds(seconds, policy) * (policy >= 3 ? OFFLINE_EFFICIENCY : .5);
}
export const MANAGER_ROUTE_VERSION = 2;
export const CUSTOMER_ROUTE_VERSION = 4;
export const CUSTOMER_SPEED = 2.5;
/** Compatibility coordinates for already-moving pre-layout guests only. */
export const WORLD = Object.freeze({ entryX: -8, entryZ: 5, inboundX: -6, inboundZ: 8.2, departureOffsetX: 1.6, exitZ: 7.4, exitX: -10.4, serviceZ: 1.5, queueGap: .72, backZ: -1.7, vaultX: 8.8 });
export const recipes: readonly Recipe[] = Object.freeze([
  Object.freeze({ id: 'espresso', name: '浓缩咖啡', price: 110, brewSeconds: 3.6, color: '#a7693d', description: '出杯快、单价低，适合长队。' }),
  Object.freeze({ id: 'latte', name: '拿铁', price: 220, brewSeconds: 6.8, color: '#f0c793', description: '制作较慢、每杯收入更高。' })
]);
export const recipeById = Object.freeze(Object.fromEntries(recipes.map(recipe => [recipe.id, recipe])) as Record<RecipeId, Recipe>);
export const counterAffinities = Object.freeze({ 'counter-a': '浓缩制作时间 −25%', 'counter-b': '拿铁杯价 +12%', 'counter-c': '通用柜台', 'counter-d': '通用柜台' });
export const coffeePrice = (recipe: RecipeId, level = 1): number => Math.round(recipeById[recipe].price * (1 + COFFEE_UPGRADE_CONFIG.pricePerLevel * (level - 1)));
export const coffeeBrewSeconds = (recipe: RecipeId, level = 1): number => recipeById[recipe].brewSeconds / (1 + COFFEE_UPGRADE_CONFIG.speedPerLevel * (level - 1));
export const counterPrice = (recipe: RecipeId, level: number, id?: CounterId, coffeeLevel = 1): number => Math.round(coffeePrice(recipe, coffeeLevel) * (1 + .12 * (level - 1)) * (id === 'counter-b' && recipe === 'latte' ? 1.12 : 1));
export const counterBrewSeconds = (recipe: RecipeId, level: number, id?: CounterId, coffeeLevel = 1): number => coffeeBrewSeconds(recipe, coffeeLevel) / (1 + .045 * (level - 1)) * (id === 'counter-a' && recipe === 'espresso' ? .75 : 1);
export const managerSpeed = (level: number): number => 2.6 + .18 * (level - 1);
export const managerCapacity = (level: number): number => 1200 + 180 * (level - 1);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const roundTime = (value: number): number => Math.round(value * 1e9) / 1e9;

/** Versioned one-time transfer: legacy receipts were already minted in totalEarned. */
export function migrateCoffeeEconomy(state: SliceState): void {
  const version = (state as { economyVersion: number }).economyVersion;
  if (![1, 2, 3, 4, ECONOMY_VERSION].includes(version)) throw new Error('Unsupported economy version.');
  if (state.layout !== undefined && (!state.layout || typeof state.layout !== 'object' || Array.isArray(state.layout))) throw new Error('Invalid layout.');
  if (version < 3 && state.layout?.active) throw new Error('Legacy economy cannot contain an active layout.');
  if (version >= 3 && state.layout === undefined) throw new Error('Current economy requires explicit layout.');
  if (version < 4 && state.layout?.version === 3) throw new Error('Legacy economy cannot contain current layout.');
  if (version === 1) {
    if (state.coffeeLevels !== undefined) throw new Error('Legacy economy cannot contain coffee levels.');
    state.coffeeLevels = { espresso: 1, latte: 1 };
  }
  const levels = state.coffeeLevels;
  if (!levels || typeof levels !== 'object' || Array.isArray(levels) || Object.keys(levels).sort().join() !== 'espresso,latte' ||
    recipes.some(recipe => !Number.isInteger(levels[recipe.id]) || levels[recipe.id] < 1 || levels[recipe.id] > COFFEE_MAX_LEVEL)) throw new Error('Invalid coffee levels.');
  if (version === ECONOMY_VERSION) {
    if (!validateIngredients(state.ingredients)) throw new Error('Invalid ingredient inventory.');
  } else {
    if (state.ingredients !== undefined) throw new Error('Legacy economy cannot contain ingredient inventory.');
    state.ingredients = createInitialIngredients();
  }
  if (version >= 4) {
    if (state.manager.carrying || state.counters.some(counter => counter.pendingCash)) throw new Error('Retired cash balances must be zero.');
    state.economyVersion = ECONOMY_VERSION;
    return;
  }
  if (state.layout === undefined) state.layout = { ...initialLayout(), version: 2, active: false };
  state.layout = normalizeLayout(state.layout);
  for (const sign of state.layout.coffeeSigns) sign.stored = true;
  const receipts = state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
  if (!Number.isSafeInteger(receipts) || receipts < 0 || !Number.isSafeInteger(state.wallet + receipts)) throw new Error('Invalid transferred receipts.');
  state.wallet += receipts;
  for (const counter of state.counters) counter.pendingCash = 0;
  // Tombstone keeps historical upgrade investment without a live actor or action.
  state.manager = { x: WORLD.vaultX, z: WORLD.backZ, carrying: 0, phase: 'moving', target: state.counters.length, timer: 0, level: state.manager.level };
  state.managerRouteVersion = MANAGER_ROUTE_VERSION;
  state.economyVersion = ECONOMY_VERSION;
}

/** Pre-v2 in-flight customers finish their visible leg once; v2 paths extend in place.
 * Coordinates, brew snapshots and assets never change during migration. */
export function migrateCustomerRoutes(state: SliceState): void {
  if (state.customerRouteVersion === CUSTOMER_ROUTE_VERSION || state.customerRouteVersion === 3) return;
  if (state.customerRouteVersion !== undefined && state.customerRouteVersion !== 1 && state.customerRouteVersion !== 2) throw new Error('Unsupported customer route version.');
  if (state.customerRouteVersion !== 2) {
    for (const customer of state.customers) {
      if (customer.phase === 'entering' || customer.phase === 'leaving') customer.finishLegacyRoute = true;
    }
  }
  state.customerRouteVersion = 3;
}

export function createInitialState(): SliceState {
  return {
    schemaVersion: 1, economyVersion: ECONOMY_VERSION, ingredients: createInitialIngredients(), layout: initialLayout(), coffeeLevels: { espresso: 1, latte: 1 }, managerRouteVersion: MANAGER_ROUTE_VERSION, customerRouteVersion: CUSTOMER_ROUTE_VERSION, elapsed: 0, wallet: INITIAL_WALLET,
    totalEarned: 0, totalServed: 0, spend: 0, nextCustomerId: 1,
    arrivalTimer: 0, inviteCooldown: 0, paused: false, stepCarry: 0, eventSequence: 0, offlineClaimIds: [],
    counters: [
      { id: 'counter-a', x: 0, level: 1, recipe: 'espresso', pendingCash: 0, brewed: 0, brew: null },
      { id: 'counter-b', x: 5, level: 1, recipe: 'latte', pendingCash: 0, brewed: 0, brew: null }
    ],
    customers: [], manager: { x: WORLD.vaultX, z: WORLD.backZ, carrying: 0, phase: 'moving', target: 2, timer: 0, level: 1 },
    lastOfflineClaimId: null
  };
}

export function createEngine(initial: SliceState = createInitialState(), observeRoute?: RouteObserver): SliceEngine {
  const state = clone(initial);
  migrateCoffeeEconomy(state);
  state.layout = normalizeLayout(state.layout);
  migrateCustomerRoutes(state);
  if (state.customerRouteVersion !== CUSTOMER_ROUTE_VERSION) migrateLayoutDoors(state);
  state.stepCarry ??= 0;
  state.eventSequence ??= 0;
  state.offlineClaimIds ??= state.lastOfflineClaimId ? [state.lastOfflineClaimId] : [];
  let events: SliceEvent[] = [];
  let silent = false;
  let legacyOfflineIngredients = false;
  let activeOffline = false;
  let editing: 'idle' | 'draining' | 'ready' = 'idle';
  const activeLayout = () => !!state.layout?.active;
  const counterDrained = (counter: Counter): boolean => !counter.brew;
  const layoutSimulation = createLayoutSimulation(state, { emit, traceCustomer, canStart: counter => legacyOfflineIngredients || canBrew(state, counter.recipe), startBrew, stepSeconds: STEP_SECONDS, customerSpeed: CUSTOMER_SPEED });
  function startBrew(counter: Counter, customer: Customer): boolean {
    if (counter.brew || !legacyOfflineIngredients && !consumeIngredients(state, counter.recipe)) return false;
    counter.brew = { recipe: counter.recipe, customerId: customer.id, elapsed: 0, duration: counterBrewSeconds(counter.recipe, counter.level, counter.id, state.coffeeLevels[counter.recipe]), price: counterPrice(counter.recipe, counter.level, counter.id, state.coffeeLevels[counter.recipe]) };
    return true;
  }
  function trace(event: Omit<RouteTraceEvent, 'time'>): void {
    if (!observeRoute || silent) return;
    // The observer receives detached scalar data and cannot break the simulation.
    try { observeRoute({ time: state.elapsed, ...event }); } catch { /* QA is non-authoritative. */ }
  }
  function traceCustomer(kind: RouteTraceEvent['kind'], customer: Customer, extra: Partial<RouteTraceEvent> = {}): void {
    if (!observeRoute || silent) return;
    trace({ actor: 'customer', kind, customerId: customer.id, counterId: customer.counterId,
      x: customer.x, z: customer.z, phase: customer.phase, routeLeg: customer.routeLeg,
      legacy: !!customer.finishLegacyRoute, hasCup: customer.hasCup, ...extra });
  }
  function emit(type: SliceEvent['type'], payload: Omit<Partial<SliceEvent>, 'id' | 'type'> = {}): void {
    state.eventSequence = (state.eventSequence ?? 0) + 1;
    if (silent) return;
    events.push({ id: state.eventSequence, type, ...payload });
    // Render notifications are transient; simulation and event IDs are persisted.
    if (events.length > 512) events.shift();
  }
  const findCounter = (id: CounterId): Counter | undefined => state.counters.find(counter => counter.id === id);
  const lane = (counterId: CounterId): Customer[] => {
    const x = findCounter(counterId)!.x;
    const priority = (customer: Customer): number => ['serving', 'receiving'].includes(customer.phase) ? -1 : customer.x === x ? 0 : 1;
    // Accepted pre-grid archives can contain a younger guest already ahead of an
    // older arrival. Drain in physical order so neither must walk through the
    // other to honor an obsolete ID queue. Existing paid/brewing orders stay first.
    return state.customers.filter(customer => customer.counterId === counterId && customer.phase !== 'leaving')
      .sort((a, b) => priority(a) - priority(b) || (priority(a) === 0 ? a.z - b.z : 0) || a.id - b.id);
  };
  function arrive(): boolean {
    if (editing !== 'idle' || state.paused || state.customerRouteVersion !== CUSTOMER_ROUTE_VERSION) return false;
    return layoutSimulation.arrive();
  }
  // The parallel return lane crosses only the three short inbound feeders and
  // the two local departure merges. A customer already inside a junction clears
  // first; otherwise the horizontal return has priority. Reservations follow
  // physical coordinates, so a saved/reloaded tick needs no hidden traffic state.
  const junctionXs = [WORLD.inboundX, ...state.counters.flatMap(counter => [counter.x, counter.x + WORLD.departureOffsetX])];
  function junctionBlocked(customer: Customer, nextX: number, nextZ: number): boolean {
    const clearance = WORLD.queueGap, lookahead = clearance + CUSTOMER_SPEED * STEP_SECONDS;
    const returning = customer.phase === 'leaving' && customer.routeLeg === 2;
    for (const x of junctionXs) {
      if (returning) {
        if (customer.x < x - clearance || nextX > x + clearance) continue;
        if (state.customers.some(other => other !== customer && !other.finishLegacyRoute && other.x === x &&
          !(other.phase === 'leaving' && other.routeLeg === 2) && Math.abs(other.z - WORLD.exitZ) < clearance - 1e-9)) return true;
      } else if (customer.x === x && nextX === x) {
        // An established vertical occupant must be able to finish crossing even
        // when the horizontal line is waiting immediately outside its stop line.
        if (Math.abs(customer.z - WORLD.exitZ) < clearance - 1e-9) continue;
        if (Math.min(customer.z, nextZ) > WORLD.exitZ + clearance || Math.max(customer.z, nextZ) < WORLD.exitZ - clearance) continue;
        if (state.customers.some(other => other !== customer && !other.finishLegacyRoute && other.phase === 'leaving' && other.routeLeg === 2 &&
          other.x > x - clearance && other.x < x + lookahead)) return true;
      }
    }
    return false;
  }
  function move(customer: Customer, x: number, z: number, speed = CUSTOMER_SPEED): boolean {
    const dx = x - customer.x, dz = z - customer.z;
    // Most queued customers are already at their target. A no-op cannot reduce
    // clearance and should not run any traffic or pairwise distance work.
    if (dx === 0 && dz === 0) return true;
    const distance = Math.sqrt(dx * dx + dz * dz), step = speed * STEP_SECONDS;
    const reached = distance <= step + 1e-9;
    const nextX = reached ? x : customer.x + dx / distance * step;
    const nextZ = reached ? z : customer.z + dz / distance * step;
    if (!customer.finishLegacyRoute) {
      if (junctionBlocked(customer, nextX, nextZ)) return false;
      // Preserve body clearance at turns, shared-lane following and merges too.
      // Checking the proposed point prevents fast upgrades and invite batches
      // from overlapping when a preceding customer is waiting at a crossing.
      const gap = WORLD.queueGap - 1e-9, gapSquared = gap * gap;
      for (const other of state.customers) {
        if (other === customer || other.finishLegacyRoute) continue;
        const nextDx = nextX - other.x;
        if (nextDx <= -gap || nextDx >= gap) continue;
        const nextDz = nextZ - other.z;
        if (nextDz <= -gap || nextDz >= gap) continue;
        const nextDistanceSquared = nextDx * nextDx + nextDz * nextDz;
        if (nextDistanceSquared >= gapSquared) continue;
        // Only genuinely close pairs need the current-distance comparison.
        // Valid v2 turns separate continuously without teleporting or freezing.
        const currentDx = customer.x - other.x, currentDz = customer.z - other.z;
        if (nextDistanceSquared <= currentDx * currentDx + currentDz * currentDz + 1e-12) return false;
      }
    }
    const previousX = customer.x, previousZ = customer.z;
    customer.x = nextX; customer.z = nextZ;
    if (observeRoute && !silent && !customer.finishLegacyRoute) {
      // Half-open segments count a reached centreline once, including an exact endpoint.
      const crosses = (from: number, to: number, line: number): boolean =>
        from < line && to >= line || from > line && to <= line;
      for (const crossingX of junctionXs) {
        const horizontal = previousZ === WORLD.exitZ && nextZ === WORLD.exitZ && crosses(previousX, nextX, crossingX);
        const vertical = previousX === crossingX && nextX === crossingX && crosses(previousZ, nextZ, WORLD.exitZ);
        if (horizontal || vertical) traceCustomer('crossing', customer, { crossingX });
      }
    }
    return reached;
  }
  function advanceCustomers(): void {
    for (const counter of state.counters) {
      const queue = lane(counter.id);
      for (let i = 0; i < queue.length; i++) {
        const customer = queue[i];
        if (customer.phase === 'entering' || customer.phase === 'queue') {
          let targetZ = WORLD.serviceZ + i * WORLD.queueGap;
          const previous = queue[i - 1];
          if (previous && previous.x === counter.x) targetZ = Math.max(targetZ, previous.z + WORLD.queueGap);
          // Do not reverse out into the cross-aisle when a preceding customer
          // is still turning into this lane. Wait, then follow at queue spacing.
          if (customer.x === counter.x) targetZ = Math.min(targetZ, customer.z);
          const clearingService = i === 0 && state.customers.some(departing => departing.counterId === counter.id && departing.phase === 'leaving' && !departing.finishLegacyRoute && departing.routeLeg === 0 && departing.x - counter.x < WORLD.queueGap);
          let reached = false;
          if (customer.phase === 'entering' && !customer.finishLegacyRoute && customer.routeLeg !== 3) {
            // The inbound cross-aisle runs parallel to the return lane.
            // Its short vertical feeders use the junction right-of-way above.
            if (customer.routeLeg === 0 && move(customer, WORLD.inboundX, WORLD.entryZ)) { customer.routeLeg = 1; traceCustomer('phase', customer); }
            else if (customer.routeLeg === 1 && move(customer, WORLD.inboundX, WORLD.inboundZ)) { customer.routeLeg = 2; traceCustomer('phase', customer); }
            else if (customer.routeLeg === 2 && move(customer, counter.x, WORLD.inboundZ)) { customer.routeLeg = 3; traceCustomer('phase', customer); }
          } else if (!clearingService) reached = move(customer, counter.x, targetZ);
          if (customer.phase === 'entering' && reached) {
            customer.phase = 'queue'; delete customer.routeLeg; delete customer.finishLegacyRoute;
            traceCustomer('phase', customer);
          }
          if (i === 0 && customer.phase === 'queue' && reached && customer.z === WORLD.serviceZ && !counter.brew) {
            customer.timer = 0;
            if (startBrew(counter, customer)) customer.phase = 'serving';
            else { customer.phase = 'leaving'; customer.routeLeg = 0; customer.departureReason = 'stockout'; }
            traceCustomer('phase', customer);
          }
        } else if (customer.phase === 'receiving') {
          customer.timer = roundTime(customer.timer + STEP_SECONDS);
          if (customer.timer >= .7 && counter.brew?.customerId === customer.id) {
            const price = counter.brew.price;
            state.wallet += price; state.totalEarned += price; state.totalServed++;
            counter.brew = null; customer.phase = 'leaving'; customer.timer = 0; customer.routeLeg = 0;
            traceCustomer('phase', customer);
            emit('served', { counterId: counter.id, amount: price });
          }
        }
      }
    }
    for (const customer of state.customers) {
      if (customer.phase !== 'leaving') continue;
      const counter = findCounter(customer.counterId)!;
      if (customer.finishLegacyRoute) {
        // Bound the compatibility exception to customers already leaving in an
        // old archive. Finishing it keeps their cup and saved position intact.
        if (customer.timer === 0 && move(customer, counter.x + 1.25, WORLD.serviceZ + .15)) customer.timer = 1;
        else if (customer.timer === 1 && move(customer, counter.x + 1.25, WORLD.entryZ)) customer.timer = 2;
        else if (customer.timer === 2 && move(customer, WORLD.entryX, WORLD.entryZ)) customer.timer = 3;
      } else {
        // Clear the service point on its outer side, join the parallel
        // return lane, then walk beyond the entrance-side world boundary.
        const exitX = counter.x + WORLD.departureOffsetX;
        if (customer.routeLeg === 0 && move(customer, exitX, WORLD.serviceZ)) { customer.routeLeg = 1; traceCustomer('phase', customer); }
        else if (customer.routeLeg === 1 && move(customer, exitX, WORLD.exitZ)) { customer.routeLeg = 2; traceCustomer('phase', customer); }
        else if (customer.routeLeg === 2 && move(customer, WORLD.exitX, WORLD.exitZ)) { customer.routeLeg = 3; traceCustomer('phase', customer); }
      }
    }
    state.customers = state.customers.filter(customer => {
      const removed = customer.phase === 'leaving' && (customer.finishLegacyRoute ? customer.timer === 3 : customer.routeLeg === 3);
      if (removed) traceCustomer('despawn', customer);
      return !removed;
    });
  }

  function advanceBrews(): void {
    for (const counter of state.counters) {
      const brew = counter.brew;
      if (!brew) continue;
      const customer = state.customers.find(customer => customer.id === brew.customerId);
      if (!customer || customer.phase !== 'serving') continue;
      brew.elapsed = Math.min(brew.duration, roundTime(brew.elapsed + STEP_SECONDS));
      if (brew.elapsed + 1e-9 >= brew.duration) {
        counter.brewed++; customer.phase = 'receiving'; customer.timer = 0; customer.hasCup = true;
        traceCustomer('phase', customer);
        emit('brewed', { counterId: counter.id });
      }
    }
  }
  function tick(): void {
    state.elapsed = Math.round((state.elapsed + STEP_SECONDS) / STEP_SECONDS) * STEP_SECONDS;
    state.elapsed = roundTime(state.elapsed);
    state.inviteCooldown = Math.max(0, roundTime(state.inviteCooldown - STEP_SECONDS));
    if (!state.paused) state.arrivalTimer = roundTime(state.arrivalTimer + STEP_SECONDS);
    // Deterministic small cadence variation; no wall clock or Math.random.
    const interval = 2.4 + (state.nextCustomerId % 3) * .15;
    if (!state.paused && state.arrivalTimer + 1e-9 >= interval) { state.arrivalTimer = roundTime(state.arrivalTimer - interval); arrive(); }
    if (activeLayout()) { layoutSimulation.advanceCustomers(); advanceBrews(); layoutSimulation.advanceMovement(); }
    else { advanceCustomers(); advanceBrews(); }
    if (state.customerRouteVersion !== CUSTOMER_ROUTE_VERSION) migrateLayoutDoors(state);
    if (editing === 'draining' && !state.customers.length && state.counters.every(counterDrained)) editing = 'ready';
  }
  function advance(seconds: number, beforeLastStep?: (state: Readonly<SliceState>) => void): void {
    if (activeOffline || editing === 'ready' || state.paused && !state.customers.length && state.counters.every(counterDrained) || !Number.isFinite(seconds) || seconds <= 0) return;
    // Keep fractional frames instead of rounding each incoming delta. Rounding
    // 1/60 per call, for example, would drift relative to one whole second.
    const total = (state.stepCarry ?? 0) + seconds;
    const steps = Math.floor((total + 1e-12) / STEP_SECONDS);
    const carry = total - steps * STEP_SECONDS;
    state.stepCarry = Math.abs(carry) < 1e-12 ? 0 : Math.max(0, carry);
    for (let i = 0; i < steps; i++) {
      // Optional read-only presentation seam; offline/core callers pay no snapshot cost.
      if (i === steps - 1 || state.paused) beforeLastStep?.(state);
      tick();
      if ((editing as string) === 'ready' || state.paused && !state.customers.length && state.counters.every(counterDrained)) { state.stepCarry = 0; break; }
    }
  }
  function quote(id: CounterId): CounterQuote {
    const counter = findCounter(id);
    if (!counter) return { cost: 0, beforePrice: 0, afterPrice: 0, beforeSeconds: 0, afterSeconds: 0, paybackSeconds: 0, capped: true };
    const capped = counter.level >= MAX_LEVEL, nextLevel = Math.min(MAX_LEVEL, counter.level + 1);
    const cost = capped ? 0 : Math.round(800 * 1.16 ** (counter.level - 1));
    const beforePrice = counterPrice(counter.recipe, counter.level, counter.id, state.coffeeLevels[counter.recipe]), afterPrice = counterPrice(counter.recipe, nextLevel, counter.id, state.coffeeLevels[counter.recipe]);
    const beforeSeconds = counterBrewSeconds(counter.recipe, counter.level, counter.id, state.coffeeLevels[counter.recipe]), afterSeconds = counterBrewSeconds(counter.recipe, nextLevel, counter.id, state.coffeeLevels[counter.recipe]);
    // Departure starts on the payment tick. Later guests wait the remaining
    // fixed steps needed for one queue-gap of sideways clearance.
    const clearanceSeconds = (Math.ceil(WORLD.queueGap / (CUSTOMER_SPEED * STEP_SECONDS)) - 1) * STEP_SECONDS;
    const turnoverSeconds = .7 + WORLD.queueGap / CUSTOMER_SPEED + clearanceSeconds;
    const incremental = afterPrice / (afterSeconds + turnoverSeconds) - beforePrice / (beforeSeconds + turnoverSeconds);
    return { cost, beforePrice, afterPrice, beforeSeconds, afterSeconds, paybackSeconds: capped ? 0 : cost / Math.max(.001, incremental), capped };
  }
  function coffeeQuote(recipe: RecipeId): CoffeeQuote {
    if (!Object.hasOwn(recipeById, recipe)) return { level: 0, nextLevel: 0, cost: 0, beforePrice: 0, afterPrice: 0, beforeSeconds: 0, afterSeconds: 0, capped: true };
    const level = state.coffeeLevels[recipe], capped = level >= COFFEE_MAX_LEVEL, nextLevel = Math.min(COFFEE_MAX_LEVEL, level + 1);
    return { level, nextLevel, capped,
      cost: capped ? 0 : Math.round(COFFEE_UPGRADE_CONFIG.baseCosts[recipe] * COFFEE_UPGRADE_CONFIG.costGrowth ** (level - 1)),
      beforePrice: coffeePrice(recipe, level), afterPrice: coffeePrice(recipe, nextLevel),
      beforeSeconds: coffeeBrewSeconds(recipe, level), afterSeconds: coffeeBrewSeconds(recipe, nextLevel)
    };
  }
  function managerQuote() { return { cost: 0, speed: 0, nextSpeed: 0, capped: true }; }
  return {
    get state() { return state; }, advance,
    ingredientQuote(id, mode) { return quoteIngredient(state, id, mode); },
    buyIngredient(id, mode) {
      if (activeOffline) return false;
      const offer = purchaseIngredient(state, id, mode);
      if (!offer) return false;
      emit('ingredients-purchased', { ingredientId: id, amount: offer.cost }); return true;
    },
    beginLayoutEdit() {
      if (activeOffline || editing !== 'idle' || !state.paused) return false;
      editing = 'draining';
      if (!state.customers.length && state.counters.every(counterDrained)) editing = 'ready';
      return true;
    },
    layoutEditStatus() { return editing; },
    createLayoutDraft() { return editing === 'ready' ? copyLayout(state) : null; },
    cancelLayoutEdit() { editing = 'idle'; },
    commitLayout(draft) {
      if (editing !== 'ready') return { ok: false, message: '请先暂停营业，等顾客离店后再装修。' };
      if (draft.version !== 3) return { ok: false, message: '请使用当前装修布局。' };
      const checked = validateLayout(draft); if (!checked.ok) return checked;
      const offer = layoutCost(state, draft); if (!offer.ok) return offer;
      const next = clone(draft); next.active = true; next.trafficTurn = 'customer';
      for (const item of next.furniture.filter(item => item.kind === 'counter')) {
        const counter = state.counters.find(counter => counter.id === item.counterId);
        if (counter) counter.x = item.x;
        else state.counters.push({ id: item.counterId!, x: item.x, level: 1, recipe: 'espresso', pendingCash: 0, brewed: 0, brew: null });
      }
      state.counters.sort((a, b) => a.id.localeCompare(b.id));
      state.wallet -= offer.cost!; state.spend += offer.cost!; state.layout = next;
      // Historical manager progression remains a stationary compatibility record.
      state.manager.target = state.counters.length; state.manager.phase = 'moving'; state.manager.timer = 0;
      delete state.manager.nav; delete state.manager.finishLegacySweep;
      editing = 'idle'; emit('layout-changed', { amount: offer.cost });
      return { ok: true, message: '装修已保存，点击恢复营业后再接待新顾客。', cost: offer.cost };
    },
    invite() {
      if (activeOffline || editing !== 'idle' || state.paused || state.inviteCooldown > 0) return false;
      let arrivals = 0;
      for (let i = 0; i < 3; i++) if (arrive()) arrivals++;
      if (!arrivals) return false;
      state.inviteCooldown = INVITE_COOLDOWN_SECONDS; emit('invited'); return true;
    },
    upgrade(id) {
      if (activeOffline || editing !== 'idle') return false;
      const counter = findCounter(id), offer = quote(id);
      if (!counter || offer.capped || state.wallet < offer.cost) return false;
      state.wallet -= offer.cost; state.spend += offer.cost; counter.level++;
      emit('upgraded', { counterId: id, amount: offer.cost }); return true;
    },
    upgradeCoffee(recipe) {
      if (activeOffline || editing !== 'idle') return false;
      const offer = coffeeQuote(recipe);
      if (offer.capped || state.wallet < offer.cost) return false;
      state.wallet -= offer.cost; state.spend += offer.cost; state.coffeeLevels[recipe]++;
      emit('coffee-upgraded', { recipeId: recipe, amount: offer.cost }); return true;
    },
    upgradeManager() { return false; },
    setRecipe(id, recipe) {
      if (activeOffline || editing !== 'idle') return false;
      const counter = findCounter(id);
      if (!counter || !Object.hasOwn(recipeById, recipe) || counter.recipe === recipe) return false;
      counter.recipe = recipe; emit('recipe-changed', { counterId: id }); return true;
    },
    togglePause() { if (!activeOffline && editing === 'idle') state.paused = !state.paused; }, quote, managerQuote, coffeeQuote,
    drainEvents() { const result = events; events = []; return result; },
    snapshot() {
      const snapshot = clone(state);
      // Canonical picosecond precision removes floating representation noise
      // without quantising every frame's fractional remainder.
      snapshot.stepCarry = Math.round((snapshot.stepCarry ?? 0) * 1e12) / 1e12;
      return snapshot;
    },
    beginOffline,
    applyOffline(seconds, claimId, policy = 4) {
      const job = beginOffline(seconds, claimId, policy);
      job.advance(Number.MAX_SAFE_INTEGER);
      return job.result();
    }
  };
  function beginOffline(seconds: number, claimId: string, policy: OfflinePolicyVersion = 4): OfflineJob {
    const effective = state.paused ? 0 : offlineEffectiveSeconds(seconds, policy);
    const valid = !activeOffline && editing === 'idle' && typeof claimId === 'string' && !!claimId && claimId.length <= 256 && claimId !== state.lastOfflineClaimId && !state.offlineClaimIds!.includes(claimId) && Number.isFinite(seconds) && seconds >= 0 && [1, 2, 3, 4].includes(policy) && effective + state.elapsed <= MAX_ELAPSED_SECONDS;
    const total = (state.stepCarry ?? 0) + effective;
    const steps = valid && !state.paused ? Math.floor((total + 1e-12) / STEP_SECONDS) : 0;
    const carry = total - steps * STEP_SECONDS;
    let completed = 0, done = !valid;
    if (valid) activeOffline = true;
    const beforeWallet = state.wallet, beforeEarned = state.totalEarned;
    function finish() {
      if (done) return;
      if (!state.paused) state.stepCarry = Math.abs(carry) < 1e-12 ? 0 : Math.max(0, carry);
      state.lastOfflineClaimId = claimId;
      state.offlineClaimIds!.push(claimId);
      if (state.offlineClaimIds!.length > 256) state.offlineClaimIds!.shift();
      done = true; activeOffline = false;
    }
    if (valid && !steps) finish();
    return {
      get accepted() { return valid; }, get done() { return done; },
      get totalSeconds() { return effective; },
      get completedSeconds() { return done ? effective : completed * STEP_SECONDS; },
      advance(maxSteps) {
        if (done || !Number.isSafeInteger(maxSteps) || maxSteps <= 0) return;
        const end = Math.min(steps, completed + maxSteps);
        silent = true; legacyOfflineIngredients = policy < 4;
        try { while (completed < end) { tick(); completed++; } } finally { silent = false; legacyOfflineIngredients = false; }
        if (completed === steps) finish();
      },
      result() {
        if (!valid || !done) return { accepted: false, amount: 0, seconds: 0 };
        return { accepted: true, amount: state.wallet - beforeWallet, seconds: offlineWallSeconds(seconds, policy), effectiveSeconds: effective, awaySeconds: seconds, policyVersion: policy, generatedAmount: state.totalEarned - beforeEarned, pendingCash: state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), carrying: state.manager.carrying, stockout: state.layout!.furniture.some(item => item.kind === 'counter' && !item.stored && !canBrew(state, findCounter(item.counterId!)!.recipe)) };
      }
    };
  }
}
