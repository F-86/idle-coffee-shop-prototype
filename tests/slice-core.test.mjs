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
const { createEngine, createInitialState, recipes, MAX_LEVEL, INITIAL_WALLET, counterBrewSeconds, counterPrice, managerCapacity, managerSpeed, STEP_SECONDS, WORLD, MANAGER_ROUTE_VERSION } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, validateState, createMemoryStorage } = await import('../src/slice/core/persistence.ts');
const { InMemorySaveRepository, GuestAuthProvider } = await import('../src/slice/core/sync.ts');

function assets(state) { return state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0); }
function withPendingCash(a = 1200, b = 1200) {
  const state = createInitialState();
  state.counters[0].pendingCash = a; state.counters[1].pendingCash = b;
  state.totalEarned = a + b;
  return state;
}
function cashEvents(events) { return events.filter(event => event.type === 'collected' || event.type === 'deposited'); }
function until(engine, predicate, maxTicks = 1000) {
  const events = [];
  for (let tick = 0; tick < maxTicks; tick++) {
    if (predicate(engine.state, events)) return events;
    engine.advance(STEP_SECONDS); events.push(...engine.drainEvents());
  }
  assert.fail('Deterministic fixture did not reach its expected manager phase.');
}
function legacyState(manager = {}, a = 900, b = 900) {
  const state = withPendingCash(a, b);
  delete state.managerRouteVersion;
  state.manager = { ...state.manager, x: -8, target: 0, ...manager };
  state.totalEarned += state.manager.carrying;
  return state;
}
function rawEnvelope(state, savedAt = 1000, recordChangeTag = 'legacy-route-source') {
  return JSON.stringify({ schemaVersion: 1, savedAt, recordChangeTag, state });
}

test('TC-3D-001 real manager route collects nearest B, farther A, then deposits at the shared vault', () => {
  const initial = withPendingCash();
  assert.equal(MANAGER_ROUTE_VERSION, 2);
  assert.equal(WORLD.vaultX, 8.8);
  assert.deepEqual(initial.counters.map(counter => counter.x), [0, 5]);
  assert.ok(Math.abs(WORLD.vaultX - initial.counters[1].x) < Math.abs(WORLD.vaultX - initial.counters[0].x));
  assert.equal(initial.manager.x, WORLD.vaultX); assert.equal(initial.manager.target, 1);
  const engine = createEngine(initial), stops = [], events = [];
  let previousPhase = 'moving';
  for (let i = 0; i < 500 && cashEvents(events).length < 4; i++) {
    const before = structuredClone(engine.state.manager);
    engine.advance(STEP_SECONDS); events.push(...engine.drainEvents());
    const manager = engine.state.manager;
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
    assert.equal(validateState(engine.snapshot()).ok, true);
    assert.ok(manager.x >= 0 && manager.x <= WORLD.vaultX);
    assert.ok(Math.abs(manager.x - before.x) <= managerSpeed(manager.level) * STEP_SECONDS + 1e-9);
    if (manager.phase !== previousPhase && manager.phase !== 'moving') stops.push([manager.target, manager.x, manager.phase]);
    previousPhase = manager.phase;
    if (!cashEvents(events).some(event => event.type === 'deposited')) assert.equal(engine.state.wallet, INITIAL_WALLET);
  }
  assert.deepEqual(stops.slice(0, 4), [[1, 5, 'collecting'], [0, 0, 'collecting'], [2, 8.8, 'depositing'], [1, 5, 'collecting']]);
  assert.deepEqual(cashEvents(events).slice(0, 4).map(({ type, counterId, amount }) => [type, counterId ?? null, amount]), [
    ['collected', 'counter-b', 600], ['collected', 'counter-a', 600], ['deposited', null, 1200], ['collected', 'counter-b', 600]
  ]);
});

test('TC-3D-001 B-first collection preserves per-counter half-bag limits at every manager level', () => {
  for (const level of [1, 7, MAX_LEVEL]) {
    const initial = withPendingCash(20000, 20000); initial.manager.level = level;
    const engine = createEngine(initial);
    const events = until(engine, (_, events) => cashEvents(events).some(event => event.type === 'deposited'));
    const limit = Math.floor(managerCapacity(level) / 2);
    assert.deepEqual(cashEvents(events).map(({ type, counterId, amount }) => [type, counterId ?? null, amount]), [
      ['collected', 'counter-b', limit], ['collected', 'counter-a', limit], ['deposited', null, limit * 2]
    ]);
    assert.equal(managerSpeed(level), 2.6 + .18 * (level - 1));
    assert.equal(managerCapacity(level), 1200 + 180 * (level - 1));
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
  }
});

test('TC-3D-003 real route keeps identical state and cash-event order under split advance', () => {
  const whole = createEngine(withPendingCash(30000, 30000)), split = createEngine(withPendingCash(30000, 30000));
  whole.advance(72.137);
  for (let i = 0; i < 720; i++) split.advance(.1);
  split.advance(.137);
  assert.deepEqual(split.snapshot(), whole.snapshot());
  assert.deepEqual(split.drainEvents(), whole.drainEvents());
});

test('TC-3D-004 route resumes exactly after saving each moving, collecting and depositing leg', () => {
  const checkpoints = [.137, 1.713, 2.137, 4.113, 5.137, 8.013];
  for (const checkpoint of checkpoints) {
    const uninterrupted = createEngine(withPendingCash(30000, 30000)); uninterrupted.advance(checkpoint); uninterrupted.drainEvents();
    const before = uninterrupted.snapshot(), storage = createMemoryStorage(), repo = new LocalSaveRepository(storage);
    assert.equal(repo.save(before, 1000).ok, true);
    const loaded = new LocalSaveRepository(storage).load(1000);
    assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, before);
    assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).state.managerRouteVersion, 2);
    const restored = createEngine(loaded.state);
    uninterrupted.advance(26.413);
    for (let i = 0; i < 264; i++) restored.advance(.1);
    restored.advance(.013);
    assert.deepEqual(restored.snapshot(), uninterrupted.snapshot(), `resume at ${checkpoint}s`);
    assert.deepEqual(restored.drainEvents(), uninterrupted.drainEvents(), `events at ${checkpoint}s`);
  }
});

test('TC-3D-004 explicit legacy migration preserves in-flight stops, timers, assets and once-only versioning', () => {
  const fixtures = [
    { manager: { phase: 'moving', target: 0, x: -4, timer: 0 }, x: 4.4, collected: ['counter-a', 'counter-b'] },
    { manager: { phase: 'collecting', target: 0, x: 0, timer: .2 }, x: 0, collected: ['counter-a', 'counter-b'] },
    { manager: { phase: 'moving', target: 1, x: 2.5, timer: 0, carrying: 600 }, x: 2.5, collected: ['counter-b'] },
    { manager: { phase: 'collecting', target: 1, x: 5, timer: .2, carrying: 600 }, x: 5, collected: ['counter-b'] },
    { manager: { phase: 'moving', target: 2, x: -1.5, timer: 0, carrying: 1200 }, x: 6.9, collected: [] },
    { manager: { phase: 'depositing', target: 2, x: -8, timer: .25, carrying: 1200 }, x: 8.8, collected: [] }
  ];
  for (const fixture of fixtures) {
    const source = legacyState(fixture.manager);
    source.stepCarry = .027; source.eventSequence = 91; source.lastOfflineClaimId = 'already-claimed'; source.offlineClaimIds = ['older-claim', 'already-claimed'];
    const original = structuredClone(source), checked = validateState(source);
    assert.equal(checked.ok, true);
    assert.deepEqual(source, original, 'validator never mutates archive input');
    const migrated = checked.state;
    assert.equal(migrated.managerRouteVersion, 2);
    assert.ok(Math.abs(migrated.manager.x - fixture.x) < 1e-9);
    assert.equal(migrated.manager.target, source.manager.target); assert.equal(migrated.manager.phase, source.manager.phase);
    assert.equal(migrated.manager.timer, source.manager.timer); assert.equal(migrated.manager.carrying, source.manager.carrying);
    for (const key of ['wallet', 'totalEarned', 'spend', 'elapsed', 'stepCarry', 'eventSequence', 'lastOfflineClaimId', 'offlineClaimIds', 'counters', 'customers']) assert.deepEqual(migrated[key], source[key], key);
    assert.equal(validateState(migrated).ok, true);
    assert.deepEqual(validateState(migrated).state, migrated, 'already-v2 archives are never mapped again');
    const engine = createEngine(source); assert.deepEqual(engine.snapshot(), migrated);
    const firstSweep = until(engine, (_, events) => cashEvents(events).some(event => event.type === 'deposited'));
    assert.deepEqual(cashEvents(firstSweep).filter(event => event.type === 'collected').map(event => event.counterId), fixture.collected);
    assert.equal(cashEvents(firstSweep).filter(event => event.type === 'deposited').length, 1);
    assert.equal(engine.state.manager.finishLegacySweep, undefined); assert.equal(engine.state.manager.target, 1);
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
    const nextSweep = until(engine, (_, events) => cashEvents(events).some(event => event.type === 'collected'));
    assert.equal(cashEvents(nextSweep)[0].counterId, 'counter-b', 'every subsequent sweep starts nearest the vault');
    const frozen = engine.snapshot(); assert.equal(engine.applyOffline(60, 'already-claimed').accepted, false); assert.deepEqual(engine.snapshot(), frozen);
  }
  for (const explicitVersion of [undefined, 1]) {
    const source = legacyState(); if (explicitVersion) source.managerRouteVersion = explicitVersion;
    const migrated = validateState(source).state;
    assert.equal(migrated.manager.x, 8.8); assert.equal(migrated.manager.target, 1); assert.equal(migrated.manager.finishLegacySweep, undefined);
  }
});

test('TC-3D-004 legacy migration leaves active customers and frozen brew snapshots untouched', () => {
  const live = createEngine(); live.advance(11.027);
  const source = live.snapshot(); delete source.managerRouteVersion;
  source.manager = { ...source.manager, x: -3, target: 0, phase: 'moving', timer: 0 };
  assert.ok(source.customers.length && source.counters.some(counter => counter.brew));
  const checked = validateState(source); assert.equal(checked.ok, true);
  assert.deepEqual(checked.state.customers, source.customers); assert.deepEqual(checked.state.counters, source.counters);
  assert.equal(checked.state.arrivalTimer, source.arrivalTimer); assert.equal(checked.state.nextCustomerId, source.nextCustomerId);
  assert.equal(checked.state.stepCarry, source.stepCarry); assert.equal(checked.state.eventSequence, source.eventSequence);
});

test('TC-3D-004 a migrated sweep resumes without repeating stops after every in-flight save/reload', () => {
  const checkpoints = [
    [.137, 'moving', 0], [1.913, 'collecting', 0], [2.337, 'moving', 1],
    [4.313, 'collecting', 1], [5.137, 'moving', 2], [6.313, 'depositing', 2]
  ];
  for (const [checkpoint, phase, target] of checkpoints) {
    const original = legacyState({ x: -4 }, 5000, 5000);
    const uninterrupted = createEngine(original); uninterrupted.advance(checkpoint); uninterrupted.drainEvents();
    const before = uninterrupted.snapshot();
    assert.equal(before.manager.finishLegacySweep, true); assert.equal(before.manager.phase, phase); assert.equal(before.manager.target, target);
    const storage = createMemoryStorage(); storage.setItem(SAVE_KEY, rawEnvelope(original));
    const repo = new LocalSaveRepository(storage); repo.load(1000); assert.equal(repo.save(before, 1000).ok, true);
    const loaded = new LocalSaveRepository(storage).load(1000);
    assert.deepEqual(loaded.state, before, 'version2 continuation must not be remapped or reset');
    const restored = createEngine(loaded.state);
    uninterrupted.advance(30.413); restored.advance(30.413);
    assert.deepEqual(restored.snapshot(), uninterrupted.snapshot()); assert.deepEqual(restored.drainEvents(), uninterrupted.drainEvents());
    assert.equal(restored.state.manager.finishLegacySweep, undefined);
    assert.equal(assets(restored.state), INITIAL_WALLET + restored.state.totalEarned);
  }
});

test('TC-3D-004 new route validator rejects off-stop actions, invalid segments and migration/version misuse', () => {
  const mutations = [
    s => s.managerRouteVersion = 0, s => s.managerRouteVersion = '2', s => s.managerRouteVersion = 3,
    s => s.manager.finishLegacySweep = false, s => s.manager.finishLegacySweep = 'true',
    s => { s.manager.phase = 'collecting'; s.manager.x = 0; },
    s => { s.manager.phase = 'depositing'; s.manager.target = 2; s.manager.x = 0; },
    s => s.manager.x = 4, s => { s.manager.target = 0; s.manager.x = 6; },
    s => s.manager.timer = .1,
    s => { s.manager.finishLegacySweep = true; s.manager.target = 1; s.manager.x = 6; },
    s => { s.manager.finishLegacySweep = true; s.manager.target = 2; s.manager.x = 4; }
  ];
  for (const mutate of mutations) { const state = createInitialState(); mutate(state); assert.equal(validateState(state).ok, false); }
  const invalidLegacyMarker = legacyState(); invalidLegacyMarker.manager.finishLegacySweep = true;
  assert.equal(validateState(invalidLegacyMarker).ok, false);
  // Previous validation accepted these unreachable coordinates/timers. Migration
  // must return a physically safe v2 state that remains valid on its next save.
  for (const manager of [{ phase: 'collecting', target: 1, x: -3, timer: .6 }, { phase: 'depositing', target: 2, x: 1, timer: .6 }, { phase: 'moving', target: 2, x: 0, timer: .2 }]) {
    const source = legacyState(manager), checked = validateState(source);
    assert.equal(checked.ok, true); assert.equal(validateState(checked.state).ok, true); assert.equal(checked.state.manager.timer, manager.timer);
  }
  for (const version of [3, 99]) {
    const state = createInitialState(); state.managerRouteVersion = version;
    const storage = createMemoryStorage(), raw = rawEnvelope(state); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage); const load = repo.load(121000);
    assert.equal(load.status, 'future'); assert.equal(load.protectedRaw, true); assert.equal(repo.save(load.state, 121000).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
  }
  for (const mutate of [s => s.managerRouteVersion = '2', s => s.manager.finishLegacySweep = false, s => { s.manager.phase = 'depositing'; s.manager.target = 2; s.manager.x = 0; }]) {
    const state = createInitialState(); mutate(state);
    const storage = createMemoryStorage(), raw = rawEnvelope(state); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage); const load = repo.load(121000);
    assert.equal(load.status, 'corrupt'); assert.equal(load.protectedRaw, true); assert.equal(repo.save(load.state, 121000).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
  }
});

test('TC-3D-004 authentic legacy archives migrate offline only once and retain retries/CAS protection', () => {
  const source = legacyState({ target: 1, x: 3, carrying: 600 }); source.stepCarry = .027; source.eventSequence = 42;
  const raw = rawEnvelope(source), memory = createMemoryStorage(); memory.setItem(SAVE_KEY, raw);
  const immediate = new LocalSaveRepository(memory).load(1000);
  assert.equal(immediate.status, 'loaded'); assert.equal(immediate.state.managerRouteVersion, 2);
  assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).offlinePolicyVersion, 3);
  assert.deepEqual(JSON.parse(memory.getItem(SAVE_KEY)).state, immediate.state);
  memory.setItem(SAVE_KEY, raw); // Exercise failure/retry from authentic pre-policy bytes.
  const expected = createEngine(immediate.state); expected.advance(60);
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
  const paused = legacyState({ phase: 'depositing', target: 2, x: -8, carrying: 1200, timer: .25 }); paused.paused = true;
  const pausedMemory = createMemoryStorage(); pausedMemory.setItem(SAVE_KEY, rawEnvelope(paused));
  const pausedLoad = new LocalSaveRepository(pausedMemory).load(121000);
  assert.equal(pausedLoad.offline.amount, 0); assert.equal(pausedLoad.state.elapsed, 0); assert.equal(pausedLoad.state.manager.timer, .25); assert.equal(pausedLoad.state.manager.carrying, 1200);
});

test('TC-3D-001 cash stays conserved through visible customer and manager phases', () => {
  const engine = createEngine();
  const phases = new Set(); let hadPending = false; let hadCarrying = false; let deposited = false;
  for (let i = 0; i < 2400; i++) {
    engine.advance(.05);
    for (const customer of engine.state.customers) phases.add(customer.phase);
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
    assert.ok(Number.isInteger(engine.state.wallet));
    assert.equal(engine.state.manager.z, -1.7);
    hadPending ||= engine.state.counters.some(counter => counter.pendingCash > 0);
    hadCarrying ||= engine.state.manager.carrying > 0;
    deposited ||= engine.drainEvents().some(event => event.type === 'deposited');
  }
  assert.deepEqual([...phases].sort(), ['entering', 'leaving', 'queue', 'receiving', 'serving']);
  assert.ok(hadPending && hadCarrying && deposited);
  assert.ok(engine.state.totalServed > 5);
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

test('TC-3D-002 original counter affinities create a meaningful recipe tradeoff', () => {
  assert.equal(counterBrewSeconds('espresso', 1, 'counter-a'), counterBrewSeconds('espresso', 1, 'counter-b') * .75);
  assert.ok(counterPrice('latte', 1, 'counter-b') > counterPrice('latte', 1, 'counter-a'));
  const fast = createEngine(), slow = createEngine();
  fast.setRecipe('counter-b', 'espresso'); slow.setRecipe('counter-a', 'latte');
  fast.advance(180); slow.advance(180);
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

test('TC-3D-004 offline close-loop income has no gameplay cap and is claimed only once', () => {
  const engine = createEngine();
  const result = engine.applyOffline(7201, 'claim-1');
  assert.equal(result.accepted, true); assert.equal(result.seconds, 7201); assert.ok(result.amount > 0);
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

test('TC-3D-001 capped production exposes a real transport bottleneck removable by manager upgrades', () => {
  const initial = createInitialState(); initial.counters.forEach(counter => counter.level = MAX_LEVEL);
  const slow = createEngine(initial); const fasterInitial = structuredClone(initial); fasterInitial.manager.level = MAX_LEVEL;
  const faster = createEngine(fasterInitial); slow.advance(1200); faster.advance(1200);
  assert.equal(slow.state.totalEarned, faster.state.totalEarned);
  assert.ok(faster.state.wallet > slow.state.wallet);
  const slowPending = slow.state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
  const fasterPending = faster.state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
  assert.ok(slowPending > managerCapacity(MAX_LEVEL) * 10, 'a substantial capped-production backlog remains under the shorter physical route');
  assert.ok(fasterPending < slowPending / 10, 'manager upgrades remove the transport bottleneck without changing production');
  assert.equal(assets(slow.state), INITIAL_WALLET + slow.state.totalEarned);
  assert.equal(assets(faster.state), INITIAL_WALLET + faster.state.totalEarned);
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
  const initial = withPendingCash(300, 270), memory = createMemoryStorage();
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
  assert.equal(repo.load(1000).status, 'new'); assert.equal(repo.save(withPendingCash(), 1000).ok, true);
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
  const winner = rawEnvelope(withPendingCash(), 1000, 'new-client'); memory.setItem(SAVE_KEY, winner);
  assert.equal(repo.reset({ confirmProtected: true }).status, 'conflict'); assert.equal(memory.getItem(SAVE_KEY), winner);
  assert.equal(repo.load(1000).status, 'loaded'); assert.equal(repo.save(withPendingCash(), 1000).ok, true);
});
