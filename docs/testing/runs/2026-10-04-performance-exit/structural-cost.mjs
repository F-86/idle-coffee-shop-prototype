// Run from the repository root. Optional first argument is an extracted baseline tree.
// NullEngine proves allocation/transform structure only, never FPS, GPU load or temperature.
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw error; } } });
const directory = resolve(process.argv[2] ?? '.');
const { CoffeeScene } = await import(pathToFileURL(resolve(directory, 'src/slice/render/CoffeeScene.ts')));
const { createInitialState } = await import(pathToFileURL(resolve(directory, 'src/slice/core/engine.ts')));
const potentialCasters = new Set();
const shape = CoffeeScene.prototype.shape;
CoffeeScene.prototype.shape = function (...args) { const mesh = shape.apply(this, args); if (args[6] !== false) potentialCasters.add(mesh); return mesh; };
const engine = new NullEngine({ renderWidth: 1280, renderHeight: 900, textureSize: 512 });
const canvas = { addEventListener() {}, removeEventListener() {}, hasPointerCapture() { return false; }, getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 900 }; } };
const renderer = new CoffeeScene(canvas, () => {}, { engine, shadows: false });
const state = createInitialState();
for (let i = 0; i < 24; i++) state.customers.push({ id: i + 1, x: i % 2 * 5 + (i >= 16 ? 1.6 : 0), z: i >= 16 ? 2 + (i - 16) * .5 : 1.5 + Math.floor(i / 2) * .72, phase: i >= 16 ? 'leaving' : 'queue', counterId: i % 2 ? 'counter-b' : 'counter-a', timer: 0, hasCup: i >= 16, skin: i % 6 });
renderer.update(state, 0);
const casters = renderer.staticCasters ?? potentialCasters;
const result = {
  evidence: 'NullEngine structure, same synthetic 24-person snapshot; no GPU/thermal measurement',
  meshes: renderer.scene.meshes.length,
  geometries: renderer.scene.geometries.length,
  frozenMeshes: renderer.scene.meshes.filter(mesh => mesh.isWorldMatrixFrozen).length,
  configuredShadowCasterCandidates: [...casters].filter(mesh => !mesh.isDisposed()).length,
  movingCustomerShadowCasterCandidates: [...casters].filter(mesh => !mesh.isDisposed() && mesh.name.startsWith('customer-')).length,
};
renderer.dispose(); engine.dispose();
console.log(JSON.stringify(result, null, 2));
