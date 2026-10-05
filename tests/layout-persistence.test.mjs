import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { createEngine, createInitialState, INITIAL_WALLET, ECONOMY_VERSION } = await import('../src/slice/core/engine.ts');
const { initialLayout, addFurniture, validateLayout } = await import('../src/slice/core/layout.ts');
const { LocalSaveRepository, createMemoryStorage, SAVE_KEY, validateState } = await import('../src/slice/core/persistence.ts');
const { PORTABLE_VERSION, createPortableSave, parsePortableSave, overviewOf } = await import('../src/slice/core/portableSave.ts');
const copy = value => structuredClone(value);
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const business = value => { const state = copy(value); delete state.lastOfflineClaimId; delete state.offlineClaimIds; return state; };
const rawEnvelope = (state, changes = {}) => JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 3, savedAt: 100000, recordChangeTag: 'layout-fixture', saveId: 'layout-fixture', revision: 3, state, ...changes });
const oldOverview = state => ({ wallet: state.wallet, totalEarned: state.totalEarned, totalServed: state.totalServed, elapsed: state.elapsed, counterLevels: state.counters.map(counter => counter.level), ...(state.economyVersion === 1 ? {} : { coffeeLevels: { ...state.coffeeLevels } }), managerLevel: state.manager.level, pendingCash: state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), carrying: state.manager.carrying });
const payload = state => ({ saveId: 'layout-exchange', revision: 7, gameSchemaVersion: 1, economyVersion: state.economyVersion, offlinePolicyVersion: 3, savedAt: 100000, exportedAt: 100123, overview: overviewOf(state), state: copy(state) });
const independentFile = (value, formatVersion = value.economyVersion) => {
  const payloadText = JSON.stringify(value, null, 2);
  return { payloadText, text: JSON.stringify({ format: 'mellow-bean-portable-save', formatVersion, payloadText, integrity: { algorithm: 'SHA-256', sha256: sha256(payloadText) } }) };
};
// Literal pre-layout checkpoint, captured from the previous released economy2.
// It includes two in-flight brews, a recipe changed after snapshotting, an exit
// guest, multiple inbound legs, cash waiting at a counter and sub-step time.
function legacyState(version = 2) {
  const state = {
    schemaVersion: 1, economyVersion: version, coffeeLevels: { espresso: 1, latte: 1 }, managerRouteVersion: 2, customerRouteVersion: 3,
    elapsed: 16.1, wallet: 400, totalEarned: 123, totalServed: 1, spend: 800, nextCustomerId: 7, arrivalTimer: .8, inviteCooldown: 0, paused: false, stepCarry: .037, eventSequence: 10, offlineClaimIds: [],
    counters: [
      { id: 'counter-a', x: 0, level: 2, recipe: 'latte', pendingCash: 123, brewed: 1, brew: { recipe: 'espresso', customerId: 3, elapsed: 1.1, duration: 2.583732057416268, price: 123 } },
      { id: 'counter-b', x: 5, level: 1, recipe: 'latte', pendingCash: 0, brewed: 0, brew: { recipe: 'latte', customerId: 2, elapsed: 1.75, duration: 6.8, price: 246 } },
    ],
    customers: [
      { id: 1, x: 1.225, z: 7.4, phase: 'leaving', counterId: 'counter-a', timer: 0, hasCup: true, skin: 0, routeLeg: 2 },
      { id: 2, x: 5, z: 1.5, phase: 'serving', counterId: 'counter-b', timer: 0, hasCup: false, skin: 1 },
      { id: 3, x: 0, z: 1.5, phase: 'serving', counterId: 'counter-a', timer: 0, hasCup: false, skin: 2 },
      { id: 4, x: 3.625, z: 8.2, phase: 'entering', counterId: 'counter-b', timer: 0, routeLeg: 2, hasCup: false, skin: 3 },
      { id: 5, x: -3.125, z: 8.2, phase: 'entering', counterId: 'counter-a', timer: 0, routeLeg: 2, hasCup: false, skin: 4 },
      { id: 6, x: -6, z: 5.125, phase: 'entering', counterId: 'counter-b', timer: 0, routeLeg: 1, hasCup: false, skin: 5 },
    ], manager: { x: 8.8, z: -1.7, carrying: 0, phase: 'depositing', target: 2, timer: 0, level: 1 }, lastOfflineClaimId: null,
  };
  if (version === 1) delete state.coffeeLevels;
  return state;
}
function activeState({ stored = false } = {}) {
  // Synthetic already-earned balance and served count keep this fixture short;
  // actual purchases and layout activation go through the public engine API.
  const state = createInitialState(); state.wallet += 30000; state.totalEarned = 30000; state.totalServed = 40; state.counters[0].brewed = 40; state.nextCustomerId = 41;
  const engine = createEngine(state); engine.togglePause(); assert.equal(engine.beginLayoutEdit(), true);
  for (let i = 0; i < 4000 && engine.layoutEditStatus() !== 'ready'; i++) engine.advance(.05);
  assert.equal(engine.layoutEditStatus(), 'ready');
  const draft = engine.createLayoutDraft(); assert.ok(draft); draft.expanded = true;
  assert.ok(addFurniture(draft, 'counter', 13, 0)); assert.ok(addFurniture(draft, 'counter', 13, 6)); assert.ok(addFurniture(draft, 'table', 0, 5));
  if (stored) draft.furniture.find(item => item.id === 'counter-d').stored = true;
  assert.equal(validateLayout(draft).ok, true, validateLayout(draft).message);
  const result = engine.commitLayout(draft); assert.equal(result.ok, true, result.message); assert.equal(result.cost, 11400);
  engine.togglePause(); const snapshot = engine.snapshot(); assert.equal(validateState(snapshot).ok, true, JSON.stringify(validateState(snapshot)));
  return snapshot;
}
function assertMoney(state) { assert.equal(state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), INITIAL_WALLET + state.totalEarned); }

for (const version of [1, 2]) test(`TC-3D-025 economy${version} migration preserves exact old coordinates, snapshots, assets and fractional clock`, () => {
  const old = legacyState(version), before = copy(old), checked = validateState(old); assert.equal(checked.ok, true, checked.message);
  assert.deepEqual(old, before); assert.equal(checked.state.economyVersion, 4); assert.equal(checked.state.layout.version, 2); assert.equal(checked.state.layout.active, false); assert.ok(checked.state.layout.coffeeSigns.every(sign => sign.stored));
  assert.equal(checked.state.wallet, old.wallet + 123); assert.equal(checked.state.manager.carrying, 0); assert.deepEqual(checked.state.counters, old.counters.map(counter => ({ ...counter, pendingCash: 0 })));
  for (const key of ['customers', 'totalEarned', 'totalServed', 'spend', 'elapsed', 'stepCarry', 'eventSequence', 'nextCustomerId']) assert.deepEqual(checked.state[key], old[key], key);
  assert.deepEqual(validateState(checked.state).state, checked.state); assert.deepEqual(createEngine(old).snapshot(), checked.state);
  const storage = createMemoryStorage(), raw = rawEnvelope(old); storage.setItem(SAVE_KEY, raw); const repo = new LocalSaveRepository(storage);
  const loaded = repo.load(100000); assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, checked.state); assert.equal(storage.getItem(SAVE_KEY), raw);
  const replay = createEngine(loaded.state), direct = createEngine(checked.state); replay.advance(101.123); direct.advance(101.123); assert.deepEqual(replay.snapshot(), direct.snapshot());
  assertMoney(replay.state); assert.equal(validateState(replay.snapshot()).ok, true);
});

for (const version of [1, 2]) test(`TC-3D-025 original portable${version} bytes retain their fingerprint while normalizing to portable4`, async () => {
  const old = legacyState(version), source = { saveId: 'old-layout-source', revision: 4, gameSchemaVersion: 1, economyVersion: version, offlinePolicyVersion: 3, savedAt: 100000, exportedAt: 100123, overview: oldOverview(old), state: old };
  const { text, payloadText } = independentFile(source, version), parsed = await parsePortableSave(text);
  assert.equal(parsed.ok, true, parsed.message); assert.equal(parsed.file.text, text); assert.equal(parsed.file.fingerprint, sha256(payloadText));
  assert.equal(parsed.file.payload.economyVersion, 4); assert.equal(parsed.file.payload.state.layout.version, 2); assert.deepEqual(parsed.file.payload.state.counters, old.counters.map(counter => ({ ...counter, pendingCash: 0 }))); assert.deepEqual(parsed.file.payload.state.customers, old.customers);
  assert.deepEqual(parsed.file.payload.overview, { ...oldOverview({ ...old, economyVersion: 2, coffeeLevels: { espresso: 1, latte: 1 }, wallet: old.wallet + 123, counters: old.counters.map(counter => ({ ...counter, pendingCash: 0 })) }), placedCounters: 2, placedSeats: 0, expanded: false });
  const written = await createPortableSave(parsed.file.payload); assert.equal(JSON.parse(written.text).formatVersion, 4); assert.notEqual(written.fingerprint, parsed.file.fingerprint);
  assert.deepEqual((await parsePortableSave(written.text)).file.payload, parsed.file.payload);
  const storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); repo.load(100000);
  const imported = repo.importSnapshot(parsed.file.payload.state, { expectedRaw: null, currentState: createInitialState(), fingerprint: parsed.file.fingerprint, otherTabsClosed: true }, 101000);
  assert.equal(imported.ok, true); assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).importedFileHashes, [sha256(payloadText)]); assert.equal(imported.state.elapsed, old.elapsed);
  const mismatch = copy(source); mismatch.economyVersion = 3; mismatch.state.economyVersion = 3; assert.equal((await parsePortableSave(independentFile(mismatch, version).text)).ok, false);
});

test('TC-3D-025 new layout/economy/route versions protect original bytes until explicit recovery', () => {
  assert.equal(ECONOMY_VERSION, 4); assert.equal(PORTABLE_VERSION, 4);
  for (const mutate of [state => { state.economyVersion = 5; }, state => { state.layout.version = 4; }, state => { state.managerRouteVersion = 3; }, state => { state.customerRouteVersion = 5; }]) {
    const state = createInitialState(); mutate(state); const raw = rawEnvelope(state), storage = createMemoryStorage(); storage.setItem(SAVE_KEY, raw);
    const repo = new LocalSaveRepository(storage), loaded = repo.load(999999); assert.equal(loaded.status, 'future'); assert.equal(loaded.protectedRaw, true); assert.equal(repo.save(createInitialState(), 999999).ok, false); assert.equal(repo.reset().ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
    const reset = repo.reset({ confirmProtected: true }); assert.equal(reset.ok, true); assert.equal(storage.getItem(reset.backupKey), raw);
  }
});

test('TC-3D-025 missing and malformed modern layouts fail closed without silently restoring default furniture', () => {
  const cases = [state => { delete state.layout; }, state => { state.layout = null; }, state => { state.layout.active = 'false'; }, state => { state.layout.furniture = []; }, state => { state.layout.furniture[0].rotation = 4; }, state => { state.layout.furniture[0].x = .5; }, state => { state.layout.furniture[1].x = 0; }, state => { state.layout.furniture.forEach(item => item.stored = true); }, state => { state.layout.expanded = true; }];
  for (const mutate of cases) {
    const state = createInitialState(); mutate(state); const before = copy(state), raw = rawEnvelope(state), storage = createMemoryStorage(); storage.setItem(SAVE_KEY, raw);
    assert.equal(validateState(state).ok, false, mutate.toString()); assert.deepEqual(state, before); const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, 'corrupt'); assert.equal(repo.save(createInitialState(), 100000).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
  }
});

test('TC-3D-025 active counters, seats, expansion and exact live paths survive file/local save and deterministic replay', async () => {
  const engine = createEngine(activeState()); engine.advance(89.137); const snapshot = engine.snapshot(), checked = validateState(snapshot); assert.equal(checked.ok, true, checked.message); assert.equal(snapshot.counters.length, 4);
  const storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); repo.load(100000); assert.equal(repo.save(snapshot, 100000).ok, true);
  const loaded = new LocalSaveRepository(storage).load(100000); assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.state, snapshot);
  const file = await createPortableSave(payload(snapshot)), parsed = await parsePortableSave(file.text); assert.equal(parsed.ok, true, parsed.message); assert.deepEqual(parsed.file.payload.state, snapshot);
  assert.equal(parsed.file.payload.overview.placedCounters, 4); assert.equal(parsed.file.payload.overview.placedSeats, 1); assert.equal(parsed.file.payload.overview.expanded, true);
  const replay = createEngine(parsed.file.payload.state); replay.advance(120.013); engine.advance(120.013); assert.deepEqual(replay.snapshot(), engine.snapshot()); assertMoney(replay.state);
});

test('TC-3D-025 stored counters retain upgraded assets and lifetime cup counts while receipts are already in wallet', async () => {
  const state = activeState({ stored: true }), counter = state.counters[3]; counter.level = 5; counter.recipe = 'latte'; counter.brewed = 2; state.totalEarned += 246; state.wallet += 246; state.totalServed += 2;
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state))); const file = await createPortableSave(payload(state)), parsed = await parsePortableSave(file.text); assert.equal(parsed.ok, true); assert.deepEqual(parsed.file.payload.state.counters[3], counter);
  assert.equal(parsed.file.payload.overview.placedCounters, 3); assert.equal(parsed.file.payload.overview.counterLevels[3], 5); assert.equal(parsed.file.payload.overview.pendingCash, 0);
  const replay = createEngine(parsed.file.payload.state); replay.advance(60); assert.deepEqual(replay.state.counters[3], counter); assertMoney(replay.state); assert.equal(validateState(replay.snapshot()).ok, true);
});

test('TC-3D-025 active layout offline settlement exceeds the former cap, replays exactly 80 percent and does not claim twice', async () => {
  const engine = createEngine(activeState()); engine.advance(47.113); const snapshot = engine.snapshot();
  const storage = createMemoryStorage(), repo = new LocalSaveRepository(storage); repo.load(100000); assert.equal(repo.save(snapshot, 100000).ok, true);
  const raw = storage.getItem(SAVE_KEY), reader = new LocalSaveRepository(storage), pending = reader.load(9400000, { deferOffline: true }); assert.equal(pending.status, 'settling'); assert.equal(storage.getItem(SAVE_KEY), raw);
  const result = await reader.finishOffline(pending.pending, { yieldControl: async () => { assert.equal(storage.getItem(SAVE_KEY), raw); } }); assert.equal(result.status, 'loaded', result.message); assert.equal(result.offline.effectiveSeconds, 7440);
  const direct = createEngine(snapshot); direct.advance(7440); assert.deepEqual(business(result.state), business(direct.snapshot())); assertMoney(result.state);
  const again = new LocalSaveRepository(storage).load(9400000); assert.deepEqual(again.state, result.state); assert.equal(again.offline?.accepted ?? false, false);
});

test('TC-3D-025 active offline cancellation leaves original layout, cash, paths and bytes untouched', async () => {
  const engine = createEngine(activeState()); engine.advance(29.137); const storage = createMemoryStorage(), raw = rawEnvelope(engine.snapshot()); storage.setItem(SAVE_KEY, raw);
  const repo = new LocalSaveRepository(storage), pending = repo.load(1000000, { deferOffline: true }), controller = new AbortController();
  const result = await repo.finishOffline(pending.pending, { signal: controller.signal, yieldControl: async () => { controller.abort(); } });
  assert.equal(result.status, 'offline-save-failed'); assert.equal(storage.getItem(SAVE_KEY), raw); assert.equal(result.offline.accepted, false); assert.deepEqual(result.state, JSON.parse(raw).state);
});

test('TC-3D-025 explicit corrupt layouts on legacy economies never migrate away bad ownership', () => {
  for (const economy of [1, 2]) for (const layout of [null, [], 1, { ...initialLayout(), active: true }, { ...initialLayout(), expanded: true }, { ...initialLayout(), version: 3 }]) {
    const state = legacyState(economy); state.layout = copy(layout); const before = copy(state);
    assert.equal(validateState(state).ok, false, `${economy}:${JSON.stringify(layout)}`); assert.deepEqual(state, before);
  }
});

test('TC-3D-025 active furniture ownership, spending, service snapshots and cup ledgers are validated independently', () => {
  const original = activeState({ stored: true });
  const changes = [
    state => { state.layout.furniture.splice(2, 1); },
    state => { state.layout.furniture[2].counterId = 'counter-d'; },
    state => { state.layout.furniture[2].id = 'counter-d'; },
    state => { state.counters.pop(); },
    state => { state.counters[2].x++; },
    state => { state.counters[2].id = 'counter-z'; },
    state => { state.layout.furniture[0].stored = true; state.layout.furniture[1].stored = true; state.layout.furniture[2].stored = true; },
    state => { state.wallet += state.spend; state.spend = 0; },
    state => { state.totalServed = 39; state.counters[0].brewed = 39; },
    state => { state.counters[3].brew = { recipe: 'espresso', price: 110, duration: 3.6, elapsed: 1, customerId: 41 }; },
    state => { state.counters[3].brewed++; },
    state => { state.counters[3].pendingCash++; },
    state => { state.layout.expanded = false; },
    state => { state.layout.trafficTurn = 'random'; },
    state => { state.economyVersion = 2; },
  ];
  for (const mutate of changes) { const state = copy(original); mutate(state); assert.equal(validateState(state).ok, false, mutate.toString()); }
});

test('TC-3D-025 malformed active waypoint geometry, phase destinations and seat ownership cannot be restored', () => {
  const engine = createEngine(activeState()), samples = new Map();
  for (let i = 0; i < 30000 && samples.size < 5; i++) {
    engine.advance(.05);
    for (const phase of ['entering', 'serving', 'receiving', 'seeking-seat', 'dining']) if (!samples.has(phase) && engine.state.customers.some(customer => customer.phase === phase && (phase !== 'entering' || customer.nav?.length > 2))) samples.set(phase, engine.snapshot());
  }
  for (const phase of ['entering', 'serving', 'receiving', 'seeking-seat', 'dining']) { assert.ok(samples.has(phase), `reached ${phase}`); const checked = validateState(samples.get(phase)); assert.equal(checked.ok, true, `${phase}: ${checked.message}`); }
  const mutateCustomer = (phase, mutate) => { const state = copy(samples.get(phase)); const customer = state.customers.find(customer => customer.phase === phase); mutate(state, customer); assert.equal(validateState(state).ok, false, `${phase}: ${mutate.toString()}`); };
  mutateCustomer('entering', (_, customer) => { customer.nav[1].x += 2; });
  mutateCustomer('entering', (_, customer) => { customer.nav[0].x += .5; });
  mutateCustomer('entering', (_, customer) => { customer.nav = [{ x: 0, z: 0 }]; });
  mutateCustomer('entering', (_, customer) => { customer.nav = []; });
  mutateCustomer('entering', (_, customer) => { customer.nav = customer.nav.slice(0, -1); });
  mutateCustomer('entering', (_, customer) => { customer.routeLeg = 1; });
  mutateCustomer('entering', (_, customer) => { customer.x += .01; customer.z += .01; });
  mutateCustomer('serving', (_, customer) => { customer.hasCup = true; });
  mutateCustomer('serving', (state, customer) => { state.counters.find(counter => counter.id === customer.counterId).brew.customerId++; });
  mutateCustomer('serving', (_, customer) => { customer.nav = [{ x: customer.x, z: customer.z + 1 }]; });
  mutateCustomer('receiving', (state, customer) => { state.counters.find(counter => counter.id === customer.counterId).brew.elapsed -= .05; });
  mutateCustomer('receiving', (_, customer) => { customer.timer = 1; });
  mutateCustomer('seeking-seat', (_, customer) => { delete customer.seatId; });
  mutateCustomer('seeking-seat', (_, customer) => { customer.seatId = 'missing-table'; });
  mutateCustomer('dining', (_, customer) => { customer.x++; });
  mutateCustomer('dining', (_, customer) => { customer.timer = 7; });
  mutateCustomer('dining', (_, customer) => { customer.hasCup = false; });
  mutateCustomer('dining', (state, customer) => { state.customers.push({ ...copy(customer), id: state.nextCustomerId++ }); });
});

test('TC-3D-027 retired manager tombstone rejects resurrected navigation, cash or collection actions', () => {
  const original = activeState();
  const cases = [
    state => { state.manager.nav = [{ x: 9, z: -2 }]; }, state => { state.manager.target = 999; },
    state => { state.manager.timer = .5; }, state => { state.manager.collectionCursor = 0; },
    state => { state.manager.finishLegacySweep = true; }, state => { state.manager.phase = 'collecting'; },
    state => { state.manager.x = 9; }, state => { state.manager.carrying = 1; state.wallet--; },
  ];
  for (const mutate of cases) { const state = copy(original); mutate(state); assert.equal(validateState(state).ok, false, mutate.toString()); }
});

test('TC-3D-027 portable4 rejects future layout data and forged placed-furniture previews with valid checksums', async () => {
  const original = payload(activeState({ stored: true }));
  for (const mutate of [value => { value.state.layout.version = 4; }, value => { value.state.economyVersion = 5; value.economyVersion = 5; }, value => { value.overview.placedCounters++; }, value => { value.overview.placedSeats++; }, value => { value.overview.expanded = false; }, value => { delete value.state.layout; }]) {
    const value = copy(original); mutate(value); assert.equal((await parsePortableSave(independentFile(value, 4).text)).ok, false, mutate.toString());
  }
  assert.equal((await parsePortableSave(independentFile(original, 5).text)).ok, false);
  const disguised = copy(original); disguised.economyVersion = 2; disguised.state.economyVersion = 2; delete disguised.overview.placedCounters; delete disguised.overview.placedSeats; delete disguised.overview.expanded;
  assert.equal((await parsePortableSave(independentFile(disguised, 2).text)).ok, false, 'active furniture cannot masquerade as an old economy2 file');
});

test('TC-3D-025 active offline competing writes cannot partially persist cash or layout', async () => {
  const engine = createEngine(activeState()); engine.advance(12.137); const state = engine.snapshot(), storage = createMemoryStorage(), raw = rawEnvelope(state); storage.setItem(SAVE_KEY, raw);
  const repo = new LocalSaveRepository(storage), prepared = repo.load(175000, { deferOffline: true }), competing = rawEnvelope(state, { recordChangeTag: 'competing-layout-writer', revision: 4 }); let injected = false;
  const result = await repo.finishOffline(prepared.pending, { yieldControl: async () => { if (!injected) { injected = true; storage.setItem(SAVE_KEY, competing); } } });
  assert.equal(result.status, 'conflict'); assert.equal(result.offline.accepted, false); assert.equal(storage.getItem(SAVE_KEY), competing); assert.deepEqual(result.state, state);
});

test('TC-3D-027 economy3 missing layout fails closed instead of restoring starter furniture', () => {
  const source = legacyState(2); source.economyVersion = 3; const storage = createMemoryStorage(), raw = rawEnvelope(source); storage.setItem(SAVE_KEY, raw);
  assert.equal(validateState(source).ok, false); const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, 'corrupt'); assert.equal(repo.save(createInitialState()).ok, false); assert.equal(storage.getItem(SAVE_KEY), raw);
});

function oldEmptyLayout() {
  const state = createInitialState(); state.economyVersion = 3; state.customerRouteVersion = 3; state.layout.version = 2;
  state.layout.coffeeSigns.forEach(sign => { sign.stored = false; }); state.manager = { x: 9, z: -2, carrying: 0, phase: 'moving', target: 2, timer: 0, level: 4 };
  return state;
}

test('TC-3D-027 old furniture blocking the opposite door is stored once, retaining ownership, money and notice', async () => {
  const source = oldEmptyLayout(); addFurniture(source.layout, 'table', 10, 6); source.spend = 600; source.wallet -= 600;
  assert.equal(validateLayout(source.layout).ok, true); const checked = validateState(source); assert.equal(checked.ok, true, checked.message);
  const next = checked.state; assert.equal(next.layout.version, 3); assert.equal(next.layout.furniture.find(item => item.kind === 'table').stored, true); assert.equal(next.doorMigrationNotice, true);
  for (const key of ['wallet', 'spend', 'totalEarned', 'coffeeLevels']) assert.deepEqual(next[key], source[key]); assert.equal(next.manager.level, 4);
  const file = await createPortableSave(payload(next)); assert.equal((await parsePortableSave(file.text)).file.payload.state.doorMigrationNotice, true);
  assert.deepEqual(validateState(next).state, next); delete next.doorMigrationNotice; assert.equal(validateState(next).state.doorMigrationNotice, undefined);
});

test('TC-3D-027 last legacy counter blocking exit repositions to safe owned anchors and reports it once', () => {
  const source = oldEmptyLayout(); source.layout.furniture[0].stored = true; Object.assign(source.layout.furniture[1], { x: 8, z: 6 }); source.counters[1].x = 8; source.counters[1].level = 7;
  assert.equal(validateLayout(source.layout).ok, true); const checked = validateState(source); assert.equal(checked.ok, true, checked.message);
  assert.equal(checked.state.doorMigrationNotice, true); assert.equal(validateLayout(checked.state.layout).ok, true); assert.equal(checked.state.counters[1].level, 7); assert.equal(checked.state.wallet, source.wallet); assert.equal(checked.state.totalEarned, source.totalEarned);
  assert.deepEqual(validateState(checked.state).state, checked.state);
});

test('TC-3D-027 already safe old geometry needs no furniture move or migration notice', () => {
  const source = oldEmptyLayout(); const checked = validateState(source); assert.equal(checked.ok, true, checked.message);
  assert.deepEqual(checked.state.layout.furniture, source.layout.furniture); assert.equal(checked.state.doorMigrationNotice, undefined);
});
