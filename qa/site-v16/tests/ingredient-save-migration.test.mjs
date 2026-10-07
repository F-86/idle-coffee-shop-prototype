import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { createEngine, createInitialState, INITIAL_WALLET } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, createMemoryStorage, validateState } = await import('../src/slice/core/persistence.ts');
const { createPortableSave, parsePortableSave, overviewOf } = await import('../src/slice/core/portableSave.ts');
const old4 = JSON.parse(await readFile(new URL('./fixtures/economy4-ingredients-migration.json', import.meta.url), 'utf8'));
const old3 = JSON.parse(await readFile(new URL('./fixtures/economy3-operations-migration.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const stock = { beans: 40, milk: 20 };
const business = state => { const copy = clone(state); delete copy.lastOfflineClaimId; delete copy.offlineClaimIds; return copy; };
const envelope = (state, policy = 4) => JSON.stringify({ schemaVersion: 1, savedAt: 100000, recordChangeTag: 'inventory-fixture', offlinePolicyVersion: policy, state });
const ledger = state => assert.equal(state.wallet, INITIAL_WALLET + state.totalEarned - state.spend);
function repository(state, policy = 4) {
  const storage = createMemoryStorage(), raw = envelope(state, policy); storage.setItem(SAVE_KEY, raw);
  return { storage, raw, repo: new LocalSaveRepository(storage) };
}
function legacyState(version) {
  if (version === 4) return clone(old4.inFlight);
  const state = clone(old3.inactive); state.economyVersion = version;
  if (version < 3) delete state.layout;
  if (version === 1) delete state.coffeeLevels;
  return state;
}
function filePayload(state, version = state.economyVersion) {
  const overview = {
    wallet: state.wallet, totalEarned: state.totalEarned, totalServed: state.totalServed, elapsed: state.elapsed,
    counterLevels: state.counters.map(counter => counter.level),
    ...(version > 1 ? { coffeeLevels: { ...state.coffeeLevels } } : {}),
    managerLevel: state.manager.level, pendingCash: state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), carrying: state.manager.carrying,
    ...(version >= 3 ? { placedCounters: state.layout.furniture.filter(item => item.kind === 'counter' && !item.stored).length, placedSeats: state.layout.furniture.filter(item => item.kind === 'table' && !item.stored).length, expanded: state.layout.expanded } : {}),
    ...(version >= 5 ? { ingredients: { ...state.ingredients } } : {})
  };
  return { saveId: 'inventory-source', revision: 7, gameSchemaVersion: 1, economyVersion: version, offlinePolicyVersion: version < 5 ? 3 : 4, savedAt: 0, exportedAt: 1, overview, state: clone(state) };
}
function independentFile(payload, formatVersion = 9) {
  const payloadText = JSON.stringify(payload), sha256 = createHash('sha256').update(payloadText, 'utf8').digest('hex');
  return JSON.stringify({ format: 'mellow-bean-portable-save', formatVersion, payloadText, integrity: { algorithm: 'SHA-256', sha256 } });
}

test('TC-3D-028 v5 requires exact bounded integer inventory and old schemas forbid inventory', async () => {
  for (const ingredients of [undefined, null, [], {}, { beans: 0 }, { beans: 0, milk: 0, sugar: 0 }, { beans: -1, milk: 0 }, { beans: 121, milk: 0 }, { beans: 0, milk: 81 }, { beans: .1, milk: 0 }, { beans: 0, milk: '1' }, { beans: Infinity, milk: 0 }]) {
    const state = createInitialState(); state.ingredients = ingredients;
    assert.equal(validateState(state).ok, false, JSON.stringify(ingredients));
    const f = repository(state); assert.equal(f.repo.load(100000).status, 'corrupt');
    assert.equal(f.storage.getItem(SAVE_KEY), f.raw); assert.equal(f.repo.save(createInitialState()).ok, false);
  }
  for (const ingredients of [{ beans: 0, milk: 0 }, { beans: 120, milk: 80 }]) {
    const state = createInitialState(); state.ingredients = ingredients;
    assert.equal(validateState(state).ok, true); assert.deepEqual(validateState(state).state.ingredients, ingredients);
    assert.equal((await parsePortableSave(independentFile(filePayload(state)))).ok, true);
  }
  for (const version of [1, 2, 3, 4]) {
    const state = legacyState(version); state.ingredients = { beans: 0, milk: 0 };
    assert.equal(validateState(state).ok, false, `relabelled economy${version}`);
    assert.equal((await parsePortableSave(independentFile(filePayload(state, version), version))).ok, false);
  }
});

test('TC-3D-028 v1–4 seed once without changing in-flight orders, income, pause or owned upgrades', () => {
  for (const version of [1, 2, 3, 4]) {
    const original = legacyState(version), before = clone(original), result = validateState(original);
    assert.equal(result.ok, true, result.message); assert.deepEqual(original, before);
    const migrated = result.state;
    assert.equal(migrated.economyVersion, 9); assert.deepEqual(migrated.ingredients, stock);
    assert.equal(migrated.totalEarned, original.totalEarned); assert.equal(migrated.totalServed, original.totalServed);
    assert.equal(migrated.paused, original.paused); assert.equal(migrated.spend, original.spend);
    assert.deepEqual(migrated.counters.map(c => c.brew), original.counters.map(c => c.brew));
    assert.deepEqual(migrated.counters.map(c => [c.level, c.recipe]), original.counters.map(c => [c.level, c.recipe]));
    assert.deepEqual(migrated.customers, original.customers); ledger(migrated);
    assert.deepEqual(validateState(migrated).state, migrated);
    migrated.ingredients = { beans: 0, milk: 3 };
    assert.deepEqual(validateState(migrated).state.ingredients, { beans: 0, milk: 3 });
    assert.deepEqual(createEngine(migrated).snapshot().ingredients, { beans: 0, milk: 3 });
  }
});

test('TC-3D-028 migrated in-flight brew completes at frozen price with zero stock and no second consumption', () => {
  const checked = validateState(old4.paused); assert.equal(checked.ok, true);
  const state = checked.state, brew = clone(state.counters[0].brew), earned = state.totalEarned;
  state.ingredients = { beans: 0, milk: 0 };
  const engine = createEngine(state); engine.advance(.5);
  for (const field of ['recipe', 'price', 'duration', 'customerId']) assert.equal(engine.state.counters[0].brew[field], brew[field]);
  assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 0 });
  engine.advance(2.5);
  assert.equal(engine.state.totalEarned - earned, brew.price); assert.deepEqual(engine.state.ingredients, { beans: 0, milk: 0 });
  assert.equal(validateState(engine.snapshot()).ok, true); ledger(engine.state);
});

test('TC-3D-028 stockout departures save only as empty-cup v5 leaving customers', () => {
  const state = createInitialState(); state.nextCustomerId = 2;
  state.customers = [{ id: 1, x: 0, z: 2, phase: 'leaving', counterId: 'counter-a', timer: 0, hasCup: false, skin: 0, departureReason: 'stockout' }];
  assert.equal(validateState(state).ok, true);
  for (const change of [customer => { delete customer.departureReason; }, customer => { customer.departureReason = 'unknown'; }, customer => { customer.hasCup = true; }, customer => { customer.phase = 'queue'; }]) {
    const invalid = clone(state); change(invalid.customers[0]); assert.equal(validateState(invalid).ok, false, change.toString());
  }
  const ordinary = clone(state); delete ordinary.customers[0].departureReason; ordinary.customers[0].hasCup = true;
  assert.equal(validateState(ordinary).ok, true, 'ordinary departures retain their cup');
  const old = clone(state); old.economyVersion = 4; delete old.ingredients;
  assert.equal(validateState(old).ok, false, 'old schemas cannot relabel empty-cup departures');
  const f = repository(state); assert.deepEqual(f.repo.load(100000).state, state);
  assert.equal(f.repo.save(state, 100001).ok, true); assert.deepEqual(f.repo.durableSnapshot().state.customers, state.customers);
});

test('TC-3D-028 pending legacy local windows match frozen unlimited-production oracle then stamp policy4', () => {
  for (const sample of old4.offlineWindows) {
    const f = repository(old4.inFlight, sample.policy), now = 100000 + sample.wall * 1000;
    const actual = f.repo.load(now); assert.equal(actual.status, 'loaded', actual.message);
    const expected = validateState(sample.state); assert.equal(expected.ok, true);
    assert.deepEqual(business(actual.state), business(expected.state), `legacy policy${sample.policy}`);
    assert.deepEqual(actual.state.ingredients, stock); ledger(actual.state);
    if (sample.policy === 3) assert.ok(actual.state.totalServed > 40, 'old window must not be cut short by new stock');
    const durable = f.storage.getItem(SAVE_KEY), record = JSON.parse(durable);
    assert.equal(record.offlinePolicyVersion, 4); assert.equal(record.state.economyVersion, 9); assert.equal(record.savedAt, now);
    assert.deepEqual(new LocalSaveRepository(f.storage).load(now).state, actual.state); assert.equal(f.storage.getItem(SAVE_KEY), durable);
    const next = new LocalSaveRepository(f.storage).load(now + 30000), online = createEngine(actual.state); online.advance(24);
    assert.deepEqual(business(next.state), business(online.snapshot())); assert.equal(next.offline.policyVersion, 4);
    assert.ok(next.state.ingredients.beans < 40, 'the next interval reserves finite stock');
  }
});

test('TC-3D-028 failed legacy settlement preserves old anchor and stock seed until a successful atomic retry', () => {
  const memory = createMemoryStorage(), raw = envelope(old4.inFlight, 3); memory.setItem(SAVE_KEY, raw); let deny = true;
  const storage = { ...memory, setItem(key, value) { if (deny) throw Error('quota'); memory.setItem(key, value); } };
  const repo = new LocalSaveRepository(storage), failed = repo.load(700000);
  assert.equal(failed.status, 'offline-save-failed'); assert.equal(memory.getItem(SAVE_KEY), raw);
  assert.deepEqual(failed.state.ingredients, stock); assert.equal(failed.state.totalEarned, old4.inFlight.totalEarned);
  assert.equal(repo.save(failed.state, 700000).ok, false);
  deny = false; const restored = repo.load(700000);
  const oracle = validateState(old4.offlineWindows.find(sample => sample.policy === 3).state);
  assert.deepEqual(business(restored.state), business(oracle.state)); assert.deepEqual(restored.state.ingredients, stock);
  const once = memory.getItem(SAVE_KEY); assert.deepEqual(new LocalSaveRepository(storage).load(700000).state, restored.state);
  assert.equal(memory.getItem(SAVE_KEY), once);
});

test('TC-3D-028 policy4 consumes exact finite stock during unlimited 80-percent offline time', () => {
  const initial = createInitialState(), f = repository(initial), result = f.repo.load(700000), online = createEngine(initial); online.advance(480);
  assert.equal(result.status, 'loaded'); assert.equal(result.offline.effectiveSeconds, 480); assert.equal(result.offline.awaySeconds, 600);
  assert.equal(result.offline.stockout, true); assert.deepEqual(business(result.state), business(online.snapshot()));
  assert.equal(result.state.ingredients.beans, 0); assert.ok(result.state.totalServed <= 40); assert.equal(result.state.spend, initial.spend); ledger(result.state);
  const repeat = new LocalSaveRepository(f.storage).load(1300000);
  assert.equal(repeat.offline.amount, 0); assert.equal(repeat.state.totalEarned, result.state.totalEarned);
  assert.deepEqual(repeat.state.ingredients, result.state.ingredients); assert.equal(repeat.state.elapsed, 960);
});

test('TC-3D-028 legacy files verify old overview shape and seed preview once without file-era income', async () => {
  for (const version of [1, 2, 3, 4]) {
    const source = legacyState(version), payload = filePayload(source, version), text = independentFile(payload, version);
    assert.equal(Object.hasOwn(payload.overview, 'ingredients'), false);
    const parsed = await parsePortableSave(text); assert.equal(parsed.ok, true, `v${version}: ${parsed.message}`);
    assert.equal(parsed.file.text, text); assert.deepEqual(parsed.file.payload.state.ingredients, stock);
    assert.deepEqual(parsed.file.payload.overview.ingredients, stock); assert.equal(parsed.file.payload.offlinePolicyVersion, 4);
    assert.equal(parsed.file.payload.state.totalEarned, source.totalEarned); assert.equal(parsed.file.payload.state.elapsed, source.elapsed);
    const storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); repo.load(900000);
    const imported = repo.importSnapshot(parsed.file.payload.state, { expectedRaw: null, currentState: null, fingerprint: parsed.file.fingerprint, otherTabsClosed: true }, 900000);
    assert.equal(imported.ok, true); assert.deepEqual(imported.state, parsed.file.payload.state);
    assert.deepEqual(new LocalSaveRepository(storage).load(900000).state, imported.state);
    const forged = clone(payload); forged.overview.ingredients = stock;
    assert.equal((await parsePortableSave(independentFile(forged, version))).ok, false, 'new preview fields cannot smuggle into original legacy shape');
    const wrongPolicy = clone(payload); wrongPolicy.offlinePolicyVersion = 4;
    assert.equal((await parsePortableSave(independentFile(wrongPolicy, version))).ok, false, 'old file contract retains original policy3');
  }
});

test('TC-3D-028 v5 export, restore, recovery backup and repeat imports never refill depleted stock', async () => {
  const current = createInitialState(); current.ingredients = { beans: 0, milk: 2 }; current.paused = true;
  const file = await createPortableSave(filePayload(current));
  assert.equal(JSON.parse(file.text).formatVersion, 9); assert.deepEqual(file.payload.overview, overviewOf(current));
  assert.equal(Object.isFrozen(file.payload.overview.ingredients), true); assert.equal(Object.isFrozen(file.payload.state.ingredients), true);
  const f = repository(current); f.repo.load(100000); let raw = f.raw;
  for (let index = 0; index < 3; index++) {
    const parsed = await parsePortableSave(file.text); assert.equal(parsed.ok, true);
    const result = f.repo.importSnapshot(parsed.file.payload.state, { expectedRaw: raw, currentState: current, fingerprint: file.fingerprint, otherTabsClosed: true }, 200000 + index);
    assert.equal(result.ok, true); assert.deepEqual(result.state.ingredients, { beans: 0, milk: 2 });
    assert.deepEqual(f.repo.readImportBackup().liveState.ingredients, { beans: 0, milk: 2 });
    assert.deepEqual(new LocalSaveRepository(f.storage).load(200000 + index).state, current);
    raw = f.storage.getItem(SAVE_KEY);
  }
  for (const id of ['beans', 'milk']) {
    const forged = filePayload(current); forged.overview.ingredients[id]++;
    assert.equal((await parsePortableSave(independentFile(forged))).ok, false);
  }
});

test('TC-3D-028 future inventory schemas and policy versions remain protected without overwrite', () => {
  for (const kind of ['economy', 'policy']) {
    const state = createInitialState(); if (kind === 'economy') state.economyVersion = 10;
    const f = repository(state, kind === 'policy' ? 5 : 4), loaded = f.repo.load(100000);
    assert.equal(loaded.status, 'future'); assert.equal(loaded.protectedRaw, true);
    assert.equal(f.repo.save(createInitialState(), 100000).ok, false); assert.equal(f.storage.getItem(SAVE_KEY), f.raw);
  }
});

test('TC-3D-028 raw economy and offline policy must match before any legacy stock exemption', () => {
  for (const policy of [undefined, 1, 2, 3]) {
    const state = createInitialState(); state.ingredients = { beans: 0, milk: 0 };
    const memory = createMemoryStorage(), record = JSON.parse(envelope(state));
    if (policy === undefined) delete record.offlinePolicyVersion; else record.offlinePolicyVersion = policy;
    const raw = JSON.stringify(record); memory.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(memory), loaded = repo.load(700000);
    assert.equal(loaded.status, 'corrupt', `economy5/policy${policy}`); assert.equal(loaded.protectedRaw, true);
    assert.equal(memory.getItem(SAVE_KEY), raw); assert.equal(repo.save(state).ok, false);
  }
  for (const version of [1, 2, 3, 4]) {
    const f = repository(legacyState(version), 4), loaded = f.repo.load(700000);
    assert.equal(loaded.status, 'corrupt', `economy${version}/policy4`); assert.equal(f.storage.getItem(SAVE_KEY), f.raw);
  }
});

test('TC-3D-028 deferred old-policy migration is cancellable and never writes seeded stock early', async () => {
  const f = repository(old4.inFlight, 3), pending = f.repo.load(700000, { deferOffline: true });
  assert.equal(pending.status, 'settling'); assert.deepEqual(pending.state.ingredients, stock);
  assert.equal(f.storage.getItem(SAVE_KEY), f.raw);
  let yields = 0;
  const interrupted = await f.repo.finishOffline(pending.pending, { yieldControl: async () => { if (++yields === 2) f.repo.cancelOffline(pending.pending); } });
  assert.equal(interrupted.status, 'offline-save-failed'); assert.equal(f.storage.getItem(SAVE_KEY), f.raw);
  assert.equal(f.repo.save(pending.state, 700000).ok, false);
  const retry = f.repo.load(700000, { deferOffline: true }); assert.equal(retry.status, 'settling');
  const restored = await f.repo.finishOffline(retry.pending, { yieldControl: async () => {} });
  const oracle = validateState(old4.offlineWindows.find(sample => sample.policy === 3).state);
  assert.equal(restored.status, 'loaded'); assert.deepEqual(business(restored.state), business(oracle.state));
  assert.equal(JSON.parse(f.storage.getItem(SAVE_KEY)).offlinePolicyVersion, 4);
});

test('TC-3D-028 zero-time and paused legacy migration stamps policy4 without replay or repeat seed', () => {
  for (const [source, now] of [[old4.inFlight, 100000], [old4.paused, 700000]]) {
    const f = repository(source, 3), result = f.repo.load(now);
    assert.equal(result.status, 'loaded'); assert.equal(result.state.totalEarned, source.totalEarned);
    assert.equal(result.state.elapsed, source.elapsed); assert.deepEqual(result.state.ingredients, stock);
    assert.equal(JSON.parse(f.storage.getItem(SAVE_KEY)).offlinePolicyVersion, 4);
    const raw = f.storage.getItem(SAVE_KEY); assert.deepEqual(new LocalSaveRepository(f.storage).load(now).state, result.state);
    assert.equal(f.storage.getItem(SAVE_KEY), raw);
  }
  const record = JSON.parse(envelope(old4.inFlight, 1)); delete record.offlinePolicyVersion;
  const storage = createMemoryStorage(); storage.setItem(SAVE_KEY, JSON.stringify(record));
  const result = new LocalSaveRepository(storage).load(129900);
  assert.equal(result.status, 'loaded'); assert.equal(result.state.elapsed, old4.inFlight.elapsed);
  assert.deepEqual(result.state.ingredients, stock); assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).offlinePolicyVersion, 4);
});

test('TC-3D-028 migrated legacy and current routes remain durably valid while empty-cup guests drain', () => {
  let observedStockout = 0;
  for (const source of [old3.inactive, old3.active, old4.inFlight]) {
    const migrated = validateState(source); assert.equal(migrated.ok, true);
    const state = migrated.state; state.ingredients = { beans: 1, milk: 0 }; state.paused = false;
    const engine = createEngine(state);
    for (let step = 0; step < 400; step++) {
      engine.advance(.2); const current = engine.snapshot(), check = validateState(current);
      assert.equal(check.ok, true, `route${source.customerRouteVersion} step${step}: ${check.message}`);
      observedStockout += current.customers.filter(customer => customer.departureReason === 'stockout').length;
      assert.ok(current.ingredients.beans <= 1); assert.equal(current.ingredients.milk, 0); ledger(current);
    }
    assert.equal(engine.state.customers.length, 0); assert.equal(engine.state.customerRouteVersion, 4);
  }
  assert.ok(observedStockout > 0, 'the validation run must actually exercise unpaid departures');
});
