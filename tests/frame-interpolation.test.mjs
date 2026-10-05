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
const { FrameInterpolator } = await import('../src/slice/render/FrameInterpolator.ts');
const { RenderBudget } = await import('../src/slice/render/RenderBudget.ts');
const { createEngine, createInitialState, managerSpeed, STEP_SECONDS, WORLD } = await import('../src/slice/core/engine.ts');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

for (const hz of [30, 60, 90, 120, 144, 240]) {
  test(`TC-3D-012 ${hz}Hz presents constant-speed manager/customer motion between 20Hz ticks`, () => {
    const initial = createInitialState();
    initial.customers = [{ id: 1, x: -8, z: 5, phase: 'entering', counterId: 'counter-a', timer: 0, hasCup: false, skin: 0, routeLeg: 0 }];
    initial.nextCustomerId = 2;
    const engine = createEngine(initial), frames = new FrameInterpolator(engine.state);
    let previous;
    for (let i = 1; i <= hz * .6; i++) {
      const view = frames.advance(engine, 1 / hz);
      if (i / hz > STEP_SECONDS * 2 && previous) {
        close(previous.manager.x - view.manager.x, managerSpeed(1) / hz);
        // Independently derive the steady customer's per-tick velocity from two core ticks.
        const expectedCustomerSpeed = 2.5;
        close(view.customers[0].x - previous.customers[0].x, expectedCustomerSpeed / hz);
      }
      previous = view;
    }
  });
}

test('TC-3D-012 multi-step stalls interpolate the final adjacent ticks, never the entire stalled path', () => {
  const engine = createEngine(), frames = new FrameInterpolator(engine.state);
  const reference = createEngine(); reference.advance(.25); const before = reference.snapshot(); reference.advance(.05); const after = reference.snapshot();
  const view = frames.advance(engine, .31);
  close(view.manager.x, before.manager.x + (after.manager.x - before.manager.x) * .2);
  assert.equal(view.elapsed, before.elapsed);
  assert.deepEqual(engine.snapshot(), { ...after, stepCarry: .01 });
  const saved = engine.snapshot();
  frames.sample(engine.state); frames.sample(engine.state);
  assert.deepEqual(engine.snapshot(), saved, 'sampling does not mutate the economy');
});

test('TC-3D-012 pause freezes pose; replacement and offline reset never blend old routes', () => {
  const engine = createEngine(), frames = new FrameInterpolator(engine.state);
  const view = frames.advance(engine, .123);
  engine.togglePause();
  for (const dt of [.016, .4, 10]) {
    const paused = frames.advance(engine, dt);
    close(paused.manager.x, view.manager.x);
    assert.equal(paused.paused, true);
  }
  engine.togglePause();
  engine.applyOffline(60, 'qa-reset');
  frames.reset(engine.state);
  close(frames.sample(engine.state).manager.x, engine.state.manager.x);
  const replacement = createEngine();
  close(frames.advance(replacement, .01).manager.x, replacement.state.manager.x);
});

test('TC-3D-012 invite identities spawn on their own route, and phase/cup changes remain atomic', () => {
  const engine = createEngine(), frames = new FrameInterpolator(engine.state);
  engine.invite();
  const spawn = engine.snapshot().customers;
  let view = frames.advance(engine, .05);
  assert.deepEqual(view.customers.map(c => [c.id, c.x, c.z]), spawn.map(c => [c.id, c.x, c.z]));
  for (let i = 0; i < 60 * 50; i++) {
    view = frames.advance(engine, 1 / 60);
    for (const customer of view.customers) {
      assert.equal(customer.hasCup, ['receiving', 'leaving'].includes(customer.phase));
      if (customer.hasCup) assert.ok(!view.counters.some(c => c.brew?.customerId === customer.id && c.brew.elapsed < c.brew.duration), 'handoff does not draw the same cup on machine and customer');
    }
  }
});

test('TC-3D-012 quality modes and irregular frame subdivision produce the same authoritative save', () => {
  const reference = createEngine(); reference.advance(30);
  const expectedEvents = reference.drainEvents();
  for (const mode of ['smooth', 'clear-60', 'balanced', 'low-power']) {
    const engine = createEngine(), frames = new FrameInterpolator(engine.state), budget = new RenderBudget(0, mode);
    for (let n = 1; n <= 4320; n++) {
      const dt = budget.take(n * 1000 / 144);
      if (dt !== null) frames.advance(engine, dt);
    }
    engine.advance(budget.flush(30000));
    assert.deepEqual(engine.snapshot(), reference.snapshot());
    assert.deepEqual(engine.drainEvents(), expectedEvents);
  }
});

test('TC-3D-012 max-level actors stay continuous through turns, stops and handoffs at 144Hz', () => {
  const initial = createInitialState();
  initial.manager.level = 20;
  initial.counters.forEach(counter => { counter.level = 20; });
  const engine = createEngine(initial), frames = new FrameInterpolator(engine.state);
  let previous, minClearance = Infinity;
  for (let i = 0; i < 144 * 90; i++) {
    if (i % (144 * 18) === 0) engine.invite();
    const view = frames.advance(engine, 1 / 144);
    if (previous) {
      const prior = new Map(previous.customers.map(customer => [customer.id, customer]));
      for (const customer of view.customers) {
        const before = prior.get(customer.id);
        if (before) assert.ok(Math.hypot(customer.x - before.x, customer.z - before.z) <= 2.5 / 144 + 1e-8, 'turn/stop cannot teleport or overshoot');
        for (const other of view.customers) {
          if (other.id === customer.id) continue;
          minClearance = Math.min(minClearance, Math.hypot(customer.x - other.x, customer.z - other.z));
        }
      }
      assert.ok(Math.hypot(view.manager.x - previous.manager.x, view.manager.z - previous.manager.z) <= managerSpeed(20) / 144 + 1e-8);
    }
    previous = view;
  }
  assert.ok(engine.state.totalServed > 25, 'exercise repeated handoffs, not a blocked empty scene');
  assert.ok(minClearance >= .72 - 1e-8, `interpolated all-pair clearance ${minClearance}`);
});


test('TC-3D-012 removed departure finishes its final interpolated leg instead of freezing ahead of its follower', () => {
  for (const legacy of [false, true]) {
    const initial = createInitialState();
    const endpoint = legacy ? { x: WORLD.entryX, z: WORLD.entryZ } : { x: WORLD.exitX, z: WORLD.exitZ };
    const customer = (id, x) => ({ id, x, z: endpoint.z, phase: 'leaving', counterId: 'counter-a', timer: legacy ? 2 : 0, hasCup: true, skin: 0, ...(legacy ? { finishLegacyRoute: true } : { routeLeg: 2 }) });
    initial.customers = [customer(1, endpoint.x + .125), customer(2, endpoint.x + .875)];
    initial.nextCustomerId = 3;
    const engine = createEngine(initial), frames = new FrameInterpolator(engine.state);
    frames.advance(engine, .05);
    assert.ok(!engine.state.customers.some(c => c.id === 1), 'authority has reached and removed the front customer');
    const view = frames.advance(engine, .025);
    assert.equal(view.customers.length, 2, 'delayed view finishes the final leg coherently');
    close(view.customers[0].x, endpoint.x + .0625);
    close(view.customers[1].x - view.customers[0].x, .75);
    const next = frames.advance(engine, .025);
    assert.ok(!next.customers.some(c => c.id === 1));
  }
});

test('TC-3D-025 active grid departure interpolates to its own exit, never the legacy boundary', () => {
  const initial = createInitialState();
  initial.layout.active = true;
  initial.customers = [{ id: 1, x: -7.875, z: 6, phase: 'leaving', counterId: 'counter-a', timer: 0, hasCup: true, skin: 0, nav: [{ x: -8, z: 6 }] }];
  initial.nextCustomerId = 2; initial.totalServed = 1; initial.totalEarned = 110;
  initial.counters[0].brewed = 1; initial.counters[0].pendingCash = 110;
  initial.manager.target = 2;
  const engine = createEngine(initial), frames = new FrameInterpolator(engine.state);
  frames.advance(engine, .05);
  assert.equal(engine.state.customers.length, 0);
  const view = frames.advance(engine, .025);
  assert.equal(view.customers.length, 1);
  close(view.customers[0].x, -7.9375); close(view.customers[0].z, 6);
  assert.equal(frames.advance(engine, .025).customers.length, 0);
});
