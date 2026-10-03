import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { CoffeeScene } = await import('../src/slice/render/CoffeeScene.ts');
const { createEngine, createInitialState } = await import('../src/slice/core/engine.ts');

// These are CPU-side scene/state/input checks, not browser or pixel-render acceptance.
class FakeCanvas {
  listeners = new Map();
  constructor(width, height) { this.width = width; this.height = height; }
  addEventListener(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  getBoundingClientRect() { return { left: 35, top: 80, width: this.width, height: this.height }; }
  emit(type, values = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, timeStamp: 100, ...values }); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture(width = 1100, height = 600, hardwareScale = 1) {
  const engine = new NullEngine({ renderWidth: width / hardwareScale, renderHeight: height / hardwareScale, textureSize: 512, deterministicLockstep: true, lockstepMaxSteps: 4 });
  engine.getHardwareScalingLevel = () => hardwareScale;
  const canvas = new FakeCanvas(width, height);
  const actions = [];
  const renderer = new CoffeeScene(canvas, action => actions.push(action), { engine, shadows: false });
  renderer.update(createInitialState(), .016);
  return { engine, canvas, renderer, actions, dispose() { renderer.dispose(); engine.dispose(); } };
}
function screenPoint(f, meshName, offset = Vector3.Zero()) {
  const mesh = f.renderer.scene.getMeshByName(meshName);
  assert.ok(mesh, meshName);
  mesh.computeWorldMatrix(true);
  const world = Vector3.TransformCoordinates(offset, mesh.getWorldMatrix());
  const point = Vector3.Project(world, Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight()));
  const scale = f.engine.getHardwareScalingLevel();
  return { clientX: point.x * scale + 35, clientY: point.y * scale + 80, x: point.x, y: point.y };
}
function tap(f, meshName) {
  const point = screenPoint(f, meshName);
  f.canvas.emit('pointerdown', { ...point, timeStamp: 100 });
  f.canvas.emit('pointerup', { ...point, timeStamp: 240 });
}
function pose(node) { return [...node.position.asArray(), ...node.rotation.asArray()]; }

test('TC-3D-006 original reusable geometry presents snapshots without changing business state', () => {
  const f = fixture();
  try {
    const scene = f.renderer.scene;
    const initialMeshes = scene.meshes.length;
    const initialGeometries = scene.geometries.length;
    assert.ok(initialMeshes > 350, 'complete diorama geometry exists');
    assert.ok(initialGeometries < 25, 'hundreds of parts reuse a few geometries');
    assert.equal(scene.activeCamera.name, 'fixed-isometric-camera');
    const engine = createEngine();
    for (let frame = 0; frame < 100; frame++) {
      engine.advance(.25);
      const before = JSON.stringify(engine.state);
      f.renderer.update(engine.state, .05);
      assert.equal(JSON.stringify(engine.state), before, 'rendering is read-only');
    }
    assert.ok(scene.meshes.some(mesh => mesh.name.startsWith('customer-')));
    assert.equal(scene.geometries.length, initialGeometries, 'new characters share existing unit geometry');
    const empty = engine.snapshot(); empty.customers = [];
    f.renderer.update(empty, .05);
    assert.equal(scene.meshes.length, initialMeshes, 'departed characters and contact shadows are removed');
    assert.equal(scene.geometries.length, initialGeometries);
  } finally { f.dispose(); }
});

test('TC-3D-006 physical invite, counter and menu taps dispatch the correct action', () => {
  const f = fixture();
  try {
    tap(f, 'invite-guest-sign');
    tap(f, 'counter-a-upgrade-plaque');
    tap(f, 'counter-b-upgrade-plaque');
    tap(f, 'counter-a-menu');
    tap(f, 'counter-b-menu');
    assert.deepEqual(f.actions, [
      { type: 'invite' }, { type: 'counter', id: 'counter-a' }, { type: 'counter', id: 'counter-b' },
      { type: 'menu', id: 'counter-a' }, { type: 'menu', id: 'counter-b' },
    ]);
    f.renderer.selectedCounter('counter-b');
    assert.equal(f.renderer.scene.getMeshByName('counter-a-selected').isEnabled(), false);
    assert.equal(f.renderer.scene.getMeshByName('counter-b-selected').isEnabled(), true);
    f.renderer.selectedCounter(null);
    assert.equal(f.renderer.scene.getMeshByName('counter-b-selected').isEnabled(), false);
  } finally { f.dispose(); }
});

test('TC-3D-006 panning, long holds, cancelled and secondary pointers cannot become taps', () => {
  const f = fixture();
  try {
    const point = screenPoint(f, 'invite-guest-sign');
    f.canvas.emit('pointerdown', { ...point, timeStamp: 0 });
    f.canvas.emit('pointermove', { ...point, clientX: point.clientX + 45, timeStamp: 60 });
    f.canvas.emit('pointermove', { ...point, timeStamp: 100 });
    f.canvas.emit('pointerup', { ...point, timeStamp: 150 });
    f.canvas.emit('pointerdown', { ...point, timeStamp: 200 });
    f.canvas.emit('pointerup', { ...point, timeStamp: 1100 });
    f.canvas.emit('pointerdown', { ...point, timeStamp: 1200 });
    f.canvas.emit('pointercancel', { ...point, timeStamp: 1250 });
    f.canvas.emit('pointerup', { ...point, timeStamp: 1300 });
    f.canvas.emit('pointerdown', { ...point, isPrimary: false, pointerId: 2, timeStamp: 1400 });
    f.canvas.emit('pointerup', { ...point, isPrimary: false, pointerId: 2, timeStamp: 1450 });
    assert.deepEqual(f.actions, []);
    tap(f, 'invite-guest-sign');
    assert.equal(f.actions.length, 1, 'ordinary tap still works after interrupted input');
  } finally { f.dispose(); }
});

test('TC-3D-001 cups, brew progress, table money, manager cart and machine upgrades are state-driven', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    state.counters[0].level = 2;
    state.counters[0].recipe = 'latte'; // Existing brew retains its original espresso appearance.
    state.counters[0].pendingCash = 950;
    state.counters[0].brew = { recipe: 'espresso', customerId: 10, elapsed: 2, duration: 4, price: 110 };
    state.customers = [{ id: 10, x: 0, z: 1.5, phase: 'serving', counterId: 'counter-a', timer: 0, hasCup: false, skin: 2 }];
    state.manager.carrying = 700;
    state.manager.x = 1;
    state.manager.phase = 'collecting';
    f.renderer.update(state, .05);
    const scene = f.renderer.scene;
    assert.equal(scene.getMeshByName('counter-a-progress').isEnabled(), true);
    assert.ok(Math.abs(scene.getMeshByName('counter-a-progress-fill').scaling.x - .99) < 1e-9);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').isEnabled(), true);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').scaling.x, .82);
    assert.equal(scene.getTransformNodeByName('customer-10-takeaway').isEnabled(), false, 'cup remains at the machine during brewing');
    assert.equal(scene.getTransformNodeByName('counter-a-upgrade-copper').isEnabled(), true);
    assert.equal(scene.getTransformNodeByName('counter-a-cash-0').isEnabled(), true);
    assert.equal(scene.getTransformNodeByName('counter-a-cash-2').isEnabled(), true);
    assert.equal(scene.getTransformNodeByName('cart-cash-0').isEnabled(), true);
    assert.equal(scene.getTransformNodeByName('cart-cash-1').isEnabled(), true);
    state.counters[0].brew.elapsed = 4;
    state.customers[0].phase = 'receiving'; state.customers[0].hasCup = true;
    f.renderer.update(state, .05);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').isEnabled(), false, 'the handed cup is no longer drawn on the machine');
    assert.equal(scene.getTransformNodeByName('customer-10-takeaway').isEnabled(), true, 'exactly one cup is shown during receipt');
    state.counters[0].brew = null; state.counters[0].pendingCash = 0;
    state.manager.carrying = 0; state.customers[0].phase = 'leaving';
    f.renderer.update(state, .05);
    assert.equal(scene.getMeshByName('counter-a-progress').isEnabled(), false);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').isEnabled(), false);
    assert.equal(scene.getTransformNodeByName('counter-a-cash-0').isEnabled(), false);
    assert.equal(scene.getTransformNodeByName('cart-cash-0').isEnabled(), false);
    assert.equal(scene.getTransformNodeByName('customer-10-takeaway').isEnabled(), true, 'departing customer carries the actual cup');
  } finally { f.dispose(); }
});

test('TC-3D-006 pause freezes animation, disposal removes listeners and late input is harmless', () => {
  const f = fixture();
  const state = createInitialState();
  state.customers = [{ id: 1, x: -3, z: 4, phase: 'entering', counterId: 'counter-a', timer: 0, hasCup: false, skin: 0 }];
  f.renderer.update(state, .05);
  state.paused = true;
  f.renderer.update(state, .05);
  const customer = f.renderer.scene.getTransformNodeByName('customer-1');
  const leg = f.renderer.scene.getTransformNodeByName('customer-1-left-hip');
  const before = [pose(customer), pose(leg)];
  for (let frame = 0; frame < 10; frame++) f.renderer.update(state, .1);
  assert.deepEqual([pose(customer), pose(leg)], before);
  assert.equal(f.canvas.listenerCount(), 5);
  f.renderer.dispose();
  assert.equal(f.canvas.listenerCount(), 0);
  assert.equal(f.renderer.scene.isDisposed, true);
  assert.equal(f.engine.isDisposed, false, 'injected engine ownership stays with the QA caller');
  f.renderer.dispose(); f.renderer.update(state, .1); f.renderer.resize(); f.renderer.selectedCounter('counter-a');
  f.canvas.emit('pointerup');
  assert.deepEqual(f.actions, []);
  f.engine.dispose();
});

for (const [width, height] of [[1100, 600], [1340, 520], [930, 460]]) {
  test(`TC-3D-006 critical scene targets stay in view at ${width}×${height} (projection only)`, () => {
    const f = fixture(width, height);
    try {
      for (const name of ['shop-plinth', 'invite-guest-sign', 'counter-a-upgrade-plaque', 'counter-b-upgrade-plaque', 'counter-a-menu', 'counter-b-menu', 'vault-bank-label', 'brand-sign']) {
        const center = screenPoint(f, name);
        assert.ok(center.x > 0 && center.x < width && center.y > 0 && center.y < height, `${name} center is inside the viewport`);
        const mesh = f.renderer.scene.getMeshByName(name);
        const box = mesh.getBoundingInfo().boundingBox;
        for (const corner of box.vectorsWorld) {
          const p = Vector3.Project(corner, Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(width, height));
          assert.ok(p.x > -1 && p.x < width + 1 && p.y > -1 && p.y < height + 1, `${name} full target remains inside viewport`);
        }
      }
      // The canvas is a wide viewport on phones, not the narrow physical device width.
      assert.ok(f.renderer.scene.getMeshByName('counter-b-menu').getBoundingInfo().boundingBox.maximumWorld.x > 6);
    } finally { f.dispose(); }
  });
}

for (const scale of [1 / 1.75, 1 / 2]) {
  test(`TC-3D-006 high-density picking applies hardware scale exactly once (${scale})`, () => {
    const f = fixture(1100, 600, scale);
    try {
      for (const name of ['invite-guest-sign', 'counter-a-upgrade-plaque', 'counter-b-upgrade-plaque', 'counter-a-menu', 'counter-b-menu']) tap(f, name);
      assert.deepEqual(f.actions, [
        { type: 'invite' }, { type: 'counter', id: 'counter-a' }, { type: 'counter', id: 'counter-b' },
        { type: 'menu', id: 'counter-a' }, { type: 'menu', id: 'counter-b' },
      ]);
    } finally { f.dispose(); }
  });
}
