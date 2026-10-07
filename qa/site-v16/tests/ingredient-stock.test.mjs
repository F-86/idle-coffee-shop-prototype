import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
const { createEngine, createInitialState, INITIAL_WALLET, STEP_SECONDS } = await import('../src/slice/core/engine.ts');
const { canBrew, consumeIngredients, INGREDIENT_CONFIG } = await import('../src/slice/core/ingredients.ts');
const { interactionPoint } = await import('../src/slice/core/layout.ts');
const { validateState, LocalSaveRepository, createMemoryStorage } = await import('../src/slice/core/persistence.ts');
const { readFile } = await import('node:fs/promises');
const archives = JSON.parse(await readFile(new URL('./fixtures/economy3-operations-migration.json', import.meta.url), 'utf8'));
const withoutClaims = state => { const out = structuredClone(state); delete out.lastOfflineClaimId; delete out.offlineClaimIds; return out; };
const validate = state => { const checked = validateState(state); assert.equal(checked.ok, true, checked.message); assert.equal(state.wallet + state.spend, INITIAL_WALLET + state.totalEarned); };
function queued(stock = { beans: 1, milk: 1 }) {
  const state = createInitialState(); state.ingredients = stock; state.nextCustomerId = 3;
  state.customers = state.counters.map((counter, i) => ({ id: i + 1, ...interactionPoint(state.layout.furniture.find(item => item.counterId === counter.id), 'service'), phase: 'queue', counterId: counter.id, timer: 0, hasCup: false, skin: i }));
  return state;
}
function finishDrain(engine) {
  if (!engine.state.paused) engine.togglePause();
  engine.beginLayoutEdit();
  for (let tick = 0; tick < 6000 && engine.layoutEditStatus() !== 'ready'; tick++) {
    engine.advance(STEP_SECONDS); validate(engine.snapshot());
  }
  assert.equal(engine.layoutEditStatus(), 'ready'); assert.equal(engine.state.customers.length, 0); assert.equal(engine.state.counters.some(c => c.brew), false);
}

test('TC-3D-028 recipes reserve complete doses atomically, with free water and no partial loss', () => {
  const state = createInitialState(); state.ingredients = { beans: 1, milk: 0 };
  assert.equal(canBrew(state, 'espresso'), true); assert.equal(canBrew(state, 'latte'), false);
  assert.equal(consumeIngredients(state, 'latte'), false); assert.deepEqual(state.ingredients, { beans: 1, milk: 0 });
  assert.equal(consumeIngredients(state, 'espresso'), true); assert.deepEqual(state.ingredients, { beans: 0, milk: 0 });
  assert.equal(consumeIngredients(state, 'espresso'), false); assert.equal(consumeIngredients(state, 'unknown'), false);
});

test('TC-3D-028 two counters racing for the final bean produce one cup; empty guest exits and pause drains', () => {
  const engine = createEngine(queued()); engine.advance(STEP_SECONDS);
  assert.equal(engine.state.counters.filter(c => c.brew).length, 1);
  assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 1 });
  const empty = engine.state.customers.find(c => c.departureReason === 'stockout');
  assert.equal(empty.hasCup, false); assert.equal(empty.phase, 'leaving'); validate(engine.snapshot());
  finishDrain(engine); assert.equal(engine.state.totalServed, 1); assert.equal(engine.state.totalEarned, 110);
  assert.equal(engine.state.counters.reduce((n, c) => n + c.brewed, 0), 1);
});

test('TC-3D-028 missing milk blocks only latte, and missing recipes receive no new guests or invite cooldown', () => {
  const engine = createEngine(); engine.state.ingredients = { beans: 4, milk: 0 };
  assert.equal(engine.invite(), true); assert.ok(engine.state.customers.every(c => c.counterId === 'counter-a'));
  engine.advance(200); assert.equal(engine.state.totalServed, 4); assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 0 });
  assert.equal(engine.state.customers.length, 0); assert.equal(engine.invite(), false); assert.equal(engine.state.inviteCooldown, 0);
  assert.equal(engine.buyIngredient('beans', 'one'), true); engine.advance(60); assert.equal(engine.state.totalServed, 5);
  validate(engine.snapshot());
});

test('TC-3D-028 in-flight recipe, price and ingredients survive upgrade, recipe change and every refresh', () => {
  let engine = createEngine(queued({ beans: 2, milk: 1 })); engine.advance(STEP_SECONDS);
  const frozen = structuredClone(engine.state.counters.map(c => c.brew));
  assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 0 });
  assert.equal(engine.upgrade('counter-a'), true); assert.equal(engine.setRecipe('counter-a', 'latte'), true);
  const money = engine.state.wallet; engine.togglePause();
  for (let i = 0; i < 1200 && engine.state.customers.length; i++) {
    const snapshot = engine.snapshot(); validate(snapshot); engine = createEngine(validateState(snapshot).state); engine.advance(STEP_SECONDS);
    assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 0 });
    for (const c of engine.state.counters) if (c.brew) for (const k of ['recipe', 'price', 'duration', 'customerId']) assert.equal(c.brew[k], frozen.find(b => b.customerId === c.brew.customerId)[k]);
  }
  assert.equal(engine.state.totalServed, 2); assert.equal(engine.state.wallet - money, frozen.reduce((n, b) => n + b.price, 0));
  assert.equal(engine.state.customers.length, 0);
});

test('TC-3D-028 one, batch and fill purchases quote current stock, exact money, capacity and repeat clicks', () => {
  const state = createInitialState(); state.wallet += 10000; state.totalEarned += 10000; const engine = createEngine(state);
  for (const id of ['beans', 'milk']) {
    const config = INGREDIENT_CONFIG[id], before = engine.snapshot(), one = engine.ingredientQuote(id, 'one');
    assert.deepEqual(one, { quantity: 1, cost: config.unitCost, stock: config.initial, capacity: config.capacity, affordable: true });
    assert.equal(engine.buyIngredient(id, 'one'), true); assert.equal(engine.state.wallet, before.wallet - config.unitCost);
    const batch = engine.ingredientQuote(id, 'batch'); assert.equal(batch.quantity, config.batch); assert.equal(engine.buyIngredient(id, 'batch'), true);
    const fill = engine.ingredientQuote(id, 'fill'); assert.equal(fill.quantity, config.capacity - config.initial - 1 - config.batch);
    assert.equal(engine.buyIngredient(id, 'fill'), true); assert.equal(engine.state.ingredients[id], config.capacity);
    const full = engine.snapshot(); for (const mode of ['one', 'batch', 'fill']) { assert.equal(engine.buyIngredient(id, mode), false); assert.equal(engine.ingredientQuote(id, mode).quantity, 0); }
    assert.deepEqual(engine.snapshot(), full); validate(engine.snapshot());
  }
  engine.state.ingredients.beans -= 3;
  assert.equal(engine.ingredientQuote('beans', 'batch').quantity, 3); assert.equal(engine.ingredientQuote('beans', 'batch').cost, 60);
  assert.equal(engine.buyIngredient('beans', 'batch'), true); assert.equal(engine.state.ingredients.beans, 120);
  const before = engine.snapshot(); for (const [id, mode] of [['beans', 'bad'], ['unknown', 'one'], ['__proto__', 'fill'], ['beans', null]]) assert.equal(engine.buyIngredient(id, mode), false);
  assert.deepEqual(engine.snapshot(), before);
});

test('TC-3D-028 unaffordable fill never partially buys or borrows; single-dose purchase remains available paused', () => {
  const state = createInitialState(); state.wallet = 20; state.spend = INITIAL_WALLET - 20; state.ingredients = { beans: 0, milk: 0 }; state.paused = true;
  const engine = createEngine(state), before = engine.snapshot();
  assert.equal(engine.buyIngredient('beans', 'fill'), false); assert.equal(engine.buyIngredient('beans', 'batch'), false); assert.deepEqual(engine.snapshot(), before);
  assert.equal(engine.buyIngredient('beans', 'one'), true); assert.equal(engine.state.wallet, 0); assert.equal(engine.state.ingredients.beans, 1); assert.equal(engine.state.paused, true);
  assert.equal(engine.buyIngredient('beans', 'one'), false); validate(engine.snapshot());
  engine.beginLayoutEdit(); assert.equal(engine.layoutEditStatus(), 'ready');
  const funded = createEngine(); funded.togglePause(); funded.beginLayoutEdit(); assert.equal(funded.buyIngredient('beans', 'one'), true); assert.equal(funded.layoutEditStatus(), 'ready');
});

test('TC-3D-028 no rescue grants or automatic purchases appear in an insolvent shop', () => {
  const state = createInitialState(); state.wallet = 0; state.spend = INITIAL_WALLET; state.ingredients = { beans: 0, milk: 0 };
  const engine = createEngine(state); engine.advance(600); assert.equal(engine.buyIngredient('beans', 'one'), false);
  const stock = structuredClone(engine.state.ingredients), wallet = engine.state.wallet, spend = engine.state.spend;
  const result = engine.applyOffline(86400, 'no-bailout'); assert.equal(result.accepted, true); assert.equal(result.amount, 0); assert.equal(result.stockout, true);
  assert.deepEqual(engine.state.ingredients, stock); assert.equal(engine.state.wallet, wallet); assert.equal(engine.state.spend, spend); assert.equal(engine.state.totalServed, 0); validate(engine.snapshot());
});

test('TC-3D-028 finite offline inventory equals online 80% simulation, with no purchase expense or duplicate claim', () => {
  const state = queued({ beans: 2, milk: 1 }), offline = createEngine(state), online = createEngine(state);
  const before = offline.snapshot(); const job = offline.beginOffline(400, 'finite-offline');
  assert.equal(offline.buyIngredient('beans', 'one'), false);
  assert.equal(offline.upgrade('counter-a'), false); assert.equal(offline.upgradeCoffee('espresso'), false); assert.equal(offline.setRecipe('counter-a', 'latte'), false); assert.equal(offline.invite(), false); assert.equal(offline.beginLayoutEdit(), false);
  offline.togglePause(); offline.advance(40); assert.deepEqual(offline.snapshot(), before, 'a pending detached settlement owns its engine until completion');
  while (!job.done) job.advance(67); online.advance(320);
  assert.deepEqual(withoutClaims(offline.snapshot()), withoutClaims(online.snapshot()));
  const result = job.result(); assert.equal(result.amount, offline.state.wallet - before.wallet); assert.equal(result.generatedAmount, result.amount); assert.equal(result.stockout, true);
  assert.equal(offline.state.totalServed, 2); assert.deepEqual(offline.state.ingredients, { beans: 0, milk: 0 }); assert.equal(offline.state.spend, 0);
  const done = offline.snapshot(); assert.equal(offline.applyOffline(400, 'finite-offline').accepted, false); assert.deepEqual(offline.snapshot(), done);
  assert.equal(offline.buyIngredient('beans', 'one'), true); validate(offline.snapshot());
});

test('TC-3D-028 pause means zero offline consumption; online stockout drain reaches renovation', () => {
  const engine = createEngine(queued({ beans: 0, milk: 0 })); engine.togglePause(); const before = engine.snapshot();
  const result = engine.applyOffline(86400, 'paused-stock'); assert.equal(result.amount, 0); assert.equal(result.effectiveSeconds, 0);
  assert.deepEqual(withoutClaims(engine.snapshot()), withoutClaims(before)); finishDrain(engine); assert.equal(engine.state.totalServed, 0);
});

test('TC-3D-028 legacy in-flight orders finish without another dose, unstarted legacy customers stock out safely', () => {
  const migrated = validateState(archives.inactive); assert.equal(migrated.ok, true);
  const initial = migrated.state; initial.ingredients = { beans: 0, milk: 0 };
  const existing = initial.counters.filter(c => c.brew).length, initialServed = initial.totalServed;
  const engine = createEngine(initial); finishDrain(engine);
  assert.equal(engine.state.totalServed, initialServed + existing); assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 0 }); assert.equal(engine.state.customerRouteVersion, 4);
});

test('TC-3D-028 saved purchase and stockout departure retain inventory through repeated saves and loads', () => {
  const engine = createEngine(queued()), memory = createMemoryStorage(), repo = new LocalSaveRepository(memory); engine.advance(STEP_SECONDS); engine.togglePause();
  assert.equal(engine.buyIngredient('milk', 'one'), true); const saved = engine.snapshot();
  assert.equal(repo.save(saved, 1000).ok, true);
  for (let i = 0; i < 8; i++) {
    const loaded = new LocalSaveRepository(memory).load(1000); assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, saved);
    assert.equal(new LocalSaveRepository(createMemoryStorage()).save(loaded.state, 1000).ok, true);
  }
});
