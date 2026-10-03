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
  captured = new Set();
  captureCalls = 0;
  releaseCalls = 0;
  constructor(width, height) { this.width = width; this.height = height; }
  addEventListener(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  setPointerCapture(id) { this.captured.add(id); this.captureCalls++; }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); this.releaseCalls++; }
  getBoundingClientRect() { return { left: 35, top: 80, width: this.width, height: this.height }; }
  emit(type, values = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, timeStamp: 100, ...values }); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture(width = 1280, height = 900, hardwareScale = 1) {
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
function tap(f, meshName, anchorKey) {
  if (anchorKey) f.renderer.focusAnchor(anchorKey);
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
    assert.ok(initialMeshes > 350, 'complete original room geometry exists');
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

const physicalControls = [
  ['invite', 'invite-guest-sign', { type: 'invite' }],
  ['counter-a-upgrade', 'counter-a-upgrade-plaque', { type: 'counter', id: 'counter-a' }],
  ['counter-b-upgrade', 'counter-b-upgrade-plaque', { type: 'counter', id: 'counter-b' }],
  ['counter-a-recipe', 'counter-a-recipe-selector', { type: 'recipe', id: 'counter-a' }],
  ['counter-b-recipe', 'counter-b-recipe-selector', { type: 'recipe', id: 'counter-b' }],
  ['menu-espresso', 'menu-espresso', { type: 'menu', recipe: 'espresso' }],
  ['menu-latte', 'menu-latte', { type: 'menu', recipe: 'latte' }],
  ['vault', 'vault-bank-label', { type: 'vault' }],
  ['manager', 'manager-cart-control', { type: 'manager' }],
];

test('TC-3D-006 all physical room controls dispatch detail actions without mutating economy', () => {
  const f = fixture();
  try {
    for (const [key, mesh] of physicalControls) tap(f, mesh, key);
    assert.deepEqual(f.actions, physicalControls.map(([, , action]) => action));
    f.renderer.selectedCounter('counter-b');
    assert.equal(f.renderer.scene.getMeshByName('counter-a-selected').isEnabled(), false);
    assert.equal(f.renderer.scene.getMeshByName('counter-b-selected').isEnabled(), true);
    f.renderer.selectedCounter(null);
    assert.equal(f.renderer.scene.getMeshByName('counter-b-selected').isEnabled(), false);
    assert.equal(f.canvas.captureCalls, physicalControls.length);
    assert.equal(f.canvas.releaseCalls, physicalControls.length);
  } finally { f.dispose(); }
});

test('TC-3D-006 panning, long holds, cancelled and secondary pointers cannot become taps', () => {
  const f = fixture();
  try {
    f.renderer.focusAnchor('invite');
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
    tap(f, 'invite-guest-sign', 'invite');
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

function drag(f, dx, dy, pointerId = 1) {
  f.canvas.emit('pointerdown', { pointerId, clientX: 100, clientY: 150, timeStamp: 100 });
  f.canvas.emit('pointermove', { pointerId, clientX: 100 + dx, clientY: 150 + dy, timeStamp: 180 });
  f.canvas.emit('pointerup', { pointerId, clientX: 100 + dx, clientY: 150 + dy, timeStamp: 250 });
}

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) {
  for (const dpr of [1, 1.75]) {
    test(`TC-3D-006 physical ${width}×${height} at DPR ${dpr}: close room, shared anchors and reachable controls (projection only)`, () => {
      const f = fixture(width, height, 1 / dpr);
      try {
        const initial = physicalControls.map(([key]) => f.renderer.projectAnchor(key));
        assert.equal(f.canvas.width, width, 'canvas has the actual physical viewport CSS width');
        assert.equal(f.canvas.height, height, 'no wide scrolling canvas surrogate');
        assert.equal(f.renderer.scene.getMeshByName('shop-plinth'), null, 'no finite floating plinth');
        if (width < height && width < 500) {
          assert.ok(initial.filter(point => !point.visible).length >= 4, 'portrait crops the world rather than fitting every small target');
          for (const key of ['counter-a-upgrade', 'counter-a-recipe', 'menu-espresso']) assert.equal(f.renderer.projectAnchor(key).visible, true, `${key} is useful in the initial portrait view`);
          const camera = f.renderer.scene.activeCamera;
          const span = camera.orthoRight - camera.orthoLeft;
          assert.ok(span < 6, 'portrait retains large counters');
        }
        if (height < 500) for (const key of ['menu-espresso', 'menu-latte', 'counter-a-upgrade', 'counter-b-upgrade']) assert.equal(f.renderer.projectAnchor(key).visible, true, `${key} is initially reachable below the landscape HUD`);
        const counter = f.renderer.scene.getMeshByName('counter-a-countertop');
        counter.computeWorldMatrix(true);
        const projected = counter.getBoundingInfo().boundingBox.vectorsWorld.map(v => Vector3.Project(v, Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight())));
        const counterWidth = (Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) / dpr;
        assert.ok(counterWidth >= (height < 500 ? 165 : 235), `counter has meaningful screen scale (${counterWidth.toFixed(0)} CSS px)`);
        for (const [key, mesh] of physicalControls) {
          f.renderer.focusAnchor(key);
          const p = f.renderer.projectAnchor(key), physical = screenPoint(f, mesh);
          assert.equal(p.visible, true, `${key} can be brought into view with its entire wide 44px-high control clear of the HUD`);
          assert.ok(p.x >= 60 && p.x <= width - 60 && p.y >= 116 && p.y <= height - 26);
          assert.ok(Math.abs(p.x - (physical.clientX - 35)) < .01 && Math.abs(p.y - (physical.clientY - 80)) < .01, `${key} overlay and physical target share the same world point`);
          tap(f, mesh);
        }
        assert.deepEqual(f.actions, physicalControls.map(([, , action]) => action), 'DPR is applied exactly once when picking all nine controls');
      } finally { f.dispose(); }
    });
  }

  test(`TC-3D-006 captured drag is bounded and scene surfaces fill ${width}×${height} (ray coverage only)`, () => {
    const f = fixture(width, height);
    try {
      const camera = f.renderer.scene.activeCamera;
      const rotation = camera.rotation.asArray();
      for (const [dx, dy] of [[100000, 100000], [-100000, -100000], [100000, -100000], [-100000, 100000]]) {
        drag(f, dx, dy);
        const first = camera.position.asArray();
        drag(f, dx, dy);
        assert.deepEqual(camera.position.asArray(), first, 'repeated out-of-bounds drag cannot keep moving the camera');
        assert.deepEqual(camera.rotation.asArray(), rotation, 'camera angle stays fixed');
        assert.equal(f.canvas.captured.size, 0, 'capture is released after drag');
        for (const [x, y] of [[1, 1], [width - 1, 1], [1, height - 1], [width - 1, height - 1], [width / 2, height / 2]]) {
          const pick = f.renderer.scene.pick(x, y, mesh => Boolean(mesh.metadata?.coffeeEnvironment), false, camera);
          assert.equal(pick?.hit, true, `room floor/wall continues through viewport (${x}, ${y})`);
        }
      }
      assert.deepEqual(f.actions, [], 'drag never becomes a detail/transaction tap');
      for (const [key] of physicalControls) { f.renderer.focusAnchor(key); assert.equal(f.renderer.projectAnchor(key).visible, true, `${key} remains reachable after extreme pan`); }
    } finally { f.dispose(); }
  });
}

test('TC-3D-006 cancellation, capture loss and unrelated pointers preserve one drag owner', () => {
  const f = fixture(390, 844);
  try {
    f.canvas.emit('pointerdown', { clientX: 120, clientY: 180 });
    f.canvas.emit('pointerup', { pointerId: 2, isPrimary: false });
    assert.equal(f.canvas.captured.has(1), true, 'secondary up cannot release primary pointer');
    f.canvas.emit('pointercancel', { pointerId: 2 });
    assert.equal(f.canvas.captured.has(1), true, 'secondary cancellation cannot cancel primary pointer');
    f.canvas.emit('pointermove', { clientX: 260, clientY: 180 });
    const afterDrag = f.renderer.scene.activeCamera.position.asArray();
    f.canvas.emit('lostpointercapture');
    f.canvas.emit('pointermove', { clientX: 340, clientY: 180 });
    f.canvas.emit('pointerup', { clientX: 340, clientY: 180 });
    assert.deepEqual(f.renderer.scene.activeCamera.position.asArray(), afterDrag);
    assert.deepEqual(f.actions, []);
    f.canvas.emit('pointerdown', { clientX: 120, clientY: 180 });
    f.renderer.dispose();
    assert.equal(f.canvas.captured.size, 0, 'destroying an active renderer releases capture');
    assert.deepEqual(f.renderer.projectAnchor('vault'), { x: 0, y: 0, visible: false });
    f.renderer.focusAnchor('vault');
  } finally { f.dispose(); }
});

test('TC-3D-006 wall menus remain global recipe boards while each counter selector follows its recipe', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    const espresso = f.renderer.scene.getMeshByName('menu-espresso');
    const latte = f.renderer.scene.getMeshByName('menu-latte');
    state.counters[0].recipe = 'latte'; state.counters[1].recipe = 'espresso';
    f.renderer.update(state, .05);
    assert.deepEqual(espresso.metadata.coffeeAction, { type: 'menu', recipe: 'espresso' });
    assert.deepEqual(latte.metadata.coffeeAction, { type: 'menu', recipe: 'latte' });
    assert.ok(f.renderer.scene.getTransformNodeByName('cash-vault').position.y > 1, 'vault is wall-mounted above the floor');
    assert.ok(f.renderer.scene.getMeshByName('counter-a-recipe-selector').position.y > 1.2, 'recipe selection lives physically on the countertop');
    const before = f.renderer.projectAnchor('manager');
    state.manager.x = 4; state.manager.z = -1.7; state.manager.phase = 'moving';
    f.renderer.update(state, .1);
    const after = f.renderer.projectAnchor('manager');
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 50, 'manager control moves with the physical cart');
  } finally { f.dispose(); }
});


test('TC-3D-006 projected DOM hit areas share captured drag, hold, cancel and single-action guards', () => {
  const f = fixture(390, 844, 1 / 1.75);
  try {
    const key = 'counter-a-recipe';
    f.renderer.focusAnchor(key);
    const p = f.renderer.projectAnchor(key);
    const pointer = (timeStamp, extra = {}) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: p.x + 35 + 38, clientY: p.y + 80, timeStamp, ...extra });
    f.renderer.beginAnchorPointer(key, pointer(0));
    assert.equal(f.canvas.captured.has(1), true, 'DOM pointer is captured by the canvas');
    f.canvas.emit('pointerup', pointer(150));
    assert.deepEqual(f.actions, [{ type: 'recipe', id: 'counter-a' }], 'expanded DOM area dispatches its anchor action, not the counter underneath');
    f.canvas.emit('pointerup', pointer(160));
    assert.equal(f.actions.length, 1, 'extra up cannot duplicate the action');
    f.renderer.beginAnchorPointer(key, pointer(200));
    f.canvas.emit('pointerup', pointer(1050));
    assert.equal(f.actions.length, 1, 'long hold on DOM control is not an action');
    f.renderer.beginAnchorPointer(key, pointer(1200));
    f.canvas.emit('pointermove', pointer(1260, { clientX: p.x + 135 }));
    f.canvas.emit('pointermove', pointer(1300));
    f.canvas.emit('pointerup', pointer(1350));
    assert.equal(f.actions.length, 1, 'drag returning to DOM control cannot become a click');
    f.renderer.focusAnchor(key);
    const restored = f.renderer.projectAnchor(key);
    const centered = { pointerId: 1, isPrimary: true, button: 0, clientX: restored.x + 35, clientY: restored.y + 80, timeStamp: 1500 };
    f.renderer.beginAnchorPointer(key, centered);
    f.canvas.emit('pointercancel', { ...centered, timeStamp: 1550 });
    f.canvas.emit('pointerup', { ...centered, timeStamp: 1600 });
    assert.equal(f.actions.length, 1, 'cancelled DOM press cannot fire later');
    f.renderer.beginAnchorPointer(key, { ...centered, isPrimary: false, pointerId: 2 });
    f.canvas.emit('pointerup', { ...centered, isPrimary: false, pointerId: 2 });
    assert.equal(f.actions.length, 1, 'secondary DOM pointer is ignored');
    f.renderer.beginAnchorPointer(key, { ...centered, timeStamp: 1800 });
    f.canvas.emit('pointerup', { ...centered, timeStamp: 1900 });
    assert.equal(f.actions.length, 2, 'ordinary DOM tap still works after interrupted gestures');
  } finally { f.dispose(); }
});
