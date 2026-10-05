import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
const { createEngine, createInitialState, INITIAL_WALLET, STEP_SECONDS, WORLD } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, createMemoryStorage, validateState } = await import('../src/slice/core/persistence.ts');
const clone = value => structuredClone(value);
const guest = (id, counterId, phase, x, z, extra = {}) => ({ id, counterId, phase, x, z, timer: 0, hasCup: phase === 'receiving' || phase === 'leaving', skin: id % 6, ...extra });
const rawEnvelope = state => JSON.stringify({ schemaVersion: 1, savedAt: 1000, recordChangeTag: 'old-route-retirement', state });
function oldInitial(version = 1) {
  const state = createInitialState(); state.economyVersion = 3; delete state.ingredients; state.layout.version = 2; state.layout.active = false; state.layout.coffeeSigns.forEach(sign => { sign.stored = false; }); state.manager.target = 1;
  if (version === undefined) delete state.customerRouteVersion; else state.customerRouteVersion = version;
  return state;
}
function route1Brews() {
  const state = oldInitial(); state.nextCustomerId = 6;
  state.customers = [guest(1, 'counter-a', 'receiving', 0, 1.5, { timer: .35 }), guest(2, 'counter-b', 'serving', 5, 1.5), guest(3, 'counter-a', 'queue', 0, 2.22), guest(4, 'counter-b', 'entering', -1, 4.1), guest(5, 'counter-a', 'leaving', -3, 5, { timer: 2 })];
  state.counters[0].brew = { recipe: 'espresso', elapsed: 2.7, duration: 2.7, price: 110, customerId: 1 }; state.counters[1].brew = { recipe: 'latte', elapsed: .5, duration: 6.8, price: 246, customerId: 2 };
  state.counters[0].brewed = 2; state.totalServed = 1; state.counters[0].pendingCash = 110; state.totalEarned = 110; return state;
}
function route2Legs() {
  const state = oldInitial(2); state.nextCustomerId = 7;
  state.customers = [guest(1, 'counter-a', 'entering', -7, 5, { routeLeg: 0 }), guest(2, 'counter-b', 'entering', -6, 6, { routeLeg: 1 }), guest(3, 'counter-a', 'entering', -3, 8.2, { routeLeg: 2 }), guest(4, 'counter-b', 'entering', 5, 7, { routeLeg: 3 }), guest(5, 'counter-a', 'leaving', 1, 1.5, { routeLeg: 0 }), guest(6, 'counter-b', 'leaving', 6.6, 7.1, { routeLeg: 1 })];
  state.stepCarry = .027; state.totalServed = 2; state.counters.forEach(counter => { counter.brewed = 1; }); state.totalEarned = 356; state.counters[0].pendingCash = 110; state.counters[1].pendingCash = 246; return state;
}
function stepAndCheck(engine) {
  const before = new Map(engine.state.customers.map(customer => [customer.id, clone(customer)])); engine.advance(STEP_SECONDS);
  assert.equal(validateState(engine.snapshot()).ok, true); assert.equal(engine.state.wallet + engine.state.spend, INITIAL_WALLET + engine.state.totalEarned);
  for (const customer of engine.state.customers) if (before.has(customer.id)) assert.ok(Math.hypot(customer.x - before.get(customer.id).x, customer.z - before.get(customer.id).z) <= .125 + 1e-8);
  return before;
}
for (const version of [undefined, 1]) test(`TC-3D-027 route${version ?? 'unversioned'} migrating entry and three old exit legs are continuous and reloadable`, () => {
  const source = oldInitial(version); if (version === undefined) delete source.customerRouteVersion; source.nextCustomerId = 5;
  source.customers = [guest(1, 'counter-a', 'entering', -3, 3.1), guest(2, 'counter-b', 'leaving', 5.65, 1.58), guest(3, 'counter-a', 'leaving', 1.25, 3, { timer: 1 }), guest(4, 'counter-b', 'leaving', 2, 5, { timer: 2 })];
  source.totalServed = 3; source.counters[0].brewed = 1; source.counters[1].brewed = 2; source.totalEarned = 500; source.counters[0].pendingCash = 200; source.counters[1].pendingCash = 300; source.stepCarry = .027;
  const checked = validateState(source); assert.equal(checked.ok, true, checked.message); assert.deepEqual(checked.state.customers.map(({ finishLegacyRoute, ...customer }) => customer), source.customers); assert.ok(checked.state.customers.every(customer => customer.finishLegacyRoute));
  const engine = createEngine(checked.state); engine.togglePause(); assert.equal(engine.invite(), false);
  for (let i = 0; i < 1500 && engine.state.customers.length; i++) {
    stepAndCheck(engine);
    if (i === 15) { const storage = createMemoryStorage(), snapshot = engine.snapshot(); assert.equal(new LocalSaveRepository(storage).save(snapshot, 1000).ok, true); const replay = createEngine(new LocalSaveRepository(storage).load(1000).state), direct = createEngine(snapshot); replay.advance(40); direct.advance(40); assert.deepEqual(replay.snapshot(), direct.snapshot()); }
  }
  assert.equal(engine.state.customers.length, 0); assert.equal(engine.state.customerRouteVersion, 4); assert.equal(engine.state.totalServed, 4); assert.equal(engine.state.totalEarned, 610);
});

test('TC-3D-027 route1 stationary service phases retain frozen receipts and reject invalid coordinates/flags', () => {
  const source = route1Brews(), checked = validateState(source); assert.equal(checked.ok, true, checked.message); assert.deepEqual(checked.state.customers.slice(0, 3), source.customers.slice(0, 3)); assert.deepEqual(checked.state.counters.map(counter => counter.brew), source.counters.map(counter => counter.brew));
  const engine = createEngine(checked.state); engine.advance(.35); assert.equal(engine.state.totalServed, 2); assert.equal(engine.state.totalEarned, 220); assert.equal(engine.state.wallet, INITIAL_WALLET + 220);
  for (const mutate of [state => { state.customers[2].x = .3; }, state => { state.customers[0].z = 2; }, state => { state.customers[3].timer = 1; }, state => { state.customers[3].routeLeg = 0; }, state => { state.customers[3].finishLegacyRoute = true; }, state => { state.customers[3].nav = [{ x: 0, z: 2 }]; }]) { const corrupt = clone(source); mutate(corrupt); assert.equal(validateState(corrupt).ok, false, mutate.toString()); const storage = createMemoryStorage(), raw = rawEnvelope(corrupt); storage.setItem(SAVE_KEY, raw); const repo = new LocalSaveRepository(storage); assert.equal(repo.load(1000).status, 'corrupt'); assert.equal(repo.save(createInitialState()).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw); }
});

test('TC-3D-027 route2 all inbound/outbound legs retain coordinates and extend their existing departure exactly once', () => {
  const source = route2Legs(), checked = validateState(source); assert.equal(checked.ok, true, checked.message); assert.deepEqual(checked.state.customers, source.customers);
  const engine = createEngine(checked.state); engine.togglePause(); let reachedReturn = false, exited = false;
  for (let i = 0; i < 2400 && engine.state.customers.length; i++) {
    const before = stepAndCheck(engine), leaving = engine.state.customers.find(customer => customer.id === 6);
    if (leaving?.routeLeg === 2 && leaving.x < 6.6) reachedReturn = true;
    if (before.has(6) && !leaving) { assert.ok(before.get(6).x < WORLD.exitX + .125 + 1e-8); exited = true; }
    if (i === 17) { const state = engine.snapshot(), storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); assert.equal(repo.save(state, 1000).ok, true); const replay = createEngine(new LocalSaveRepository(storage).load(1000).state), direct = createEngine(state); replay.advance(120); direct.advance(120); assert.deepEqual(replay.snapshot(), direct.snapshot()); }
  }
  assert.ok(reachedReturn && exited); assert.equal(engine.state.customers.length, 0); assert.equal(engine.state.totalServed, 6); assert.equal(engine.state.customerRouteVersion, 4);
});

test('TC-3D-027 route2 malformed legs and false legacy flags protect source bytes', () => {
  for (const mutate of [state => { delete state.customers[0].routeLeg; }, state => { state.customers[0].routeLeg = -1; }, state => { state.customers[0].routeLeg = 4; }, state => { state.customers[0].routeLeg = .5; }, state => { state.customers[0].routeLeg = 1; }, state => { state.customers[0].timer = .1; }, state => { state.customers[0].finishLegacyRoute = false; }, state => { state.customers[0].x = Infinity; }, state => { state.customers[5].z = 7.2; }, state => { state.customers[5].routeLeg = 2; }, state => { state.customers[4].z = 2; }]) {
    const state = route2Legs(); mutate(state); assert.equal(validateState(state).ok, false, mutate.toString()); const storage = createMemoryStorage(), raw = rawEnvelope(state); storage.setItem(SAVE_KEY, raw); const repo = new LocalSaveRepository(storage); assert.equal(repo.load(121000).status, 'corrupt'); assert.equal(repo.save(createInitialState()).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
  }
});

test('TC-3D-027 close route2 turns continuously regain body clearance and finish without teleport', () => {
  const source = oldInitial(2); source.nextCustomerId = 3; source.customers = [guest(1, 'counter-a', 'entering', -6, 8.1, { routeLeg: 1 }), guest(2, 'counter-b', 'entering', -6, 7.6, { routeLeg: 1 })];
  const checked = validateState(source); assert.equal(checked.ok, true); const engine = createEngine(checked.state); engine.togglePause(); let previous = .5, recovered = false;
  for (let i = 0; i < 1500 && engine.state.customers.length; i++) { stepAndCheck(engine); if (engine.state.customers.length !== 2) continue; const [a, b] = engine.state.customers, gap = Math.hypot(a.x - b.x, a.z - b.z); if (!recovered) assert.ok(gap + 1e-8 >= previous); if (gap >= .72 - 1e-8) recovered = true; if (recovered) assert.ok(gap >= .72 - 1e-8); previous = gap; }
  assert.equal(recovered, true); assert.equal(engine.state.customers.length, 0); assert.equal(engine.state.totalServed, 2);
});

for (const source of [route1Brews(), route2Legs()]) test(`TC-3D-027 route${source.customerRouteVersion} offline migration survives quota failure, once-only retry, pause and CAS`, () => {
  const raw = rawEnvelope(source), storage = createMemoryStorage(); storage.setItem(SAVE_KEY, raw); const migrated = validateState(source).state;
  const failed = new LocalSaveRepository({ ...storage, setItem() { throw Error('quota'); } }).load(121000); assert.equal(failed.status, 'offline-save-failed'); assert.equal(failed.offline.accepted, false); assert.deepEqual(failed.state, migrated); assert.equal(storage.getItem(SAVE_KEY), raw);
  const result = new LocalSaveRepository(storage).load(121000); assert.equal(result.offline.accepted, true); assert.equal(result.state.customerRouteVersion, 4); assert.deepEqual(new LocalSaveRepository(storage).load(121000).state, result.state);
  const a = new LocalSaveRepository(storage), b = new LocalSaveRepository(storage), first = a.load(121000).state, second = b.load(121000).state; assert.equal(a.save(first, 122000).ok, true); const winner = storage.getItem(SAVE_KEY); assert.equal(b.save(second, 122000).status, 'conflict'); assert.equal(storage.getItem(SAVE_KEY), winner);
  const paused = clone(source); paused.paused = true; const closed = createMemoryStorage(); closed.setItem(SAVE_KEY, rawEnvelope(paused)); const loaded = new LocalSaveRepository(closed).load(121000); assert.equal(loaded.offline.amount, 0); assert.equal(loaded.state.totalEarned, paused.totalEarned); assert.equal(loaded.state.elapsed, paused.elapsed); assert.deepEqual(loaded.state.customers, validateState(paused).state.customers);
});
