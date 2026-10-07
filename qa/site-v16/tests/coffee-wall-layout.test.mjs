import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
const { createEngine, createInitialState, ECONOMY_VERSION } = await import('../src/slice/core/engine.ts');
const { LAYOUT_VERSION, initialLayout, getCoffeeSigns, normalizeLayout, moveCoffeeSign, storeCoffeeSign, validateLayout } = await import('../src/slice/core/layout.ts');
const { LocalSaveRepository, SAVE_KEY, createMemoryStorage, validateState } = await import('../src/slice/core/persistence.ts');
const { PORTABLE_VERSION, createPortableSave, overviewOf, parsePortableSave } = await import('../src/slice/core/portableSave.ts');
const legacy = JSON.parse(readFileSync(new URL('./fixtures/economy3-operations-migration.json', import.meta.url)));
const copy = value => structuredClone(value);
const payload = state => ({ saveId: 'hidden-sign-exchange', revision: 7, gameSchemaVersion: 1, economyVersion: ECONOMY_VERSION, offlinePolicyVersion: 4, savedAt: 100000, exportedAt: 100123, overview: overviewOf(state), state: copy(state) });
const envelope = state => JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 4, savedAt: 100000, recordChangeTag: 'hidden-sign-fixture', saveId: 'hidden-sign-fixture', revision: 3, state });

test('TC-3D-027 current shops store legacy plaques and cannot re-hang them', () => {
  const layout = initialLayout(); assert.equal(LAYOUT_VERSION, 3); assert.equal(PORTABLE_VERSION, 9); assert.equal(layout.active, true);
  assert.deepEqual(getCoffeeSigns(layout), [{ id: 'menu-espresso', recipe: 'espresso', x: 0, stored: true }, { id: 'menu-latte', recipe: 'latte', x: 5, stored: true }]);
  const before = copy(layout); assert.equal(moveCoffeeSign(layout, 'menu-espresso', -2), false); assert.deepEqual(layout, before); assert.equal(storeCoffeeSign(layout, 'menu-espresso'), true);
  layout.coffeeSigns[0].stored = false; assert.equal(validateLayout(layout).ok, false);
});

for (const version of [1, 2]) test(`TC-3D-027 legacy layout${version} plaques are stored without changing recipes, positions, paid levels or brew snapshots`, () => {
  const source = copy(legacy.active); source.coffeeLevels = { espresso: 3, latte: 5 }; source.layout.version = version;
  if (version === 1) delete source.layout.coffeeSigns; else { source.layout.coffeeSigns[0].x = -2; source.layout.coffeeSigns[1].x = 3; }
  const before = copy(source), checked = validateState(source); assert.equal(checked.ok, true, checked.message); assert.deepEqual(source, before);
  assert.deepEqual(checked.state.coffeeLevels, source.coffeeLevels); assert.deepEqual(checked.state.customers, source.customers); assert.deepEqual(checked.state.counters.map(counter => counter.brew), source.counters.map(counter => counter.brew));
  assert.ok(checked.state.layout.coffeeSigns.every(sign => sign.stored)); assert.deepEqual(checked.state.layout.coffeeSigns.map(sign => sign.x), version === 1 ? [0, 5] : [-2, 3]);
  assert.deepEqual(validateState(checked.state).state, checked.state);
});

test('TC-3D-027 recipe progression works through counter controls with no wall placement dependency', () => {
  const state = createInitialState(); state.wallet += 10000; state.totalEarned += 10000; const engine = createEngine(state);
  assert.equal(engine.upgradeCoffee('espresso'), false); assert.equal(engine.state.coffeeLevels.espresso, 1); assert.ok(engine.state.layout.coffeeSigns.every(sign => sign.stored));
  engine.advance(120); assert.ok(engine.state.totalServed > 0); assert.equal(validateState(engine.snapshot()).ok, true);
});

test('TC-3D-027 malformed current plaque tombstones and newer layouts fail closed', () => {
  const mutations = [layout => { delete layout.coffeeSigns; }, layout => { layout.coffeeSigns = null; }, layout => { layout.coffeeSigns.pop(); }, layout => { layout.coffeeSigns[1] = copy(layout.coffeeSigns[0]); }, layout => { layout.coffeeSigns[0].recipe = 'mocha'; }, layout => { layout.coffeeSigns[0].stored = false; }, layout => { layout.coffeeSigns[0].x = -.5; }, layout => { layout.coffeeSigns[0].x = 99; }, layout => { layout.coffeeSigns[0].z = 0; }, layout => { layout.version = 4; }, layout => { layout.version = 1; }];
  for (const mutate of mutations) { const state = createInitialState(); mutate(state.layout); assert.equal(validateState(state).ok, false, mutate.toString()); }
  const layout = initialLayout(); layout.version = 1; assert.throws(() => normalizeLayout(layout));
});

test('TC-3D-027 current local and portable5 snapshots preserve hidden plaques and business pause', async () => {
  const engine = createEngine(); engine.advance(20); engine.togglePause(); const snapshot = engine.snapshot(), storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); repo.load(100000); assert.equal(repo.save(snapshot, 100000).ok, true);
  const loaded = new LocalSaveRepository(storage).load(200000); assert.equal(loaded.state.paused, true); assert.equal(loaded.offline.amount, 0); assert.deepEqual(loaded.state.customers, snapshot.customers);
  const file = await createPortableSave(payload(loaded.state)), parsed = await parsePortableSave(file.text); assert.equal(parsed.ok, true, parsed.message); assert.deepEqual(parsed.file.payload.state, loaded.state); assert.ok(parsed.file.payload.state.layout.coffeeSigns.every(sign => sign.stored));
});

test('TC-3D-027 corrupt wall records protect original bytes and reject checksummed portable input', async () => {
  for (const value of [null, [], [{ id: 'menu-espresso', recipe: 'espresso', x: 0, stored: true }]]) {
    const state = createInitialState(); state.layout.coffeeSigns = value; const raw = envelope(state), storage = createMemoryStorage(); storage.setItem(SAVE_KEY, raw); const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, 'corrupt'); assert.equal(repo.save(createInitialState()).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
    const source = { ...payload(createInitialState()), state }, payloadText = JSON.stringify(source), sha256 = createHash('sha256').update(payloadText).digest('hex'); assert.equal((await parsePortableSave(JSON.stringify({ format: 'mellow-bean-portable-save', formatVersion: 9, payloadText, integrity: { algorithm: 'SHA-256', sha256 } }))).ok, false);
  }
});
