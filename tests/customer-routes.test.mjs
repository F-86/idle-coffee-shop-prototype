import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { createEngine, createInitialState, CUSTOMER_ROUTE_VERSION, CUSTOMER_SPEED, INITIAL_WALLET, MAX_LEVEL, QUEUE_CAPACITY, STEP_SECONDS, WORLD } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, validateState, createMemoryStorage } = await import('../src/slice/core/persistence.ts');
const EPSILON = 1e-8;
const maxStep = CUSTOMER_SPEED * STEP_SECONDS;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const counterX = customer => customer.counterId === 'counter-a' ? 0 : 5;
const assets = state => state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
const envelope = state => JSON.stringify({ schemaVersion: 1, savedAt: 1000, recordChangeTag: 'customer-route-test', state });
const clone = value => structuredClone(value);
function guest(id, counterId, phase, x, z, extra = {}) {
  return { id, counterId, phase, x, z, timer: 0, hasCup: phase === 'receiving' || phase === 'leaving', skin: id % 6, ...extra };
}
function fullQueueState(level = 1) {
  const state = createInitialState();
  for (const counter of state.counters) {
    counter.level = level;
    for (let i = 0; i < QUEUE_CAPACITY; i++) state.customers.push(guest(state.nextCustomerId++, counter.id, 'queue', counter.x, WORLD.serviceZ + i * WORLD.queueGap));
  }
  return state;
}
function assertSeparated(state) {
  for (const leaving of state.customers.filter(customer => customer.phase === 'leaving')) {
    for (const inbound of state.customers.filter(customer => customer.phase !== 'leaving')) {
      assert.ok(distance(leaving, inbound) >= WORLD.queueGap - EPSILON,
        `opposing traffic clearance ${distance(leaving, inbound)}: ${JSON.stringify({ leaving, inbound })}`);
    }
  }
}
function pointSegmentDistance(point, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point.x - from.x - t * dx, point.z - from.z - t * dz);
}
function samplePolyline(points) {
  const sampled = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i], count = Math.ceil(distance(from, to) / .04);
    for (let j = 0; j <= count; j++) sampled.push({ x: from.x + (to.x - from.x) * j / count, z: from.z + (to.z - from.z) * j / count });
  }
  return sampled;
}

test('TC-3D-011 customer route geometry separates the trunk, full queues and local exits', () => {
  assert.equal(CUSTOMER_ROUTE_VERSION, 2);
  assert.ok(WORLD.inboundZ - WORLD.exitZ > WORLD.queueGap);
  assert.ok(WORLD.inboundZ > WORLD.serviceZ + (QUEUE_CAPACITY - 1) * WORLD.queueGap + WORLD.queueGap);
  assert.ok(WORLD.departureOffsetX > WORLD.queueGap);
  const incoming = [0, 5].map(x => [
    { x: WORLD.entryX, z: WORLD.entryZ }, { x: WORLD.inboundX, z: WORLD.entryZ },
    { x: WORLD.inboundX, z: WORLD.inboundZ }, { x, z: WORLD.inboundZ }, { x, z: WORLD.serviceZ }
  ]);
  const outgoing = [0, 5].map(x => [{ x, z: WORLD.serviceZ }, { x: x + WORLD.departureOffsetX, z: WORLD.serviceZ }, { x: x + WORLD.departureOffsetX, z: WORLD.exitZ }]);
  for (let a = 0; a < outgoing.length; a++) {
    for (const point of samplePolyline(outgoing[a])) {
      for (let b = 0; b < incoming.length; b++) {
        // The intentional shared service point is the sole geometric exception;
        // live tests below verify its handoff never overlaps opposing customers.
        if (a === b && point.z === WORLD.serviceZ && point.x - a * 5 < WORLD.queueGap) continue;
        for (let i = 1; i < incoming[b].length; i++) assert.ok(pointSegmentDistance(point, incoming[b][i - 1], incoming[b][i]) >= WORLD.queueGap - EPSILON);
      }
    }
  }
  // Entrance sign's posts/panel are at z5.62. The dogleg remains beside it.
  assert.ok(WORLD.inboundX > -6.76 + .5);
  assert.ok(WORLD.entryZ < 5.62 - .5);
});

test('TC-3D-011 invitation batches arrive in distinct positions on the entry approach', () => {
  const engine = createEngine(); assert.equal(engine.invite(), true);
  assert.equal(engine.state.customers.length, 3);
  const customers = engine.state.customers;
  assert.deepEqual(customers.map(customer => customer.routeLeg), [0, 0, 0]);
  for (let i = 0; i < customers.length; i++) for (let j = i + 1; j < customers.length; j++) assert.ok(distance(customers[i], customers[j]) >= WORLD.queueGap - EPSILON);
  assert.equal(validateState(engine.snapshot()).ok, true);
});

test('TC-3D-011 live paths remain continuous and clear through full queues, upgrades and eventual disappearance', () => {
  const seenLegs = new Set(), exitedCounters = new Set(); let handoffs = 0;
  for (const level of [1, MAX_LEVEL]) {
    const initial = fullQueueState(level); initial.manager.level = level;
    assert.equal(validateState(initial).ok, true);
    const engine = createEngine(initial);
    for (let tick = 0; tick < 3600; tick++) {
      const previous = new Map(engine.state.customers.map(customer => [customer.id, clone(customer)]));
      if (tick % 360 === 0) engine.invite();
      engine.advance(STEP_SECONDS);
      const snapshot = engine.snapshot(), checked = validateState(snapshot);
      assert.equal(checked.ok, true, checked.message);
      assertSeparated(snapshot);
      assert.equal(assets(snapshot), INITIAL_WALLET + snapshot.totalEarned);
      const currentIds = new Set();
      for (const customer of snapshot.customers) {
        currentIds.add(customer.id); seenLegs.add(`${customer.phase}:${customer.routeLeg}`);
        const before = previous.get(customer.id);
        if (before) assert.ok(distance(before, customer) <= maxStep + EPSILON, `teleport at tick ${tick}`);
        if (before?.phase === 'receiving' && customer.phase === 'leaving') handoffs++;
      }
      for (const [id, removed] of previous) {
        if (currentIds.has(id)) continue;
        assert.equal(removed.phase, 'leaving'); assert.equal(removed.routeLeg, 1); assert.equal(removed.hasCup, true);
        assert.ok(distance(removed, { x: counterX(removed) + WORLD.departureOffsetX, z: WORLD.exitZ }) <= maxStep + EPSILON);
        exitedCounters.add(removed.counterId);
      }
    }
  }
  for (const key of ['entering:0', 'entering:1', 'entering:2', 'entering:3', 'leaving:0', 'leaving:1']) assert.ok(seenLegs.has(key), key);
  assert.deepEqual([...exitedCounters].sort(), ['counter-a', 'counter-b']); assert.ok(handoffs > 80);
});

test('TC-3D-011 saving and reloading each inbound and outbound leg resumes exact positions, events and ledgers', () => {
  const engine = createEngine(); engine.invite();
  const checkpoints = new Map();
  for (let tick = 0; tick < 800; tick++) {
    engine.advance(STEP_SECONDS);
    const customer = engine.state.customers.find(customer => customer.id === 1);
    if (!customer) break;
    if (customer.phase === 'entering' || customer.phase === 'leaving') {
      const key = `${customer.phase}:${customer.routeLeg}`;
      // Capture interior positions, not merely the first frame of a new leg.
      if (tick % 4 === 1 && !checkpoints.has(key)) checkpoints.set(key, engine.snapshot());
    }
  }
  assert.equal(checkpoints.size, 6);
  for (const [key, checkpoint] of checkpoints) {
    checkpoint.stepCarry = .027;
    const memory = createMemoryStorage(), repository = new LocalSaveRepository(memory);
    assert.equal(repository.save(checkpoint, 1000).ok, true);
    const loaded = new LocalSaveRepository(memory).load(1000); assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, checkpoint);
    const uninterrupted = createEngine(checkpoint), restored = createEngine(loaded.state);
    uninterrupted.advance(40.413);
    for (let frame = 0; frame < 400; frame++) restored.advance(.1);
    restored.advance(.413);
    assert.deepEqual(restored.snapshot(), uninterrupted.snapshot(), key);
    assert.deepEqual(restored.drainEvents(), uninterrupted.drainEvents(), key);
  }
});

test('TC-3D-011 route validation fails closed on corrupt legs, coordinates, flags and future versions', () => {
  const engine = createEngine(); engine.invite(); const valid = engine.snapshot();
  const mutations = [
    s => s.customerRouteVersion = 0, s => s.customerRouteVersion = '2', s => s.customerRouteVersion = 3,
    s => delete s.customers[0].routeLeg, s => s.customers[0].routeLeg = -1, s => s.customers[0].routeLeg = 4,
    s => s.customers[0].routeLeg = 1.5, s => s.customers[0].routeLeg = 1, s => s.customers[0].z = WORLD.inboundZ + .1,
    s => s.customers[0].x = Infinity, s => s.customers[0].timer = .1,
    s => s.customers[0].finishLegacyRoute = false, s => s.customers[0].finishLegacyRoute = true,
    s => { s.customers[0].phase = 'queue'; s.customers[0].x = 0; s.customers[0].z = WORLD.serviceZ; },
    s => { s.customers[0].phase = 'leaving'; s.customers[0].hasCup = true; s.customers[0].routeLeg = 2; }
  ];
  for (const mutate of mutations) {
    const state = clone(valid); mutate(state); assert.equal(validateState(state).ok, false);
    const raw = envelope(state), memory = createMemoryStorage(); memory.setItem(SAVE_KEY, raw);
    const repository = new LocalSaveRepository(memory), loaded = repository.load(121000);
    assert.equal(loaded.status, state.customerRouteVersion === 3 ? 'future' : 'corrupt'); assert.equal(loaded.protectedRaw, true);
    assert.equal(repository.save(loaded.state, 121000).ok, false); assert.equal(memory.getItem(SAVE_KEY), raw);
  }
  for (const extra of [{ routeLeg: 0, x: 1, z: 2 }, { routeLeg: 1, x: 1, z: 3 }, { routeLeg: 1, x: 1.6, z: 7.2 }]) {
    const state = createInitialState(); state.nextCustomerId = 2;
    state.customers = [guest(1, 'counter-a', 'leaving', 0, WORLD.serviceZ, extra)];
    assert.equal(validateState(state).ok, false);
  }
});

test('TC-3D-011 legacy customers retain coordinates and finish once while new guests follow separated routes', () => {
  for (const version of [undefined, 1]) {
    const source = createInitialState(); delete source.customerRouteVersion; if (version) source.customerRouteVersion = version;
    source.nextCustomerId = 5;
    source.customers = [guest(1, 'counter-a', 'entering', -3, 3.1), guest(2, 'counter-b', 'leaving', 5.65, 1.58),
      guest(3, 'counter-a', 'leaving', 1.25, 3, { timer: 1 }), guest(4, 'counter-b', 'leaving', 2, 5, { timer: 2 })];
    source.totalServed = 3; source.counters[0].brewed = 1; source.counters[1].brewed = 2;
    source.totalEarned = 500; source.counters[0].pendingCash = 200; source.counters[1].pendingCash = 300;
    source.stepCarry = .027; source.eventSequence = 44; source.lastOfflineClaimId = 'already'; source.offlineClaimIds = ['already'];
    const original = clone(source), checked = validateState(source); assert.equal(checked.ok, true); assert.deepEqual(source, original);
    const migrated = checked.state; assert.equal(migrated.customerRouteVersion, CUSTOMER_ROUTE_VERSION);
    assert.deepEqual(migrated.customers.map(({ finishLegacyRoute, ...customer }) => customer), source.customers);
    assert.ok(migrated.customers.every(customer => customer.finishLegacyRoute === true));
    for (const key of ['wallet', 'totalEarned', 'totalServed', 'counters', 'manager', 'stepCarry', 'eventSequence', 'offlineClaimIds']) assert.deepEqual(migrated[key], source[key]);
    assert.deepEqual(validateState(migrated).state, migrated);
    const engine = createEngine(migrated); assert.equal(engine.invite(), true);
    assert.ok(engine.state.customers.filter(customer => customer.id >= 5).every(customer => customer.routeLeg === 0 && !customer.finishLegacyRoute));
    for (let tick = 0; tick < 600; tick++) {
      const previous = new Map(engine.state.customers.map(customer => [customer.id, clone(customer)])); engine.advance(STEP_SECONDS);
      assert.equal(validateState(engine.snapshot()).ok, true);
      assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
      for (const customer of engine.state.customers) if (previous.has(customer.id)) assert.ok(distance(previous.get(customer.id), customer) <= maxStep + EPSILON);
      if (tick === 15) {
        const snapshot = engine.snapshot(), memory = createMemoryStorage(); assert.equal(new LocalSaveRepository(memory).save(snapshot, 1000).ok, true);
        const restored = createEngine(new LocalSaveRepository(memory).load(1000).state); restored.advance(10);
        const continued = createEngine(snapshot); continued.advance(10); assert.deepEqual(restored.snapshot(), continued.snapshot());
      }
    }
    assert.ok(engine.state.customers.every(customer => !customer.finishLegacyRoute));
    assert.ok(engine.state.customers.every(customer => customer.id > 4));
    assert.equal(engine.applyOffline(120, 'already').accepted, false);
  }
});

function legacyBrewState() {
  const state = createInitialState(); delete state.customerRouteVersion;
  state.nextCustomerId = 6;
  state.customers = [guest(1, 'counter-a', 'receiving', 0, WORLD.serviceZ, { timer: .35 }),
    guest(2, 'counter-b', 'serving', 5, WORLD.serviceZ), guest(3, 'counter-a', 'queue', 0, WORLD.serviceZ + WORLD.queueGap),
    guest(4, 'counter-b', 'entering', -1, 4.1), guest(5, 'counter-a', 'leaving', -3, 5, { timer: 2 })];
  state.counters[0].brew = { recipe: 'espresso', elapsed: 2.7, duration: 2.7, price: 110, customerId: 1 };
  state.counters[1].brew = { recipe: 'latte', elapsed: .5, duration: 6.8, price: 246, customerId: 2 };
  state.counters[0].brewed = 2; state.totalServed = 1; state.counters[0].pendingCash = 110; state.totalEarned = 110;
  return state;
}

test('TC-3D-011 legacy stationary phases and frozen brew receipts survive migration without repair or recredit', () => {
  const source = legacyBrewState(), checked = validateState(source); assert.equal(checked.ok, true);
  assert.deepEqual(checked.state.customers.slice(0, 3), source.customers.slice(0, 3)); assert.deepEqual(checked.state.counters, source.counters);
  const engine = createEngine(checked.state); engine.advance(.35);
  assert.equal(engine.state.totalServed, source.totalServed + 1); assert.equal(engine.state.totalEarned, source.totalEarned + 110);
  const departed = engine.state.customers.find(customer => customer.id === 1);
  assert.equal(departed.phase, 'leaving'); assert.equal(departed.routeLeg, 0); assert.equal(departed.finishLegacyRoute, undefined);
  for (const mutate of [s => s.customers[2].x = .3, s => s.customers[0].z = 2, s => s.customers[3].timer = 1]) {
    const corrupt = clone(source); mutate(corrupt); assert.equal(validateState(corrupt).ok, false);
    const raw = envelope(corrupt), memory = createMemoryStorage(); memory.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(memory), result = repo.load(1000); assert.equal(result.status, 'corrupt');
    assert.equal(repo.save(result.state, 1000).ok, false); assert.equal(memory.getItem(SAVE_KEY), raw);
  }
});

test('TC-3D-011 customer-route offline migration remains once-only and respects failure, pause and CAS boundaries', () => {
  const source = legacyBrewState(), raw = envelope(source), memory = createMemoryStorage(); memory.setItem(SAVE_KEY, raw);
  const immediate = new LocalSaveRepository(memory).load(1000); assert.equal(immediate.status, 'loaded'); assert.equal(memory.getItem(SAVE_KEY), raw);
  const failing = { ...memory, setItem() { throw Error('quota'); } };
  const failed = new LocalSaveRepository(failing).load(121000);
  assert.equal(failed.status, 'offline-save-failed'); assert.equal(failed.offline.accepted, false); assert.deepEqual(failed.state, immediate.state); assert.equal(memory.getItem(SAVE_KEY), raw);
  const recovered = new LocalSaveRepository(memory).load(121000); assert.equal(recovered.offline.accepted, true); assert.equal(recovered.state.customerRouteVersion, CUSTOMER_ROUTE_VERSION);
  assert.ok(recovered.state.customers.every(customer => !customer.finishLegacyRoute));
  assert.deepEqual(new LocalSaveRepository(memory).load(121000).state, recovered.state);
  assert.equal(new LocalSaveRepository(memory).load(121000).offline?.accepted ?? false, false);
  const a = new LocalSaveRepository(memory), b = new LocalSaveRepository(memory), sa = a.load(121000).state, sb = b.load(121000).state;
  assert.equal(a.save(sa, 122000).ok, true); const winning = memory.getItem(SAVE_KEY);
  assert.equal(b.save(sb, 122000).status, 'conflict'); assert.equal(memory.getItem(SAVE_KEY), winning);
  const paused = legacyBrewState(); paused.paused = true;
  const pausedMemory = createMemoryStorage(); pausedMemory.setItem(SAVE_KEY, envelope(paused));
  const pausedLoad = new LocalSaveRepository(pausedMemory).load(121000);
  assert.equal(pausedLoad.offline.amount, 0); assert.equal(pausedLoad.state.elapsed, 0);
  assert.deepEqual(pausedLoad.state.customers.map(({ finishLegacyRoute, ...customer }) => customer), paused.customers);
});

test('TC-3D-011 draft full-load payback includes the physical sideways-clearance wait', () => {
  const engine = createEngine();
  for (const counter of engine.state.counters) {
    const quote = engine.quote(counter.id);
    const clearanceSeconds = (Math.ceil(WORLD.queueGap / maxStep) - 1) * STEP_SECONDS;
    assert.ok(Math.abs(clearanceSeconds - .25) < EPSILON);
    const turnoverSeconds = .7 + WORLD.queueGap / CUSTOMER_SPEED + clearanceSeconds;
    const expected = quote.cost / (quote.afterPrice / (quote.afterSeconds + turnoverSeconds) - quote.beforePrice / (quote.beforeSeconds + turnoverSeconds));
    assert.ok(Math.abs(quote.paybackSeconds - expected) < EPSILON);
  }
});
