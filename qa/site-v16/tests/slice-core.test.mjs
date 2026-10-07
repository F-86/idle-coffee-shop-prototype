import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Node 24 strips TypeScript. Match the app bundler's extensionless TS imports.
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { createEngine, createInitialState, recipeById, recipes, MAX_LEVEL, INITIAL_WALLET, counterBrewSeconds, counterPrice, managerCapacity, managerSpeed, STEP_SECONDS, ECONOMY_VERSION, COFFEE_MAX_LEVEL, COFFEE_UPGRADE_CONFIG, coffeePrice, coffeeBrewSeconds } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, validateState, createMemoryStorage } = await import('../src/slice/core/persistence.ts');
const { InMemorySaveRepository, GuestAuthProvider } = await import('../src/slice/core/sync.ts');

// Long-running route/throughput fixtures explicitly buy supplies. This is test
// input through the real purchase API, never automatic production behavior.
function restockFixture(engine) {
  for (const id of ['beans', 'milk']) if (engine.state.ingredients[id] <= 10) assert.equal(engine.buyIngredient(id, 'batch'), true, `fixture can afford ${id}`);
}
function advanceWithSupplies(engine, seconds) {
  for (let i = 0; i < seconds; i++) { restockFixture(engine); engine.advance(Math.min(1, seconds - i)); }
}

function assets(state) { return state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0); }
function withEarnedCash(a = 1200, b = 1200) {
  const state = createInitialState(); state.wallet += a + b; state.totalEarned = a + b; return state;
}
function cashEvents(events) { return events.filter(event => event.type === 'collected' || event.type === 'deposited'); }
function until(engine, predicate, maxTicks = 3000) {
  const events = [];
  for (let tick = 0; tick < maxTicks; tick++) {
    if (predicate(engine.state, events)) return events;
    engine.advance(STEP_SECONDS); events.push(...engine.drainEvents());
  }
  assert.fail('Deterministic fixture did not reach its expected state.');
}
// Explicit pre-feature schema, independent of the current initial-state factory.
function legacyState(manager = {}, a = 900, b = 900) {
  const state = {
    schemaVersion: 1, economyVersion: 3, managerRouteVersion: 2, customerRouteVersion: 3,
    layout: { version: 2, active: false, expanded: false, furniture: [
      { id: 'counter-a', kind: 'counter', counterId: 'counter-a', x: 0, z: 0, rotation: 0, stored: false },
      { id: 'counter-b', kind: 'counter', counterId: 'counter-b', x: 5, z: 0, rotation: 0, stored: false }
    ], coffeeSigns: [ { id: 'menu-espresso', recipe: 'espresso', x: 0, stored: false }, { id: 'menu-latte', recipe: 'latte', x: 5, stored: false } ] },
    coffeeLevels: { espresso: 1, latte: 1 }, elapsed: 0, wallet: 1200, totalEarned: a + b, totalServed: 0, spend: 0,
    nextCustomerId: 1, arrivalTimer: 0, inviteCooldown: 0, paused: false, stepCarry: 0, eventSequence: 0, offlineClaimIds: [], lastOfflineClaimId: null,
    counters: [
      { id: 'counter-a', x: 0, level: 1, recipe: 'espresso', pendingCash: a, brewed: 0, brew: null },
      { id: 'counter-b', x: 5, level: 1, recipe: 'latte', pendingCash: b, brewed: 0, brew: null }
    ], customers: [], manager: { x: 8.8, z: -1.7, carrying: 0, phase: 'moving', target: 1, timer: 0, level: 1, ...manager }
  };
  state.totalEarned += state.manager.carrying;
  return state;
}
function rawEnvelope(state, savedAt = 1000, recordChangeTag = 'legacy-route-source') {
  return JSON.stringify({ schemaVersion: 1, ...(state.economyVersion >= 5 ? { offlinePolicyVersion: 4 } : {}), savedAt, recordChangeTag, state });
}

test('TC-3D-027 new shops use active layout3 and direct counter receipts with a retired manager', () => {
  const initial = createInitialState();
  assert.equal(ECONOMY_VERSION, 9); assert.equal(initial.economyVersion, 9);
  assert.equal(initial.layout.version, 3); assert.equal(initial.layout.active, true); assert.equal(initial.customerRouteVersion, 4);
  assert.deepEqual(initial.manager, { x: 8.8, z: -1.7, carrying: 0, phase: 'moving', target: 2, timer: 0, level: 1 });
  const engine = createEngine(), tombstone = structuredClone(engine.state.manager); let payments = 0;
  for (let i = 0; i < 2400; i++) {
    const before = engine.snapshot(); engine.advance(.05); const events = engine.drainEvents();
    const receipts = events.filter(event => event.type === 'served').reduce((sum, event) => sum + event.amount, 0);
    assert.equal(engine.state.wallet - before.wallet, receipts, 'wallet credits exactly when handoff completes');
    assert.equal(engine.state.totalEarned - before.totalEarned, receipts, 'each receipt is minted once');
    payments += events.filter(event => event.type === 'served').length;
    assert.deepEqual(engine.state.manager, tombstone); assert.deepEqual(cashEvents(events), []);
    assert.ok(engine.state.counters.every(counter => counter.pendingCash === 0));
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
    assert.equal(validateState(engine.snapshot()).ok, true);
  }
  assert.ok(payments > 5);
});

test('TC-3D-027 manager upgrades are retired and historical levels have no economic effect', () => {
  const source = withEarnedCash(50000, 50000), historical = structuredClone(source); historical.manager.level = MAX_LEVEL;
  const a = createEngine(source), b = createEngine(historical), before = a.snapshot();
  assert.equal(a.upgradeManager(), false); assert.equal(a.managerQuote().capped, true); assert.deepEqual(a.snapshot(), before);
  a.advance(600); b.advance(600);
  const normalized = b.snapshot(); normalized.manager.level = 1;
  assert.deepEqual(normalized, a.snapshot()); assert.deepEqual(a.drainEvents(), b.drainEvents());
});

test('TC-3D-027 economy1/2/3 migrate all old cash once and retire every in-flight manager phase', () => {
  for (const version of [1, 2, 3]) for (const manager of [
    { x: 7, target: 1, phase: 'moving', timer: 0 },
    { x: 5, target: 1, phase: 'collecting', timer: .2, carrying: 300 },
    { x: 2, target: 0, phase: 'moving', timer: 0, carrying: 600 },
    { x: 0, target: 0, phase: 'collecting', timer: .2, carrying: 600 },
    { x: 6, target: 2, phase: 'moving', timer: 0, carrying: 1200 },
    { x: 8.8, target: 2, phase: 'depositing', timer: .25, carrying: 1200 }
  ]) {
    const source = legacyState({ ...manager, level: 7 }); source.economyVersion = version;
    if (version < 3) delete source.layout;
    if (version === 1) delete source.coffeeLevels;
    source.stepCarry = .027; source.eventSequence = 91; source.lastOfflineClaimId = 'claimed'; source.offlineClaimIds = ['claimed'];
    const before = structuredClone(source), checked = validateState(source);
    assert.equal(checked.ok, true, `${version}: ${JSON.stringify(manager)}: ${checked.message}`);
    assert.deepEqual(source, before); const current = checked.state;
    assert.equal(current.wallet, source.wallet + 1800 + (manager.carrying ?? 0)); assert.equal(current.totalEarned, source.totalEarned);
    assert.equal(current.economyVersion, 9); assert.equal(current.layout.version, 3); assert.equal(current.customerRouteVersion, 4);
    assert.deepEqual(current.manager, { x: 8.8, z: -1.7, carrying: 0, phase: 'moving', target: 2, timer: 0, level: 7 });
    assert.ok(current.counters.every(counter => counter.pendingCash === 0));
    for (const key of ['spend', 'elapsed', 'stepCarry', 'eventSequence', 'lastOfflineClaimId', 'offlineClaimIds']) assert.deepEqual(current[key], source[key]);
    assert.deepEqual(validateState(current).state, current); assert.deepEqual(createEngine(source).snapshot(), current);
    assert.equal(assets(current), INITIAL_WALLET + current.totalEarned);
    const engine = createEngine(current), snapshot = engine.snapshot(); assert.equal(engine.applyOffline(60, 'claimed').accepted, false); assert.deepEqual(engine.snapshot(), snapshot);
  }
});

test('TC-3D-027 old in-flight guests and brew snapshots survive migration then drain before door conversion', () => {
  const source = legacyState({}, 300, 270); source.nextCustomerId = 3; source.elapsed = 20; source.arrivalTimer = 1.25; source.stepCarry = .027;
  source.customers = [
    { id: 1, counterId: 'counter-a', phase: 'serving', x: 0, z: 1.5, timer: 0, hasCup: false, skin: 0 },
    { id: 2, counterId: 'counter-b', phase: 'entering', routeLeg: 2, x: -2, z: 8.2, timer: 0, hasCup: false, skin: 1 }
  ];
  source.counters[0].brew = { recipe: 'espresso', customerId: 1, price: 110, elapsed: .5, duration: 2.7 };
  const checked = validateState(source); assert.equal(checked.ok, true, checked.message);
  assert.deepEqual(checked.state.customers, source.customers); assert.deepEqual(checked.state.counters[0].brew, source.counters[0].brew);
  assert.equal(checked.state.layout.version, 2); assert.equal(checked.state.customerRouteVersion, 3);
  const engine = createEngine(checked.state); assert.equal(engine.invite(), false);
  until(engine, state => state.customerRouteVersion === 4);
  assert.equal(engine.state.layout.version, 3); assert.equal(engine.state.layout.active, true); assert.equal(engine.state.nextCustomerId, 3);
  assert.equal(engine.state.customers.length, 0); assert.equal(validateState(engine.snapshot()).ok, true);
  assert.equal(engine.invite(), true);
});

test('TC-3D-027 handoff and retired cash survive split advance and all save checkpoints exactly', () => {
  for (const checkpoint of [.137, 7.413, 9.713, 10.137, 14.013, 26.137]) {
    const uninterrupted = createEngine(); uninterrupted.advance(checkpoint); uninterrupted.drainEvents();
    const before = uninterrupted.snapshot(), storage = createMemoryStorage(), repo = new LocalSaveRepository(storage);
    assert.equal(repo.save(before, 1000).ok, true);
    const loaded = new LocalSaveRepository(storage).load(1000); assert.deepEqual(loaded.state, before);
    const restored = createEngine(loaded.state); uninterrupted.advance(26.413);
    for (let i = 0; i < 264; i++) restored.advance(.1); restored.advance(.013);
    assert.deepEqual(restored.snapshot(), uninterrupted.snapshot()); assert.deepEqual(restored.drainEvents(), uninterrupted.drainEvents());
  }
});

test('TC-3D-027 current retired-cash corruption and future versions preserve archive bytes', () => {
  const mutations = [
    s => { s.counters[0].pendingCash = 1; s.totalEarned = 1; }, s => { s.manager.carrying = 1; s.totalEarned = 1; },
    s => s.manager.phase = 'collecting', s => s.manager.target = 1, s => s.manager.x = 5, s => s.manager.timer = .1,
    s => s.manager.finishLegacySweep = true, s => s.manager.nav = [{ x: 9, z: -2 }], s => s.managerRouteVersion = '2',
    s => s.customerRouteVersion = 5, s => s.economyVersion = 10, s => s.layout.version = 4,
  ];
  for (const mutate of mutations) {
    const source = createInitialState(); mutate(source); assert.equal(validateState(source).ok, false, mutate.toString());
    const storage = createMemoryStorage(), raw = rawEnvelope(source); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage), loaded = repo.load(121000);
    const future = source.customerRouteVersion === 5 || source.economyVersion === 10 || source.layout.version === 4;
    assert.equal(loaded.status, future ? 'future' : 'corrupt'); assert.equal(loaded.protectedRaw, true);
    assert.equal(repo.save(loaded.state, 121000).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
  }
});

test('TC-3D-004 authentic legacy archives migrate offline only once and retain retries/CAS protection', () => {
  const source = legacyState({ target: 1, x: 7, carrying: 600 }); source.stepCarry = .027; source.eventSequence = 42;
  const raw = rawEnvelope(source), memory = createMemoryStorage(); memory.setItem(SAVE_KEY, raw);
  const immediate = new LocalSaveRepository(memory).load(1000);
  assert.equal(immediate.status, 'loaded'); assert.equal(immediate.state.managerRouteVersion, 2);
  assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).offlinePolicyVersion, 4);
  assert.deepEqual(JSON.parse(memory.getItem(SAVE_KEY)).state, immediate.state);
  memory.setItem(SAVE_KEY, raw); // Exercise failure/retry from authentic pre-policy bytes.
  const expected = createEngine(immediate.state); expected.applyOffline(120, 'independent-old-anchor', 1);
  const unavailable = { ...memory, setItem() { throw Error('quota'); } };
  const failed = new LocalSaveRepository(unavailable).load(121000);
  assert.equal(failed.status, 'offline-save-failed'); assert.equal(failed.offline.accepted, false); assert.deepEqual(failed.state, immediate.state); assert.equal(memory.getItem(SAVE_KEY), raw);
  const recovered = new LocalSaveRepository(memory).load(121000);
  assert.equal(recovered.offline.accepted, true); assert.equal(recovered.offline.seconds, 120);
  const expectedSnapshot = expected.snapshot();
  for (const key of ['lastOfflineClaimId', 'offlineClaimIds']) expectedSnapshot[key] = recovered.state[key];
  assert.deepEqual(recovered.state, expectedSnapshot);
  assert.deepEqual(new LocalSaveRepository(memory).load(121000).state, recovered.state);
  assert.equal(new LocalSaveRepository(memory).load(121000).offline?.accepted ?? false, false);
  const a = new LocalSaveRepository(memory), b = new LocalSaveRepository(memory); const sa = a.load(121000).state, sb = b.load(121000).state;
  assert.equal(a.save(sa, 122000).ok, true); const won = memory.getItem(SAVE_KEY);
  assert.equal(b.save(sb, 122000).status, 'conflict'); assert.equal(memory.getItem(SAVE_KEY), won);
  const racedMemory = createMemoryStorage(); racedMemory.setItem(SAVE_KEY, raw);
  let reads = 0; const winningRaw = rawEnvelope(createInitialState(), 121000, 'other-window-won');
  const racingStorage = { ...racedMemory, getItem(key) { if (++reads === 2) racedMemory.setItem(SAVE_KEY, winningRaw); return racedMemory.getItem(key); } };
  const conflicted = new LocalSaveRepository(racingStorage).load(121000);
  assert.equal(conflicted.status, 'conflict'); assert.equal(conflicted.offline.accepted, false); assert.deepEqual(conflicted.state, immediate.state); assert.equal(racedMemory.getItem(SAVE_KEY), winningRaw);
  const paused = legacyState({ phase: 'depositing', target: 2, x: 8.8, carrying: 1200, timer: .25 }); paused.paused = true;
  const pausedMemory = createMemoryStorage(); pausedMemory.setItem(SAVE_KEY, rawEnvelope(paused));
  const pausedLoad = new LocalSaveRepository(pausedMemory).load(121000);
  assert.equal(pausedLoad.offline.amount, 0); assert.equal(pausedLoad.state.elapsed, 0); assert.equal(pausedLoad.state.manager.timer, 0); assert.equal(pausedLoad.state.manager.carrying, 0); assert.equal(pausedLoad.state.wallet, 4200);
});

test('TC-3D-003 fixed-step advance is independent of frame partition and save round trips', () => {
  const a = createEngine(), b = createEngine();
  a.advance(80.137);
  for (let i = 0; i < 800; i++) b.advance(.1);
  b.advance(.137);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.drainEvents(), b.drainEvents());
  const restored = createEngine(JSON.parse(JSON.stringify(b.snapshot())));
  restored.advance(.413); a.advance(.413);
  assert.deepEqual(a.snapshot(), restored.snapshot());
  const frames = createEngine(), whole = createEngine();
  for (let i = 0; i < 6000; i++) frames.advance(1 / 60);
  whole.advance(100);
  assert.deepEqual(frames.snapshot(), whole.snapshot());
  const partialA = createEngine(), partialB = createEngine();
  partialA.advance(1 / 60); partialB.advance(1 / 120); partialB.advance(1 / 120);
  assert.deepEqual(partialA.snapshot(), partialB.snapshot());
});

test('TC-3D-002 recipes and upgrades affect the next brew only', () => {
  const engine = createEngine();
  for (let i = 0; i < 800 && !engine.state.counters[0].brew; i++) engine.advance(.05);
  const before = structuredClone(engine.state.counters[0].brew);
  assert.ok(before);
  assert.ok(engine.upgrade('counter-a'));
  assert.ok(engine.setRecipe('counter-a', 'latte'));
  assert.deepEqual(engine.state.counters[0].brew, before);
  assert.ok(recipes[1].price > recipes[0].price && recipes[1].brewSeconds > recipes[0].brewSeconds);
  let completed = false;
  for (let i = 0; i < 1200; i++) {
    engine.advance(.05);
    if (engine.drainEvents().some(event => event.type === 'served' && event.counterId === 'counter-a' && event.amount === before.price)) completed = true;
    const brew = engine.state.counters[0].brew;
    if (brew && brew.customerId !== before.customerId) {
      assert.equal(brew.recipe, 'latte'); assert.ok(brew.price > recipes[1].price); break;
    }
  }
  assert.ok(completed);
});

test('COUNTER-001 all identities use the same counter upgrade formulas', () => {
  assert.equal(counterBrewSeconds('espresso', 1, 'counter-a'), counterBrewSeconds('espresso', 1, 'counter-b'));
  assert.equal(counterPrice('latte', 1, 'counter-b'), counterPrice('latte', 1, 'counter-a'));
  const fast = createEngine(), slow = createEngine();
  fast.setRecipe('counter-b', 'espresso'); slow.setRecipe('counter-a', 'latte');
  advanceWithSupplies(fast, 180); advanceWithSupplies(slow, 180);
  assert.ok(fast.state.totalServed > slow.state.totalServed);
});

test('TC-3D-003 repeated input is bounded by cooldown, capacity, cost and maximum level', () => {
  const engine = createEngine();
  assert.ok(engine.invite());
  const customerCount = engine.state.customers.length;
  for (let i = 0; i < 100; i++) assert.equal(engine.invite(), false);
  assert.equal(engine.state.customers.length, customerCount);
  assert.ok(engine.upgrade('counter-a'));
  assert.equal(engine.upgrade('counter-b'), false);
  assert.equal(engine.upgrade('counter-a'), false);
  engine.advance(3600);
  assert.ok(engine.state.customers.filter(c => c.phase !== 'leaving').length <= 16);
  const wealthy = createInitialState(); wealthy.wallet = 100_000_000; wealthy.totalEarned = wealthy.wallet - INITIAL_WALLET;
  const capped = createEngine(wealthy);
  for (let i = 1; i < MAX_LEVEL; i++) assert.ok(capped.upgrade('counter-a'));
  const wallet = capped.state.wallet;
  assert.equal(capped.upgrade('counter-a'), false);
  assert.equal(capped.state.counters[0].level, MAX_LEVEL);
  assert.equal(capped.state.wallet, wallet);
  assert.equal(capped.quote('counter-a').capped, true);
});

test('TC-3D-003 paused time and invalid deltas cannot create progress', () => {
  const engine = createEngine(); engine.advance(.027); engine.togglePause();
  const frozen = engine.snapshot();
  engine.advance(3600); engine.advance(Infinity); engine.advance(NaN); engine.advance(-3);
  assert.deepEqual(engine.snapshot(), frozen);
  engine.togglePause(); engine.advance(.023);
  assert.equal(engine.state.elapsed, .05);
});

test('TC-3D-004 corrupt and future saves preserve original bytes and reject autosave', () => {
  for (const raw of ['{oops', JSON.stringify({ schemaVersion: 99, state: createInitialState(), savedAt: 10 })]) {
    const storage = createMemoryStorage(); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage); const load = repo.load(2000);
    assert.ok(['corrupt', 'future'].includes(load.status));
    assert.ok(load.message);
    assert.equal(repo.save(load.state, 2000).ok, false);
    assert.equal(storage.getItem(SAVE_KEY), raw);
    assert.equal(repo.reset().ok, false);
    assert.equal(storage.getItem(SAVE_KEY), raw);
    const reset = repo.reset({ confirmProtected: true });
    assert.ok(reset.ok && reset.backupKey);
    assert.equal(storage.getItem(reset.backupKey), raw);
    assert.equal(storage.getItem(SAVE_KEY), null);
  }
});

test('TC-3D-004 strict validation catches enums, non-finite values, bounds and broken ledgers', () => {
  for (const mutate of [s => s.wallet = -1, s => s.wallet = .5, s => s.counters[0].recipe = 'mocha', s => s.manager.level = 21, s => s.customers.push({ id: 1 }), s => s.arrivalTimer = Infinity, s => s.totalEarned = 999]) {
    const state = createInitialState(); mutate(state); assert.equal(validateState(state).ok, false);
  }
  assert.equal(validateState(createInitialState()).ok, true);
});

test('TC-3D-004 offline close-loop advances uncapped time with finite stock and claims each interval once', () => {
  const engine = createEngine();
  const result = engine.applyOffline(7201, 'claim-1');
  assert.equal(result.accepted, true); assert.equal(result.seconds, 7201); assert.equal(result.effectiveSeconds, 7201 * .8); assert.ok(result.amount > 0);
  assert.equal(engine.state.totalServed, 40); assert.equal(engine.state.ingredients.beans, 0);
  const snapshot = engine.snapshot();
  assert.equal(engine.applyOffline(7201, 'claim-1').accepted, false);
  assert.deepEqual(engine.snapshot(), snapshot);
  engine.applyOffline(60, 'claim-2');
  const afterSecond = engine.snapshot();
  assert.equal(engine.applyOffline(60, 'claim-1').accepted, false);
  assert.deepEqual(engine.snapshot(), afterSecond);
  const storage = createMemoryStorage();
  const repo = new LocalSaveRepository(storage);
  assert.ok(repo.save(createInitialState(), 1000).ok);
  const recovered = new LocalSaveRepository(storage).load(121_000);
  assert.ok(recovered.offline?.accepted); assert.ok(recovered.offline.amount > 0);
  const reopened = new LocalSaveRepository(storage).load(121_000);
  assert.deepEqual(reopened.state, recovered.state);
  assert.equal(reopened.offline?.accepted ?? false, false);
});

test('TC-3D-004 paused offline, storage errors and another client cannot overwrite valid progress', () => {
  const paused = createEngine(); paused.togglePause();
  const claimed = paused.applyOffline(7200, 'paused-claim');
  assert.equal(claimed.amount, 0); assert.equal(paused.state.elapsed, 0);
  const storage = createMemoryStorage(), a = new LocalSaveRepository(storage), b = new LocalSaveRepository(storage);
  a.load(1000); b.load(1000);
  assert.ok(a.save(createInitialState(), 1000).ok);
  assert.equal(b.save(createInitialState(), 1000).status, 'conflict');
  const blocked = new LocalSaveRepository({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } });
  assert.equal(blocked.load(1000).status, 'unavailable');
  assert.equal(blocked.save(createInitialState(), 1000).ok, false);
});

test('TC-3D-004 overlapping reload endpoints and backwards clocks never reclaim the same interval', () => {
  const storage = createMemoryStorage(), repo = new LocalSaveRepository(storage);
  repo.save(createInitialState(), 1000);
  const first = new LocalSaveRepository(storage).load(121000);
  assert.equal(first.state.elapsed, 96);
  const older = new LocalSaveRepository(storage);
  const backwards = older.load(91000);
  assert.equal(backwards.state.elapsed, 96);
  older.save(backwards.state, 91000);
  const second = new LocalSaveRepository(storage).load(151000);
  assert.equal(second.state.elapsed, 120);
  assert.equal(second.offline.seconds, 30);
});

test('TC-3D-004 failed offline anchor writes grant no income and remain retryable', () => {
  const memory = createMemoryStorage(); new LocalSaveRepository(memory).save(createInitialState(), 1000);
  const original = memory.getItem(SAVE_KEY);
  const storage = { ...memory, setItem() { throw Error('quota'); } };
  const failed = new LocalSaveRepository(storage).load(121000);
  assert.equal(failed.status, 'offline-save-failed');
  assert.equal(failed.state.wallet, INITIAL_WALLET);
  assert.equal(failed.state.elapsed, 0);
  assert.equal(failed.offline.accepted, false);
  assert.equal(memory.getItem(SAVE_KEY), original);
  const retried = new LocalSaveRepository(memory).load(121000);
  assert.ok(retried.offline.accepted && retried.offline.amount > 0);
  assert.deepEqual(new LocalSaveRepository(memory).load(121000).state, retried.state);
});

test('TC-3D-004 save validator accepts every live phase under mixed deterministic actions', () => {
  const engine = createEngine();
  for (let i = 0; i < 2400; i++) {
    if (i % 113 === 0) engine.invite();
    if (i % 157 === 0) engine.setRecipe('counter-a', i % 2 ? 'espresso' : 'latte');
    if (i % 211 === 0) engine.upgrade('counter-a');
    if (i % 317 === 0) engine.upgradeManager();
    engine.advance(.05);
    assert.equal(validateState(engine.snapshot()).ok, true, `invalid live state at tick ${i}`);
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
  }
});

test('TC-3D-005 opaque CAS tags, idempotent retry and offline two-client conflict', async () => {
  const auth = new GuestAuthProvider(); assert.equal((await auth.getIdentity()).status, 'guest');
  const repo = new InMemorySaveRepository(); const state = createInitialState();
  const first = await repo.save('guest', state, null, 'op-1'); assert.equal(first.status, 'saved');
  const retry = await repo.save('guest', state, null, 'op-1'); assert.deepEqual(retry, first);
  const [a, b] = await Promise.all([repo.load('guest'), repo.load('guest')]);
  assert.ok(a.recordChangeTag); assert.equal(a.recordChangeTag, b.recordChangeTag);
  const ea = createEngine(a.state), eb = createEngine(b.state); ea.applyOffline(60, 'client-a'); eb.applyOffline(60, 'client-b');
  const won = await repo.save('guest', ea.snapshot(), a.recordChangeTag, 'op-a'); assert.equal(won.status, 'saved');
  const lost = await repo.save('guest', eb.snapshot(), b.recordChangeTag, 'op-b'); assert.equal(lost.status, 'conflict');
  assert.deepEqual((await repo.load('guest')).state, won.state);
  assert.equal((await repo.save('guest', eb.snapshot(), a.recordChangeTag, 'op-1')).status, 'operation-mismatch');
});


test('TC-3D-019 repository blocks writes across unresolved load failures and permits only verified recovery', () => {
  const initial = withEarnedCash(300, 270), memory = createMemoryStorage();
  const control = { read: false, write: false };
  const storage = { getItem(key) { if (control.read) throw Error('read unavailable'); return memory.getItem(key); }, setItem(key, value) { if (control.write) throw Error('quota'); memory.setItem(key, value); }, removeItem: key => memory.removeItem(key) };
  const repo = new LocalSaveRepository(storage); assert.equal(repo.save(initial, 100000).ok, true);
  const durable = memory.getItem(SAVE_KEY);
  control.write = true; assert.equal(repo.load(130000).status, 'offline-save-failed');
  control.write = false;
  assert.equal(repo.save(createInitialState(), 130000).ok, false, 'settlement failure remains a write barrier');
  control.read = true;
  for (let i = 0; i < 2; i++) assert.equal(repo.load(130000).status, 'unavailable');
  assert.equal(repo.inspect().rawText, durable, 'read failures do not replace the known CAS bytes');
  control.read = false;
  assert.equal(repo.save(createInitialState(), 130000).status, 'unavailable');
  assert.equal(memory.getItem(SAVE_KEY), durable);
  const recovered = repo.load(130000);
  assert.equal(recovered.status, 'loaded'); assert.ok(recovered.state.totalEarned >= 570);
  const claimed = memory.getItem(SAVE_KEY);
  assert.deepEqual(repo.load(130000).state, recovered.state); assert.equal(memory.getItem(SAVE_KEY), claimed);
  assert.equal(repo.save(recovered.state, 129000).ok, true);
  assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 130000, 'backwards clock cannot rewind the recovered anchor');
});

test('TC-3D-019 missing saves are distinct from first-launch empty storage and need explicit reset before writing', () => {
  const memory = createMemoryStorage(), repo = new LocalSaveRepository(memory);
  assert.equal(repo.load(1000).status, 'new'); assert.equal(repo.save(withEarnedCash(), 1000).ok, true);
  memory.removeItem(SAVE_KEY);
  assert.equal(repo.load(1000).status, 'missing'); assert.equal(repo.save(createInitialState(), 1000).status, 'missing');
  assert.equal(memory.getItem(SAVE_KEY), null);
  assert.equal(repo.reset({ confirmProtected: true }).ok, true); assert.equal(repo.save(createInitialState(), 1000).ok, true);
  const missing = new LocalSaveRepository(createMemoryStorage());
  assert.equal(missing.load(1000, { allowNew: false }).status, 'missing');
  assert.equal(missing.save(createInitialState(), 1000).ok, false);
});


test('TC-3D-019 initial read outage cannot silently initialize an empty recovery and reset retains CAS/backup protection', () => {
  const memory = createMemoryStorage(); let blocked = true;
  const repo = new LocalSaveRepository({ ...memory, getItem(key) { if (blocked) throw Error('read unavailable'); return memory.getItem(key); } });
  assert.equal(repo.load(1000).status, 'unavailable'); blocked = false;
  assert.equal(repo.load(1000).status, 'missing'); assert.equal(repo.save(createInitialState(), 1000).ok, false);
  assert.equal(repo.reset().status, 'missing', 'unresolved missing data also requires explicit reset confirmation');
  const winner = rawEnvelope(withEarnedCash(), 1000, 'new-client'); memory.setItem(SAVE_KEY, winner);
  assert.equal(repo.reset({ confirmProtected: true }).status, 'conflict'); assert.equal(memory.getItem(SAVE_KEY), winner);
  assert.equal(repo.load(1000).status, 'loaded'); assert.equal(repo.save(withEarnedCash(), 1000).ok, true);
});

// TC-3D-023 recipe upgrades. Fixtures keep the real money ledger valid; no
// production helper computes an expected upgrade fee or recipe multiplier.
function coffeeFixture(wallet = 200_000) {
  const state = createInitialState(); state.wallet = wallet; state.totalEarned = wallet - INITIAL_WALLET;
  return state;
}

test('FIXED-COFFEE-001 recipe bases ignore historical levels while counter upgrades remain active', () => {
  for (const recipe of recipes) for (let history=1;history<=10;history++) for (let level=1;level<=20;level++) for (const id of ['counter-a','counter-b','counter-c','counter-d']) {
    assert.equal(coffeePrice(recipe.id,history),recipe.price);assert.equal(coffeeBrewSeconds(recipe.id,history),recipe.brewSeconds);
    assert.equal(counterPrice(recipe.id,level,id,history),Math.round(recipe.price*(1+.12*(level-1))));assert.equal(counterBrewSeconds(recipe.id,level,id,history),recipe.brewSeconds/(1+.045*(level-1)));
  }
});
test('FIXED-COFFEE-002 retired upgrade calls never spend or refund money and preserve historical levels', () => {
  const initial=coffeeFixture();initial.coffeeLevels={espresso:5,latte:9};const engine=createEngine(initial),before=engine.snapshot();
  for (const recipe of ['espresso','latte','mocha','__proto__',null]) for(let i=0;i<20;i++)assert.equal(engine.upgradeCoffee(recipe),false);
  assert.deepEqual(engine.snapshot(),before);assert.deepEqual(engine.drainEvents(),[]);assert.equal(engine.coffeeQuote('latte').capped,true);assert.equal(engine.coffeeQuote('latte').cost,0);
  assert.equal(engine.upgrade('counter-a'),true);assert.equal(engine.state.wallet,before.wallet-800);assert.deepEqual(engine.state.coffeeLevels,before.coffeeLevels);
});
test('FIXED-COFFEE-003 existing old recipe-level cup remains frozen while later cups use fixed bases', () => {
  const initial=coffeeFixture();initial.coffeeLevels={espresso:5,latte:4};const old=createEngine(initial,undefined,{legacyCoffeeLevels:true});
  until(old,state=>!!state.counters[0].brew);const source=old.snapshot(),first=structuredClone(source.counters[0].brew);source.economyVersion=6;
  const checked=validateState(source);assert.equal(checked.ok,true);assert.equal(checked.state.economyVersion, 9);const engine=createEngine(checked.state);assert.equal(engine.upgrade('counter-a'),true);assert.deepEqual(engine.state.counters[0].brew,first);
  let paid=false,next=false;for(let i=0;i<3000&&!next;i++){engine.advance(.05);for(const event of engine.drainEvents())if(event.type==='served'&&event.counterId==='counter-a'&&event.amount===first.price)paid=true;const brew=engine.state.counters[0].brew;if(brew&&brew.customerId!==first.customerId){assert.equal(brew.price,123);assert.equal(brew.duration,3.6/1.045);next=true;}}
  assert.equal(paid,true);assert.equal(next,true);
});

test('TC-3D-023 economy1 migration adds Lv1 coffee progress and rejects malformed or future progression', () => {
  const legacy = legacyState(); legacy.economyVersion = 1; delete legacy.layout; delete legacy.coffeeLevels;
  const raw = structuredClone(legacy), checked = validateState(legacy);
  assert.equal(checked.ok, true); assert.deepEqual(legacy, raw);
  assert.deepEqual(checked.state.coffeeLevels, { espresso: 1, latte: 1 });
  assert.deepEqual(createEngine(legacy).snapshot(), checked.state); assert.deepEqual(validateState(checked.state).state, checked.state);
  const memory = createMemoryStorage(); memory.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 3, savedAt: 100000, recordChangeTag: 'pre-coffee', state: legacy }));
  const repo = new LocalSaveRepository(memory), loaded = repo.load(100000);
  assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, checked.state); assert.equal(repo.save(loaded.state, 100000).ok, true);
  assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).state.economyVersion, 9);
  for (const levels of [undefined, null, [], {}, { espresso: 1 }, { espresso: 1, latte: 1, mocha: 1 }, { espresso: 0, latte: 1 }, { espresso: 11, latte: 1 }, { espresso: 1.1, latte: 1 }, { espresso: '2', latte: 1 }, { espresso: Infinity, latte: 1 }, { espresso: 1, latte: NaN }]) {
    const bad = createInitialState(); bad.coffeeLevels = levels;
    assert.equal(validateState(bad).ok, false, JSON.stringify(levels)); assert.throws(() => createEngine(bad));
  }
  for (const version of [0, 1, '2', 2.5, 10, 999]) {
    const bad = createInitialState(); bad.economyVersion = version;
    assert.equal(validateState(bad).ok, false); assert.throws(() => createEngine(bad));
    const storage = createMemoryStorage(), raw = rawEnvelope(bad); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage), loaded = repo.load(1000);
    assert.equal(loaded.status, typeof version === 'number' && version >= 5 ? 'future' : 'corrupt');
    assert.equal(repo.save(loaded.state, 1000).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
  }
});

test('TC-3D-023 sync adapter preserves recipe progress under CAS, replay and changed-operation protection', async () => {
  const repository = new InMemorySaveRepository(), engine = createEngine(coffeeFixture()); engine.state.coffeeLevels.latte = 2;
  const state = engine.snapshot(), saved = await repository.save('coffee-user', state, null, 'coffee-create');
  assert.equal(saved.status, 'saved'); assert.deepEqual(saved.state.coffeeLevels, { espresso: 1, latte: 2 });
  assert.deepEqual(await repository.save('coffee-user', state, null, 'coffee-create'), saved);
  engine.state.coffeeLevels.espresso = 2;
  assert.equal((await repository.save('coffee-user', engine.snapshot(), null, 'coffee-create')).status, 'operation-mismatch');
  const conflict = await repository.save('coffee-user', engine.snapshot(), null, 'coffee-stale');
  assert.equal(conflict.status, 'conflict'); assert.deepEqual(conflict.state, state);
  const next = await repository.save('coffee-user', engine.snapshot(), saved.recordChangeTag, 'coffee-next');
  assert.equal(next.status, 'saved'); assert.deepEqual((await repository.load('coffee-user')).state, engine.snapshot());
  const future = engine.snapshot(); future.economyVersion = 10;
  assert.equal((await repository.save('coffee-user', future, next.recordChangeTag, 'coffee-future')).status, 'invalid-state');
  assert.deepEqual((await repository.load('coffee-user')).state, engine.snapshot());
});

test('TC-3D-027 paused guest drainage stops at the same final tick for long and partitioned advances', () => {
  for (const carry of [0, .037]) {
    const live = createEngine(); live.advance(8); const initial = live.snapshot(); initial.stepCarry = carry; initial.paused = true;
    assert.ok(initial.customers.length); const arrivals = initial.nextCustomerId;
    const whole = createEngine(initial), split = createEngine(initial);
    whole.advance(60); for (let i = 0; i < 1200; i++) split.advance(.05);
    assert.deepEqual(whole.snapshot(), split.snapshot()); assert.deepEqual(whole.drainEvents(), split.drainEvents());
    assert.equal(whole.state.customers.length, 0); assert.equal(whole.state.nextCustomerId, arrivals);
    assert.equal(whole.state.paused, true); assert.equal(whole.state.stepCarry, 0);
    assert.ok(whole.state.elapsed < initial.elapsed + 60, 'closed empty shop clock stops at the final exit');
    const frozen = whole.snapshot(); whole.advance(3600); assert.deepEqual(whole.snapshot(), frozen);
    assert.equal(validateState(frozen).ok, true);
  }
});

test('FIXED-COFFEE-004 local economy6 settles old coffee rules once, then fixed recipes with no refund',()=>{
 const old=createEngine();old.upgrade('counter-b');old.state.coffeeLevels.latte=4;const storage=createMemoryStorage(),repo=new LocalSaveRepository(storage);repo.load(100000);repo.save(old.snapshot(),100000);const legacy=JSON.parse(storage.getItem(SAVE_KEY));legacy.state.economyVersion=6;storage.setItem(SAVE_KEY,JSON.stringify(legacy));
 const expected=createEngine(old.snapshot(),undefined,{legacyCoffeeLevels:true});expected.applyOffline(60,'reference',4);const load=new LocalSaveRepository(storage).load(160000);assert.equal(load.status,'loaded');assert.equal(load.state.wallet,expected.state.wallet);assert.equal(load.state.spend,old.state.spend);assert.deepEqual(load.state.ingredients,expected.state.ingredients);assert.equal(load.state.counters[1].level,2);assert.equal(load.state.coffeeLevels.latte,4);assert.equal(load.state.economyVersion, 9);const again=new LocalSaveRepository(storage).load(160000);assert.deepEqual(again.state,load.state);assert.equal(createEngine(load.state).coffeeQuote('latte').beforePrice,recipeById.latte.price);
});
