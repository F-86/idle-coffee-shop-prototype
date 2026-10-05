import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; } } });
// Read-only compatibility check against the last two published pre-coffee implementations.
// Requires these existing commits in the local git object database; writes fixtures only to the OS temp folder.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const current = await import(pathToFileURL(`${cwd}/src/slice/core/engine.ts`));
const save = await import(pathToFileURL(`${cwd}/src/slice/core/persistence.ts`));
const portable = await import(pathToFileURL(`${cwd}/src/slice/core/portableSave.ts`));
const engine = current.createEngine(); engine.advance(240); engine.upgradeCoffee('espresso'); engine.upgradeCoffee('latte');
const upgraded = engine.snapshot(), file = await portable.createPortableSave({ gameSchemaVersion: 1, economyVersion: 2, offlinePolicyVersion: 3, savedAt: 100000, exportedAt: 100000, saveId: 'compat-check', revision: 1, state: upgraded, overview: portable.overviewOf(upgraded) });
const results = [];
for (const revision of ['c6f7b95', 'f9f823e']) {
  const directory = mkdtempSync(join(tmpdir(), `coffee-legacy-${revision}-`));
  for (const name of ['engine', 'persistence', 'portableSave', 'types']) writeFileSync(`${directory}/${name}.ts`, execFileSync('git', ['show', `${revision}:src/slice/core/${name}.ts`], { cwd }));
  const old = await import(pathToFileURL(`${directory}/engine.ts`));
  const oldSave = await import(pathToFileURL(`${directory}/persistence.ts`));
  const oldPortable = await import(pathToFileURL(`${directory}/portableSave.ts`));
  assert.equal(oldSave.validateState(upgraded).ok, false);
  const storage = oldSave.createMemoryStorage(), raw = JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 3, savedAt: 100000, recordChangeTag: 'coffee-v2', state: upgraded });
  storage.setItem(oldSave.SAVE_KEY, raw); const repository = new oldSave.LocalSaveRepository(storage), loaded = repository.load(100000);
  assert.equal(loaded.status, 'future'); assert.equal(loaded.protectedRaw, true); assert.equal(repository.save(loaded.state, 100000).ok, false); assert.equal(storage.getItem(oldSave.SAVE_KEY), raw);
  const rejected = await oldPortable.parsePortableSave(file.text); assert.equal(rejected.ok, false);
  const oldEngine = old.createEngine(); oldEngine.advance(16.137); const oldState = oldEngine.snapshot();
  const oldFile = await oldPortable.createPortableSave({ gameSchemaVersion: 1, economyVersion: 1, offlinePolicyVersion: 3, savedAt: 100000, exportedAt: 100000, saveId: 'old-compat', revision: 1, state: oldState, overview: oldPortable.overviewOf(oldState) });
  const migrated = await portable.parsePortableSave(oldFile.text); assert.equal(migrated.ok, true);
  assert.equal(migrated.file.payload.economyVersion, 2); assert.deepEqual(migrated.file.payload.state.coffeeLevels, { espresso: 1, latte: 1 });
  assert.deepEqual(migrated.file.payload.state.counters, oldState.counters); assert.equal(migrated.file.fingerprint, oldFile.fingerprint); assert.equal(migrated.file.text, oldFile.text);
  assert.equal(save.validateState(migrated.file.payload.state).ok, true);
  results.push({ revision: execFileSync('git', ['rev-parse', revision], { cwd, encoding: 'utf8' }).trim(), oldValidatorRejectsNewEconomy: true, oldLocalLoadStatus: loaded.status, oldAutosaveBlockedRawUnchanged: true, oldPortableRejectsV2: true, actualOldWriterV1MigratesInNewRuntime: true, inFlightSnapshotsAndFingerprintPreserved: true });
}
console.log(JSON.stringify({ node: process.version, checkedAt: new Date().toISOString(), newEconomyVersion: upgraded.economyVersion, newFormatVersion: JSON.parse(file.text).formatVersion, results }, null, 2));
