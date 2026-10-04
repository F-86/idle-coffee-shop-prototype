import type { Counter, CounterId, CounterQuote, Customer, Recipe, RecipeId, SliceEngine, SliceEvent, SliceState } from './types';

/** Draft balance for this small playable slice, expressed in cents and metres. */
export const STEP_SECONDS = .05;
export const MAX_LEVEL = 20;
export const INITIAL_WALLET = 1200;
export const QUEUE_CAPACITY = 8;
export const INVITE_COOLDOWN_SECONDS = 18;
export const OFFLINE_CAP_SECONDS = 7200;
export const OFFLINE_EFFICIENCY = .5;
export const MANAGER_ROUTE_VERSION = 2;
export const WORLD = Object.freeze({ entryX: -8, entryZ: 5, serviceZ: 1.5, queueGap: .72, backZ: -1.7, vaultX: 8.8 });
export const recipes: readonly Recipe[] = Object.freeze([
  Object.freeze({ id: 'espresso', name: '浓缩咖啡', price: 110, brewSeconds: 3.6, color: '#a7693d', description: '出杯快、单价低，适合长队。' }),
  Object.freeze({ id: 'latte', name: '拿铁', price: 220, brewSeconds: 6.8, color: '#f0c793', description: '制作较慢、每杯收入更高。' })
]);
export const recipeById = Object.freeze(Object.fromEntries(recipes.map(recipe => [recipe.id, recipe])) as Record<RecipeId, Recipe>);
export const counterAffinities = Object.freeze({ 'counter-a': '浓缩制作时间 −25%', 'counter-b': '拿铁杯价 +12%' });
export const counterPrice = (recipe: RecipeId, level: number, id?: CounterId): number => Math.round(recipeById[recipe].price * (1 + .12 * (level - 1)) * (id === 'counter-b' && recipe === 'latte' ? 1.12 : 1));
export const counterBrewSeconds = (recipe: RecipeId, level: number, id?: CounterId): number => recipeById[recipe].brewSeconds / (1 + .045 * (level - 1)) * (id === 'counter-a' && recipe === 'espresso' ? .75 : 1);
export const managerSpeed = (level: number): number => 2.6 + .18 * (level - 1);
export const managerCapacity = (level: number): number => 1200 + 180 * (level - 1);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const roundTime = (value: number): number => Math.round(value * 1e9) / 1e9;

/** Narrow route migration, not an economy/schema migration. External states must be validated first. */
export function migrateManagerRoute(state: SliceState): void {
  if (state.managerRouteVersion === MANAGER_ROUTE_VERSION) return;
  if (state.managerRouteVersion !== undefined && state.managerRouteVersion !== 1) throw new Error('Unsupported manager route version.');
  const manager = state.manager;
  const freshDeparture = manager.phase === 'moving' && manager.target === 0 && manager.x === -8 && manager.timer === 0 && manager.carrying === 0;
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  // Match the previous visible leg progress once. Thereafter x is the actual
  // world coordinate, including throughout a still-in-flight legacy sweep.
  if (manager.target === 0) manager.x = WORLD.vaultX * (1 - clamp((manager.x + 8) / 8));
  else if (manager.target === 1) manager.x = Math.max(0, Math.min(5, manager.x));
  else manager.x = 5 + (WORLD.vaultX - 5) * (1 - clamp((manager.x + 8) / 13));
  // The old validator allowed stationary coordinates away from the semantic
  // stop. Live archives already match it; accepted old archives are now made
  // physically safe without touching their money or in-progress dwell timer.
  if (manager.phase !== 'moving') manager.x = manager.target === 2 ? WORLD.vaultX : state.counters[manager.target].x;
  if (freshDeparture) manager.target = 1;
  else if (manager.target !== 2 || manager.phase === 'moving' && manager.timer !== 0) manager.finishLegacySweep = true;
  state.managerRouteVersion = MANAGER_ROUTE_VERSION;
}

export function createInitialState(): SliceState {
  return {
    schemaVersion: 1, economyVersion: 1, managerRouteVersion: MANAGER_ROUTE_VERSION, elapsed: 0, wallet: INITIAL_WALLET,
    totalEarned: 0, totalServed: 0, spend: 0, nextCustomerId: 1,
    arrivalTimer: 0, inviteCooldown: 0, paused: false, stepCarry: 0, eventSequence: 0, offlineClaimIds: [],
    counters: [
      { id: 'counter-a', x: 0, level: 1, recipe: 'espresso', pendingCash: 0, brewed: 0, brew: null },
      { id: 'counter-b', x: 5, level: 1, recipe: 'latte', pendingCash: 0, brewed: 0, brew: null }
    ],
    customers: [], manager: { x: WORLD.vaultX, z: WORLD.backZ, carrying: 0, phase: 'moving', target: 1, timer: 0, level: 1 },
    lastOfflineClaimId: null
  };
}

export function createEngine(initial: SliceState = createInitialState()): SliceEngine {
  const state = clone(initial);
  migrateManagerRoute(state);
  state.stepCarry ??= 0;
  state.eventSequence ??= 0;
  state.offlineClaimIds ??= state.lastOfflineClaimId ? [state.lastOfflineClaimId] : [];
  let events: SliceEvent[] = [];
  let silent = false;
  function emit(type: SliceEvent['type'], payload: Omit<Partial<SliceEvent>, 'id' | 'type'> = {}): void {
    state.eventSequence = (state.eventSequence ?? 0) + 1;
    if (silent) return;
    events.push({ id: state.eventSequence, type, ...payload });
    // Render notifications are transient; simulation and event IDs are persisted.
    if (events.length > 512) events.shift();
  }
  const findCounter = (id: CounterId): Counter | undefined => state.counters.find(counter => counter.id === id);
  const lane = (counterId: CounterId): Customer[] => state.customers.filter(customer => customer.counterId === counterId && customer.phase !== 'leaving').sort((a, b) => a.id - b.id);
  function arrive(): boolean {
    if (state.customers.length >= 32) return false;
    const counts = state.counters.map(counter => lane(counter.id).length);
    const smallest = Math.min(...counts);
    if (smallest >= QUEUE_CAPACITY) return false;
    const candidates = state.counters.filter((_, i) => counts[i] === smallest);
    const counter = candidates[(state.nextCustomerId - 1) % candidates.length];
    const id = state.nextCustomerId++;
    state.customers.push({ id, x: WORLD.entryX, z: WORLD.entryZ, phase: 'entering', counterId: counter.id, timer: 0, hasCup: false, skin: (id * 37 + 11) % 6 });
    emit('arrived', { counterId: counter.id });
    return true;
  }
  function move(customer: Customer, x: number, z: number, speed = 2.5): boolean {
    const dx = x - customer.x, dz = z - customer.z;
    const distance = Math.hypot(dx, dz), step = speed * STEP_SECONDS;
    if (distance <= step + 1e-9) { customer.x = x; customer.z = z; return true; }
    customer.x += dx / distance * step;
    customer.z += dz / distance * step;
    return false;
  }
  function advanceCustomers(): void {
    for (const counter of state.counters) {
      const queue = lane(counter.id);
      for (let i = 0; i < queue.length; i++) {
        const customer = queue[i];
        if (customer.phase === 'entering' || customer.phase === 'queue') {
          const targetZ = WORLD.serviceZ + i * WORLD.queueGap;
          const reached = move(customer, counter.x, targetZ);
          if (customer.phase === 'entering' && reached) customer.phase = 'queue';
          if (i === 0 && customer.phase === 'queue' && reached && !counter.brew) {
            customer.phase = 'serving'; customer.timer = 0;
            counter.brew = { recipe: counter.recipe, customerId: customer.id, elapsed: 0, duration: counterBrewSeconds(counter.recipe, counter.level, counter.id), price: counterPrice(counter.recipe, counter.level, counter.id) };
          }
        } else if (customer.phase === 'receiving') {
          customer.timer = roundTime(customer.timer + STEP_SECONDS);
          if (customer.timer >= .7 && counter.brew?.customerId === customer.id) {
            const price = counter.brew.price;
            counter.pendingCash += price; state.totalEarned += price; state.totalServed++;
            counter.brew = null; customer.phase = 'leaving'; customer.timer = 0;
            emit('served', { counterId: counter.id, amount: price });
          }
        }
      }
    }
    for (const customer of state.customers) {
      if (customer.phase !== 'leaving') continue;
      const counter = findCounter(customer.counterId)!;
      // Step aside first, then walk up the shared front aisle to the exit.
      if (customer.timer === 0 && move(customer, counter.x + 1.25, WORLD.serviceZ + .15)) customer.timer = 1;
      else if (customer.timer === 1 && move(customer, counter.x + 1.25, WORLD.entryZ)) customer.timer = 2;
      else if (customer.timer === 2 && move(customer, WORLD.entryX, WORLD.entryZ)) customer.timer = 3;
    }
    state.customers = state.customers.filter(customer => !(customer.phase === 'leaving' && customer.timer === 3));
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
        emit('brewed', { counterId: counter.id });
      }
    }
  }
  function advanceManager(): void {
    const manager = state.manager;
    manager.z = WORLD.backZ;
    const targetX = manager.target === 2 ? WORLD.vaultX : state.counters[manager.target].x;
    if (manager.phase === 'moving') {
      const difference = targetX - manager.x, step = managerSpeed(manager.level) * STEP_SECONDS;
      if (Math.abs(difference) <= step + 1e-9) {
        manager.x = targetX; manager.timer = 0;
        manager.phase = manager.target === 2 ? 'depositing' : 'collecting';
      } else manager.x += Math.sign(difference) * step;
      return;
    }
    manager.timer = roundTime(manager.timer + STEP_SECONDS);
    if (manager.timer < (manager.phase === 'depositing' ? .6 : .45)) return;
    if (manager.phase === 'collecting') {
      const counter = state.counters[manager.target];
      // Reserve half a bag for each counter, preventing high-level A from starving B.
      const amount = Math.min(counter.pendingCash, Math.floor(managerCapacity(manager.level) / 2), managerCapacity(manager.level) - manager.carrying);
      if (amount > 0) { counter.pendingCash -= amount; manager.carrying += amount; emit('collected', { counterId: counter.id, amount }); }
      // Targets keep their counter identity. Current sweeps visit the nearest
      // counter B first; migrated sweeps finish only their remaining old stops.
      manager.target = manager.finishLegacySweep ? (manager.target === 0 ? 1 : 2) : (manager.target === 1 ? 0 : 2);
    } else {
      const amount = manager.carrying;
      if (amount > 0) { state.wallet += amount; manager.carrying = 0; emit('deposited', { amount }); }
      delete manager.finishLegacySweep;
      manager.target = 1;
    }
    manager.phase = 'moving'; manager.timer = 0;
  }
  function tick(): void {
    state.elapsed = Math.round((state.elapsed + STEP_SECONDS) / STEP_SECONDS) * STEP_SECONDS;
    state.elapsed = roundTime(state.elapsed);
    state.inviteCooldown = Math.max(0, roundTime(state.inviteCooldown - STEP_SECONDS));
    state.arrivalTimer = roundTime(state.arrivalTimer + STEP_SECONDS);
    // Deterministic small cadence variation; no wall clock or Math.random.
    const interval = 2.4 + (state.nextCustomerId % 3) * .15;
    if (state.arrivalTimer + 1e-9 >= interval) { state.arrivalTimer = roundTime(state.arrivalTimer - interval); arrive(); }
    advanceCustomers(); advanceBrews(); advanceManager();
  }
  function advance(seconds: number): void {
    if (state.paused || !Number.isFinite(seconds) || seconds <= 0) return;
    // Keep fractional frames instead of rounding each incoming delta. Rounding
    // 1/60 per call, for example, would drift relative to one whole second.
    const total = (state.stepCarry ?? 0) + seconds;
    const steps = Math.floor((total + 1e-12) / STEP_SECONDS);
    const carry = total - steps * STEP_SECONDS;
    state.stepCarry = Math.abs(carry) < 1e-12 ? 0 : Math.max(0, carry);
    for (let i = 0; i < steps; i++) tick();
  }
  function quote(id: CounterId): CounterQuote {
    const counter = findCounter(id);
    if (!counter) return { cost: 0, beforePrice: 0, afterPrice: 0, beforeSeconds: 0, afterSeconds: 0, paybackSeconds: 0, capped: true };
    const capped = counter.level >= MAX_LEVEL, nextLevel = Math.min(MAX_LEVEL, counter.level + 1);
    const cost = capped ? 0 : Math.round(800 * 1.16 ** (counter.level - 1));
    const beforePrice = counterPrice(counter.recipe, counter.level, counter.id), afterPrice = counterPrice(counter.recipe, nextLevel, counter.id);
    const beforeSeconds = counterBrewSeconds(counter.recipe, counter.level, counter.id), afterSeconds = counterBrewSeconds(counter.recipe, nextLevel, counter.id);
    const incremental = afterPrice / (afterSeconds + .7 + WORLD.queueGap / 2.5) - beforePrice / (beforeSeconds + .7 + WORLD.queueGap / 2.5);
    return { cost, beforePrice, afterPrice, beforeSeconds, afterSeconds, paybackSeconds: capped ? 0 : cost / Math.max(.001, incremental), capped };
  }
  function managerQuote() {
    const capped = state.manager.level >= MAX_LEVEL;
    return { cost: capped ? 0 : Math.round(1000 * 1.16 ** (state.manager.level - 1)), speed: managerSpeed(state.manager.level), nextSpeed: managerSpeed(Math.min(MAX_LEVEL, state.manager.level + 1)), capped };
  }
  return {
    get state() { return state; }, advance,
    invite() {
      if (state.paused || state.inviteCooldown > 0) return false;
      let arrivals = 0;
      for (let i = 0; i < 3; i++) if (arrive()) arrivals++;
      if (!arrivals) return false;
      state.inviteCooldown = INVITE_COOLDOWN_SECONDS; emit('invited'); return true;
    },
    upgrade(id) {
      const counter = findCounter(id), offer = quote(id);
      if (!counter || offer.capped || state.wallet < offer.cost) return false;
      state.wallet -= offer.cost; state.spend += offer.cost; counter.level++;
      emit('upgraded', { counterId: id, amount: offer.cost }); return true;
    },
    upgradeManager() {
      const offer = managerQuote();
      if (offer.capped || state.wallet < offer.cost) return false;
      state.wallet -= offer.cost; state.spend += offer.cost; state.manager.level++;
      emit('upgraded', { amount: offer.cost }); return true;
    },
    setRecipe(id, recipe) {
      const counter = findCounter(id);
      if (!counter || !Object.hasOwn(recipeById, recipe) || counter.recipe === recipe) return false;
      counter.recipe = recipe; emit('recipe-changed', { counterId: id }); return true;
    },
    togglePause() { state.paused = !state.paused; }, quote, managerQuote,
    drainEvents() { const result = events; events = []; return result; },
    snapshot() {
      const snapshot = clone(state);
      // Canonical picosecond precision removes floating representation noise
      // without quantising every frame's fractional remainder.
      snapshot.stepCarry = Math.round((snapshot.stepCarry ?? 0) * 1e12) / 1e12;
      return snapshot;
    },
    applyOffline(seconds, claimId) {
      if (typeof claimId !== 'string' || !claimId || claimId.length > 256 || claimId === state.lastOfflineClaimId || state.offlineClaimIds!.includes(claimId) || !Number.isFinite(seconds) || seconds < 0) return { accepted: false, amount: 0, seconds: 0 };
      const bounded = Math.min(OFFLINE_CAP_SECONDS, seconds), before = state.wallet;
      state.lastOfflineClaimId = claimId;
      state.offlineClaimIds!.push(claimId);
      if (state.offlineClaimIds!.length > 256) state.offlineClaimIds!.shift();
      silent = true;
      try { advance(bounded * OFFLINE_EFFICIENCY); } finally { silent = false; }
      return { accepted: true, amount: state.wallet - before, seconds: bounded };
    }
  };
}
