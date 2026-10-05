import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const core = await import('../src/slice/core/engine.ts');
const { createEngine, createInitialState } = core;
const { LocalSaveRepository, createMemoryStorage, SAVE_KEY, validateState } = await import('../src/slice/core/persistence.ts');
const checkpoint = () => { const engine = createEngine(); engine.upgrade('counter-a'); engine.advance(16.137); engine.setRecipe('counter-a', 'latte'); return engine.snapshot(); };
const business = state => { const copy = structuredClone(state); delete copy.lastOfflineClaimId; delete copy.offlineClaimIds; return copy; };
const advanced = (state, seconds) => { const engine = createEngine(state); engine.advance(seconds); return engine.snapshot(); };
const rawLegacy = (state, savedAt = 100000, version) => JSON.stringify({ schemaVersion: 1, savedAt, recordChangeTag: 'legacy-policy', ...(version === undefined ? {} : { offlinePolicyVersion: version }), state });

test('TC-3D-017 effective offline duration is continuous, monotone and bounded around 30s and 2h', () => {
  const cases = [[0, 0], [.01, .005], [29.9, 14.95], [30, 15], [30.1, 15.05], [7199.9, 3599.95], [7200, 3600], [7200.1, 3600], [8.64e12, 3600]];
  for (const [wall, effective] of cases) assert.equal(core.offlineEffectiveSeconds(wall), effective);
  for (const invalid of [-1, NaN, Infinity, -Infinity]) assert.equal(core.offlineEffectiveSeconds(invalid), 0);
  for (let ms = 29800; ms <= 30200; ms++) assert.ok(core.offlineEffectiveSeconds(ms / 1000) >= core.offlineEffectiveSeconds((ms - 1) / 1000));
});

test('TC-3D-017 current durable anchors settle all positive intervals once without altering production snapshots or prices', () => {
  for (const [wall, effective] of [[0, 0], [.01, .005], [29.9, 14.95], [30, 15], [30.1, 15.05]]) {
    const initial = checkpoint(), memory = createMemoryStorage(), repo = new LocalSaveRepository(memory);
    assert.equal(repo.save(initial, 100000).ok, true);
    const raw = memory.getItem(SAVE_KEY);
    assert.equal(JSON.parse(raw).offlinePolicyVersion, 2);
    const result = new LocalSaveRepository(memory).load(100000 + wall * 1000);
    assert.equal(result.status, 'loaded');
    assert.deepEqual(business(result.state), business(advanced(initial, effective)), `${wall}s must use the same fixed-step simulation`);
    const anchored = memory.getItem(SAVE_KEY);
    assert.equal(JSON.parse(anchored).savedAt, 100000 + wall * 1000);
    assert.deepEqual(new LocalSaveRepository(memory).load(100000 + wall * 1000).state, result.state);
    assert.equal(memory.getItem(SAVE_KEY), anchored, 'same-endpoint load is read-only');
    if (!wall) assert.equal(anchored, raw);
  }
});

test('TC-3D-017 unmarked and v1 anchors receive legacy treatment exactly once before the new policy starts', () => {
  for (const version of [undefined, 1]) for (const wall of [0, 29.9, 30, 30.1]) {
    const initial = checkpoint(), memory = createMemoryStorage(), now = 100000 + wall * 1000;
    memory.setItem(SAVE_KEY, rawLegacy(initial, 100000, version));
    const first = new LocalSaveRepository(memory).load(now);
    assert.deepEqual(business(first.state), business(advanced(initial, wall < 30 ? 0 : wall / 2)));
    const migrated = memory.getItem(SAVE_KEY);
    assert.equal(JSON.parse(migrated).offlinePolicyVersion, 2);
    assert.equal(JSON.parse(migrated).savedAt, now);
    assert.deepEqual(new LocalSaveRepository(memory).load(now).state, first.state);
    assert.equal(memory.getItem(SAVE_KEY), migrated);
    const second = new LocalSaveRepository(memory).load(now + 29900);
    assert.deepEqual(business(second.state), business(advanced(first.state, 14.95)), 'subsequent short gap uses half speed');
  }
});

test('TC-3D-017 migration and new short claims preserve bytes and state on failed writes and recover once', () => {
  for (const legacy of [false, true]) {
    const initial = checkpoint(), memory = createMemoryStorage();
    if (legacy) memory.setItem(SAVE_KEY, rawLegacy(initial)); else new LocalSaveRepository(memory).save(initial, 100000);
    const original = memory.getItem(SAVE_KEY);
    const failed = new LocalSaveRepository({ ...memory, setItem() { throw Error('quota'); } }).load(129900);
    assert.equal(failed.status, 'offline-save-failed'); assert.equal(failed.offline.accepted, false);
    assert.deepEqual(failed.state, initial); assert.equal(memory.getItem(SAVE_KEY), original);
    const recovered = new LocalSaveRepository(memory).load(129900);
    assert.deepEqual(business(recovered.state), business(advanced(initial, legacy ? 0 : 14.95)));
    assert.deepEqual(new LocalSaveRepository(memory).load(129900).state, recovered.state);
  }
});

test('TC-3D-017 policy versions fail closed and future-time migration preserves a nondecreasing anchor', () => {
  for (const version of [0, -1, 1.5, '2', null, 3]) {
    const memory = createMemoryStorage(), raw = rawLegacy(checkpoint(), 100000, version); memory.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(memory), loaded = repo.load(140000);
    assert.equal(loaded.status, version === 3 ? 'future' : 'corrupt'); assert.equal(loaded.protectedRaw, true);
    assert.equal(repo.save(createInitialState(), 140000).ok, false); assert.equal(memory.getItem(SAVE_KEY), raw);
  }
  const memory = createMemoryStorage(), initial = checkpoint(); memory.setItem(SAVE_KEY, rawLegacy(initial, 140000));
  const repo = new LocalSaveRepository(memory), before = repo.load(100000);
  assert.deepEqual(before.state, initial); assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 140000);
  assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).offlinePolicyVersion, 2);
  repo.save(before.state, 110000);
  assert.deepEqual(new LocalSaveRepository(memory).load(139999).state, initial);
  assert.deepEqual(business(new LocalSaveRepository(memory).load(140010).state), business(advanced(initial, .005)));
});

test('TC-3D-017 bounded claim IDs accept maximum legal storage tags and cannot discard unpaid elapsed time', () => {
  const memory = createMemoryStorage(), initial = checkpoint();
  memory.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 2, savedAt: 100000, recordChangeTag: 'x'.repeat(256), state: initial }));
  const loaded = new LocalSaveRepository(memory).load(130000);
  assert.equal(loaded.offline.accepted, true);
  assert.ok(loaded.state.lastOfflineClaimId.length <= 256);
  assert.deepEqual(business(loaded.state), business(advanced(initial, 15)));
});

test('TC-3D-017 transactional hidden settlement honors later durable anchors, failure and concurrent writers', () => {
  const initial = checkpoint(), memory = createMemoryStorage(), repo = new LocalSaveRepository(memory);
  repo.save(initial, 140000);
  const unchanged = repo.settleOffline(initial, 100000, 130000);
  assert.deepEqual(unchanged.state, initial); assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 140000);
  const resumed = repo.settleOffline(initial, 130000, 140020);
  assert.deepEqual(business(resumed.state), business(advanced(initial, .01)));
  const snapshot = structuredClone(resumed.state), raw = memory.getItem(SAVE_KEY);
  const loser = new LocalSaveRepository(memory); loser.load(140020);
  const winner = new LocalSaveRepository(memory); winner.load(140020); winner.save(snapshot, 140020);
  const winningRaw = memory.getItem(SAVE_KEY);
  const conflict = loser.settleOffline(snapshot, 140020, 169920);
  assert.equal(conflict.status, 'conflict'); assert.equal(conflict.offline.accepted, false);
  assert.deepEqual(conflict.state, snapshot); assert.equal(memory.getItem(SAVE_KEY), winningRaw); assert.notEqual(raw, winningRaw);
  let deny = false;
  const storage = { ...memory, setItem(key, value) { if (deny) throw Error('quota'); memory.setItem(key, value); } };
  const failing = new LocalSaveRepository(storage); const loaded = failing.load(140020); deny = true;
  const failed = failing.settleOffline(loaded.state, 140020, 169920);
  assert.equal(failed.status, 'offline-save-failed'); assert.deepEqual(failed.state, snapshot); assert.equal(memory.getItem(SAVE_KEY), winningRaw);
});

test('TC-3D-017 paused and fractional short claims retain fixed-step time and duplicate protection', () => {
  const initial = checkpoint(), engine = createEngine(initial);
  for (let i = 0; i < 100; i++) assert.equal(engine.applyOffline(.01, `fraction-${i}`).accepted, true);
  assert.deepEqual(business(engine.snapshot()), business(advanced(initial, .5)));
  const snapshot = engine.snapshot(); assert.equal(engine.applyOffline(30, 'fraction-0').accepted, false); assert.deepEqual(engine.snapshot(), snapshot);
  const paused = createEngine(initial); paused.togglePause(); const before = paused.snapshot();
  paused.applyOffline(1e12, 'paused'); assert.deepEqual(business(paused.snapshot()), business(before));
  assert.equal(validateState(paused.snapshot()).ok, true);
});

test('TC-3D-017 two-hour and arbitrarily long gaps have exactly the same bounded simulation result', () => {
  const initial = checkpoint(), capped = createEngine(initial), long = createEngine(initial);
  const a = capped.applyOffline(7200, 'cap'), b = long.applyOffline(8.64e12, 'long');
  assert.equal(a.seconds, 7200); assert.equal(b.seconds, 7200); assert.equal(a.amount, b.amount);
  assert.deepEqual(business(capped.snapshot()), business(long.snapshot()));
  assert.equal(capped.state.elapsed, initial.elapsed + 3600);
  assert.equal(validateState(capped.snapshot()).ok, true);
});

test('TC-3D-017 legacy zero, rollback, paused and short migrations are atomic under errors and CAS races', () => {
  for (const now of [90000, 100000, 129900]) for (const paused of [false, true]) for (const mode of ['failure', 'conflict']) {
    const state = checkpoint(); state.paused = paused;
    const memory = createMemoryStorage(), raw = rawLegacy(state); memory.setItem(SAVE_KEY, raw);
    const winning = rawLegacy(state, 140000); let reads = 0;
    const storage = { ...memory, getItem(key) { if (mode === 'conflict' && ++reads === 2) memory.setItem(SAVE_KEY, winning); return memory.getItem(key); }, setItem(key, value) { if (mode === 'failure') throw Error('quota'); memory.setItem(key, value); } };
    const failed = new LocalSaveRepository(storage).load(now);
    assert.equal(failed.status, mode === 'failure' ? 'offline-save-failed' : 'conflict');
    assert.deepEqual(failed.state, state); assert.equal(failed.offline.accepted, false);
    assert.equal(memory.getItem(SAVE_KEY), mode === 'failure' ? raw : winning);
    const recovered = new LocalSaveRepository(memory).load(now);
    assert.deepEqual(recovered.state, state);
    const saved = JSON.parse(memory.getItem(SAVE_KEY)); assert.equal(saved.offlinePolicyVersion, 2);
    assert.equal(saved.savedAt, Math.max(now, mode === 'failure' ? 100000 : 140000));
  }
});

test('TC-3D-017 rejected claim never consumes an endpoint, even if a generated ID collides', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'collision' } });
  try {
    const memory = createMemoryStorage(), initial = checkpoint(); initial.lastOfflineClaimId = 'local:collision'; initial.offlineClaimIds = ['local:collision'];
    new LocalSaveRepository(memory).save(initial, 100000); const raw = memory.getItem(SAVE_KEY);
    const failed = new LocalSaveRepository(memory).load(129900);
    assert.equal(failed.status, 'offline-save-failed'); assert.equal(failed.offline.accepted, false);
    assert.deepEqual(failed.state, initial); assert.equal(memory.getItem(SAVE_KEY), raw);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
});

test('TC-3D-017 many short reloads preserve fractional time and endpoint authority after claim history eviction', () => {
  const memory = createMemoryStorage(), initial = checkpoint(); new LocalSaveRepository(memory).save(initial, 100000);
  let loaded;
  for (let i = 1; i <= 300; i++) loaded = new LocalSaveRepository(memory).load(100000 + i * 10);
  assert.deepEqual(business(loaded.state), business(advanced(initial, 1.5)));
  assert.equal(loaded.state.offlineClaimIds.length, 256);
  const raw = memory.getItem(SAVE_KEY);
  assert.deepEqual(new LocalSaveRepository(memory).load(100010).state, loaded.state);
  assert.deepEqual(new LocalSaveRepository(memory).load(103000).state, loaded.state);
  assert.equal(memory.getItem(SAVE_KEY), raw);
});
