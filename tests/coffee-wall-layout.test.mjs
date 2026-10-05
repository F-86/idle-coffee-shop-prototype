import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
const { createEngine, createInitialState, WORLD } = await import('../src/slice/core/engine.ts');
const { COFFEE_WALL, LAYOUT_VERSION, addFurniture, coffeeWallSlots, getCoffeeSigns, initialCoffeeSigns, initialLayout, layoutCost, moveCoffeeSign, normalizeLayout, occupiedCells, storeCoffeeSign, storeFurniture, validateLayout } = await import('../src/slice/core/layout.ts');
const { LocalSaveRepository, SAVE_KEY, createMemoryStorage, validateState } = await import('../src/slice/core/persistence.ts');
const { PORTABLE_VERSION, createPortableSave, overviewOf, parsePortableSave } = await import('../src/slice/core/portableSave.ts');
const copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const payload = state => ({ saveId: 'wall-sign-exchange', revision: 7, gameSchemaVersion: 1, economyVersion: 3, offlinePolicyVersion: 3, savedAt: 100000, exportedAt: 100123, overview: overviewOf(state), state: copy(state) });
const envelope = state => JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 3, savedAt: 100000, recordChangeTag: 'wall-sign-fixture', saveId: 'wall-sign-fixture', revision: 3, state });
function legacyLayout(state) { const result = copy(state); result.layout.version = 1; delete result.layout.coffeeSigns; return result; }
function edit(engine, change) {
  assert.equal(engine.beginLayoutEdit(), true);
  for (let i = 0; i < 12000 && engine.layoutEditStatus() !== 'ready'; i++) engine.advance(.05);
  assert.equal(engine.layoutEditStatus(), 'ready');
  const draft = engine.createLayoutDraft(); change(draft);
  const result = engine.commitLayout(draft); assert.equal(result.ok, true, result.message); return result;
}

test('TC-3D-026 wall menus keep their stable recipe identities and existing default coordinates', () => {
  const layout = initialLayout();
  assert.equal(LAYOUT_VERSION, 2); assert.equal(layout.version, 2); assert.equal(PORTABLE_VERSION, 3);
  assert.deepEqual(getCoffeeSigns(layout), [{ id: 'menu-espresso', recipe: 'espresso', x: 0, stored: false }, { id: 'menu-latte', recipe: 'latte', x: 5, stored: false }]);
  assert.equal(COFFEE_WALL.y, 2.7); assert.equal(COFFEE_WALL.z, -3.45);
  const other = initialCoffeeSigns(); other[0].stored = true; assert.equal(layout.coffeeSigns[0].stored, false);
  for (const expanded of [false, true]) for (const x of coffeeWallSlots({ expanded })) {
    const left = x - COFFEE_WALL.width / 2, right = x + COFFEE_WALL.width / 2;
    assert.ok(left >= -7 && right <= (expanded ? 16 : 10));
    assert.ok(left > -6.45 + 2, 'clear the fixed renovation plaque');
    assert.ok(right + COFFEE_WALL.minGap <= WORLD.vaultX - .825 || left - COFFEE_WALL.minGap >= WORLD.vaultX + .825, 'clear the fixed vault silhouette');
  }
});

test('TC-3D-026 wall move/store/restore is free and independent from floor occupancy and last-counter protection', () => {
  const state = createInitialState(), draft = initialLayout(), occupied = occupiedCells(draft);
  assert.equal(moveCoffeeSign(draft, 'menu-espresso', -2), true);
  assert.equal(moveCoffeeSign(draft, 'menu-latte', 2), true);
  assert.equal(validateLayout(draft).ok, true); assert.equal(layoutCost(state, draft).cost, 0);
  assert.deepEqual(occupiedCells(draft), occupied);
  assert.equal(moveCoffeeSign(draft, 'menu-latte', 1), true); assert.equal(validateLayout(draft).ok, false);
  assert.equal(storeCoffeeSign(draft, 'menu-latte'), true); assert.equal(validateLayout(draft).ok, true);
  assert.equal(storeCoffeeSign(draft, 'menu-espresso'), true); assert.equal(validateLayout(draft).ok, true);
  assert.equal(moveCoffeeSign(draft, 'menu-espresso', 0), true); assert.equal(draft.coffeeSigns[0].stored, false);
  assert.equal(storeFurniture(draft, 'counter-a'), true); assert.equal(storeFurniture(draft, 'counter-b'), false);
  const before = copy(draft); assert.equal(moveCoffeeSign(draft, 'menu-mocha', 5), false); assert.equal(storeCoffeeSign(draft, 'menu-mocha'), false); assert.deepEqual(draft, before);
  assert.equal(moveCoffeeSign(draft, 'menu-espresso', 12), true); assert.equal(validateLayout(draft).ok, false);
  draft.expanded = true; assert.equal(validateLayout(draft).ok, true);
});

test('TC-3D-026 malformed and future wall layouts fail closed without repairing owned signs', () => {
  const corruptions = [
    value => { delete value.coffeeSigns; }, value => { value.coffeeSigns = null; }, value => { value.coffeeSigns = []; },
    value => { value.coffeeSigns.pop(); }, value => { value.coffeeSigns.push(copy(value.coffeeSigns[0])); },
    value => { value.coffeeSigns[1] = copy(value.coffeeSigns[0]); }, value => { value.coffeeSigns[0].id = 'menu-latte'; },
    value => { value.coffeeSigns[0].recipe = 'mocha'; }, value => { value.coffeeSigns[0].stored = 1; },
    value => { value.coffeeSigns[0].x = -.5; }, value => { value.coffeeSigns[0].x = 12; }, value => { value.coffeeSigns[0].x = Infinity; },
    value => { value.coffeeSigns[0].x = 5; }, value => { value.coffeeSigns[0].z = 0; },
    value => { value.coffeeSigns[0].stored = true; value.coffeeSigns[0].x = 99; }, value => { value.version = 3; },
    value => { value.version = 1; }, value => { addFurniture(value, 'table', 0, 5).id = 'menu-espresso'; },
  ];
  for (const corrupt of corruptions) {
    const state = createInitialState(); corrupt(state.layout); const before = copy(state);
    assert.equal(validateLayout(state.layout).ok, false, corrupt.toString()); assert.equal(validateState(state).ok, false, corrupt.toString());
    assert.throws(() => normalizeLayout(state.layout)); assert.throws(() => createEngine(state)); assert.deepEqual(state, before);
  }
});

test('TC-3D-026 invalid wall drafts and cancellation cannot mutate live assets or consume the edit session', () => {
  const engine = createEngine(), before = engine.snapshot(); assert.equal(engine.beginLayoutEdit(), true);
  const draft = engine.createLayoutDraft(); moveCoffeeSign(draft, 'menu-espresso', 5);
  assert.deepEqual(engine.snapshot(), before); assert.equal(engine.commitLayout(draft).ok, false); assert.equal(engine.layoutEditStatus(), 'ready'); assert.deepEqual(engine.snapshot(), before);
  moveCoffeeSign(draft, 'menu-espresso', -2); storeCoffeeSign(draft, 'menu-latte'); engine.cancelLayoutEdit(); assert.deepEqual(engine.snapshot(), before);
  assert.equal(edit(engine, next => moveCoffeeSign(next, 'menu-espresso', -2)).cost, 0);
  const committed = engine.snapshot(); assert.equal(engine.commitLayout(draft).ok, false); assert.deepEqual(engine.snapshot(), committed);
  assert.equal(committed.wallet, before.wallet); assert.equal(committed.spend, before.spend); assert.deepEqual(committed.coffeeLevels, before.coffeeLevels); assert.deepEqual(committed.counters, before.counters);
  const inactive = createInitialState(); moveCoffeeSign(inactive.layout, 'menu-espresso', -2);
  assert.equal(validateLayout(inactive.layout).ok, true); assert.equal(validateState(inactive).ok, false, 'custom wall positions require a committed active layout');
});

for (const active of [false, true]) test(`TC-3D-026 layout1 migration preserves exact ${active ? 'dynamic' : 'legacy'} actors, cash, upgrades and clocks`, () => {
  const initial = createInitialState(); initial.wallet += 2000; initial.totalEarned += 2000;
  const engine = createEngine(initial); assert.equal(engine.upgradeCoffee('espresso'), true);
  if (active) edit(engine, draft => { addFurniture(draft, 'table', 0, 5); });
  engine.advance(61.137);
  const modern = engine.snapshot(), old = legacyLayout(modern), before = copy(old), checked = validateState(old);
  assert.equal(checked.ok, true, checked.message); assert.deepEqual(old, before); assert.deepEqual(checked.state, modern);
  assert.deepEqual(createEngine(old).snapshot(), modern); assert.deepEqual(validateState(checked.state).state, modern);
  const storage = createMemoryStorage(), raw = envelope(old); storage.setItem(SAVE_KEY, raw);
  const loaded = new LocalSaveRepository(storage).load(100000); assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, modern); assert.equal(storage.getItem(SAVE_KEY), raw);
  const migrated = createEngine(old), current = createEngine(modern); migrated.advance(123.043); current.advance(123.043); assert.deepEqual(migrated.snapshot(), current.snapshot());
});

test('TC-3D-026 moved/stored signs preserve recipe upgrades, counter recipes and deterministic operating revenue', () => {
  const left = createEngine(), right = createEngine();
  assert.equal(left.upgradeCoffee('espresso'), true); assert.equal(right.upgradeCoffee('espresso'), true);
  const before = left.snapshot();
  assert.equal(edit(left, draft => { moveCoffeeSign(draft, 'menu-espresso', -2); storeCoffeeSign(draft, 'menu-espresso'); storeCoffeeSign(draft, 'menu-latte'); }).cost, 0);
  edit(right, () => {});
  assert.equal(left.state.wallet, before.wallet); assert.equal(left.state.spend, before.spend); assert.deepEqual(left.state.coffeeLevels, before.coffeeLevels);
  assert.equal(left.setRecipe('counter-a', 'latte'), true); assert.equal(right.setRecipe('counter-a', 'latte'), true);
  assert.equal(left.upgradeCoffee('latte'), right.upgradeCoffee('latte'));
  left.advance(500.037); right.advance(500.037);
  const stored = left.snapshot(), shown = right.snapshot(); delete stored.layout.coffeeSigns; delete shown.layout.coffeeSigns; assert.deepEqual(stored, shown);
  assert.ok(left.state.totalServed > 0); assert.equal(validateState(left.snapshot()).ok, true);
});

test('TC-3D-026 layout2 local and portable3 saves round-trip wall placements without changing old v3 file identity', async () => {
  const engine = createEngine(); edit(engine, draft => { moveCoffeeSign(draft, 'menu-espresso', -2); storeCoffeeSign(draft, 'menu-latte'); }); engine.advance(91.037);
  const state = engine.snapshot(), storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); repo.load(100000);
  assert.equal(repo.save(state, 100000).ok, true); assert.deepEqual(new LocalSaveRepository(storage).load(100000).state, state);
  const file = await createPortableSave(payload(state)), parsed = await parsePortableSave(file.text);
  assert.equal(parsed.ok, true, parsed.message); assert.deepEqual(parsed.file.payload.state, state);
  const old = payload(legacyLayout(state)), payloadText = JSON.stringify(old, null, 2);
  const text = JSON.stringify({ format: 'mellow-bean-portable-save', formatVersion: 3, payloadText, integrity: { algorithm: 'SHA-256', sha256: hash(payloadText) } });
  const imported = await parsePortableSave(text); assert.equal(imported.ok, true, imported.message); assert.equal(imported.file.text, text); assert.equal(imported.file.fingerprint, hash(payloadText));
  assert.deepEqual(imported.file.payload.state.layout.coffeeSigns, initialCoffeeSigns()); assert.deepEqual(imported.file.payload.overview, old.overview);
  const normalized = copy(state); normalized.layout.coffeeSigns = initialCoffeeSigns(); assert.deepEqual(imported.file.payload.state, normalized);
});

test('TC-3D-026 malformed and future layout2 archives protect original bytes and reject checksummed portable input', async () => {
  for (const [change, status] of [[state => { delete state.layout.coffeeSigns; }, 'corrupt'], [state => { state.layout.version = 3; }, 'future'], [state => { state.layout.coffeeSigns[0].x = 5; }, 'corrupt']]) {
    const state = createInitialState(); change(state); const raw = envelope(state), storage = createMemoryStorage(); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, status); assert.equal(repo.save(createInitialState(), 100000).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
    const source = payload(state), payloadText = JSON.stringify(source);
    const text = JSON.stringify({ format: 'mellow-bean-portable-save', formatVersion: 3, payloadText, integrity: { algorithm: 'SHA-256', sha256: hash(payloadText) } });
    assert.equal((await parsePortableSave(text)).ok, false);
  }
});

test('TC-3D-026 offline replay preserves stored signs and exactly matches effective online time', () => {
  const engine = createEngine(); edit(engine, draft => { storeCoffeeSign(draft, 'menu-espresso'); storeCoffeeSign(draft, 'menu-latte'); });
  const online = createEngine(engine.snapshot()), offline = createEngine(engine.snapshot());
  online.advance(160.037); const result = offline.applyOffline(200.04625, 'wall-layout-offline'); assert.equal(result.accepted, true); assert.equal(result.effectiveSeconds, 160.037);
  const beforeClaims = value => { const state = copy(value); delete state.lastOfflineClaimId; delete state.offlineClaimIds; return state; };
  assert.deepEqual(beforeClaims(offline.snapshot()), beforeClaims(online.snapshot())); assert.ok(offline.state.layout.coffeeSigns.every(sign => sign.stored));
  const before = offline.snapshot(); assert.equal(offline.applyOffline(200.04625, 'wall-layout-offline').accepted, false); assert.deepEqual(offline.snapshot(), before);
});
