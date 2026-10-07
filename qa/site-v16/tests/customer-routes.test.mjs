import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
const { createEngine, createInitialState, CUSTOMER_ROUTE_VERSION, CUSTOMER_SPEED, INITIAL_WALLET, STEP_SECONDS } = await import('../src/slice/core/engine.ts');
const { initialLayout, GRID, layoutExit, layoutExitAnchor, layoutEntrySpawn, findGridPath, validateLayout, addFurniture, actorReservations } = await import('../src/slice/core/layout.ts');
const { validateState } = await import('../src/slice/core/persistence.ts');
const legacy = JSON.parse(readFileSync(new URL('./fixtures/economy3-operations-migration.json', import.meta.url)));
const clone = value => structuredClone(value);
const maxStep = CUSTOMER_SPEED * STEP_SECONDS;
function drain(engine) { if (!engine.state.paused) engine.togglePause(); for (let i = 0; i < 12000 && engine.state.customers.length; i++) engine.advance(STEP_SECONDS); assert.equal(engine.state.customers.length, 0); }
function expandedEngine() {
  const seed = createInitialState(); seed.wallet += 20000; seed.totalEarned += 20000; seed.totalServed = 40; seed.counters[0].brewed = 40;
  const engine = createEngine(seed); engine.togglePause(); engine.beginLayoutEdit(); const draft = engine.createLayoutDraft(); draft.expanded = true; addFurniture(draft, 'counter', 13, 0); addFurniture(draft, 'table', 3, 5);
  assert.equal(engine.commitLayout(draft).ok, true); engine.togglePause(); return engine;
}

test('TC-3D-027 opposite doors have separate interior and exterior anchors before and after expansion', () => {
  assert.equal(CUSTOMER_ROUTE_VERSION, 4); assert.deepEqual(GRID.entry, { x: -7, z: 5 }); assert.deepEqual(layoutEntrySpawn(), { x: -8, z: 5 });
  for (const expanded of [false, true]) {
    const layout = initialLayout(); layout.expanded = expanded;
    assert.deepEqual(layoutExitAnchor(layout), { x: expanded ? 16 : 10, z: 6 }); assert.deepEqual(layoutExit(layout), { x: expanded ? 17 : 11, z: 6 });
    assert.equal(validateLayout(layout).ok, true); assert.ok(findGridPath(layout, GRID.entry, layoutExitAnchor(layout)));
    addFurniture(layout, 'table', layoutExitAnchor(layout).x, 6); assert.equal(validateLayout(layout).ok, false);
  }
});

test('TC-3D-027 invitation cannot overlap its entrance or start while closed', () => {
  const engine = createEngine(); assert.equal(engine.invite(), true); assert.equal(engine.state.customers.length, 1); assert.deepEqual({ x: engine.state.customers[0].x, z: engine.state.customers[0].z }, layoutEntrySpawn());
  assert.equal(engine.invite(), false); engine.togglePause(); assert.equal(engine.invite(), false); drain(engine); assert.equal(engine.state.totalServed, 1);
});

for (const expanded of [false, true]) test(`TC-3D-027 ${expanded ? 'expanded' : 'base'} routes are continuous, reserved and end at the opposite exterior threshold`, () => {
  const engine = expanded ? expandedEngine() : createEngine(); let departures = 0, minimum = Infinity;
  for (let tick = 0; tick < 4000; tick++) {
    const before = new Map(engine.state.customers.map(customer => [customer.id, clone(customer)])); engine.advance(STEP_SECONDS);
    for (const customer of engine.state.customers) {
      const previous = before.get(customer.id); if (previous) assert.ok(Math.hypot(customer.x - previous.x, customer.z - previous.z) <= maxStep + 1e-8);
      if (customer.phase === 'leaving' && customer.nav) assert.deepEqual(customer.nav.at(-1), layoutExit(engine.state.layout));
      before.delete(customer.id);
    }
    for (const customer of before.values()) { assert.equal(customer.phase, 'leaving'); assert.ok(Math.hypot(customer.x - layoutExit(engine.state.layout).x, customer.z - 6) <= maxStep + 1e-8); departures++; }
    for (let a = 0; a < engine.state.customers.length; a++) for (let b = a + 1; b < engine.state.customers.length; b++) {
      const one = engine.state.customers[a], two = engine.state.customers[b]; minimum = Math.min(minimum, Math.hypot(one.x - two.x, one.z - two.z));
      const reserved = actorReservations(two); assert.equal([...actorReservations(one)].some(point => reserved.has(point)), false);
    }
    if (tick % 10 === 0) { const checked = validateState(engine.snapshot()); assert.equal(checked.ok, true, checked.message); }
  }
  assert.ok(departures > 10); assert.ok(minimum >= .72); assert.equal(engine.state.wallet + engine.state.spend, INITIAL_WALLET + engine.state.totalEarned);
});

test('TC-3D-027 every active customer phase resumes positions, events and receipts exactly after reload', () => {
  const engine = expandedEngine(), samples = new Map();
  for (let i = 0; i < 4000 && samples.size < 7; i++) { engine.advance(STEP_SECONDS); for (const customer of engine.state.customers) if (!samples.has(customer.phase)) samples.set(customer.phase, engine.snapshot()); }
  assert.equal(samples.size, 7);
  for (const [phase, snapshot] of samples) {
    const loaded = validateState(snapshot); assert.equal(loaded.ok, true, phase); assert.deepEqual(loaded.state, snapshot);
    const one = createEngine(snapshot), two = createEngine(loaded.state); one.advance(60.013); two.advance(60.013); assert.deepEqual(two.snapshot(), one.snapshot()); assert.deepEqual(two.drainEvents(), one.drainEvents());
  }
});

for (const [name, source] of Object.entries({ inactive: legacy.inactive, active: legacy.active, ...legacy.phases })) test(`TC-3D-027 genuine legacy ${name} checkpoint keeps in-flight positions and drains once into the new doors`, () => {
  const original = clone(source), checked = validateState(source); assert.equal(checked.ok, true, checked.message); assert.deepEqual(source, original);
  assert.deepEqual(checked.state.customers, source.customers.map(c=>c.phase==='dining'?{...c,tipDue:0}:c)); assert.deepEqual(checked.state.counters.map(counter => counter.brew), source.counters.map(counter => counter.brew));
  const engine = createEngine(checked.state), existing = new Set(source.customers.map(customer => customer.id)); assert.equal(engine.invite(), false);
  let served = 0; const beforeEarned = source.totalEarned, unpaid = source.customers.filter(customer => ['entering', 'queue', 'serving', 'receiving'].includes(customer.phase)).length;
  engine.togglePause();
  for (let i = 0; i < 12000 && engine.state.customers.length; i++) { engine.advance(STEP_SECONDS); for (const event of engine.drainEvents()) if (event.type === 'served') served++; assert.ok(engine.state.customers.every(customer => existing.has(customer.id))); if (i % 20 === 0) assert.equal(validateState(engine.snapshot()).ok, true); }
  assert.equal(engine.state.customers.length, 0); assert.equal(served, unpaid); assert.equal(engine.state.totalServed - source.totalServed, unpaid); assert.ok(engine.state.totalEarned >= beforeEarned);
  assert.equal(engine.state.layout.version, 3); assert.equal(engine.state.customerRouteVersion, 4); assert.equal(engine.state.paused, true);
  const replay = createEngine(engine.snapshot()); assert.deepEqual(replay.snapshot(), engine.snapshot()); replay.togglePause(); replay.advance(30); assert.ok(replay.state.nextCustomerId > source.nextCustomerId);
});

test('TC-3D-027 current routes reject old flags, wrong doors, malformed nav and unsupported versions', () => {
  const engine = createEngine(); engine.advance(4); const original = engine.snapshot(); assert.ok(original.customers[0].nav);
  for (const mutate of [state => { state.customerRouteVersion = 5; }, state => { state.customerRouteVersion = 3; }, state => { state.customers[0].routeLeg = 0; }, state => { state.customers[0].finishLegacyRoute = true; }, state => { state.customers[0].nav[0].x += .25; }, state => { state.customers[0].nav = [{ x: 0, z: 0 }]; }, state => { state.customers[0].nav = []; }, state => { state.customers[0].nav.push({ x: 11, z: 7 }); }]) { const state = clone(original); mutate(state); assert.equal(validateState(state).ok, false, mutate.toString()); }
});
