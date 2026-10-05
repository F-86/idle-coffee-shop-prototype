import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
// Read-only compatibility check against actual released pre-coffee and pre-stock
// writers. Git objects are read locally; all isolated old modules live in /tmp.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const current = await import(pathToFileURL(`${cwd}/src/slice/core/engine.ts`));
const save = await import(pathToFileURL(`${cwd}/src/slice/core/persistence.ts`));
const portable = await import(pathToFileURL(`${cwd}/src/slice/core/portableSave.ts`));
const engine = current.createEngine(); engine.advance(240);
assert.equal(engine.upgradeCoffee('espresso'), true); assert.equal(engine.upgradeCoffee('latte'), true);
assert.equal(engine.buyIngredient('beans', 'batch'), true); assert.equal(engine.buyIngredient('milk', 'batch'), true);
engine.advance(16.137);
const upgraded = engine.snapshot();
const file = await portable.createPortableSave({ gameSchemaVersion: 1, economyVersion: current.ECONOMY_VERSION, offlinePolicyVersion: save.OFFLINE_POLICY_VERSION, savedAt: 100000, exportedAt: 100000, saveId: 'compat-check', revision: 1, state: upgraded, overview: portable.overviewOf(upgraded) });
const currentStorage = save.createMemoryStorage(), currentRepository = new save.LocalSaveRepository(currentStorage);
assert.equal(currentRepository.save(upgraded, 100000).ok, true);
const currentRaw = currentStorage.getItem(save.SAVE_KEY);
const results = [];
for (const revision of ['c6f7b95', 'f9f823e', 'b6fb418']) {
  const directory = mkdtempSync(join(tmpdir(), `coffee-legacy-${revision}-`)), copied = new Set();
  function copyModule(name) {
    if (copied.has(name)) return;
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/); copied.add(name);
    const source = execFileSync('git', ['show', `${revision}:src/slice/core/${name}.ts`], { cwd, encoding: 'utf8' });
    writeFileSync(`${directory}/${name}.ts`, source);
    // Include exact-revision runtime and type dependencies, including the layout
    // simulation introduced after the two original economy1 releases.
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)['"]/g)) copyModule(match[1].replace(/\.ts$/, ''));
  }
  for (const name of ['engine', 'persistence', 'portableSave']) copyModule(name);
  const old = await import(pathToFileURL(`${directory}/engine.ts`));
  const oldSave = await import(pathToFileURL(`${directory}/persistence.ts`));
  const oldPortable = await import(pathToFileURL(`${directory}/portableSave.ts`));
  assert.equal(oldSave.validateState(upgraded).ok, false);
  const storage = oldSave.createMemoryStorage(); storage.setItem(oldSave.SAVE_KEY, currentRaw);
  const repository = new oldSave.LocalSaveRepository(storage), loaded = repository.load(100000);
  assert.equal(loaded.status, 'future'); assert.equal(loaded.protectedRaw, true);
  assert.equal(repository.save(loaded.state, 100000).ok, false); assert.equal(storage.getItem(oldSave.SAVE_KEY), currentRaw);
  assert.equal((await oldPortable.parsePortableSave(file.text)).ok, false);

  // Produce a real old save, with real paid upgrades and unfinished customers.
  const oldEngine = old.createEngine();
  assert.equal(oldEngine.upgrade('counter-a'), true);
  if (typeof oldEngine.upgradeCoffee === 'function') {
    oldEngine.advance(240);
    assert.equal(oldEngine.upgradeCoffee('espresso'), true); assert.equal(oldEngine.upgradeCoffee('latte'), true);
  }
  oldEngine.advance(16.137);
  for (let tick = 0; tick < 400 && !oldEngine.state.counters.some(counter => counter.brew); tick++) oldEngine.advance(.05);
  assert.ok(oldEngine.state.counters.some(counter => counter.brew), 'old writer must exercise an in-flight snapshot');
  oldEngine.setRecipe('counter-a', 'latte');
  const oldState = oldEngine.snapshot(), sourceCopy = structuredClone(oldState);
  assert.equal(Object.hasOwn(oldState, 'ingredients'), false);
  const oldFile = await oldPortable.createPortableSave({ gameSchemaVersion: 1, economyVersion: oldState.economyVersion, offlinePolicyVersion: oldSave.OFFLINE_POLICY_VERSION, savedAt: 100000, exportedAt: 100000, saveId: 'old-compat', revision: 1, state: oldState, overview: oldPortable.overviewOf(oldState) });
  const migrated = await portable.parsePortableSave(oldFile.text); assert.equal(migrated.ok, true, migrated.message);
  const restored = migrated.file.payload.state;
  const receipts = oldState.manager.carrying + oldState.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
  if (oldState.economyVersion < 4) assert.ok(receipts > 0, 'old cash transfer must be exercised');
  assert.equal(migrated.file.payload.economyVersion, current.ECONOMY_VERSION);
  assert.equal(migrated.file.payload.offlinePolicyVersion, save.OFFLINE_POLICY_VERSION);
  assert.deepEqual(restored.coffeeLevels, oldState.coffeeLevels ?? { espresso: 1, latte: 1 });
  assert.deepEqual(restored.counters, oldState.counters.map(counter => ({ ...counter, pendingCash: 0 })));
  assert.deepEqual(restored.customers, oldState.customers);
  assert.equal(restored.wallet, oldState.wallet + receipts); assert.equal(restored.totalEarned, oldState.totalEarned);
  assert.equal(restored.spend, oldState.spend); assert.equal(restored.manager.level, oldState.manager.level); assert.equal(restored.manager.carrying, 0);
  assert.deepEqual(restored.ingredients, { beans: 40, milk: 20 });
  assert.equal(restored.elapsed, oldState.elapsed); assert.equal(restored.stepCarry, oldState.stepCarry);
  assert.equal(migrated.file.fingerprint, oldFile.fingerprint); assert.equal(migrated.file.text, oldFile.text);
  assert.equal(save.validateState(restored).ok, true); assert.deepEqual(save.validateState(restored).state, restored);
  assert.deepEqual(current.createEngine(restored).snapshot(), restored);
  assert.deepEqual(oldState, sourceCopy, 'reading never mutates the old source');

  // Also let the actual old local writer persist its own snapshot, then migrate
  // it at a zero-length gap. The durable second read cannot repay or refill.
  const oldStorage = oldSave.createMemoryStorage(), oldWriter = new oldSave.LocalSaveRepository(oldStorage);
  assert.equal(oldWriter.save(oldState, 100000).ok, true);
  const newReader = new save.LocalSaveRepository(oldStorage), local = newReader.load(100000);
  assert.equal(local.status, 'loaded'); assert.deepEqual(local.state, restored);
  const durable = oldStorage.getItem(save.SAVE_KEY), envelope = JSON.parse(durable);
  assert.equal(envelope.offlinePolicyVersion, save.OFFLINE_POLICY_VERSION);
  assert.equal(envelope.state.economyVersion, current.ECONOMY_VERSION);
  assert.deepEqual(new save.LocalSaveRepository(oldStorage).load(100000).state, restored);
  assert.equal(oldStorage.getItem(save.SAVE_KEY), durable);
  const depleted = current.createEngine(restored); depleted.advance(30);
  assert.ok(depleted.state.ingredients.beans < 40, 'subsequent current production consumes migrated inventory');
  assert.equal(newReader.save(depleted.snapshot(), 130000).ok, true);
  assert.deepEqual(new save.LocalSaveRepository(oldStorage).load(130000).state, depleted.snapshot(), 'ordinary reload neither replenishes stock nor repeats old cash transfer');
  results.push({ revision: execFileSync('git', ['rev-parse', revision], { cwd, encoding: 'utf8' }).trim(), copiedModules: [...copied].sort(), oldEconomyVersion: oldState.economyVersion, oldFormatVersion: oldPortable.PORTABLE_VERSION, oldValidatorRejectsNewEconomy: true, oldLocalLoadStatus: loaded.status, oldAutosaveBlockedRawUnchanged: true, oldPortableRejectsCurrentFormat: true, actualOldWritersMigrateInNewRuntime: true, inFlightLevelsAndFingerprintPreserved: true, oldCashTransferredExactlyOnce: true, migratedStockGrantedExactlyOnce: true });
}
console.log(JSON.stringify({ node: process.version, checkedAt: new Date().toISOString(), newEconomyVersion: upgraded.economyVersion, newOfflinePolicyVersion: save.OFFLINE_POLICY_VERSION, newFormatVersion: JSON.parse(file.text).formatVersion, results }, null, 2));
