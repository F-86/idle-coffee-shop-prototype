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
const { createEngine, createInitialState, recipes, MAX_LEVEL, INITIAL_WALLET, counterBrewSeconds, counterPrice } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, validateState, createMemoryStorage } = await import('../src/slice/core/persistence.ts');
const { InMemorySaveRepository, GuestAuthProvider } = await import('../src/slice/core/sync.ts');

function assets(state) { return state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0); }

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

test('TC-3D-004 offline close-loop income is bounded and claimed only once', () => {
  const engine = createEngine();
  const result = engine.applyOffline(100_000, 'claim-1');
  assert.equal(result.accepted, true); assert.equal(result.seconds, 7200); assert.ok(result.amount > 0);
  const snapshot = engine.snapshot();
  assert.equal(engine.applyOffline(100_000, 'claim-1').accepted, false);
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
  assert.equal(first.state.elapsed, 60);
  const older = new LocalSaveRepository(storage);
  const backwards = older.load(91000);
  assert.equal(backwards.state.elapsed, 60);
  older.save(backwards.state, 91000);
  const second = new LocalSaveRepository(storage).load(151000);
  assert.equal(second.state.elapsed, 75);
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
  assert.ok(slow.state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0) > slow.state.wallet - INITIAL_WALLET);
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
