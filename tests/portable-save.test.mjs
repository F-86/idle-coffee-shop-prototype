import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { createEngine, createInitialState, INITIAL_WALLET, ECONOMY_VERSION, COFFEE_MAX_LEVEL } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, validateState, OFFLINE_POLICY_VERSION } = await import('../src/slice/core/persistence.ts');
const { createPortableSave, parsePortableSave, overviewOf, portableFilename, PORTABLE_FORMAT, PORTABLE_VERSION, MAX_PORTABLE_BYTES } = await import('../src/slice/core/portableSave.ts');

const legacyArchives = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/economy3-operations-migration.json', import.meta.url), 'utf8'));

// These tests use only isolated storage and simulated timestamps. The independent
// file writer hashes the literal UTF-8 payload bytes with Node, not production code.
const copy = value => structuredClone(value);
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const hashNumber = n => n.toString(16).padStart(64, '0');
const checkpoint = () => {
  const engine = createEngine(); engine.upgrade('counter-a'); engine.advance(7.437);
  engine.setRecipe('counter-a', 'latte'); return engine.snapshot();
};
const independentOverview = state => ({
  wallet: state.wallet, totalEarned: state.totalEarned, totalServed: state.totalServed, elapsed: state.elapsed,
  counterLevels: state.counters.map(counter => counter.level), coffeeLevels: { ...state.coffeeLevels }, managerLevel: state.manager.level,
  pendingCash: state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), carrying: state.manager.carrying,
  placedCounters: state.layout.furniture.filter(item => item.kind === 'counter' && !item.stored).length, placedSeats: state.layout.furniture.filter(item => item.kind === 'table' && !item.stored).length, expanded: state.layout.expanded,
});
const payload = (state = checkpoint(), changes = {}) => ({
  saveId: 'export-source-001', revision: 19, gameSchemaVersion: 1, economyVersion: 4,
  offlinePolicyVersion: 3, savedAt: 1000, exportedAt: 2000,
  overview: independentOverview(state), state: copy(state), ...changes,
});
const fileWithPayloadText = (payloadText, formatVersion = 4) => JSON.stringify({
  format: 'mellow-bean-portable-save', formatVersion, payloadText,
  integrity: { algorithm: 'SHA-256', sha256: sha256(payloadText) },
});
const independentlyWrittenFile = value => fileWithPayloadText(JSON.stringify(value));
const business = state => {
  const result = copy(state); delete result.lastOfflineClaimId; delete result.offlineClaimIds; return result;
};

class FaultStorage {
  data = new Map(); events = []; beforeGet = null; beforeSet = null; afterSet = null;
  getItem(key) { this.events.push(['get', key]); this.beforeGet?.(key); return this.data.get(key) ?? null; }
  setItem(key, value) {
    this.events.push(['set', key, value]); this.beforeSet?.(key, value);
    this.data.set(key, value); this.afterSet?.(key, value);
  }
  removeItem(key) { this.events.push(['remove', key]); this.data.delete(key); }
}
const rawEnvelope = (state = checkpoint(), changes = {}) => JSON.stringify({
  schemaVersion: 1, offlinePolicyVersion: 3, savedAt: 100000,
  saveId: 'local-existing-shop', revision: 7, recordChangeTag: 'local-existing-tag', state: copy(state), ...changes,
});
const fixture = (changes = {}) => {
  const state = checkpoint(), storage = new FaultStorage(), raw = rawEnvelope(state, changes);
  storage.data.set(SAVE_KEY, raw); const repo = new LocalSaveRepository(storage);
  assert.equal(repo.load(JSON.parse(raw).savedAt).status, 'loaded'); storage.events = [];
  return { repo, storage, raw, state };
};
const importOptions = ({ raw, state }, changes = {}) => ({
  expectedRaw: raw, currentState: copy(state), fingerprint: hashNumber(1), otherTabsClosed: true, ...changes,
});
const mainWrites = storage => storage.events.filter(([operation, key]) => operation === 'set' && key === SAVE_KEY);
const backupWrites = storage => storage.events.filter(([operation, key]) => operation === 'set' && key.startsWith(`${SAVE_KEY}-import-backup-`));
const assertUntouched = (f, result, status) => {
  assert.equal(result.ok, false); assert.equal(result.status, status);
  assert.equal(f.storage.data.get(SAVE_KEY), f.raw); assert.equal(mainWrites(f.storage).length, 0);
};
const assertMoney = state => {
  assert.equal(validateState(state).ok, true);
  assert.equal(state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), INITIAL_WALLET + state.totalEarned);
};

test('TC-3D-021 file export is detached, deeply frozen, complete and independently SHA-256 verifiable', async () => {
  const original = payload(), before = copy(original), result = await createPortableSave(original);
  assert.equal(PORTABLE_FORMAT, 'mellow-bean-portable-save'); assert.equal(PORTABLE_VERSION, 4);
  assert.equal(OFFLINE_POLICY_VERSION, 3); assert.equal(MAX_PORTABLE_BYTES, 256 * 1024);
  const outer = JSON.parse(result.text), decoded = JSON.parse(outer.payloadText);
  assert.deepEqual(Object.keys(outer).sort(), ['format', 'formatVersion', 'integrity', 'payloadText']);
  assert.deepEqual(outer.integrity, { algorithm: 'SHA-256', sha256: sha256(outer.payloadText) });
  assert.equal(result.fingerprint, outer.integrity.sha256); assert.deepEqual(decoded, before);
  assert.deepEqual(overviewOf(original.state), independentOverview(original.state));
  assert.ok(decoded.state.counters[0].brew, 'fixture contains a frozen in-flight brew');
  assert.equal(decoded.state.counters[0].brew.recipe, 'espresso'); assert.equal(decoded.state.counters[0].recipe, 'latte');
  const parsed = await parsePortableSave(result.text); assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.file.payload, before); assert.equal(parsed.file.text, result.text);
  for (const value of [result, result.payload, result.payload.state, result.payload.overview, result.payload.overview.counterLevels, result.payload.state.counters, result.payload.state.counters[0].brew, parsed.file.payload.state.manager]) assert.equal(Object.isFrozen(value), true);
  original.state.wallet++; original.overview.wallet++; original.saveId = 'changed';
  assert.deepEqual(result.payload, before); assert.deepEqual(parsed.file.payload, before);
  assert.throws(() => { result.payload.state.wallet++; }, TypeError);
});

test('TC-3D-021 checksum covers exact payload bytes and every metadata field, not parsed JSON', async () => {
  const original = payload(), text = independentlyWrittenFile(original), wrapper = JSON.parse(text);
  for (const [key, value] of [['saveId', 'different-identity'], ['revision', 20], ['savedAt', 999], ['exportedAt', 2001], ['gameSchemaVersion', 2], ['economyVersion', 5], ['offlinePolicyVersion', 2]]) {
    const changed = copy(wrapper); changed.payloadText = JSON.stringify({ ...original, [key]: value });
    const result = await parsePortableSave(JSON.stringify(changed));
    assert.equal(result.ok, false, key); assert.match(result.message, /完整性/, key);
  }
  for (const payloadText of [` ${wrapper.payloadText}`, JSON.stringify(original, null, 2), JSON.stringify(Object.fromEntries(Object.entries(original).reverse()))]) {
    const staleDigest = await parsePortableSave(JSON.stringify({ ...wrapper, payloadText }));
    assert.equal(staleDigest.ok, false); assert.match(staleDigest.message, /完整性/);
    const correctDigest = await parsePortableSave(fileWithPayloadText(payloadText));
    assert.equal(correctDigest.ok, true); assert.deepEqual(correctDigest.file.payload, original);
  }
  assert.equal((await parsePortableSave(JSON.stringify(wrapper, null, 4))).ok, true, 'outer formatting is outside the payload digest');
  const unicode = payload(); unicode.state.lastOfflineClaimId = '离线-☕'; unicode.state.offlineClaimIds = ['离线-☕'];
  assert.equal((await parsePortableSave(independentlyWrittenFile(unicode))).ok, true, 'digest uses UTF-8 rather than UTF-16 code units');
});

test('TC-3D-021 parser rejects malformed, raw recovery, future, and extra-key file envelopes', async () => {
  const original = JSON.parse(independentlyWrittenFile(payload()));
  const cases = [null, [], 1, 'save', {}, { format: 'mellow-bean-import-backup', version: 1, originalRaw: rawEnvelope() }, JSON.parse(rawEnvelope())];
  for (const change of [
    { format: 'other-game' }, { formatVersion: 5 }, { formatVersion: '1' }, { payloadText: {} }, { extra: true },
    { integrity: null }, { integrity: { algorithm: 'MD5', sha256: original.integrity.sha256 } },
    { integrity: { ...original.integrity, sha256: 'A'.repeat(64) } },
    { integrity: { ...original.integrity, sha256: '0'.repeat(63) } },
    { integrity: { ...original.integrity, signature: 'untrusted' } },
  ]) cases.push({ ...original, ...change });
  for (const value of cases) assert.equal((await parsePortableSave(JSON.stringify(value))).ok, false, JSON.stringify(value).slice(0, 120));
  for (const text of ['', '{', '\ufeff{}', '<script>alert(1)</script>', independentlyWrittenFile(payload()).slice(0, -1), fileWithPayloadText('{')]) assert.equal((await parsePortableSave(text)).ok, false);
  const missing = copy(original); delete missing.integrity; assert.equal((await parsePortableSave(JSON.stringify(missing))).ok, false);
});

test('TC-3D-021 signed-but-invalid lineage, schema, policy and timestamps are rejected', async () => {
  const mutations = [
    ['saveId', ''], ['saveId', '../shop'], ['saveId', '<script>'], ['saveId', 'x'.repeat(101)], ['saveId', 19],
    ['revision', 0], ['revision', -1], ['revision', 1.5], ['revision', Number.MAX_SAFE_INTEGER], ['revision', '1'],
    ['gameSchemaVersion', 2], ['economyVersion', 5], ['offlinePolicyVersion', 1], ['offlinePolicyVersion', 2], ['offlinePolicyVersion', 4],
    ['savedAt', -1], ['savedAt', 8.64e15 + 1], ['exportedAt', -1], ['exportedAt', 8.64e15 + 1], ['savedAt', '1000'], ['exportedAt', null],
    ['unrecognized', true],
  ];
  for (const [key, value] of mutations) assert.equal((await parsePortableSave(independentlyWrittenFile(payload(undefined, { [key]: value })))).ok, false, `${key}=${String(value)}`);
  const missing = payload(); delete missing.exportedAt; assert.equal((await parsePortableSave(independentlyWrittenFile(missing))).ok, false);
  for (const value of [0, 8.64e15]) assert.equal((await parsePortableSave(independentlyWrittenFile(payload(undefined, { savedAt: value, exportedAt: value, revision: Number.MAX_SAFE_INTEGER - 1 })))).ok, true);
});

test('TC-3D-021 even a recomputed checksum cannot hide invalid finite values, economy or relationships', async () => {
  const mutations = [
    state => { state.schemaVersion = 2; }, state => { state.economyVersion = 5; },
    state => { state.wallet = -1; }, state => { state.wallet = 1.5; }, state => { state.wallet = Number.MAX_SAFE_INTEGER + 1; },
    state => { state.wallet += 1; }, state => { state.totalEarned += 1; }, state => { state.spend += 1; },
    state => { state.counters[0].pendingCash += 1; }, state => { state.manager.carrying += 1; },
    state => { state.totalServed += 1; }, state => { state.counters[0].brewed += 1; },
    state => { state.elapsed = .013; }, state => { state.elapsed = -1; }, state => { state.stepCarry = .05; },
    state => { state.manager.level = 0; }, state => { state.counters[0].level = 1e12; },
    state => { state.counters[0].recipe = 'free-money'; }, state => { state.manager.phase = 'flying'; },
    state => { state.counters[0].brew.customerId = 999999; }, state => { state.counters[0].brew.price = .5; },
    state => { state.counters[0].brew.elapsed = state.counters[0].brew.duration + 1; },
    state => { state.customers[1].id = state.customers[0].id; }, state => { state.customers[0].hasCup = !state.customers[0].hasCup; },
  ];
  for (const mutate of mutations) {
    const value = payload(); mutate(value.state); value.overview = independentOverview(value.state);
    assert.equal((await parsePortableSave(independentlyWrittenFile(value))).ok, false, mutate.toString());
  }
  for (const key of ['wallet', 'totalEarned', 'totalServed', 'elapsed', 'pendingCash', 'carrying', 'managerLevel']) {
    const value = payload(); value.overview[key]++;
    assert.equal((await parsePortableSave(independentlyWrittenFile(value))).ok, false, `forged overview ${key}`);
  }
  const forgedLevels = payload(); forgedLevels.overview.counterLevels.reverse();
  assert.equal((await parsePortableSave(independentlyWrittenFile(forgedLevels))).ok, false);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    for (const key of ['savedAt', 'exportedAt', 'revision']) await assert.rejects(createPortableSave(payload(undefined, { [key]: invalid })));
    const value = payload(); value.state.wallet = invalid; value.overview.wallet = invalid; await assert.rejects(createPortableSave(value));
  }
  const overflow = payload(); overflow.state.unused = 'OVERFLOW_LITERAL';
  assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(overflow).replace('"OVERFLOW_LITERAL"', '1e999')))).ok, false, 'JSON overflow in an otherwise unknown field must fail finite-number checks');
});

test('TC-3D-021 hostile property names, depth and node budgets fail without prototype pollution', async () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const value = payload(); Object.defineProperty(value.state.manager, key, { enumerable: true, value: { polluted: true } });
    assert.equal((await parsePortableSave(independentlyWrittenFile(value))).ok, false, key);
    await assert.rejects(createPortableSave(value));
  }
  assert.equal({}.polluted, undefined);
  const deep = payload(); let nested = deep.state;
  for (let i = 0; i < 25; i++) nested = nested.extra = {};
  assert.equal((await parsePortableSave(independentlyWrittenFile(deep))).ok, false);
  const wide = payload(); wide.state.extra = Array(10001).fill(0);
  assert.equal((await parsePortableSave(independentlyWrittenFile(wide))).ok, false);
  const cycle = payload(); cycle.state.extra = cycle; await assert.rejects(createPortableSave(cycle));
});

test('TC-3D-021 256 KiB limit measures UTF-8 bytes and checks the full outer file', async () => {
  const text = independentlyWrittenFile(payload()), exact = text + ' '.repeat(MAX_PORTABLE_BYTES - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(exact), MAX_PORTABLE_BYTES); assert.equal((await parsePortableSave(exact)).ok, true);
  const tooLarge = await parsePortableSave(exact + ' '); assert.equal(tooLarge.ok, false); assert.match(tooLarge.message, /256/);
  const multibyte = payload(); multibyte.state.extra = '☕'.repeat(90000);
  const multibyteText = independentlyWrittenFile(multibyte);
  assert.ok(multibyteText.length < MAX_PORTABLE_BYTES); assert.ok(Buffer.byteLength(multibyteText) > MAX_PORTABLE_BYTES);
  assert.match((await parsePortableSave(multibyteText)).message, /256/);
  await assert.rejects(createPortableSave(multibyte), /大小限制/);
});

test('TC-3D-021 unavailable WebCrypto fails closed and does not emit unchecked files', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const result = await parsePortableSave(independentlyWrittenFile(payload()));
    assert.equal(result.ok, false); assert.match(result.message, /无法校验/);
    await assert.rejects(createPortableSave(payload()), /无法校验/);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('TC-3D-021 export filenames are collision-resistant and use only export time and revision', async () => {
  const file = await createPortableSave(payload(undefined, { exportedAt: Date.UTC(2026, 9, 5, 12, 0, 0, 123) }));
  const names = new Set(Array.from({ length: 50 }, () => portableFilename(file)));
  assert.equal(names.size, 50);
  for (const name of names) assert.match(name, /^mellow-bean-2026-10-05T12-00-00-123Z-r19-[a-f0-9-]+\.json$/);
});

test('TC-3D-021 durableSnapshot is a detached validated read with no settlement or storage mutation', () => {
  const f = fixture(), first = f.repo.durableSnapshot();
  assert.deepEqual(first.state, f.state); assert.equal(first.saveId, 'local-existing-shop'); assert.equal(first.revision, 7);
  first.state.wallet++; first.saveId = 'mutated';
  assert.deepEqual(f.repo.durableSnapshot().state, f.state); assert.equal(f.repo.durableSnapshot().saveId, 'local-existing-shop');
  assert.equal(f.storage.events.length, 0); assert.equal(f.storage.data.get(SAVE_KEY), f.raw);
  assert.equal(new LocalSaveRepository(new FaultStorage()).durableSnapshot(), null);
  const broken = new FaultStorage(); broken.data.set(SAVE_KEY, 'broken-original-bytes');
  const protectedRepo = new LocalSaveRepository(broken); assert.equal(protectedRepo.load(100000).status, 'corrupt');
  assert.equal(protectedRepo.durableSnapshot(), null); assert.equal(broken.data.get(SAVE_KEY), 'broken-original-bytes');
});

test('TC-3D-021 import verifies the full original/raw and unsaved/live backup before fresh replacement', () => {
  const f = fixture(), incoming = createInitialState(), liveEngine = createEngine(f.state); liveEngine.advance(3.7);
  const live = liveEngine.snapshot(), beforeIncoming = copy(incoming), beforeLive = copy(live);
  const result = f.repo.importSnapshot(incoming, importOptions(f, { currentState: live }), 200000);
  assert.equal(result.ok, true); assert.equal(result.status, 'saved'); assert.deepEqual(result.state, incoming);
  assert.equal(result.settledAt, 200000); assert.match(result.backupKey, /^mellow-bean-3d-v1-import-backup-/);
  const durable = JSON.parse(f.storage.data.get(SAVE_KEY)), backup = JSON.parse(f.storage.data.get(result.backupKey));
  assert.equal(durable.revision, 1); assert.notEqual(durable.saveId, 'local-existing-shop'); assert.notEqual(durable.recordChangeTag, 'local-existing-tag');
  assert.equal(durable.savedAt, 200000); assert.equal(durable.offlinePolicyVersion, 3);
  assert.deepEqual(durable.importedFileHashes, [hashNumber(1)]); assert.equal(durable.lastImportBackupKey, result.backupKey);
  assert.deepEqual(backup, { format: 'mellow-bean-import-backup', version: 1, createdAt: 200000, originalRaw: f.raw, liveState: live, liveSaveId: 'local-existing-shop', liveRevision: 7 });
  assert.deepEqual(f.repo.readImportBackup(), backup);
  const freshReader = new LocalSaveRepository(f.storage); assert.equal(freshReader.load(200000).status, 'loaded');
  assert.deepEqual(freshReader.readImportBackup(), backup, 'the backup pointer survives a complete repository reload');
  const operations = f.storage.events.slice(0, 6).map(([operation, key]) => [operation, key === SAVE_KEY ? 'main' : 'backup']);
  assert.deepEqual(operations, [['get', 'main'], ['set', 'backup'], ['get', 'backup'], ['get', 'main'], ['set', 'main'], ['get', 'main']]);
  result.state.wallet++; incoming.wallet++; live.wallet++;
  assert.deepEqual(f.repo.durableSnapshot().state, beforeIncoming); assert.deepEqual(f.repo.readImportBackup().liveState, beforeLive);
  assert.equal(f.repo.save(beforeIncoming, 200001).ok, true);
  assert.equal(f.repo.durableSnapshot().saveId, durable.saveId); assert.equal(f.repo.durableSnapshot().revision, 2);
  assert.equal(f.repo.durableSnapshot().lastImportBackupKey, result.backupKey);
});

test('TC-3D-021 import requires closed-other-tabs acknowledgement, initialization and current preview', () => {
  for (const otherTabsClosed of [false, undefined]) {
    const f = fixture(); assertUntouched(f, f.repo.importSnapshot(createInitialState(), importOptions(f, { otherTabsClosed }), 200000), 'conflict');
    assert.equal(f.storage.events.length, 0);
  }
  const f = fixture(); assertUntouched(f, f.repo.importSnapshot(createInitialState(), importOptions(f, { expectedRaw: 'stale-preview' }), 200000), 'conflict');
  assert.equal(f.storage.events.length, 0);
  const uninitialized = new LocalSaveRepository(f.storage);
  assert.equal(uninitialized.importSnapshot(createInitialState(), importOptions(f), 200000).status, 'unavailable');
  const unavailable = new LocalSaveRepository(null); unavailable.load(200000);
  assert.equal(unavailable.importSnapshot(createInitialState(), { ...importOptions(f), expectedRaw: null }, 200000).status, 'unavailable');
  const changed = fixture(); assert.equal(changed.repo.save(changed.state, 100001).ok, true); const latest = changed.storage.data.get(SAVE_KEY); changed.storage.events = [];
  assert.equal(changed.repo.importSnapshot(createInitialState(), importOptions(changed), 200000).status, 'conflict');
  assert.equal(changed.storage.data.get(SAVE_KEY), latest); assert.equal(changed.storage.events.length, 0);
});

test('TC-3D-021 invalid candidate, current live backup, timestamp or fingerprint performs no writes', () => {
  const invalid = createInitialState(); invalid.wallet++;
  for (const kind of ['candidate', 'live', 'clock', 'fingerprint']) {
    const f = fixture(), options = importOptions(f), incoming = kind === 'candidate' ? invalid : createInitialState();
    if (kind === 'live') options.currentState = invalid;
    if (kind === 'fingerprint') options.fingerprint = '<untrusted>';
    assertUntouched(f, f.repo.importSnapshot(incoming, options, kind === 'clock' ? Infinity : 200000), 'invalid-state');
    assert.equal(f.storage.events.length, 0);
  }
});

test('TC-3D-021 active offline settlement blocks import without touching durable or backup bytes', () => {
  const f = fixture(), pending = f.repo.load(150000, { deferOffline: true });
  assert.equal(pending.status, 'settling'); assert.ok(pending.pending); f.storage.events = [];
  assertUntouched(f, f.repo.importSnapshot(createInitialState(), importOptions(f), 200000), 'settling');
  assert.equal(f.storage.events.length, 0); f.repo.cancelOffline(pending.pending);
});

test('TC-3D-021 import detects a competing writer before backup and during backup verification', () => {
  for (const stage of ['before-backup', 'during-backup']) {
    const f = fixture(), foreign = rawEnvelope(createInitialState(), { saveId: 'foreign-writer', revision: 9 });
    if (stage === 'before-backup') f.storage.data.set(SAVE_KEY, foreign);
    else f.storage.afterSet = key => { if (key !== SAVE_KEY) f.storage.data.set(SAVE_KEY, foreign); };
    const result = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000);
    assert.equal(result.ok, false); assert.equal(result.status, 'conflict'); assert.equal(f.storage.data.get(SAVE_KEY), foreign);
    assert.equal(mainWrites(f.storage).length, 0); assert.equal(backupWrites(f.storage).length, stage === 'before-backup' ? 0 : 1);
    if (result.backupKey) assert.equal(JSON.parse(f.storage.data.get(result.backupKey)).originalRaw, f.raw);
  }
});

test('TC-3D-021 backup write rejection, partial write, bad readback and read exceptions never replace the shop', () => {
  for (const fault of ['reject-write', 'throw-after-write', 'read-mismatch', 'read-throws']) {
    const f = fixture();
    f.storage.beforeSet = key => { if (key !== SAVE_KEY && fault === 'reject-write') throw Error('quota'); };
    f.storage.afterSet = key => {
      if (key === SAVE_KEY) return;
      if (fault === 'throw-after-write') throw Error('post-write error');
      if (fault === 'read-mismatch') f.storage.data.set(key, 'truncated backup');
    };
    f.storage.beforeGet = key => { if (key !== SAVE_KEY && fault === 'read-throws') throw Error('backup unreadable'); };
    const result = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000);
    assertUntouched(f, result, 'unavailable'); assert.equal(result.uncertain, undefined); assert.ok(result.backupKey);
    assert.equal(f.repo.inspect().rawText, f.raw); assert.deepEqual(f.repo.durableSnapshot().state, f.state);
  }
});

test('TC-3D-021 local read failures before and after backup never attempt a replacement', () => {
  for (const failureRead of [1, 2]) {
    const f = fixture(); let reads = 0;
    f.storage.beforeGet = key => { if (key === SAVE_KEY && ++reads === failureRead) throw Error('main read unavailable'); };
    const result = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000);
    assertUntouched(f, result, 'unavailable'); assert.equal(backupWrites(f.storage).length, failureRead - 1);
  }
});

test('TC-3D-021 replacement exceptions/readback races enter uncertainty without blind rollback or saving', () => {
  for (const fault of ['reject-write', 'throw-after-write', 'read-throws', 'foreign-write']) {
    const f = fixture(), foreign = rawEnvelope(createInitialState(), { saveId: 'foreign-after-replace', revision: 4 }); let attempted = false;
    f.storage.beforeSet = key => { if (key === SAVE_KEY) { attempted = true; if (fault === 'reject-write') throw Error('quota'); } };
    f.storage.afterSet = key => {
      if (key !== SAVE_KEY) return;
      if (fault === 'throw-after-write') throw Error('post-write error');
      if (fault === 'foreign-write') f.storage.data.set(SAVE_KEY, foreign);
    };
    f.storage.beforeGet = key => { if (key === SAVE_KEY && attempted && fault === 'read-throws') throw Error('replacement unreadable'); };
    const result = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000);
    assert.equal(result.ok, false, fault); assert.equal(result.status, 'import-uncertain', fault); assert.equal(result.uncertain, true);
    assert.equal(mainWrites(f.storage).length, 1, 'no rollback write may erase a concurrent winner');
    assert.equal(JSON.parse(f.storage.data.get(result.backupKey)).originalRaw, f.raw);
    assert.equal(f.repo.readImportBackup()?.originalRaw, f.raw, 'a verified backup stays exportable when replacement outcome is uncertain');
    if (fault === 'reject-write') assert.equal(f.storage.data.get(SAVE_KEY), f.raw);
    else if (fault === 'foreign-write') assert.equal(f.storage.data.get(SAVE_KEY), foreign);
    else assert.deepEqual(JSON.parse(f.storage.data.get(SAVE_KEY)).state, createInitialState());
    f.storage.beforeGet = null; f.storage.beforeSet = null; f.storage.afterSet = null;
    const held = f.storage.data.get(SAVE_KEY), writes = mainWrites(f.storage).length;
    assert.equal(f.repo.save(f.state, 200001).status, 'import-uncertain');
    assert.equal(f.repo.settleOffline(f.state, 200000, 200001).status, 'import-uncertain');
    assert.equal(f.storage.data.get(SAVE_KEY), held); assert.equal(mainWrites(f.storage).length, writes);
    const envelope = JSON.parse(held), reloaded = f.repo.load(envelope.savedAt);
    assert.equal(reloaded.status, 'loaded'); assert.deepEqual(reloaded.state, envelope.state);
    assert.equal(f.repo.save(reloaded.state, envelope.savedAt).ok, true, 'explicit successful reread releases the save barrier');
  }
});

test('TC-3D-021 an uncertain rejected replacement requires rereading before another import attempt', () => {
  const f = fixture();
  f.storage.beforeSet = key => { if (key === SAVE_KEY) throw Error('write refused before mutation'); };
  const first = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000);
  assert.equal(first.status, 'import-uncertain'); assert.equal(f.storage.data.get(SAVE_KEY), f.raw);
  f.storage.beforeSet = null; f.storage.events = [];
  const repeated = f.repo.importSnapshot(createInitialState(), importOptions(f), 200001);
  assertUntouched(f, repeated, 'import-uncertain'); assert.equal(backupWrites(f.storage).length, 0);
  assert.equal(f.repo.load(100000).status, 'loaded');
  assert.equal(f.repo.importSnapshot(createInitialState(), importOptions(f), 200002).ok, true);
});

test('TC-3D-021 failed backup creation cannot unlock a protected corrupt original', () => {
  const storage = new FaultStorage(), raw = 'corrupt original that must remain byte-identical'; storage.data.set(SAVE_KEY, raw);
  const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, 'corrupt');
  storage.beforeSet = () => { throw Error('quota'); };
  const result = repo.importSnapshot(createInitialState(), { expectedRaw: raw, currentState: null, fingerprint: hashNumber(1), otherTabsClosed: true }, 200000);
  assert.equal(result.status, 'unavailable'); assert.equal(storage.data.get(SAVE_KEY), raw); assert.equal(repo.inspect().protectedRaw, true);
  storage.beforeSet = null; assert.equal(repo.save(createInitialState(), 200001).ok, false);
  assert.equal(storage.data.get(SAVE_KEY), raw);
});

test('TC-3D-021 ordinary legacy saves acquire stable identity and monotonic revisions without lowering time', () => {
  const state = checkpoint(), storage = new FaultStorage();
  storage.data.set(SAVE_KEY, JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 3, savedAt: 100000, recordChangeTag: 'legacy-tag', state }));
  const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, 'loaded');
  assert.equal(repo.save(state, 99999).ok, true); const first = repo.durableSnapshot();
  assert.match(first.saveId, /^[a-zA-Z0-9-]{1,100}$/); assert.equal(first.revision, 1); assert.equal(first.savedAt, 100000);
  assert.equal(repo.save(state, 100001).ok, true); assert.equal(repo.durableSnapshot().saveId, first.saveId); assert.equal(repo.durableSnapshot().revision, 2);
  const exhausted = fixture({ revision: Number.MAX_SAFE_INTEGER - 1 });
  assertUntouched(exhausted, exhausted.repo.save(exhausted.state, 200000), 'invalid-state');
});

test('TC-3D-021 corrupt raw and empty local shops may import only with a verified recovery backup', () => {
  for (const originalRaw of ['{corrupt preserved exactly\n', null]) {
    const storage = new FaultStorage(); if (originalRaw !== null) storage.data.set(SAVE_KEY, originalRaw);
    const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, originalRaw === null ? 'new' : 'corrupt');
    const result = repo.importSnapshot(checkpoint(), { expectedRaw: originalRaw, currentState: null, fingerprint: hashNumber(2), otherTabsClosed: true }, 200000);
    assert.equal(result.ok, true); assert.deepEqual(result.state, checkpoint());
    assert.equal(repo.inspect().protectedRaw, false); assert.equal(repo.durableSnapshot().revision, 1);
    const backup = repo.readImportBackup(); assert.equal(backup.originalRaw, originalRaw); assert.equal(backup.liveState, null);
    assert.equal(repo.save(result.state, 200000).ok, true);
  }
});

test('TC-3D-021 import never replays file-era time, even for stale/future export timestamps or backward local clocks', async () => {
  const imported = checkpoint();
  for (const exportedAt of [0, 8.64e15]) for (const fileSavedAt of [0, 8.64e15]) for (const now of [50000, 200000]) {
    const f = fixture(), parsed = await parsePortableSave(independentlyWrittenFile(payload(imported, { exportedAt, savedAt: fileSavedAt })));
    assert.equal(parsed.ok, true);
    const result = f.repo.importSnapshot(parsed.file.payload.state, importOptions(f, { fingerprint: parsed.file.fingerprint }), now);
    const anchor = Math.max(100000, now);
    assert.equal(result.ok, true); assert.equal(result.settledAt, anchor); assert.deepEqual(result.state, imported);
    const saved = f.storage.data.get(SAVE_KEY);
    for (const at of [now, anchor - 1, anchor]) {
      const same = new LocalSaveRepository(f.storage).load(at);
      assert.equal(same.status, 'loaded'); assert.deepEqual(same.state, imported); assert.equal(f.storage.data.get(SAVE_KEY), saved);
    }
    const future = new LocalSaveRepository(f.storage).load(anchor + 10000), oracle = createEngine(imported); oracle.advance(8);
    assert.deepEqual(business(future.state), business(oracle.snapshot())); assertMoney(future.state);
    const settled = f.storage.data.get(SAVE_KEY), repeated = new LocalSaveRepository(f.storage).load(anchor + 10000);
    assert.deepEqual(repeated.state, future.state); assert.equal(f.storage.data.get(SAVE_KEY), settled);
  }
});

test('TC-3D-021 repeated imports are explicit replacements with new identity, no asset merge or repeated file-era rewards', async () => {
  const f = fixture(), parsed = await parsePortableSave(independentlyWrittenFile(payload())); assert.equal(parsed.ok, true);
  let expectedRaw = f.raw, currentState = f.state; const identities = new Set(['local-existing-shop']), backups = new Set();
  for (let i = 0; i < 4; i++) {
    const result = f.repo.importSnapshot(parsed.file.payload.state, { expectedRaw, currentState, fingerprint: parsed.file.fingerprint, otherTabsClosed: true }, 200000 + i * 1000);
    assert.equal(result.ok, true); assert.deepEqual(result.state, parsed.file.payload.state); assertMoney(result.state);
    const durable = f.repo.durableSnapshot(); assert.equal(durable.revision, 1); assert.equal(identities.has(durable.saveId), false);
    identities.add(durable.saveId); assert.equal(backups.has(result.backupKey), false); backups.add(result.backupKey);
    assert.deepEqual(durable.importedFileHashes, [parsed.file.fingerprint]); assert.equal(f.repo.readImportBackup().originalRaw, expectedRaw);
    expectedRaw = f.storage.data.get(SAVE_KEY); currentState = result.state;
  }
});

test('TC-3D-027 old portable cash transfers once, previews the credited wallet and imports paused', async () => {
  const incoming = copy(legacyArchives.inactive); incoming.paused = true;
  incoming.counters[0].pendingCash = 300; incoming.counters[1].pendingCash = 400;
  incoming.manager.carrying = 200; incoming.totalEarned = incoming.wallet + incoming.spend + 900 - INITIAL_WALLET;
  const oldPayload = payload(incoming, { economyVersion: 3 });
  const text = fileWithPayloadText(JSON.stringify(oldPayload), 3), parsed = await parsePortableSave(text);
  assert.equal(parsed.ok, true, parsed.message); assert.equal(parsed.file.text, text);
  const current = parsed.file.payload.state;
  assert.equal(current.wallet, incoming.wallet + 900); assert.equal(current.totalEarned, incoming.totalEarned);
  assert.ok(current.counters.every(counter => counter.pendingCash === 0)); assert.equal(current.manager.carrying, 0);
  assert.equal(parsed.file.payload.overview.wallet, current.wallet); assert.equal(parsed.file.payload.overview.pendingCash, 0); assert.equal(parsed.file.payload.overview.carrying, 0);
  const f = fixture(), result = f.repo.importSnapshot(current, importOptions(f, { fingerprint: parsed.file.fingerprint }), 200000);
  assert.equal(result.ok, true); assert.deepEqual(result.state, current); assertMoney(result.state);
  const reloaded = new LocalSaveRepository(f.storage).load(210000);
  assert.deepEqual(business(reloaded.state), business(current), 'paused file import creates no offline progress');
  const exported = await createPortableSave(parsed.file.payload), again = await parsePortableSave(exported.text);
  assert.equal(again.ok, true); assert.deepEqual(again.file.payload.state, current);
  for (const mutate of [s => s.wallet++, s => s.pendingCash++, s => s.carrying++]) {
    const forged = copy(oldPayload); mutate(forged.overview);
    assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(forged), 3))).ok, false, 'original preview must be verified before cash migration');
  }
});

test('TC-3D-021 remembered file fingerprints are deduplicated, capped at 32 and preserved by ordinary saves', () => {
  const f = fixture(); let expectedRaw = f.raw, currentState = f.state;
  for (let i = 1; i <= 35; i++) {
    const result = f.repo.importSnapshot(createInitialState(), { expectedRaw, currentState, fingerprint: hashNumber(i), otherTabsClosed: true }, 200000 + i);
    assert.equal(result.ok, true); expectedRaw = f.storage.data.get(SAVE_KEY); currentState = result.state;
  }
  const expected = Array.from({ length: 32 }, (_, i) => hashNumber(i + 4)); assert.deepEqual(f.repo.durableSnapshot().importedFileHashes, expected);
  assert.equal(f.repo.importSnapshot(currentState, { expectedRaw, currentState, fingerprint: hashNumber(35), otherTabsClosed: true }, 200100).ok, true);
  assert.deepEqual(f.repo.durableSnapshot().importedFileHashes, expected);
  assert.equal(f.repo.save(currentState, 200101).ok, true); assert.deepEqual(f.repo.durableSnapshot().importedFileHashes, expected);
});

test('TC-3D-021 readImportBackup fails safely for missing, malformed or unreadable backups', () => {
  const f = fixture(); assert.equal(f.repo.readImportBackup(), null);
  const imported = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000); assert.equal(imported.ok, true);
  const key = imported.backupKey, valid = f.storage.data.get(key), backup = JSON.parse(valid);
  for (const replacement of [null, '', '{', JSON.stringify({ ...backup, format: 'wrong' }), JSON.stringify({ ...backup, version: 2 }), JSON.stringify({ ...backup, liveState: {} }), JSON.stringify({ ...backup, originalRaw: 1 }), JSON.stringify({ ...backup, liveRevision: 0 })]) {
    if (replacement === null) f.storage.data.delete(key); else f.storage.data.set(key, replacement);
    assert.equal(f.repo.readImportBackup(), null); assert.equal(f.repo.durableSnapshot().revision, 1);
  }
  f.storage.data.set(key, valid); f.storage.beforeGet = requested => { if (requested === key) throw Error('unreadable'); };
  assert.equal(f.repo.readImportBackup(), null); f.storage.beforeGet = null;
  const first = f.repo.readImportBackup(); first.liveState.wallet++;
  assert.deepEqual(f.repo.readImportBackup(), backup, 'callers cannot mutate persisted recovery material');
});

test('TC-3D-021 valid large local revisions remain readable in the import recovery backup', () => {
  const f = fixture({ revision: Number.MAX_SAFE_INTEGER - 1 });
  const result = f.repo.importSnapshot(createInitialState(), importOptions(f), 200000);
  assert.equal(result.ok, true); assert.equal(f.repo.durableSnapshot().revision, 1);
  const backup = f.repo.readImportBackup(); assert.ok(backup, 'a supported source revision must not make its recovery backup unreadable');
  assert.equal(backup.liveRevision, Number.MAX_SAFE_INTEGER - 1); assert.equal(backup.originalRaw, f.raw);
});

function legacyPayload() {
  const state = copy(legacyArchives.inactive), value = payload(state);
  value.economyVersion = 1; value.state.economyVersion = 1;
  delete value.state.coffeeLevels; delete value.state.layout; delete value.overview.coffeeLevels;
  delete value.overview.placedCounters; delete value.overview.placedSeats; delete value.overview.expanded;
  return value;
}

test('TC-3D-023 v4 files preserve and fingerprint coffee levels through import, reload and backup recovery', async () => {
  const engine = createEngine(); engine.advance(200); engine.upgradeCoffee('espresso'); engine.upgradeCoffee('latte');
  assert.deepEqual(engine.state.coffeeLevels, { espresso: 2, latte: 2 });
  const original = payload(engine.snapshot()), file = await createPortableSave(original), outer = JSON.parse(file.text);
  assert.equal(outer.formatVersion, 4); assert.equal(file.payload.economyVersion, 4); assert.equal(file.payload.state.economyVersion, 4);
  assert.deepEqual(file.payload.overview.coffeeLevels, { espresso: 2, latte: 2 });
  assert.equal(file.fingerprint, sha256(outer.payloadText));
  assert.equal(Object.isFrozen(file.payload.state.coffeeLevels), true); assert.equal(Object.isFrozen(file.payload.overview.coffeeLevels), true);
  const changed = copy(outer), decoded = JSON.parse(changed.payloadText); decoded.state.coffeeLevels.espresso++;
  decoded.overview.coffeeLevels.espresso++; changed.payloadText = JSON.stringify(decoded);
  assert.match((await parsePortableSave(JSON.stringify(changed))).message, /完整性/);
  const different = await createPortableSave(decoded); assert.notEqual(different.fingerprint, file.fingerprint);
  const parsed = await parsePortableSave(file.text); assert.equal(parsed.ok, true);
  const f = fixture(), imported = f.repo.importSnapshot(parsed.file.payload.state, importOptions(f, { fingerprint: parsed.file.fingerprint }), 200000);
  assert.equal(imported.ok, true); assert.deepEqual(imported.state, original.state);
  assert.deepEqual(new LocalSaveRepository(f.storage).load(200000).state, original.state);
  const recovered = f.repo.readImportBackup(); assert.deepEqual(recovered.liveState.coffeeLevels, f.state.coffeeLevels);
  assertMoney(imported.state);
});

test('TC-3D-023 valid v1 files verify original bytes then migrate once to Lv1 and export v4', async () => {
  const legacy = legacyPayload(), before = copy(legacy), payloadText = JSON.stringify(legacy, null, 2), text = fileWithPayloadText(payloadText, 1);
  const parsed = await parsePortableSave(text); assert.equal(parsed.ok, true);
  assert.equal(parsed.file.text, text); assert.equal(parsed.file.fingerprint, sha256(payloadText)); assert.deepEqual(legacy, before);
  assert.equal(parsed.file.payload.economyVersion, 4); assert.equal(parsed.file.payload.state.economyVersion, 4);
  assert.deepEqual(parsed.file.payload.state.coffeeLevels, { espresso: 1, latte: 1 });
  assert.deepEqual(parsed.file.payload.overview.coffeeLevels, { espresso: 1, latte: 1 });
  assert.deepEqual(parsed.file.payload.state.counters, legacy.state.counters.map(counter => ({ ...counter, pendingCash: 0 })), 'in-flight prices and times survive cash transfer');
  const f = fixture(), result = f.repo.importSnapshot(parsed.file.payload.state, importOptions(f, { fingerprint: parsed.file.fingerprint }), 200000);
  assert.equal(result.ok, true); assert.deepEqual(result.state, parsed.file.payload.state); assert.equal(result.state.elapsed, legacy.state.elapsed);
  assert.equal(JSON.parse(f.storage.data.get(SAVE_KEY)).state.economyVersion, 4);
  assert.deepEqual(JSON.parse(f.storage.data.get(SAVE_KEY)).importedFileHashes, [sha256(payloadText)]);
  const upgraded = await createPortableSave(parsed.file.payload), again = await parsePortableSave(upgraded.text);
  assert.equal(JSON.parse(upgraded.text).formatVersion, 4); assert.equal(again.ok, true); assert.deepEqual(again.file.payload, parsed.file.payload);
  assert.notEqual(upgraded.fingerprint, parsed.file.fingerprint);
  await assert.rejects(createPortableSave(legacy), /无法生成/, 'writers require current normalized data');
});

test('TC-3D-023 mismatched formats, economies, coffee bounds and forged summaries fail even with valid checksums', async () => {
  for (const format of [0, -1, 5, 999, '2', null]) assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(payload()), format))).ok, false);
  assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(payload()), 1))).ok, false, 'current state cannot masquerade as v1');
  assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(legacyPayload()), 2))).ok, false, 'v1 state is not a valid v2 payload');
  const mismatched = payload(); mismatched.economyVersion = 1;
  assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(mismatched), 1))).ok, false);
  const legacyWithLevels = legacyPayload(); legacyWithLevels.state.coffeeLevels = { espresso: 1, latte: 2 };
  assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(legacyWithLevels), 1))).ok, false, 'old economy plus paid progression cannot be silently repaired');
  const legacyForged = legacyPayload(); legacyForged.overview.coffeeLevels = { espresso: 1, latte: 1 };
  assert.equal((await parsePortableSave(fileWithPayloadText(JSON.stringify(legacyForged), 1))).ok, false);
  for (const levels of [undefined, null, {}, [], { espresso: 1 }, { espresso: 1, latte: 1, mocha: 1 }, { espresso: 0, latte: 1 }, { espresso: COFFEE_MAX_LEVEL + 1, latte: 1 }, { espresso: 1.5, latte: 1 }, { espresso: '1', latte: 1 }]) {
    const value = payload(); value.state.coffeeLevels = levels; value.overview.coffeeLevels = levels;
    assert.equal((await parsePortableSave(independentlyWrittenFile(value))).ok, false, JSON.stringify(levels));
  }
  for (const target of ['state', 'overview']) {
    const value = payload(); value[target].coffeeLevels.espresso = 2;
    assert.equal((await parsePortableSave(independentlyWrittenFile(value))).ok, false, `coffee ${target} mismatch`);
  }
});

test('TC-3D-023 retained pre-coffee recovery backup normalizes liveState for v4 re-export without altering original bytes', async () => {
  const f = fixture(), legacy = legacyPayload().state;
  const backupKey = `${SAVE_KEY}-import-backup-legacy-coffee`;
  const originalRaw = '  { "pre-feature": "original protected bytes" }\n';
  const record = { format: 'mellow-bean-import-backup', version: 1, createdAt: 50000, originalRaw, liveState: legacy, liveSaveId: 'legacy-shop', liveRevision: 3 };
  const backupRaw = JSON.stringify(record); f.storage.data.set(backupKey, backupRaw);
  const main = JSON.parse(f.raw); main.lastImportBackupKey = backupKey; f.storage.data.set(SAVE_KEY, JSON.stringify(main));
  const repo = new LocalSaveRepository(f.storage); assert.equal(repo.load(100000).status, 'loaded');
  f.storage.events = [];
  const read = repo.readImportBackup(); assert.equal(read.originalRaw, originalRaw);
  assert.equal(read.liveState.economyVersion, 4); assert.deepEqual(read.liveState.coffeeLevels, { espresso: 1, latte: 1 });
  const exported = await createPortableSave(payload(read.liveState, { savedAt: read.createdAt })), parsed = await parsePortableSave(exported.text);
  assert.equal(parsed.ok, true); assert.equal(JSON.parse(exported.text).formatVersion, 4); assert.deepEqual(parsed.file.payload.state, read.liveState);
  assert.equal(f.storage.data.get(backupKey), backupRaw); assert.equal(f.storage.events.some(([operation]) => operation === 'set'), false);
});


test('TC-3D-027 portable v1/v2/v3 validate their original summaries then migrate to v4 once', async () => {
  for (const version of [1, 2, 3]) {
    const source = copy(version === 3 ? legacyArchives.active : legacyArchives.inactive);
    const value = payload(source, { economyVersion: version }); value.state.economyVersion = version;
    if (version < 3) {
      delete value.state.layout; delete value.overview.placedCounters; delete value.overview.placedSeats; delete value.overview.expanded;
      if (version === 1) { delete value.state.coffeeLevels; delete value.overview.coffeeLevels; }
    }
    const receipts = source.counters.reduce((sum, counter) => sum + counter.pendingCash, source.manager.carrying);
    const original = JSON.stringify(value), text = fileWithPayloadText(original, version), parsed = await parsePortableSave(text);
    assert.equal(parsed.ok, true, `format${version}: ${parsed.message}`);
    assert.equal(parsed.file.text, text); assert.equal(parsed.file.fingerprint, sha256(original));
    assert.equal(parsed.file.payload.economyVersion, 4); assert.equal(parsed.file.payload.state.economyVersion, 4);
    assert.equal(parsed.file.payload.state.wallet, source.wallet + receipts); assert.equal(parsed.file.payload.state.totalEarned, source.totalEarned);
    assert.deepEqual(parsed.file.payload.state.customers, source.customers);
    assert.deepEqual(parsed.file.payload.state.counters.map(counter => counter.brew), source.counters.map(counter => counter.brew));
    const next = await createPortableSave(parsed.file.payload), again = await parsePortableSave(next.text);
    assert.equal(again.ok, true); assert.deepEqual(again.file.payload, parsed.file.payload);
  }
  for (const field of ['pending', 'carrying']) {
    const value = payload(); value.state.totalEarned++;
    if (field === 'pending') value.state.counters[0].pendingCash++; else value.state.manager.carrying++;
    value.overview = independentOverview(value.state);
    assert.equal((await parsePortableSave(independentlyWrittenFile(value))).ok, false, 'balanced v4 retired cash is corruption, never a migration');
  }
});
