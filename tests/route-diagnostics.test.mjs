import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { createEngine, createInitialState, WORLD } = await import('../src/slice/core/engine.ts');
const { FrameInterpolator } = await import('../src/slice/render/FrameInterpolator.ts');
const { RouteDiagnostics, isRouteQA, ROUTE_TRACE_LIMIT, TRACKED_TRACE_LIMIT, MANAGER_TRACE_LIMIT } = await import('../src/slice/qa/RouteDiagnostics.ts');
const { LocalSaveRepository, createMemoryStorage, SAVE_KEY, validateState } = await import('../src/slice/core/persistence.ts');

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
  for (const [id, counter, exitX, crossings] of [[1, 'counter-a', 1.6, [1.6, 0, -6]], [2, 'counter-b', 6.6, [6.6, 5, 1.6, 0, -6]]]) {
    const events = slow.events.filter(event => event.customerId === id);
    assert.equal(events[0].kind, 'spawn'); assert.equal(events[0].counterId, counter);
    assert.ok(events.some(event => event.kind === 'phase' && event.phase === 'receiving' && event.hasCup));
    assert.ok(events.some(event => event.kind === 'phase' && event.phase === 'leaving' && event.routeLeg === 1 && event.x === exitX && event.z === 1.5));
    assert.ok(events.some(event => event.kind === 'phase' && event.phase === 'leaving' && event.routeLeg === 2 && event.x === exitX && event.z === 7.4));
    assert.deepEqual(events.filter(event => event.kind === 'crossing' && event.phase === 'leaving').map(event => event.crossingX), crossings);
    const terminal = events.filter(event => event.kind === 'despawn');
    assert.equal(terminal.length, 1); assert.equal(terminal[0].x, -10.4); assert.equal(terminal[0].z, 7.4); assert.equal(terminal[0].hasCup, true);
    assert.equal(events.at(-1), terminal[0]);
  }
  assert.ok(slow.events.every((event, index, all) => !index || event.time >= all[index - 1].time));
});

test('TC-3D-014 crossing endpoints count once; despawn records actual endpoint before delayed presentation disposal', () => {
  const initial = createInitialState(); initial.nextCustomerId = 2;
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

  const crossing = createInitialState(); crossing.nextCustomerId = 2;
  crossing.customers = [{ ...initial.customers[0], x: .125 }];
  const events = [], crossingEngine = createEngine(crossing, event => events.push(event));
  crossingEngine.advance(.05); crossingEngine.advance(.05);
  assert.equal(events.filter(event => event.kind === 'crossing' && event.crossingX === 0).length, 1);
  assert.equal(events.find(event => event.kind === 'crossing').x, 0);
});

test('TC-3D-014 manager logs real B→A→vault transfers while return passage and empty stops create no money', () => {
  const initial = createInitialState(); initial.counters[0].pendingCash = 100; initial.counters[1].pendingCash = 200; initial.totalEarned = 300;
  const events = [], engine = createEngine(initial, event => events.push(event));
  engine.advance(9);
  const transfers = events.filter(event => ['collected', 'deposited'].includes(event.kind));
  assert.deepEqual(transfers.slice(0, 3).map(event => [event.kind, event.counterId, event.amount, event.target, event.x]), [
    ['collected', 'counter-b', 200, 1, 5], ['collected', 'counter-a', 100, 0, 0], ['deposited', undefined, 300, 2, 8.8],
  ]);
  for (const event of transfers) {
    if (event.kind === 'collected') { assert.equal(event.pendingBefore - event.pendingAfter, event.amount); assert.equal(event.carryingAfter - event.carryingBefore, event.amount); assert.equal(event.walletBefore, event.walletAfter); }
    else { assert.equal(event.carryingBefore - event.carryingAfter, event.amount); assert.equal(event.walletAfter - event.walletBefore, event.amount); }
  }
  const pass = events.find(event => event.kind === 'passage' && event.counterId === 'counter-b');
  assert.equal(pass.target, 2); assert.equal(pass.phase, 'moving'); assert.equal(pass.amount, undefined);
  assert.ok(pass.time > transfers[1].time && pass.time < transfers[2].time);
  const empty = [], emptyEngine = createEngine(undefined, event => empty.push(event)); emptyEngine.advance(9);
  assert.equal(empty.filter(event => ['collected', 'deposited'].includes(event.kind)).length, 0);
  assert.equal(empty.filter(event => event.actor === 'manager' && event.kind === 'phase' && event.phase === 'collecting').length, 2);

  const legacy = structuredClone(initial); legacy.manager.finishLegacySweep = true; legacy.manager.target = 0; legacy.manager.x = 1;
  const oldEvents = [], oldEngine = createEngine(legacy, event => oldEvents.push(event)); oldEngine.advance(9);
  assert.deepEqual(oldEvents.filter(event => event.kind === 'collected').slice(0, 2).map(event => event.counterId), ['counter-a', 'counter-b']);
});

test('TC-3D-014 bounded record, sticky customer identity, isolated readers, and explicit reset prevent stale IDs', () => {
  const diagnostics = new RouteDiagnostics(), engine = createEngine(undefined, diagnostics.observe);
  engine.invite(); engine.advance(600);
  const result = diagnostics.read();
  assert.equal(result.selectedId, 1); assert.equal(result.terminal.kind, 'despawn');
  assert.equal(result.records.length, ROUTE_TRACE_LIMIT); assert.equal(result.trackedRecords.length <= TRACKED_TRACE_LIMIT, true);
  assert.equal(result.managerRecords.length, MANAGER_TRACE_LIMIT); assert.equal(result.dropped, result.sequence - ROUTE_TRACE_LIMIT);
  assert.ok(result.records.every(event => event.customerId !== 1), 'the dedicated terminal stays after the global ring has evicted customer 1');
  result.records[0].x = 999; result.terminal.x = 999; result.records.length = 0;
  assert.equal(diagnostics.read().records.length, ROUTE_TRACE_LIMIT); assert.equal(diagnostics.read().terminal.x, WORLD.exitX);
  diagnostics.selectNext(engine.state, 'counter-b');
  assert.equal(engine.state.customers.find(customer => customer.id === diagnostics.trackedId).counterId, 'counter-b');
  assert.equal(diagnostics.read().terminal, null);
  diagnostics.reset('reload');
  assert.equal(diagnostics.read().session, 2); assert.equal(diagnostics.read().sequence, 0); assert.equal(diagnostics.trackedId, null);
  assert.equal(diagnostics.read().records.length, 0); assert.equal(diagnostics.read().sample, null);
});

test('TC-3D-014 two same-step transitions keep real order and pre-movement transition coordinates', () => {
  const initial = createInitialState(); initial.nextCustomerId = 2;
  initial.customers = [{ id: 1, counterId: 'counter-a', phase: 'entering', routeLeg: 3, hasCup: false, skin: 0, timer: 0, x: 0, z: 1.6 }];
  const events = [], engine = createEngine(initial, event => events.push(event)); engine.advance(.05);
  assert.deepEqual(events.filter(event => event.actor === 'customer').map(event => [event.kind, event.phase, event.x, event.z, event.time]), [
    ['phase', 'queue', 0, 1.5, .05], ['phase', 'serving', 0, 1.5, .05],
  ]);
  const receiving = createInitialState(); receiving.nextCustomerId = 2;
  receiving.customers = [{ ...initial.customers[0], phase: 'receiving', routeLeg: undefined, z: 1.5, timer: .65, hasCup: true }];
  receiving.counters[0].brew = { recipe: 'espresso', elapsed: 2.7, duration: 2.7, customerId: 1, price: 110 };
  const departures = [], departure = createEngine(receiving, event => departures.push(event)); departure.advance(.05);
  const leaving = departures.find(event => event.actor === 'customer' && event.kind === 'phase');
  assert.equal(leaving.phase, 'leaving'); assert.equal(leaving.x, 0); assert.equal(leaving.z, 1.5); assert.equal(leaving.routeLeg, 0);
  assert.equal(departure.state.customers[0].x, .125, 'the same tick moves only after the leaving transition was logged');
});
