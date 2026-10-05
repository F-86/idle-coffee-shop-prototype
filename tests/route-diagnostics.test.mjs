import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { createEngine, createInitialState } = await import('../src/slice/core/engine.ts');
const { FrameInterpolator } = await import('../src/slice/render/FrameInterpolator.ts');
const { RouteDiagnostics, isRouteQA, ROUTE_TRACE_LIMIT, TRACKED_TRACE_LIMIT } = await import('../src/slice/qa/RouteDiagnostics.ts');
const { LocalSaveRepository, createMemoryStorage, SAVE_KEY, validateState } = await import('../src/slice/core/persistence.ts');

const legacyArchives = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/economy3-operations-migration.json', import.meta.url), 'utf8'));
function legacyInitial() {
  const state = structuredClone(legacyArchives.inactive);
  state.customers = []; state.nextCustomerId = 1; state.elapsed = 0; state.stepCarry = 0; state.arrivalTimer = 0; state.inviteCooldown = 0;
  state.wallet = 1200; state.totalEarned = 0; state.totalServed = 0; state.spend = 0; state.eventSequence = 0;
  state.manager = { x: 8.8, z: -1.7, carrying: 0, phase: 'moving', target: 1, timer: 0, level: 1 };
  for (const counter of state.counters) { counter.pendingCash = 0; counter.brewed = 0; counter.brew = null; counter.level = 1; }
  return state;
}

test('TC-3D-014 trace is explicitly opt-in; detached/throwing observers cannot change snapshots, business events or saves', () => {
  assert.equal(isRouteQA('?qa=1'), true);
  for (const search of ['', '?qa', '?qa=0', '?qa=false', '?qa=2']) assert.equal(isRouteQA(search), false);
  const recording = new RouteDiagnostics();
  const baseline = createEngine();
  const variants = [createEngine(undefined, recording.observe), createEngine(undefined, event => { event.amount = -99; event.x = 999; event.time = -1; }), createEngine(undefined, () => { throw Error('broken QA'); })];
  const all = [baseline, ...variants];
  const run = action => {
    for (const engine of all) action(engine);
    const expected = baseline.snapshot(), events = baseline.drainEvents();
    for (const engine of variants) { assert.deepEqual(engine.snapshot(), expected); assert.deepEqual(engine.drainEvents(), events); }
    assert.equal(validateState(expected).ok, true);
  };
  run(engine => engine.invite()); run(engine => engine.advance(23.417));
  run(engine => engine.upgrade('counter-a')); run(engine => engine.setRecipe('counter-b', 'espresso'));
  run(engine => engine.advance(39.2)); run(engine => engine.upgradeManager());
  run(engine => engine.togglePause()); run(engine => engine.advance(17)); run(engine => engine.togglePause());
  const beforeOffline = recording.read().sequence;
  run(engine => engine.applyOffline(120, 'test-only-claim'));
  assert.equal(recording.read().sequence, beforeOffline, 'offline is a discontinuity, never described as observed rendered motion');
  run(engine => engine.applyOffline(120, 'test-only-claim')); run(engine => engine.advance(.013));
  const memory = createMemoryStorage(), repo = new LocalSaveRepository(memory);
  repo.load(1000); assert.equal(repo.save(variants[0].snapshot(), 1000).ok, true);
  assert.deepEqual(JSON.parse(memory.getItem(SAVE_KEY)).state, baseline.snapshot());
  assert.deepEqual(new LocalSaveRepository(memory).load(1000).state, baseline.snapshot());
  assert.doesNotMatch(memory.getItem(SAVE_KEY), /routeTrace|diagnostic|tracked|records|crossing/);
});

function tracesAt(frame) {
  const events = [], engine = createEngine(undefined, event => events.push({ ...event }));
  engine.invite();
  const count = Math.round(90 / frame);
  for (let i = 0; i < count; i++) engine.advance(frame);
  return { events, state: engine.snapshot(), business: engine.drainEvents() };
}
test('TC-3D-014 real fixed-step paths remain complete across one stalled frame, 20Hz and 144Hz', () => {
  const slow = tracesAt(90);
  for (const frame of [.05, 1 / 144]) assert.deepEqual(tracesAt(frame), slow);
  for (const [id, counter] of [[1, 'counter-a'], [2, 'counter-b']]) {
    const events = slow.events.filter(event => event.customerId === id);
    assert.equal(events[0].kind, 'spawn'); assert.equal(events[0].counterId, counter);
    assert.equal(events[0].x, -8); assert.equal(events[0].z, 5);
    assert.ok(events.some(event => event.kind === 'phase' && event.phase === 'receiving' && event.hasCup));
    assert.ok(events.some(event => event.kind === 'phase' && event.phase === 'leaving' && event.z === 2));
    assert.ok(events.every(event => event.routeLeg === undefined), 'grid routes carry no legacy polyline labels');
    const terminal = events.filter(event => event.kind === 'despawn');
    assert.equal(terminal.length, 1); assert.equal(terminal[0].x, 11); assert.equal(terminal[0].z, 6); assert.equal(terminal[0].hasCup, true);
    assert.equal(events.at(-1), terminal[0]);
  }
  assert.ok(slow.events.every((event, index, all) => !index || event.time >= all[index - 1].time));
});

test('TC-3D-014 crossing endpoints count once; despawn records actual endpoint before delayed presentation disposal', () => {
  const initial = legacyInitial(); initial.nextCustomerId = 2;
  initial.customers = [{ id: 1, counterId: 'counter-a', phase: 'leaving', routeLeg: 2, hasCup: true, skin: 0, timer: 0, x: -10.3, z: 7.4 }];
  const diagnostics = new RouteDiagnostics(), engine = createEngine(initial, diagnostics.observe), frames = new FrameInterpolator(engine.state);
  diagnostics.selectNext(engine.state);
  const view = frames.advance(engine, .06);
  assert.equal(engine.state.customers.length, 0); assert.equal(view.customers.length, 1);
  assert.ok(view.customers[0].x < -10.3 && view.customers[0].x > -10.4);
  diagnostics.capture(engine.state, view, true, { x: view.customers[0].x, z: 7.4, screenX: 12, screenY: 22, inViewport: true });
  const pending = diagnostics.read();
  assert.equal(pending.sample.authority, null); assert.equal(pending.sample.presented.id, 1); assert.ok(pending.sample.scene);
  assert.equal(pending.terminal.x, -10.4); assert.equal(pending.terminal.time, .05);
  const after = frames.advance(engine, .04); assert.equal(after.customers.length, 0);
  diagnostics.capture(engine.state, after, true, null);
  assert.equal(diagnostics.read().sample.scene, null); assert.equal(diagnostics.read().selectedId, 1);
  assert.equal(diagnostics.read().trackedRecords.filter(event => event.kind === 'despawn').length, 1);

  const crossing = legacyInitial(); crossing.nextCustomerId = 2;
  crossing.customers = [{ ...initial.customers[0], x: .125 }];
  const events = [], crossingEngine = createEngine(crossing, event => events.push(event));
  crossingEngine.advance(.05); crossingEngine.advance(.05);
  assert.equal(events.filter(event => event.kind === 'crossing' && event.crossingX === 0).length, 1);
  assert.equal(events.find(event => event.kind === 'crossing').x, 0);
});

test('TC-3D-027 diagnostics record customer handoffs without any retired-manager movement or transfers', () => {
  const events = [], engine = createEngine(undefined, event => events.push(event)); engine.advance(120);
  assert.ok(events.some(event => event.actor === 'customer' && event.phase === 'leaving'));
  assert.deepEqual(events.filter(event => event.actor === 'manager'), []);
  assert.deepEqual(events.filter(event => ['collected', 'deposited', 'passage'].includes(event.kind)), []);
  const legacy = legacyInitial(); legacy.counters[0].pendingCash = 100; legacy.counters[1].pendingCash = 200; legacy.totalEarned = 300;
  const oldEvents = [], oldEngine = createEngine(legacy, event => oldEvents.push(event)); oldEngine.advance(30);
  assert.equal(oldEvents.some(event => event.actor === 'manager'), false);
  assert.ok(oldEngine.state.wallet >= 1500); assert.equal(oldEngine.state.manager.carrying, 0);
});

test('TC-3D-014 bounded record, sticky customer identity, isolated readers, and explicit reset prevent stale IDs', () => {
  const diagnostics = new RouteDiagnostics(), engine = createEngine(undefined, diagnostics.observe);
  engine.invite(); engine.advance(600);
  const result = diagnostics.read();
  assert.equal(result.selectedId, 1); assert.equal(result.terminal.kind, 'despawn');
  assert.equal(result.records.length, ROUTE_TRACE_LIMIT); assert.equal(result.trackedRecords.length <= TRACKED_TRACE_LIMIT, true);
  assert.equal(result.managerRecords.length, 0); assert.equal(result.dropped, result.sequence - ROUTE_TRACE_LIMIT);
  assert.ok(result.records.every(event => event.customerId !== 1), 'the dedicated terminal stays after the global ring has evicted customer 1');
  result.records[0].x = 999; result.terminal.x = 999; result.records.length = 0;
  assert.equal(diagnostics.read().records.length, ROUTE_TRACE_LIMIT); assert.equal(diagnostics.read().terminal.x, 11);
  diagnostics.selectNext(engine.state, 'counter-b');
  assert.equal(engine.state.customers.find(customer => customer.id === diagnostics.trackedId).counterId, 'counter-b');
  assert.equal(diagnostics.read().terminal, null);
  diagnostics.reset('reload');
  assert.equal(diagnostics.read().session, 2); assert.equal(diagnostics.read().sequence, 0); assert.equal(diagnostics.trackedId, null);
  assert.equal(diagnostics.read().records.length, 0); assert.equal(diagnostics.read().sample, null);
});

test('TC-3D-014 two same-step transitions keep real order and pre-movement transition coordinates', () => {
  const initial = legacyInitial(); initial.nextCustomerId = 2;
  initial.customers = [{ id: 1, counterId: 'counter-a', phase: 'entering', routeLeg: 3, hasCup: false, skin: 0, timer: 0, x: 0, z: 1.6 }];
  const events = [], engine = createEngine(initial, event => events.push(event)); engine.advance(.05);
  assert.deepEqual(events.filter(event => event.actor === 'customer').map(event => [event.kind, event.phase, event.x, event.z, event.time]), [
    ['phase', 'queue', 0, 1.5, .05], ['phase', 'serving', 0, 1.5, .05],
  ]);
  const receiving = legacyInitial(); receiving.nextCustomerId = 2;
  receiving.customers = [{ ...initial.customers[0], phase: 'receiving', routeLeg: undefined, z: 1.5, timer: .65, hasCup: true }];
  receiving.counters[0].brewed = 1;
  receiving.counters[0].brew = { recipe: 'espresso', elapsed: 2.7, duration: 2.7, customerId: 1, price: 110 };
  const departures = [], departure = createEngine(receiving, event => departures.push(event)); departure.advance(.05);
  const leaving = departures.find(event => event.actor === 'customer' && event.kind === 'phase');
  assert.equal(leaving.phase, 'leaving'); assert.equal(leaving.x, 0); assert.equal(leaving.z, 1.5); assert.equal(leaving.routeLeg, 0);
  assert.equal(departure.state.customers[0].x, .125, 'the same tick moves only after the leaving transition was logged');
});
