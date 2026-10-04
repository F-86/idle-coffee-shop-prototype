// Run from the mellow-bean checkout:
// node docs/testing/runs/2026-10-04-room-route-refinement/legacy-route-sweep.mjs 2363c12
// Reads the actual previous engine from Git; writes no repository or save files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

const baseline = process.argv[2] ?? '2363c12';
const baselineSha = execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim();
const oldText = execFileSync('git', ['show', `${baseline}:src/slice/core/engine.ts`], { encoding: 'utf8' });
const previous = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(oldText)).toString('base64')}`);
const { validateState } = await import(pathToFileURL(resolve('src/slice/core/persistence.ts')).href);
const { createEngine } = await import(pathToFileURL(resolve('src/slice/core/engine.ts')).href);
const engine = previous.createEngine();
let checkedCount = 0, freshDepartureNormalizations = 0;
const phases = new Map();

for (let tick = 0; tick < 10000; tick++) {
  if (tick % 113 === 0) engine.invite();
  if (tick % 157 === 0) engine.setRecipe('counter-a', tick % 2 ? 'espresso' : 'latte');
  if (tick % 211 === 0) engine.upgrade('counter-a');
  if (tick % 317 === 0) engine.upgradeManager();
  engine.advance(.05);
  const source = engine.snapshot(), unchanged = JSON.stringify(source);
  const phase = `${source.manager.target}:${source.manager.phase}`;
  phases.set(phase, (phases.get(phase) ?? 0) + 1);
  for (const version of [undefined, 1]) {
    const input = structuredClone(source);
    if (version === 1) input.managerRouteVersion = 1;
    const validated = validateState(input);
    assert.equal(validated.ok, true, `legacy live tick ${tick}, version ${version}`);
    const repeated = validateState(validated.state);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.state, validated.state, 'canonical validation is idempotent');
    assert.deepEqual(createEngine(validated.state).snapshot(), validated.state, 'canonical engine recreation is idempotent');
    assert.equal(JSON.stringify(source), unchanged, 'validation never mutates the source archive');
    const oldSafe = structuredClone(input), newSafe = structuredClone(validated.state), m = input.manager;
    if (m.phase === 'moving' && m.target === 0 && m.x === -8 && m.timer === 0 && m.carrying === 0) {
      assert.equal(newSafe.manager.target, 1);
      assert.equal(newSafe.manager.x, 8.8);
      assert.equal(newSafe.manager.finishLegacySweep, undefined);
      oldSafe.manager.target = 1;
      freshDepartureNormalizations++;
    }
    delete oldSafe.managerRouteVersion;
    delete newSafe.managerRouteVersion;
    delete oldSafe.manager.x;
    delete newSafe.manager.x;
    delete newSafe.manager.finishLegacySweep;
    assert.deepEqual(newSafe, oldSafe, 'authentic archive preserves all assets, timing, customer, brew and claims');
    checkedCount++;
  }
}

console.log(JSON.stringify({
  result: 'PASS',
  baseline: baselineSha,
  generatedSnapshots: 10000,
  legacyVariantsPerSnapshot: ['absent', 1],
  validatedLegacyStates: checkedCount,
  freshDepartureNormalizations,
  simulatedSeconds: engine.state.elapsed,
  phaseCounts: Object.fromEntries([...phases.entries()].sort()),
  boundaries: 'CPU core/persistence evidence only; no browser pixels, DOM, native dialogs or touch-device acceptance.'
}, null, 2));
