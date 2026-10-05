import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
const { createEngine, createInitialState, STEP_SECONDS, INITIAL_WALLET, managerSpeed } = await import('../src/slice/core/engine.ts');
const { initialLayout, validateLayout, validateLayoutState, layoutCost, addFurniture, moveFurniture, rotateFurniture, storeFurniture, furnitureCells, interactionPoint, findGridPath, gridKey, occupiedCells, GRID, LAYOUT_PRICES } = await import('../src/slice/core/layout.ts');
const assets = state => state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
function funded() { const state = createInitialState(); state.wallet += 100000; state.totalEarned = 100000; state.totalServed = 40; state.counters[0].brewed = 40; return state; }
function activate(initial = createInitialState(), change = () => {}) { const engine = createEngine(initial); assert.ok(engine.beginLayoutEdit()); assert.equal(engine.layoutEditStatus(), 'ready'); const draft = engine.createLayoutDraft(); change(draft); assert.equal(validateLayout(draft).ok, true); assert.equal(engine.commitLayout(draft).ok, true); return engine; }
function expanded(draft) { draft.expanded = true; addFurniture(draft, 'counter', 12, 0); addFurniture(draft, 'counter', 13, 6); addFurniture(draft, 'table', -4, 0); addFurniture(draft, 'table', 3, 5); }
function until(engine, done, seconds = 500) { for (let tick = 0; tick < seconds / STEP_SECONDS; tick++) { if (done()) return; engine.advance(STEP_SECONDS); } assert.fail('Expected deterministic condition not reached.'); }

test('TC-3D-025 grid footprints rotate around the owned furniture origin', () => {
  const layout = initialLayout(), item = layout.furniture[0];
  assert.equal(furnitureCells(item).length, 15); assert.deepEqual(interactionPoint(item, 'service'), { x: 0, z: 2 });
  for (const expected of [{ x: -2, z: 0 }, { x: 0, z: -2 }, { x: 2, z: 0 }, { x: 0, z: 2 }]) { rotateFurniture(layout, item.id); assert.deepEqual(interactionPoint(item, 'service'), expected); }
  assert.equal(item.rotation, 0); assert.equal(validateLayout(layout).ok, true);
});
test('TC-3D-025 reject overlap, boundary, blocked entrance/service/back/seat and final-counter storage', () => {
  for (const change of [draft => moveFurniture(draft, 'counter-b', 0, 0), draft => moveFurniture(draft, 'counter-b', 10, 0), draft => addFurniture(draft, 'table', -7, 5), draft => addFurniture(draft, 'table', 0, 2), draft => addFurniture(draft, 'table', 0, -2), draft => { addFurniture(draft, 'table', 2, 4); addFurniture(draft, 'table', 2, 5); }]) {
    const draft = initialLayout(); change(draft); assert.equal(validateLayout(draft).ok, false);
  }
  const draft = initialLayout(); assert.equal(storeFurniture(draft, 'counter-b'), true); assert.equal(storeFurniture(draft, 'counter-a'), false); assert.equal(validateLayout(draft).ok, true);
});
test('TC-3D-025 pathfinding respects furniture and returns cardinal traversable cells', () => {
  const layout = initialLayout(), blocked = occupiedCells(layout), path = findGridPath(layout, GRID.entry, { x: 5, z: -2 });
  assert.ok(path.length); let previous = GRID.entry;
  for (const point of path) { assert.equal(blocked.has(gridKey(point)), false); assert.equal(Math.abs(point.x - previous.x) + Math.abs(point.z - previous.z), 1); previous = point; }
  assert.equal(findGridPath(layout, GRID.entry, { x: 0, z: 0 }), null);
  const barrier = new Set(); for (let z = GRID.minZ; z <= GRID.maxZ; z++) barrier.add(`-5,${z}`);
  assert.equal(findGridPath(layout, GRID.entry, { x: 5, z: -2 }, barrier), null);
});
test('TC-3D-025 editor cancellation and invalid commits are transactionally inert', () => {
  const engine = createEngine(), original = engine.snapshot(); engine.beginLayoutEdit(); const draft = engine.createLayoutDraft();
  addFurniture(draft, 'table', 0, 5); engine.advance(10); assert.deepEqual(engine.snapshot(), original); assert.equal(engine.invite(), false); assert.equal(engine.upgrade('counter-a'), false);
  moveFurniture(draft, 'counter-b', 0, 0); assert.equal(engine.commitLayout(draft).ok, false); assert.deepEqual(engine.snapshot(), original);
  engine.cancelLayoutEdit(); assert.deepEqual(engine.snapshot(), original); assert.equal(engine.layoutEditStatus(), 'idle'); engine.advance(1); assert.equal(engine.state.elapsed, 1);
});
test('TC-3D-025 draft mutations do not leak; costs are paid once; ownership cannot be deleted or relabelled', () => {
  const engine = createEngine(funded()); engine.beginLayoutEdit(); const draft = engine.createLayoutDraft(); expanded(draft);
  assert.equal(engine.state.layout.furniture.length, 2); const cost = 2 * LAYOUT_PRICES.counter + 2 * LAYOUT_PRICES.table + LAYOUT_PRICES.expansion;
  assert.equal(layoutCost(engine.state, draft).cost, cost); const before = engine.state.wallet; assert.equal(engine.commitLayout(draft).ok, true); assert.equal(engine.state.wallet, before - cost);
  draft.furniture[0].x = 100; assert.equal(engine.state.layout.furniture[0].x, 0); assert.equal(engine.commitLayout(draft).ok, false);
  engine.beginLayoutEdit(); until(engine, () => engine.layoutEditStatus() === 'ready'); const next = engine.createLayoutDraft(); next.furniture = next.furniture.filter(item => item.id !== 'counter-a'); assert.equal(engine.commitLayout(next).ok, false); engine.cancelLayoutEdit();
  assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
});
test('TC-3D-025 one expansion needs both milestone and wallet; repeated unlock cannot mint or re-charge', () => {
  const poor = createEngine(); poor.beginLayoutEdit(); const blocked = poor.createLayoutDraft(); blocked.expanded = true; assert.equal(poor.commitLayout(blocked).ok, false);
  const engine = activate(funded(), draft => { draft.expanded = true; }); const spend = engine.state.spend;
  engine.beginLayoutEdit(); until(engine, () => engine.layoutEditStatus() === 'ready'); assert.equal(engine.commitLayout(engine.createLayoutDraft()).ok, true); assert.equal(engine.state.spend, spend);
  engine.beginLayoutEdit(); const shrink = engine.createLayoutDraft(); shrink.expanded = false; assert.equal(engine.commitLayout(shrink).ok, false);
});
test('TC-3D-025 legacy in-flight customers and money finish visibly before editor becomes ready', () => {
  const engine = createEngine(); engine.advance(40.027); const before = engine.snapshot(); assert.ok(before.customers.length); assert.ok(engine.beginLayoutEdit());
  assert.equal(engine.layoutEditStatus(), 'draining'); assert.deepEqual(engine.snapshot(), before); assert.equal(engine.createLayoutDraft(), null);
  until(engine, () => engine.layoutEditStatus() === 'ready'); assert.equal(engine.state.customers.length, 0); assert.equal(engine.state.manager.carrying, 0); assert.ok(engine.state.counters.every(counter => counter.pendingCash === 0 && counter.brew === null));
  const manager = structuredClone(engine.state.manager), money = assets(engine.state); assert.equal(engine.commitLayout(engine.createLayoutDraft()).ok, true);
  assert.equal(engine.state.manager.x, manager.x); assert.equal(engine.state.manager.z, manager.z); assert.equal(assets(engine.state), money);
  engine.advance(STEP_SECONDS); assert.ok(Math.hypot(engine.state.manager.x - manager.x, engine.state.manager.z - manager.z) <= managerSpeed(manager.level) * STEP_SECONDS + 1e-9);
  assert.equal(validateLayoutState(engine.state), null);
});
test('TC-3D-025 edit ready/cancel preserves a saved paused flag while allowing graceful drain', () => {
  const initial = createInitialState(); initial.paused = true; const engine = createEngine(initial); const before = engine.snapshot();
  engine.beginLayoutEdit(); engine.advance(100); engine.cancelLayoutEdit(); assert.deepEqual(engine.snapshot(), before);
  const busy = createEngine(); busy.advance(20); busy.togglePause(); busy.beginLayoutEdit(); until(busy, () => busy.layoutEditStatus() === 'ready'); assert.equal(busy.state.paused, true); busy.cancelLayoutEdit(); assert.equal(busy.state.paused, true);
});
test('TC-3D-025 paid customers occupy and release real seats, with takeaway fallback and no duplicate payment', () => {
  const engine = activate(funded(), draft => addFurniture(draft, 'table', 3, 5)); let dined = 0, tookAway = 0, payments = 0, previous = new Set();
  for (let i = 0; i < 18000; i++) {
    engine.advance(STEP_SECONDS);
    const seats = engine.state.customers.map(customer => customer.seatId).filter(Boolean); assert.equal(new Set(seats).size, seats.length);
    const dining = engine.state.customers.filter(customer => customer.phase === 'dining'); for (const customer of dining) if (!previous.has(customer.id)) dined++;
    previous = new Set(dining.map(customer => customer.id));
    for (const event of engine.drainEvents()) if (event.type === 'served') payments++;
    if (engine.state.customers.some(customer => customer.phase === 'leaving')) tookAway++;
    if (i % 20 === 0) assert.equal(validateLayoutState(engine.state), null);
  }
  assert.ok(dined > 10); assert.ok(tookAway > 0); assert.equal(engine.state.totalServed - 40, payments); assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
});
test('TC-3D-025 active four-counter expansion stays live, collision-free and financially conserved', () => {
  const engine = activate(funded(), expanded); const counts = new Map(); let minimumGap = Infinity;
  for (let i = 0; i < 24000; i++) {
    engine.advance(STEP_SECONDS);
    for (const event of engine.drainEvents()) if (event.type === 'served') counts.set(event.counterId, (counts.get(event.counterId) ?? 0) + 1);
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
    if (i % 20 === 0) assert.equal(validateLayoutState(engine.state), null);
    const actors = [...engine.state.customers, engine.state.manager];
    for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) minimumGap = Math.min(minimumGap, Math.hypot(actors[a].x - actors[b].x, actors[a].z - actors[b].z));
  }
  assert.equal(counts.size, 4); assert.ok([...counts.values()].every(count => count > 5)); assert.ok(engine.state.wallet > 100000 - engine.state.spend); assert.ok(minimumGap >= .72, `${minimumGap}m clearance`);
  const served = engine.state.totalServed; engine.advance(300); assert.ok(engine.state.totalServed > served + 5);
});
test('TC-3D-025 moved/rotated/stored counter keeps its levels, recipe and lifetime production', () => {
  const initial = funded(); initial.counters[1].level = 8; initial.counters[1].recipe = 'espresso'; const engine = activate(initial, draft => { storeFurniture(draft, 'counter-b'); moveFurniture(draft, 'counter-a', 0, 3); rotateFurniture(draft, 'counter-a'); });
  assert.equal(engine.state.counters[1].level, 8); assert.equal(engine.state.counters[1].recipe, 'espresso'); engine.advance(300);
  assert.ok(engine.state.totalServed > 45); assert.equal(engine.state.counters[1].brewed, 0); assert.equal(validateLayoutState(engine.state), null);
});
test('TC-3D-025 active online, exact 80% offline, split ticks and reload have equal outcomes', () => {
  const seed = activate(funded(), expanded).snapshot(), online = createEngine(seed), offline = createEngine(seed), split = createEngine(seed);
  online.advance(800.037); const result = offline.applyOffline(1000.04625, 'layout-offline'); assert.equal(result.accepted, true); assert.equal(result.effectiveSeconds, 800.037);
  for (let i = 0; i < 8000; i++) split.advance(.1); split.advance(.037);
  assert.deepEqual(split.snapshot(), online.snapshot());
  const stripClaims = state => { delete state.lastOfflineClaimId; delete state.offlineClaimIds; return state; }; assert.deepEqual(stripClaims(offline.snapshot()), stripClaims(online.snapshot()));
  const resumed = createEngine(online.snapshot()); resumed.advance(211.017); online.advance(211.017); assert.deepEqual(resumed.snapshot(), online.snapshot());
  const before = offline.snapshot(); assert.equal(offline.applyOffline(1000, 'layout-offline').accepted, false); assert.deepEqual(offline.snapshot(), before);
});
test('TC-3D-025 economy 1/2 migration introduces inactive geometry without altering in-flight positions/assets', () => {
  const live = createEngine(); live.advance(20.037);
  for (const version of [1, 2]) {
    const source = live.snapshot(); source.economyVersion = version; delete source.layout; if (version === 1) delete source.coffeeLevels;
    const restored = createEngine(source); assert.equal(restored.state.economyVersion, 3); assert.deepEqual(restored.state.layout, initialLayout());
    for (const key of ['customers', 'counters', 'manager', 'wallet', 'totalEarned', 'spend', 'stepCarry']) assert.deepEqual(restored.state[key], source[key]);
  }
});


test('TC-3D-025 stored pending cash neither blocks renovation nor moves until counter restored', () => {
  const engine = activate(funded(), draft => storeFurniture(draft, 'counter-b')); engine.advance(1);
  engine.state.counters[1].pendingCash = 123; engine.state.totalEarned += 123;
  assert.equal(validateLayoutState(engine.state), null); engine.beginLayoutEdit(); until(engine, () => engine.layoutEditStatus() === 'ready');
  const draft = engine.createLayoutDraft(); assert.equal(engine.state.counters[1].pendingCash, 123); assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
  moveFurniture(draft, 'counter-b', 5, 0); assert.equal(engine.commitLayout(draft).ok, true); engine.drainEvents(); engine.beginLayoutEdit();
  until(engine, () => engine.layoutEditStatus() === 'ready'); const collected = engine.drainEvents().filter(event => event.type === 'collected' && event.counterId === 'counter-b');
  assert.deepEqual(collected.map(event => event.amount), [123]); assert.equal(engine.state.counters[1].pendingCash, 0); assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned);
});
test('TC-3D-025 new routes reserve the occupied entrance segment and remain collision-free every tick', () => {
  const engine = activate(funded(), expanded); let minimum = Infinity, concurrent = 0;
  for (let tick = 0; tick < 5000; tick++) {
    engine.advance(STEP_SECONDS); const actors = [...engine.state.customers, engine.state.manager]; concurrent = Math.max(concurrent, actors.filter(actor => actor.nav).length);
    for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) minimum = Math.min(minimum, Math.hypot(actors[a].x - actors[b].x, actors[a].z - actors[b].z));
  }
  assert.ok(concurrent >= 2); assert.ok(minimum >= .72, `${minimum}m clearance`);
});
test('TC-3D-025 compact purchased counters increase same-recipe capacity; long walks remain a layout tradeoff', () => {
  const output = [];
  for (const count of [1, 2, 4]) {
    const seed = funded(); for (const counter of seed.counters) counter.recipe = 'espresso';
    const engine = activate(seed, draft => {
      if (count === 1) storeFurniture(draft, 'counter-b');
      if (count === 4) { draft.expanded = true; addFurniture(draft, 'counter', -5, 1).rotation = 1; addFurniture(draft, 'counter', 5, 6); }
    });
    engine.advance(1200); output.push(engine.state.totalServed - 40);
    assert.equal(assets(engine.state), INITIAL_WALLET + engine.state.totalEarned); assert.equal(validateLayoutState(engine.state), null);
  }
  assert.ok(output[1] > output[0], output.join('/')); assert.ok(output[2] > output[1], output.join('/'));
});
test('TC-3D-025 ready editor cannot be advanced indirectly through an offline claim', () => {
  const engine = createEngine(); engine.beginLayoutEdit(); const before = engine.snapshot();
  assert.equal(engine.applyOffline(1000, 'during-edit').accepted, false); assert.deepEqual(engine.snapshot(), before);
});

test('TC-3D-025 an overfilled incoming manager never reverses money into a counter', () => {
  const source = activate().snapshot(); source.manager = { x: 0, z: -2, target: 0, phase: 'collecting', carrying: 1300, timer: .4, level: 1 }; source.totalEarned += 1300;
  assert.notEqual(validateLayoutState(source), null); const engine = createEngine(source); engine.advance(STEP_SECONDS);
  assert.equal(engine.state.counters[0].pendingCash, 0); assert.equal(engine.state.manager.carrying, 1300); assert.equal(engine.drainEvents().some(event => event.type === 'collected' && event.amount < 0), false);
});

test('TC-3D-025 empty chair is an obstacle, but its assigned seat destination stays reachable', () => {
  const layout = initialLayout(); const table = addFurniture(layout, 'table', 0, 5), seat = interactionPoint(table, 'seat');
  const across = findGridPath(layout, { x: -2, z: 6 }, { x: 2, z: 6 }); assert.ok(across); assert.equal(across.some(point => gridKey(point) === gridKey(seat)), false);
  const dine = findGridPath(layout, { x: 0, z: 2 }, seat); assert.ok(dine); assert.deepEqual(dine.at(-1), seat);
});
test('TC-3D-025 active QA traces show actual positive collection and deposit ledger deltas', () => {
  const traces = [], engine = createEngine(activate().snapshot(), trace => traces.push(trace)); engine.advance(120);
  const collect = traces.find(trace => trace.kind === 'collected'), deposit = traces.find(trace => trace.kind === 'deposited');
  assert.ok(collect.amount > 0); assert.equal(collect.pendingBefore - collect.pendingAfter, collect.amount); assert.equal(collect.carryingAfter - collect.carryingBefore, collect.amount); assert.equal(collect.walletBefore, collect.walletAfter);
  assert.ok(deposit.amount > 0); assert.equal(deposit.walletAfter - deposit.walletBefore, deposit.amount); assert.equal(deposit.carryingAfter, 0);
});
