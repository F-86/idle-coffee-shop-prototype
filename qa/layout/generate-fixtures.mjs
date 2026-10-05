import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { createEngine, createInitialState } = await import('../../src/slice/core/engine.ts');
const { addFurniture } = await import('../../src/slice/core/layout.ts');
const { createPortableSave, overviewOf } = await import('../../src/slice/core/portableSave.ts');
const { validateState } = await import('../../src/slice/core/persistence.ts');
const destination = process.argv[2];
if (!destination) throw Error('Usage: node qa/layout/generate-fixtures.mjs /absolute/temporary/output-directory');
const out = resolve(destination); await mkdir(out, { recursive: true });
const funded = createInitialState();
// Explicit synthetic earned history, solely for isolated QA: no hidden live-app cheat.
funded.wallet += 30000; funded.totalEarned = 30000;
funded.totalServed = 40; funded.counters[0].brewed = 40; funded.nextCustomerId = 41;
const scenarios = [['funded-before-renovation', funded]];
const engine = createEngine(funded); engine.beginLayoutEdit();
const draft = engine.createLayoutDraft();
if (!draft) throw Error('Initial QA shop did not enter safe renovation.');
draft.expanded = true;
addFurniture(draft, 'counter', 13, 0);
addFurniture(draft, 'counter', 13, 6);
addFurniture(draft, 'table', 0, 5);
addFurniture(draft, 'table', 3, 5);
const result = engine.commitLayout(draft);
if (!result.ok) throw Error(result.message);
scenarios.push(['expanded-four-counters', engine.snapshot()]);
engine.advance(180);
scenarios.push(['expanded-in-flight', engine.snapshot()]);
for (const [name, state] of scenarios) {
  const checked = validateState(state); if (!checked.ok) throw Error(`${name}: ${checked.message}`);
  const file = await createPortableSave({ saveId: `qa-layout-${name}`, revision: 1, gameSchemaVersion: 1, economyVersion: 3, offlinePolicyVersion: 3, savedAt: 0, exportedAt: 0, overview: overviewOf(state), state });
  const path = resolve(out, `mellow-bean-QA-${name}.json`); await writeFile(path, file.text); console.log(path);
}
