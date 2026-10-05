import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const core = await import('../src/slice/core/engine.ts');
const { createEngine, createInitialState, INITIAL_WALLET, MAX_ELAPSED_SECONDS, STEP_SECONDS, WORLD } = core;
const { LocalSaveRepository, createMemoryStorage, SAVE_KEY, validateState, OFFLINE_POLICY_VERSION, OFFLINE_STEP_BATCH, OFFLINE_SLICE_BUDGET_MS } = await import('../src/slice/core/persistence.ts');

// Online fixed-step advance is the independent oracle. The expected values below
// never call the offline policy helper or derive expected prices from its output.
const checkpoint = () => { const engine = createEngine(); engine.upgrade('counter-a'); engine.advance(16.137); engine.setRecipe('counter-a', 'latte'); return engine.snapshot(); };
const business = state => { const copy = structuredClone(state); delete copy.lastOfflineClaimId; delete copy.offlineClaimIds; return copy; };
const advanced = (state, seconds) => { const engine = createEngine(state); engine.advance(seconds); return engine.snapshot(); };
const assets = state => state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message ?? 'number'}: ${actual} ≠ ${expected}`);
const assertValidMoney = state => { assert.equal(validateState(state).ok, true); assert.equal(assets(state), INITIAL_WALLET + state.totalEarned); };
const rawEnvelope = (state, savedAt = 100000, version = 3, recordChangeTag = 'policy-fixture') => JSON.stringify({ schemaVersion: 1, savedAt, recordChangeTag, ...(version === 'unmarked' ? {} : { offlinePolicyVersion: version }), state });
const fixture = (state = checkpoint(), version = 3, savedAt = 100000) => {
  const memory = createMemoryStorage(); memory.setItem(SAVE_KEY, rawEnvelope(state, savedAt, version));
  return { initial: state, memory, raw: memory.getItem(SAVE_KEY), repo: new LocalSaveRepository(memory) };
};
const finish = (repo, pending, options = {}) => repo.finishOffline(pending, { yieldControl: async () => {}, ...options });
const rejection = (result, initial, memory, raw, status = 'offline-save-failed') => {
  assert.equal(result.status, status); assert.equal(result.offline?.accepted, false);
  assert.deepEqual(result.state, initial); assert.equal(memory.getItem(SAVE_KEY), raw);
};
const boundaries = [[0, 0], [29.9, 23.92], [30, 24], [30.1, 24.08], [1799.9, 1439.92], [1800, 1440], [1800.1, 1440.08], [7200, 5760], [7200.1, 5760.08]];

// A deterministic wall-clock stub forces every async slice to hit its time
// budget after one batch; this tests the scheduler without timing-flaky limits.
async function oneBatchPerYield(run) {
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now'); let time = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => (time += OFFLINE_SLICE_BUDGET_MS + 1) });
  try { return await run(); }
  finally { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; }
}

test('TC-3D-020 v3 is continuous 80% at every former threshold, with no gameplay duration cap', () => {
  assert.equal(OFFLINE_POLICY_VERSION, 3);
  for (const [wall, expected] of [...boundaries, [.01, .008], [86400, 69120], [8.64e12, 6.912e12]]) {
    near(core.offlineEffectiveSeconds(wall), expected, `${wall}s wall duration`);
    assert.equal(core.offlineWallSeconds(wall), wall);
  }
  for (const invalid of [-1, NaN, Infinity, -Infinity]) assert.equal(core.offlineEffectiveSeconds(invalid), 0);
  for (const threshold of [30, 1800, 7200]) for (let delta = -100; delta <= 100; delta++) {
    const wall = threshold + delta / 1000;
    assert.ok(core.offlineEffectiveSeconds(wall) > core.offlineEffectiveSeconds(wall - .001));
  }
  for (const policy of [1, 2]) for (const wall of [0, .01, 29.9, 30, 30.1, 1799.9, 1800, 1800.1, 7200, 7200.1, 86400]) {
    const expected = policy === 1 && wall < 30 ? 0 : Math.min(wall, 7200) / 2;
    near(core.offlineEffectiveSeconds(wall, policy), expected, `legacy v${policy}`);
  }
});

test('TC-3D-020 exact boundary settlements equal ordinary simulation at 80%, including fixed-step carry', () => {
  const initial = checkpoint(), original = structuredClone(initial);
  for (const [wall, expected] of boundaries) {
    const oracle = createEngine(initial); oracle.advance(wall * .8);
    const engine = createEngine(initial), result = engine.applyOffline(wall, `boundary-${wall}`);
    assert.equal(result.accepted, true); assert.equal(result.seconds, wall); assert.equal(result.awaySeconds, wall); assert.equal(result.policyVersion, 3);
    near(result.effectiveSeconds, expected); assert.deepEqual(business(engine.snapshot()), business(oracle.snapshot()), `${wall}s boundary`);
    assert.equal(result.amount, engine.state.wallet - initial.wallet);
    assert.equal(result.generatedAmount, engine.state.totalEarned - initial.totalEarned);
    assertValidMoney(engine.snapshot()); assert.deepEqual(engine.drainEvents(), [], 'offline ticks do not flood presentation events');
  }
  assert.deepEqual(initial, original, 'core never mutates the supplied archive');
});

test('TC-3D-020 a real 24-hour interval completes 69,120 seconds of ordinary simulation without a two-hour cap', () => {
  const initial = checkpoint(), offline = createEngine(initial), online = createEngine(initial);
  const job = offline.beginOffline(86400, 'full-day');
  assert.equal(job.accepted, true); assert.equal(job.totalSeconds, 69120); assert.equal(job.done, false);
  // Compare distinct intermediate partitions, then execute the long suffix once
  // per engine rather than re-simulating a full day for each partition.
  for (const count of [1, 31, 257, 4093]) {
    job.advance(count); online.advance(count * STEP_SECONDS);
    assert.deepEqual(business(offline.snapshot()), business(online.snapshot()));
    assert.equal(job.result().accepted, false, 'an incomplete candidate cannot be claimed');
  }
  // Use one whole-duration online reference for the final result: subtracting
  // large floating-point prefixes would introduce unrelated carry noise.
  const wholeOnline = createEngine(initial); wholeOnline.advance(69120); job.advance(Number.MAX_SAFE_INTEGER);
  assert.equal(job.done, true); assert.equal(job.completedSeconds, 69120); assert.equal(job.result().seconds, 86400);
  assert.deepEqual(business(offline.snapshot()), business(wholeOnline.snapshot()));
  near(offline.state.elapsed, initial.elapsed + 69120); assert.ok(offline.state.elapsed > initial.elapsed + 7200);
  assertValidMoney(offline.snapshot());
  const before = offline.snapshot(); job.advance(1); job.advance(Number.MAX_SAFE_INTEGER); assert.deepEqual(offline.snapshot(), before);
});

test('TC-3D-020 arbitrary job batches and randomized partitions preserve every simulated field', () => {
  const initial = checkpoint(), effective = 317.2192, wall = 396.524;
  for (const partition of ['single', 'one-step', 'random']) {
    const engine = createEngine(initial), job = engine.beginOffline(wall, `partition-${partition}`); let seed = 837;
    while (!job.done) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      job.advance(partition === 'single' ? Number.MAX_SAFE_INTEGER : partition === 'one-step' ? 1 : 1 + seed % 137);
    }
    assert.deepEqual(business(engine.snapshot()), business(advanced(initial, effective)), partition);
    assertValidMoney(engine.snapshot());
  }
  const engine = createEngine(initial), job = engine.beginOffline(10, 'invalid-batches'), before = engine.snapshot();
  for (const invalid of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) job.advance(invalid);
  assert.deepEqual(engine.snapshot(), before); assert.equal(job.completedSeconds, 0); assert.equal(job.done, false);
  job.advance(160); assert.equal(job.done, true);
});

test('TC-3D-020 short partitions and reloads conserve fractional time through claim-history eviction', () => {
  const initial = checkpoint(), engine = createEngine(initial);
  for (let i = 0; i < 300; i++) assert.equal(engine.applyOffline(.01, `fraction-${i}`).accepted, true);
  assert.deepEqual(business(engine.snapshot()), business(advanced(initial, 2.4)));
  const before = engine.snapshot(); assert.equal(engine.applyOffline(30, 'fraction-299').accepted, false); assert.deepEqual(engine.snapshot(), before);
  assert.equal(engine.state.offlineClaimIds.length, 256);
  const { memory, repo } = fixture(initial); let loaded = repo.load(100000);
  for (let i = 1; i <= 300; i++) loaded = new LocalSaveRepository(memory).load(100000 + i * 10);
  assert.deepEqual(business(loaded.state), business(advanced(initial, 2.4))); assert.equal(loaded.state.offlineClaimIds.length, 256);
  const raw = memory.getItem(SAVE_KEY);
  for (const now of [100010, 102999, 103000]) assert.deepEqual(new LocalSaveRepository(memory).load(now).state, loaded.state);
  assert.equal(memory.getItem(SAVE_KEY), raw, 'durable endpoint remains authoritative after old claim IDs expire');
});

test('TC-3D-020 saved v3 short intervals settle once, while zero and rollback loads are byte-preserving', () => {
  for (const [wall, effective] of [[0, 0], [.01, .008], [29.9, 23.92], [30, 24], [30.1, 24.08]]) {
    const { initial, memory, raw, repo } = fixture(); const now = 100000 + wall * 1000;
    const result = repo.load(now); assert.equal(result.status, 'loaded');
    assert.deepEqual(business(result.state), business(advanced(initial, effective)));
    const stored = memory.getItem(SAVE_KEY), envelope = JSON.parse(stored);
    assert.equal(envelope.savedAt, now); assert.equal(envelope.offlinePolicyVersion, 3);
    if (!wall) assert.equal(stored, raw);
    for (const at of [now - 1, now]) assert.deepEqual(new LocalSaveRepository(memory).load(at).state, result.state);
    assert.equal(memory.getItem(SAVE_KEY), stored);
  }
});

test('TC-3D-020 in-flight production retains full prices and frozen recipe/duration snapshots', () => {
  const initial = checkpoint(), engine = createEngine(initial), brew = structuredClone(initial.counters[0].brew);
  assert.equal(brew.recipe, 'espresso'); assert.equal(initial.counters[0].recipe, 'latte'); assert.equal(brew.price, 123);
  engine.applyOffline(.5, 'brew-prefix');
  const current = engine.state.counters[0].brew;
  for (const key of ['recipe', 'price', 'duration', 'customerId']) assert.equal(current[key], brew[key]);
  near(current.elapsed, brew.elapsed + .4); assert.equal(engine.state.wallet, initial.wallet);
  engine.applyOffline(2.5, 'brew-payment');
  assert.deepEqual(business(engine.snapshot()), business(advanced(initial, 2.4)));
  assert.equal(engine.state.totalEarned - initial.totalEarned, 123, 'the completed cup pays its entire frozen price, not 80% of its price');
  assertValidMoney(engine.snapshot());
});

test('TC-3D-020 manager collection only moves existing cash; it is not reported as newly generated income', () => {
  const initial = createInitialState(); initial.counters[0].pendingCash = 600; initial.counters[1].pendingCash = 600; initial.totalEarned = 1200;
  const engine = createEngine(initial), job = engine.beginOffline(11.25, 'old-cash-only');
  const stops = []; let lastPhase = initial.manager.phase, deposited = false;
  while (!job.done) {
    job.advance(1); const state = engine.state;
    assert.equal(state.totalEarned, initial.totalEarned, 'no customer has paid yet');
    assertValidMoney(engine.snapshot());
    if (state.manager.phase !== lastPhase && state.manager.phase !== 'moving') stops.push([state.manager.target, state.manager.phase]);
    lastPhase = state.manager.phase;
    if (state.wallet > initial.wallet) deposited = true;
    if (!deposited) assert.equal(state.wallet, initial.wallet, 'carried and counter cash is not spendable');
  }
  assert.deepEqual(stops.slice(0, 3), [[1, 'collecting'], [0, 'collecting'], [2, 'depositing']]);
  assert.equal(job.result().amount, 1200); assert.equal(job.result().generatedAmount, 0);
  assert.equal(job.result().pendingCash, 0); assert.equal(job.result().carrying, 0);
  assert.equal(engine.state.wallet, INITIAL_WALLET + 1200);
});

test('TC-3D-020 every legacy anchor uses its own policy once, then all subsequent short gaps use v3', () => {
  for (const version of ['unmarked', 1, 2]) for (const wall of [0, 29.9, 30, 30.1, 7200.1, 86400]) {
    const { initial, memory, repo } = fixture(checkpoint(), version); const now = 100000 + wall * 1000;
    const expected = version !== 2 && wall < 30 ? 0 : Math.min(wall, 7200) / 2;
    const first = repo.load(now); assert.equal(first.status, 'loaded');
    assert.deepEqual(business(first.state), business(advanced(initial, expected)), `${version}: ${wall}s`);
    const migrated = memory.getItem(SAVE_KEY), envelope = JSON.parse(migrated);
    assert.equal(envelope.offlinePolicyVersion, 3); assert.equal(envelope.savedAt, now);
    assert.deepEqual(new LocalSaveRepository(memory).load(now).state, first.state); assert.equal(memory.getItem(SAVE_KEY), migrated);
    const next = new LocalSaveRepository(memory).load(now + 29900);
    assert.deepEqual(business(next.state), business(advanced(first.state, 23.92)), 'subsequent short gap uses 80%');
    assert.equal(next.offline.policyVersion, 3); assertValidMoney(next.state);
  }
});

test('TC-3D-020 zero, short, paused and rollback migrations never stamp policy or anchors before a successful write', () => {
  for (const version of ['unmarked', 1, 2]) for (const now of [90000, 100000, 129900]) for (const paused of [false, true]) {
    const initial = checkpoint(); initial.paused = paused;
    const { memory, raw } = fixture(initial, version); let deny = true;
    const storage = { ...memory, setItem(key, value) { if (deny) throw Error('quota'); memory.setItem(key, value); } };
    const repo = new LocalSaveRepository(storage), failed = repo.load(now);
    rejection(failed, initial, memory, raw); assert.equal(JSON.parse(raw).offlinePolicyVersion, version === 'unmarked' ? undefined : version);
    assert.equal(repo.save(initial, now).ok, false, 'failed transaction requires a successful reload');
    deny = false; const recovered = repo.load(now), expected = paused || version !== 2 || now <= 100000 ? 0 : 14.95;
    assert.equal(recovered.status, 'loaded'); assert.deepEqual(business(recovered.state), business(advanced(initial, expected)));
    const migrated = JSON.parse(memory.getItem(SAVE_KEY)); assert.equal(migrated.offlinePolicyVersion, 3); assert.equal(migrated.savedAt, Math.max(now, 100000));
    assert.deepEqual(new LocalSaveRepository(memory).load(now).state, recovered.state);
  }
});

test('TC-3D-020 unsupported versions fail closed; future-time migration never moves the anchor backwards', () => {
  for (const version of [0, -1, 1.5, '3', null, 4]) {
    const { memory, raw, repo } = fixture(checkpoint(), version), result = repo.load(140000);
    assert.equal(result.status, version === 4 ? 'future' : 'corrupt'); assert.equal(result.protectedRaw, true);
    assert.equal(repo.save(createInitialState(), 140000).ok, false); assert.equal(memory.getItem(SAVE_KEY), raw);
  }
  for (const version of ['unmarked', 1, 2, 3]) {
    const { initial, memory, raw, repo } = fixture(checkpoint(), version, 140000), result = repo.load(100000);
    assert.deepEqual(result.state, initial); assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 140000);
    assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).offlinePolicyVersion, 3);
    if (version === 3) assert.equal(memory.getItem(SAVE_KEY), raw);
    assert.equal(repo.save(result.state, 110000).ok, true);
    assert.deepEqual(new LocalSaveRepository(memory).load(139999).state, initial);
    assert.deepEqual(business(new LocalSaveRepository(memory).load(140010).state), business(advanced(initial, .008)));
  }
});

test('TC-3D-020 paused v3 archives preserve all business state and consume each real interval once', () => {
  const initial = checkpoint(); initial.paused = true;
  const { memory, repo } = fixture(initial), loaded = repo.load(86400100000, { deferOffline: true });
  assert.equal(loaded.status, 'loaded'); assert.equal(loaded.offline.accepted, true); assert.equal(loaded.offline.effectiveSeconds, 0);
  assert.equal(loaded.offline.amount, 0); assert.equal(loaded.offline.generatedAmount, 0);
  assert.deepEqual(business(loaded.state), business(initial)); assertValidMoney(loaded.state);
  const raw = memory.getItem(SAVE_KEY); assert.deepEqual(repo.load(86400100000).state, loaded.state); assert.equal(memory.getItem(SAVE_KEY), raw);
});

test('TC-3D-020 numeric-limit refusal never truncates a gap, consumes its endpoint, or modifies the original bytes', () => {
  const initial = checkpoint(); initial.elapsed = MAX_ELAPSED_SECONDS;
  const { memory, raw, repo } = fixture(initial), result = repo.load(100100, { deferOffline: true });
  rejection(result, initial, memory, raw); assert.equal(result.pending, undefined);
  const engine = createEngine(initial), before = engine.snapshot();
  for (const seconds of [.1, 8.64e12, -1, NaN, Infinity]) {
    const job = engine.beginOffline(seconds, `unsafe-${seconds}`); assert.equal(job.accepted, false); assert.equal(job.done, true); job.advance(1000); assert.equal(job.result().accepted, false);
    assert.deepEqual(engine.snapshot(), before);
  }
  assert.equal(repo.load(100000).status, 'loaded', 'a valid zero-gap read can recover without altering the archive');
  assert.equal(memory.getItem(SAVE_KEY), raw);
});

test('TC-3D-020 integer-money overflow refuses the whole candidate in synchronous and asynchronous settlement', async () => {
  const initial = createInitialState(); initial.wallet = 1e12; initial.totalEarned = 1e12 - INITIAL_WALLET + 1;
  initial.manager = { ...initial.manager, carrying: 1, phase: 'depositing', target: 2, x: WORLD.vaultX, timer: .55 };
  assertValidMoney(initial);
  for (const deferOffline of [false, true]) {
    const { memory, raw, repo } = fixture(initial); let result = repo.load(100100, { deferOffline });
    if (deferOffline) { assert.equal(result.status, 'settling'); result = await finish(repo, result.pending); }
    rejection(result, initial, memory, raw); assert.equal(repo.save(initial, 100100).ok, false);
    assert.equal(new LocalSaveRepository(memory).load(100000).status, 'loaded');
  }
});

test('TC-3D-020 deferred settlement yields bounded batches, exposes read-only progress, then commits exactly once', async () => {
  await oneBatchPerYield(async () => {
    const { initial, memory, raw, repo } = fixture(); const source = structuredClone(initial), now = 110000;
    const loaded = repo.load(now, { deferOffline: true }); assert.equal(loaded.status, 'settling'); assert.deepEqual(loaded.state, initial); assert.equal(memory.getItem(SAVE_KEY), raw);
    assert.equal(loaded.pending.endpoint, now); assert.equal(repo.save(initial, now).status, 'settling'); assert.equal(repo.reset().status, 'settling');
    loaded.state.wallet = 0; loaded.state.counters[0].recipe = 'espresso'; // Public return values cannot mutate the candidate.
    const progress = []; let yields = 0, writes = 0; const originalSet = memory.setItem;
    memory.setItem = (key, value) => { writes++; originalSet(key, value); };
    const result = await finish(repo, loaded.pending, {
      yieldControl: async () => { yields++; assert.equal(memory.getItem(SAVE_KEY), raw); assert.deepEqual(initial, source); },
      onProgress: point => { progress.push({ ...point }); assert.equal(memory.getItem(SAVE_KEY), raw); }
    });
    assert.equal(result.status, 'loaded'); assert.equal(writes, 1); assert.equal(yields, 5, '8s / (32 × .05s) needs five bounded batches');
    assert.equal(OFFLINE_STEP_BATCH, 32); assert.equal(OFFLINE_SLICE_BUDGET_MS, 8);
    assert.equal(progress[0].fraction, 0); assert.equal(progress.at(-1).fraction, 1);
    for (let i = 1; i < progress.length; i++) { assert.ok(progress[i].fraction > progress[i - 1].fraction); assert.ok(progress[i].completedSeconds - progress[i - 1].completedSeconds <= 1.6 + 1e-9); }
    assert.deepEqual(business(result.state), business(advanced(initial, 8))); assertValidMoney(result.state);
    const committed = memory.getItem(SAVE_KEY); assert.equal(JSON.parse(committed).savedAt, now);
    const duplicate = await finish(repo, loaded.pending); assert.equal(duplicate.offline.accepted, false); assert.equal(memory.getItem(SAVE_KEY), committed); assert.equal(writes, 1);
    assert.deepEqual(repo.load(now).state, result.state);
  });
});

test('TC-3D-020 cancellation and thrown callbacks retain the complete unpaid interval and permit clean retry', async () => {
  for (const mode of ['already-aborted', 'progress-abort', 'progress-cancel', 'progress-throw', 'yield-throw']) {
    await oneBatchPerYield(async () => {
      const { initial, memory, raw, repo } = fixture(), controller = new AbortController(), loaded = repo.load(130000, { deferOffline: true });
      assert.equal(loaded.status, 'settling'); if (mode === 'already-aborted') controller.abort();
      const result = await finish(repo, loaded.pending, {
        signal: controller.signal,
        onProgress: progress => {
          if (progress.completedSeconds > 0 && mode === 'progress-abort') controller.abort();
          if (progress.completedSeconds > 0 && mode === 'progress-cancel') repo.cancelOffline(loaded.pending);
          if (progress.completedSeconds > 0 && mode === 'progress-throw') throw Error('observer failed');
        },
        yieldControl: async () => { assert.equal(memory.getItem(SAVE_KEY), raw); if (mode === 'yield-throw') throw Error('scheduler failed'); }
      });
      rejection(result, initial, memory, raw);
      const retry = repo.load(130000, { deferOffline: true }); assert.equal(retry.status, 'settling');
      const settled = await finish(repo, retry.pending); assert.deepEqual(business(settled.state), business(advanced(initial, 24)));
      const committed = memory.getItem(SAVE_KEY); assert.deepEqual(repo.load(130000).state, settled.state); assert.equal(memory.getItem(SAVE_KEY), committed);
    });
  }
});

test('TC-3D-020 aborting or throwing from the final progress callback still prevents the commit', async () => {
  for (const mode of ['abort', 'throw', 'cancel']) {
    const { initial, memory, raw, repo } = fixture(), controller = new AbortController(), loaded = repo.load(100100, { deferOffline: true });
    const result = await finish(repo, loaded.pending, { signal: controller.signal, onProgress: progress => {
      if (progress.fraction !== 1) return;
      if (mode === 'abort') controller.abort(); else if (mode === 'cancel') repo.cancelOffline(loaded.pending); else throw Error('final progress failed');
    } });
    rejection(result, initial, memory, raw);
  }
});

test('TC-3D-020 interrupted legacy async migration never exposes v3 before successful settlement', async () => {
  for (const version of ['unmarked', 1, 2]) {
    const { initial, memory, raw, repo } = fixture(checkpoint(), version), loaded = repo.load(130000, { deferOffline: true });
    assert.equal(loaded.status, 'settling'); assert.equal(memory.getItem(SAVE_KEY), raw);
    const failed = await finish(repo, loaded.pending, { yieldControl: async () => { throw Error('interrupted'); } });
    rejection(failed, initial, memory, raw);
    const retry = repo.load(130000, { deferOffline: true }), done = await finish(repo, retry.pending);
    assert.deepEqual(business(done.state), business(advanced(initial, 15))); assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).offlinePolicyVersion, 3);
    const next = repo.load(159900); assert.deepEqual(business(next.state), business(advanced(done.state, 23.92)));
  }
});

test('TC-3D-020 late work cannot overwrite a newer load, settlement, explicit reset, or another writer', async () => {
  for (const mode of ['newer-load', 'newer-settlement', 'reset', 'other-writer']) {
    const { initial, memory, repo } = fixture(), old = repo.load(130000, { deferOffline: true }); let winningRaw, winningState, replaced = false;
    const result = await finish(repo, old.pending, { yieldControl: async () => {
      if (replaced) return; replaced = true;
      if (mode === 'newer-load') winningState = repo.load(100000).state;
      if (mode === 'newer-settlement') winningState = repo.load(140000).state;
      if (mode === 'reset') {
        repo.cancelOffline(old.pending); assert.equal(repo.reset({ confirmProtected: true }).ok, true);
        winningState = createInitialState(); assert.equal(repo.save(winningState, 150000).ok, true);
      }
      if (mode === 'other-writer') {
        const writer = new LocalSaveRepository(memory); winningState = writer.load(100000).state;
        assert.equal(writer.save(winningState, 140000).ok, true);
      }
      winningRaw = memory.getItem(SAVE_KEY);
    } });
    rejection(result, initial, memory, winningRaw, mode === 'other-writer' ? 'conflict' : 'offline-save-failed');
    assert.deepEqual(new LocalSaveRepository(memory).load(JSON.parse(winningRaw).savedAt).state, winningState);
    assert.equal(memory.getItem(SAVE_KEY), winningRaw);
    if (mode !== 'other-writer') assert.equal(repo.save(winningState, JSON.parse(winningRaw).savedAt).ok, true, 'stale failure must not poison the newer repository generation');
  }
});

test('TC-3D-020 overlapping finish calls cannot commit twice or cancel the active owner', async () => {
  const { initial, memory, raw, repo } = fixture(), loaded = repo.load(130000, { deferOffline: true });
  let release; const gate = new Promise(resolve => { release = resolve; }); let yields = 0;
  const first = finish(repo, loaded.pending, { yieldControl: async () => { if (++yields === 1) await gate; } });
  const second = await finish(repo, loaded.pending); rejection(second, initial, memory, raw);
  release(); const done = await first; assert.equal(done.status, 'loaded'); assert.deepEqual(business(done.state), business(advanced(initial, 24)));
  const committed = memory.getItem(SAVE_KEY); assert.deepEqual(repo.load(130000).state, done.state); assert.equal(memory.getItem(SAVE_KEY), committed);
});

test('TC-3D-020 final write failure and compare-before-write races preserve source bytes and full unpaid time', async () => {
  for (const mode of ['write-failure', 'commit-CAS']) {
    const { initial, memory, raw } = fixture(); const winning = rawEnvelope(initial, 140000, 3, 'winner'); let fail = false;
    const storage = { ...memory, getItem(key) { if (fail && mode === 'commit-CAS') { fail = false; memory.setItem(SAVE_KEY, winning); } return memory.getItem(key); }, setItem(key, value) { if (fail && mode === 'write-failure') throw Error('quota'); memory.setItem(key, value); } };
    const repo = new LocalSaveRepository(storage), loaded = repo.load(130000, { deferOffline: true });
    const result = await finish(repo, loaded.pending, { onProgress: progress => { if (progress.fraction === 1) fail = true; } });
    rejection(result, initial, memory, mode === 'write-failure' ? raw : winning, mode === 'write-failure' ? 'offline-save-failed' : 'conflict');
    fail = false; const retry = repo.load(130000, { deferOffline: true });
    const done = retry.pending ? await finish(repo, retry.pending) : retry;
    assert.deepEqual(business(done.state), business(advanced(initial, mode === 'write-failure' ? 24 : 0)));
  }
});

test('TC-3D-020 zero and short legacy migration CAS conflicts cannot stamp the losing candidate', () => {
  for (const version of ['unmarked', 1, 2]) for (const now of [90000, 100000, 129900]) {
    const { initial, memory, raw } = fixture(checkpoint(), version), winning = rawEnvelope(initial, 140000, version, 'concurrent-anchor'); let reads = 0;
    const storage = { ...memory, getItem(key) { if (++reads === 2) memory.setItem(SAVE_KEY, winning); return memory.getItem(key); } };
    const result = new LocalSaveRepository(storage).load(now); rejection(result, initial, memory, winning, 'conflict'); assert.notEqual(raw, winning);
    const recovered = new LocalSaveRepository(memory).load(now); assert.deepEqual(recovered.state, initial);
    const envelope = JSON.parse(memory.getItem(SAVE_KEY)); assert.equal(envelope.offlinePolicyVersion, 3); assert.equal(envelope.savedAt, 140000);
  }
});

test('TC-3D-020 live hidden settlement respects later durable anchors, cancellation and concurrent writers', async () => {
  const initial = checkpoint(), memory = createMemoryStorage(), repo = new LocalSaveRepository(memory); assert.equal(repo.save(initial, 140000).ok, true);
  const unchanged = repo.settleOffline(initial, 100000, 130000); assert.deepEqual(unchanged.state, initial); assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 140000);
  const pending = repo.settleOffline(initial, 130000, 140100, { deferOffline: true }); assert.equal(pending.status, 'settling');
  const done = await finish(repo, pending.pending); assert.deepEqual(business(done.state), business(advanced(initial, .08)));
  const raw = memory.getItem(SAVE_KEY), source = structuredClone(done.state), again = repo.settleOffline(source, 140100, 170000, { deferOffline: true });
  source.wallet = 0; repo.cancelOffline(again.pending);
  const cancelled = await finish(repo, again.pending); rejection(cancelled, done.state, memory, raw);
  const recovered = repo.load(140100), loser = repo.settleOffline(recovered.state, 140100, 170000, { deferOffline: true });
  const writer = new LocalSaveRepository(memory), winning = writer.load(140100); assert.equal(writer.save(winning.state, 150000).ok, true);
  const winningRaw = memory.getItem(SAVE_KEY), conflict = await finish(repo, loser.pending); rejection(conflict, recovered.state, memory, winningRaw, 'conflict');
});

test('TC-3D-020 maximum storage tags and rejected duplicate claims never discard an unpaid endpoint', () => {
  const initial = checkpoint(), memory = createMemoryStorage(); memory.setItem(SAVE_KEY, rawEnvelope(initial, 100000, 3, 'x'.repeat(256)));
  const loaded = new LocalSaveRepository(memory).load(130000); assert.equal(loaded.offline.accepted, true); assert.ok(loaded.state.lastOfflineClaimId.length <= 256);
  assert.deepEqual(business(loaded.state), business(advanced(initial, 24)));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'collision' } });
  try {
    initial.lastOfflineClaimId = 'local:collision'; initial.offlineClaimIds = ['local:collision'];
    memory.setItem(SAVE_KEY, rawEnvelope(initial)); const raw = memory.getItem(SAVE_KEY);
    rejection(new LocalSaveRepository(memory).load(129900), initial, memory, raw);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
});


test('TC-3D-020 exact live sources may retry zero, sub-step and paused write failures without authorizing other saves', () => {
  for (const deltaMs of [0, 1, 10]) for (const paused of [false, true]) {
    const { initial, memory, raw } = fixture(); let deny = false;
    const storage = { ...memory, setItem(key, value) { if (deny) throw Error('quota'); memory.setItem(key, value); } };
    const repo = new LocalSaveRepository(storage); assert.equal(repo.load(100000).status, 'loaded');
    const live = advanced(initial, 5); live.paused = paused; const original = structuredClone(live);
    deny = true; const result = repo.settleOffline(live, 105000, 105000 + deltaMs, { deferOffline: true });
    rejection(result, original, memory, raw);
    deny = false; assert.equal(repo.save(live, 105000 + deltaMs).ok, false);
    const altered = structuredClone(live); altered.counters[0].recipe = 'espresso';
    assert.equal(repo.settleOffline(altered, 105000, 105000 + deltaMs).offline.accepted, false);
    assert.equal(repo.settleOffline(live, 104999, 105000 + deltaMs).offline.accepted, false);
    assert.equal(memory.getItem(SAVE_KEY), raw);
    const retry = repo.settleOffline(live, 105000, 105000 + deltaMs, { deferOffline: true });
    assert.equal(retry.status, 'loaded');
    assert.deepEqual(business(retry.state), business(advanced(original, deltaMs / 1000 * .8)));
    assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 105000 + deltaMs);
    assert.deepEqual(live, original); assertValidMoney(retry.state);
  }
});

test('TC-3D-020 cancellation of a 10ms live gap preserves its source and fractional carry for exact retry', async () => {
  const { initial, memory, repo } = fixture(); assert.equal(repo.load(100000).status, 'loaded');
  const live = advanced(initial, 5); live.stepCarry = .049; const original = structuredClone(live), raw = memory.getItem(SAVE_KEY);
  const pending = repo.settleOffline(live, 105000, 105010, { deferOffline: true }); assert.equal(pending.status, 'settling');
  repo.cancelOffline(pending.pending); rejection(await finish(repo, pending.pending), original, memory, raw);
  const altered = structuredClone(live); altered.stepCarry = .048;
  assert.equal(repo.settleOffline(altered, 105000, 105010).offline.accepted, false);
  const retry = repo.settleOffline(live, 105000, 105010, { deferOffline: true }); assert.equal(retry.status, 'settling');
  const done = await finish(repo, retry.pending);
  assert.deepEqual(business(done.state), business(advanced(original, .008))); near(done.state.stepCarry, .007);
  near(done.state.elapsed, original.elapsed + .05); assert.deepEqual(live, original);
  assert.equal(JSON.parse(memory.getItem(SAVE_KEY)).savedAt, 105010);
});

test('TC-3D-020 live CAS conflict stays latched even if another actor later restores the old bytes', async () => {
  const { initial, memory, raw, repo } = fixture(); assert.equal(repo.load(100000).status, 'loaded');
  const live = advanced(initial, 5), pending = repo.settleOffline(live, 105000, 135000, { deferOffline: true });
  const winner = rawEnvelope(initial, 140000, 3, 'new-authority'); memory.setItem(SAVE_KEY, winner);
  const result = await finish(repo, pending.pending); rejection(result, live, memory, winner, 'conflict');
  memory.setItem(SAVE_KEY, raw);
  const retry = repo.settleOffline(live, 105000, 135000, { deferOffline: true }); rejection(retry, live, memory, raw, 'conflict');
  assert.equal(retry.pending, undefined); assert.equal(repo.save(live, 135000).ok, false);
  assert.deepEqual(repo.load(100000).state, initial, 'only a fresh authoritative load clears the conflict');
});

test('TC-3D-020 generated live claim collisions and failed reads never grant exact-source retry authority', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'collision' } });
  try {
    const initial = checkpoint(); initial.lastOfflineClaimId = 'local:collision'; initial.offlineClaimIds = ['local:collision'];
    const { memory, raw, repo } = fixture(initial); assert.equal(repo.load(100000).status, 'loaded');
    const result = repo.settleOffline(initial, 100000, 100010); rejection(result, initial, memory, raw);
    assert.equal(repo.settleOffline(initial, 100000, 100010).offline.accepted, false); assert.equal(repo.save(initial, 100010).ok, false);
    assert.equal(memory.getItem(SAVE_KEY), raw);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
  const { initial, memory, raw } = fixture(); let deny = false;
  const repo = new LocalSaveRepository({ ...memory, getItem(key) { if (deny) throw Error('read unavailable'); return memory.getItem(key); } });
  assert.equal(repo.load(100000).status, 'loaded'); deny = true; assert.equal(repo.load(100010).status, 'unavailable'); deny = false;
  assert.equal(repo.save(initial, 100010).ok, false);
  const retry = repo.settleOffline(initial, 100000, 100010); assert.equal(retry.status, 'unavailable'); assert.equal(retry.offline.accepted, false);
  assert.equal(memory.getItem(SAVE_KEY), raw);
});
