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
const { CoffeeScene, managerPresentationX } = await import('../src/slice/render/CoffeeScene.ts');
const { createEngine, createInitialState } = await import('../src/slice/core/engine.ts');
const { validateState } = await import('../src/slice/core/persistence.ts');

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
function centerMesh(f, meshName) {
  const point = screenPoint(f, meshName);
  f.renderer.panBy(point.clientX - 35 - f.canvas.width / 2, point.clientY - 80 - f.canvas.height / 2);
}


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
    assert.ok(Math.abs(scene.getMeshByName('counter-a-progress-fill').scaling.x - .45) < 1e-9);
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
        if (height < 500) for (const key of ['menu-espresso', 'menu-latte', 'counter-a-upgrade', 'counter-b-upgrade']) assert.equal(f.renderer.projectAnchor(key).visible, true, `${key} is fully visible in the initial landscape world`);
        const counter = f.renderer.scene.getMeshByName('counter-a-countertop');
        counter.computeWorldMatrix(true);
        const projected = counter.getBoundingInfo().boundingBox.vectorsWorld.map(v => Vector3.Project(v, Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight())));
        const counterWidth = (Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) / dpr;
        assert.ok(counterWidth >= (height < 500 ? 165 : 235), `counter has meaningful screen scale (${counterWidth.toFixed(0)} CSS px)`);
        for (const [key, mesh] of physicalControls) {
          f.renderer.focusAnchor(key);
          const p = f.renderer.projectAnchor(key), physical = screenPoint(f, mesh);
          assert.equal(p.visible, true, `${key} can be brought fully into view at its physical size`);
          assert.ok(p.x >= 12 && p.x <= width - 12 && p.y >= 12 && p.y <= height - 12);
          const footprint = f.renderer.getAnchorFootprint(key);
          assert.ok(footprint.width >= 44 && footprint.height >= 44, `${key} actual geometry is at least 44 CSS px in both axes (${footprint.width.toFixed(1)}×${footprint.height.toFixed(1)})`);
          assert.ok(Math.abs(p.x - (physical.clientX - 35)) < .01 && Math.abs(p.y - (physical.clientY - 80)) < .01, `${key} diagnostic and physical target share the same world point`);
          tap(f, mesh);
        }
        assert.deepEqual(f.actions, physicalControls.map(([, , action]) => action), 'DPR is applied exactly once when picking all eight controls');
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
    const selector = f.renderer.scene.getMeshByName('counter-a-recipe-selector');
    const body = f.renderer.scene.getMeshByName('counter-a-body');
    selector.computeWorldMatrix(true); body.computeWorldMatrix(true);
    const face = selector.getBoundingInfo().boundingBox, cabinet = body.getBoundingInfo().boundingBox;
    assert.ok(face.minimumWorld.y >= cabinet.minimumWorld.y - .001 && face.maximumWorld.y <= cabinet.maximumWorld.y + .001, 'recipe selector stays inside the physical counter front height');
    assert.ok(selector.position.z > .7, 'recipe is pasted on the front-facing side');
    assert.equal(selector.metadata.coffeeSurface, 'counter-front');
    assert.equal(f.renderer.scene.getMeshByName('counter-a-selector-stand'), null);
    assert.equal(f.renderer.scene.getMeshByName('counter-a-register-foot'), null);
  } finally { f.dispose(); }
});



function surfaceDiameter(f, meshName) {
  const mesh = f.renderer.scene.getMeshByName(meshName);
  mesh.computeWorldMatrix(true);
  const { minimum: lo, maximum: hi } = mesh.getBoundingInfo().boundingBox;
  const a = screenPoint(f, meshName, new Vector3(lo.x, lo.y, 0));
  const b = screenPoint(f, meshName, new Vector3(hi.x, lo.y, 0));
  const c = screenPoint(f, meshName, new Vector3(lo.x, hi.y, 0));
  const ex = b.clientX - a.clientX, ey = b.clientY - a.clientY;
  const fx = c.clientX - a.clientX, fy = c.clientY - a.clientY;
  // Distance between parallel polygon edges. This is stronger than a rotated AABB:
  // a 44px circle fits on the actual projected parallelogram, not just its bounding box.
  return Math.abs(ex * fy - ey * fx) / Math.max(Math.hypot(ex, ey), Math.hypot(fx, fy));
}

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) {
  for (const dpr of [1, 1.75]) {
    test(`TC-3D-008 actual control polygon accepts a 44px circle at ${width}×${height}, DPR ${dpr} (geometry only)`, () => {
      const f = fixture(width, height, 1 / dpr);
      try {
        for (const [key, mesh] of physicalControls) {
          f.renderer.focusAnchor(key);
          const diameter = surfaceDiameter(f, mesh);
          assert.ok(diameter >= 44, `${key}: actual plane edge spacing ${diameter.toFixed(2)} CSS px`);
          assert.equal(f.renderer.getFocus(), key);
          assert.equal(f.renderer.activateFocused(), true, `${key}: currently visible front physical surface activates by keyboard`);
        }
        assert.deepEqual(f.actions, physicalControls.map(([, , action]) => action));
      } finally { f.dispose(); }
    });
  }
}

test('TC-3D-008 every label is lit opaque depth-tested ink on a mounted non-billboard scene slab', () => {
  const f = fixture();
  try {
    assert.equal(typeof f.renderer.beginAnchorPointer, 'undefined', 'obsolete DOM hit-area seam is absent');
    const labels = f.renderer.scene.meshes.filter(mesh => mesh.metadata?.coffeeLabel);
    assert.equal(labels.length, 11);
    for (const mesh of labels) {
      assert.equal(mesh.billboardMode, 0, `${mesh.name}: no screen-facing geometry`);
      assert.equal(mesh.renderingGroupId, 0, `${mesh.name}: normal scene depth order`);
      assert.equal(mesh.receiveShadows, true);
      assert.equal(mesh.material.disableLighting, false, `${mesh.name}: follows lights`);
      assert.equal(mesh.material.disableDepthWrite, false, `${mesh.name}: writes depth`);
      assert.deepEqual(mesh.material.emissiveColor.asArray(), [0, 0, 0], `${mesh.name}: no self-lit HUD ink`);
      assert.equal(mesh.material.alpha, 1);
      const mount = f.renderer.scene.getMeshByName(mesh.metadata.coffeeMount);
      assert.ok(mount?.isVisible, `${mesh.name}: opaque slab is physically present`);
      assert.equal(mount.material.alpha, 1);
      assert.equal(mount.parent, mesh.parent, `${mesh.name}: label and mounting share room transform`);
    }
    for (const mesh of f.renderer.scene.meshes) {
      assert.equal(mesh.billboardMode, 0, `${mesh.name}: no billboard progress/cash/control`);
      if (mesh.metadata?.coffeeAction) {
        assert.equal(mesh.isVisible, true, `${mesh.name}: no hidden action hitbox`);
        assert.equal(mesh.material?.alpha ?? 1, 1, `${mesh.name}: action geometry is opaque`);
      }
    }
    assert.equal(f.renderer.scene.getMeshByName('counter-a-progress').parent.name, 'counter-a-machine');
    assert.equal(f.renderer.scene.getMeshByName('counter-a-cash-total').parent.name, 'counter-a-cash-tag');
    assert.equal(f.renderer.scene.getTransformNodeByName('counter-a-cash-tag').parent.name, 'counter-a-cash-cluster');
    for (const obsolete of ['manager-cart-hit', 'invite-touch-target', 'counter-a-counter-hit', 'counter-b-counter-hit']) assert.equal(f.renderer.scene.getMeshByName(obsolete), null);
  } finally { f.dispose(); }
});

const { CreateBox } = await import('@babylonjs/core/Meshes/Builders/boxBuilder.js');
function addForegroundBlocker(f, meshName, size = 4) {
  const target = f.renderer.scene.getMeshByName(meshName);
  target.computeWorldMatrix(true);
  const world = Vector3.TransformCoordinates(Vector3.Zero(), target.getWorldMatrix());
  const camera = f.renderer.scene.activeCamera;
  const direction = camera.position.subtract(camera.getTarget()).normalize();
  const blocker = CreateBox('qa-visible-foreground-solid', { size }, f.renderer.scene);
  blocker.position.copyFrom(world.add(direction.scale(3)));
  blocker.computeWorldMatrix(true);
  return blocker;
}

test('TC-3D-008 front solid blocks pointer and keyboard; removing it restores real mesh picking', () => {
  const f = fixture(390, 844, 1 / 1.75);
  try {
    f.renderer.focusAnchor('menu-espresso');
    const blocker = addForegroundBlocker(f, 'menu-espresso');
    assert.equal(f.renderer.projectAnchor('menu-espresso').visible, true, 'projection alone does not know occlusion');
    tap(f, 'menu-espresso');
    assert.equal(f.renderer.activateFocused(), false, 'fully covered focused mesh cannot activate');
    assert.deepEqual(f.actions, [], 'no predicate-only click-through');
    blocker.setEnabled(false);
    tap(f, 'menu-espresso');
    assert.equal(f.renderer.activateFocused(), true);
    assert.deepEqual(f.actions, [{ type: 'menu', recipe: 'espresso' }, { type: 'menu', recipe: 'espresso' }]);
    f.renderer.panBy(100000, 100000);
    assert.equal(f.renderer.projectAnchor('menu-espresso').visible, false);
    assert.equal(f.renderer.activateFocused(), false, 'panned-away control cannot activate');
  } finally { f.dispose(); }
});

test('TC-3D-008 pointer start and release require the same visible physical mesh, exactly once', () => {
  const f = fixture();
  try {
    f.renderer.focusAnchor('vault');
    const point = screenPoint(f, 'vault-bank-label');
    const state = createInitialState();
    const vault = f.renderer.scene.getTransformNodeByName('cash-vault');
    const originalX = vault.position.x;
    f.canvas.emit('pointerdown', { ...point, timeStamp: 10 });
    // A QA-only transform change verifies the guard without creating a moving cart action.
    vault.position.x += 2;
    f.renderer.update(state, 0);
    f.canvas.emit('pointerup', { ...point, timeStamp: 160 });
    assert.deepEqual(f.actions, [], 'surface leaving the original press cannot retarget it');
    f.renderer.focusAnchor('vault');
    const moved = screenPoint(f, 'vault-bank-label');
    const blocker = addForegroundBlocker(f, 'vault-bank-label');
    f.canvas.emit('pointerdown', { ...moved, timeStamp: 200 });
    blocker.setEnabled(false);
    f.canvas.emit('pointerup', { ...moved, timeStamp: 300 });
    assert.deepEqual(f.actions, [], 'press on foreground cannot become a newly uncovered action');
    f.renderer.focusAnchor('vault');
    const centered = screenPoint(f, 'vault-bank-label');
    f.canvas.emit('pointerdown', { ...centered, timeStamp: 350 });
    vault.position.x = originalX;
    f.renderer.update(state, 0);
    vault.position.x = originalX + 2;
    f.renderer.update(state, 0);
    f.canvas.emit('pointerup', { ...centered, timeStamp: 550 });
    assert.deepEqual(f.actions, [], 'moving away and back invalidates the original press');
    tap(f, 'vault-bank-label', 'vault');
    f.canvas.emit('pointerup', { ...moved, timeStamp: 620 });
    assert.deepEqual(f.actions, [{ type: 'vault' }], 'one captured tap fires once');
  } finally { f.dispose(); }
});

test('TC-3D-008 opening a modal cancels captured input; every interaction stays suspended until close', () => {
  const f = fixture(390, 844);
  try {
    f.renderer.focusAnchor('counter-a-recipe');
    const point = screenPoint(f, 'counter-a-recipe-selector');
    f.canvas.emit('pointerdown', { ...point });
    f.renderer.setInteractionEnabled(false);
    assert.equal(f.canvas.captured.size, 0, 'dialog suspension releases active capture');
    const camera = f.renderer.scene.activeCamera.position.asArray();
    f.canvas.emit('pointermove', { ...point, clientX: point.clientX + 70 });
    f.canvas.emit('pointerup', { ...point });
    tap(f, 'invite-guest-sign');
    f.renderer.panBy(100, 100);
    assert.equal(f.renderer.focusNext(), null);
    f.renderer.focusAnchor('vault');
    assert.equal(f.renderer.activateFocused(), false);
    assert.deepEqual(f.renderer.scene.activeCamera.position.asArray(), camera);
    assert.deepEqual(f.actions, []);
    f.renderer.setInteractionEnabled(true);
    tap(f, 'counter-a-recipe-selector', 'counter-a-recipe');
    assert.deepEqual(f.actions, [{ type: 'recipe', id: 'counter-a' }]);
  } finally { f.dispose(); }
});

test('TC-3D-008 keyboard cycles every embodied control, preserves physical focus and is inert after disposal', () => {
  const f = fixture();
  try {
    const keys = physicalControls.map(([key]) => key);
    const visited = new Set();
    for (let i = 0; i < keys.length; i++) {
      const key = f.renderer.focusNext();
      visited.add(key);
      assert.equal(f.renderer.projectAnchor(key).visible, true);
    }
    assert.deepEqual([...visited].sort(), [...keys].sort());
    const last = f.renderer.getFocus();
    const next = f.renderer.focusNext(1);
    assert.notEqual(next, last);
    assert.equal(f.renderer.focusNext(-1), last);
    const mesh = f.renderer.scene.meshes.find(mesh => mesh.metadata?.coffeeAnchor === last);
    const mount = f.renderer.scene.getMeshByName(mesh.metadata.coffeeMount);
    assert.deepEqual(mount.material.diffuseColor.asArray(), [225 / 255, 187 / 255, 105 / 255], 'highlight is a matte physical mounting rim');
    f.renderer.dispose();
    assert.equal(f.renderer.getFocus(), null);
    assert.equal(f.renderer.focusNext(), null);
    assert.equal(f.renderer.activateFocused(), false);
    f.renderer.panBy(10, 10);
    f.renderer.setInteractionEnabled(true);
    assert.deepEqual(f.actions, []);
  } finally { f.dispose(); }
});

test('TC-3D-008 side-front upgrade plaques remain hittable while a customer occupies the service point', () => {
  const f = fixture(844, 390);
  try {
    const state = createInitialState();
    state.customers = [0, 5].map((x, i) => ({ id: i + 1, x, z: 1.5, phase: 'serving', counterId: i ? 'counter-b' : 'counter-a', timer: 0, hasCup: false, skin: i }));
    f.renderer.update(state, .05);
    tap(f, 'counter-a-upgrade-plaque', 'counter-a-upgrade');
    tap(f, 'counter-b-upgrade-plaque', 'counter-b-upgrade');
    assert.deepEqual(f.actions, [{ type: 'counter', id: 'counter-a' }, { type: 'counter', id: 'counter-b' }], 'lane customer naturally occludes its own body without covering the side plaque center');
  } finally { f.dispose(); }
});

test('TC-3D-008 small trolley cash table stays visible while manager turns without orbiting into furniture', () => {
  const f = fixture(844, 390, 1 / 1.75);
  try {
    const state = createInitialState();
    state.manager.carrying = 3600; state.manager.x = 0; state.manager.z = -1.7; state.manager.phase = 'collecting'; state.manager.target = 0;
    f.renderer.update(state, 0);
    const manager = f.renderer.scene.getTransformNodeByName('manager');
    const cart = f.renderer.scene.getTransformNodeByName('manager-cash-cart');
    const cartPosition = cart.position.asArray();
    for (let n = 0; n < 24; n++) {
      manager.rotation.y = n * Math.PI / 12;
      centerMesh(f, 'cart-cash-0-top');
      assert.deepEqual(cart.rotation.asArray(), [0, 0, 0], 'physical tray is world-oriented; it does not follow the camera or manager turns');
      assert.deepEqual(cart.position.asArray(), cartPosition);
      let visibleNote = false;
      for (let i = 0; i < 6; i++) {
        const point = screenPoint(f, `cart-cash-${i}-top`, new Vector3(0, .5, 0));
        const pick = f.renderer.scene.pick(point.x * f.engine.getHardwareScalingLevel(), point.y * f.engine.getHardwareScalingLevel());
        if (pick?.pickedMesh?.name.startsWith('cart-cash-')) visibleNote = true;
      }
      assert.equal(visibleNote, true, `manager angle ${n}: at least one actual transported note is visible to the camera`);
    }
  } finally { f.dispose(); }
});

test('TC-3D-008 world-oriented trolley clears wall, counters and baristas throughout the service route', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    state.manager.carrying = 3600;
    const cart = f.renderer.scene.getTransformNodeByName('manager-cash-cart');
    const parts = cart.getChildMeshes();
    const scene = f.renderer.scene;
    const managerParts = scene.getTransformNodeByName('manager').getChildMeshes();
    // All visible opaque room solids, including every physical label mount, wall panel,
    // wainscot rail, station, barista and plant. Only the trolley and its handler are excluded.
    const obstacles = scene.meshes.filter(mesh => mesh.isVisible && mesh.isEnabled() && mesh.material?.alpha === 1 && !parts.includes(mesh) && !managerParts.includes(mesh));
    for (const [target, start, end] of [[0, -8, 0], [1, 0, 5], [2, 5, -8]]) {
      const count = Math.ceil(Math.abs(end - start) * 2);
      for (let step = 0; step <= count; step++) {
        const x = start + (end - start) * step / count;
        state.manager.x = x; state.manager.z = -1.7; state.manager.target = target;
        state.manager.phase = step === count ? (target === 2 ? 'depositing' : 'collecting') : 'moving';
        f.renderer.update(state, 0);
        assert.deepEqual(cart.rotation.asArray(), [0, 0, 0]);
        assert.equal(cart.position.y, 0, 'walking manager bob does not lift trolley off the floor');
        for (const part of parts) {
          if (!part.isEnabled()) continue;
          part.computeWorldMatrix(true);
          const a = part.getBoundingInfo().boundingBox;
          for (const obstacle of obstacles) {
            obstacle.computeWorldMatrix(true);
            const b = obstacle.getBoundingInfo().boundingBox;
            const overlap = ['x', 'y', 'z'].map(axis => Math.min(a.maximumWorld[axis], b.maximumWorld[axis]) - Math.max(a.minimumWorld[axis], b.minimumWorld[axis]));
            assert.ok(overlap.some(value => value <= .001), `${part.name} does not penetrate ${obstacle.name} at manager route x=${x}`);
          }
        }
        centerMesh(f, 'cart-cash-0-top');
        let visible = false;
        const occluders = [];
        for (let i = 0; i < 6; i++) {
          const point = screenPoint(f, `cart-cash-${i}-top`, new Vector3(0, .5, 0));
          const pick = scene.pick(point.x, point.y);
          if (pick?.pickedMesh?.name.startsWith('cart-cash-')) visible = true;
          else if (pick?.pickedMesh) occluders.push(pick.pickedMesh);
        }
        if (step === 0 || step === count) assert.equal(visible, true, `transported notes are actually front-visible at cash handoff/deposit x=${x}`);
        if (!visible) {
          assert.equal(occluders.length, 6);
          assert.ok(occluders.every(mesh => mesh.isVisible && mesh.material?.alpha === 1 && !mesh.name.includes('manager-cart-control')), 'between stops, cash can only be occluded by actual opaque shop/person geometry');
        }
      }
    }
  } finally { f.dispose(); }
});

test('TC-3D-008 small pending cash stays physically visible beside its flat amount tag', () => {
  const f = fixture(390, 844, 1 / 1.75);
  try {
    const state = createInitialState();
    state.counters[0].pendingCash = 110;
    f.renderer.update(state, .05);
    f.renderer.focusAnchor('counter-a-recipe');
    const point = screenPoint(f, 'counter-a-cash-0-top', new Vector3(0, .5, 0));
    const pick = f.renderer.scene.pick(point.x * f.engine.getHardwareScalingLevel(), point.y * f.engine.getHardwareScalingLevel());
    assert.ok(pick?.pickedMesh?.name.startsWith('counter-a-cash-0-'), 'first small note pile is visible, rather than roofed by its cash amount display');
  } finally { f.dispose(); }
});

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) {
  for (const dpr of [1, 1.75]) {
    test(`TC-3D-009 refined physical layout at ${width}×${height}, DPR ${dpr}: vault left and independent front controls (geometry only)`, () => {
      const f = fixture(width, height, 1 / dpr);
      try {
        const scene = f.renderer.scene;
        const projectedXs = mesh => {
          mesh.computeWorldMatrix(true);
          return mesh.getBoundingInfo().boundingBox.vectorsWorld.map(v => Vector3.Project(v, Matrix.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight())).x * f.engine.getHardwareScalingLevel());
        };
        const vault = scene.getTransformNodeByName('cash-vault');
        const vaultRight = Math.max(...vault.getChildMeshes().flatMap(projectedXs));
        const menuLeft = Math.min(...['menu-espresso', 'menu-latte'].flatMap(name => projectedXs(scene.getMeshByName(name))));
        assert.ok(vaultRight < menuLeft, `whole vault is visually left of all coffee boards (${vaultRight.toFixed(2)} < ${menuLeft.toFixed(2)})`);
        const state = createInitialState();
        state.customers = [0, 5].map((x, i) => ({ id: i + 1, x, z: 1.5, phase: 'serving', counterId: i ? 'counter-b' : 'counter-a', timer: 0, hasCup: false, skin: i }));
        state.counters.forEach(counter => counter.pendingCash = 950);
        f.renderer.update(state, 0);
        for (const id of ['counter-a', 'counter-b']) {
          const body = scene.getMeshByName(`${id}-body`);
          body.computeWorldMatrix(true);
          const cabinet = body.getBoundingInfo().boundingBox;
          const receipt = scene.getMeshByName(`${id}-cash-total`);
          const glyph = receipt.metadata.coffeeGlyphHeight;
          f.renderer.focusAnchor(`${id}-recipe`);
          const glyphLow = screenPoint(f, receipt.name, new Vector3(0, -glyph / 2, 0));
          const glyphHigh = screenPoint(f, receipt.name, new Vector3(0, glyph / 2, 0));
          const glyphHeight = Math.abs(glyphHigh.clientY - glyphLow.clientY);
          assert.ok(glyphHeight >= 10, `${id} nominal receipt glyph height is readable-scale geometry (${glyphHeight.toFixed(2)} CSS px; pixel typography still needs browser QA)`);
          const receiptPoint = screenPoint(f, receipt.name, new Vector3(0, (.5 - receipt.metadata.coffeeGlyphCenter) * .64, 0));
          const receiptPick = scene.pick(receiptPoint.x * f.engine.getHardwareScalingLevel(), receiptPoint.y * f.engine.getHardwareScalingLevel());
          assert.equal(receiptPick?.pickedMesh?.name, receipt.name, 'cash amount region is a genuinely visible receipt surface');
          const notePoint = screenPoint(f, `${id}-cash-0-top`, new Vector3(0, .5, 0));
          assert.ok(notePoint.clientX >= 35 && notePoint.clientX <= 35 + width && notePoint.clientY >= 80 && notePoint.clientY <= 80 + height, 'pending money remains within the focused viewport');
          const notePick = scene.pick(notePoint.x * f.engine.getHardwareScalingLevel(), notePoint.y * f.engine.getHardwareScalingLevel());
          assert.ok(notePick?.pickedMesh?.name.startsWith(`${id}-cash-`), 'actual note pile stays front-visible beside the receipt');
          for (const [key, name] of [[`${id}-upgrade`, `${id}-upgrade-plaque`], [`${id}-recipe`, `${id}-recipe-selector`]]) {
            const mesh = scene.getMeshByName(name);
            mesh.computeWorldMatrix(true);
            const face = mesh.getBoundingInfo().boundingBox;
            assert.ok(face.minimumWorld.y >= cabinet.minimumWorld.y - .001 && face.maximumWorld.y <= cabinet.maximumWorld.y + .001, `${name} fits the counter front height`);
            assert.ok(face.minimumWorld.x >= cabinet.minimumWorld.x && face.maximumWorld.x <= cabinet.maximumWorld.x, `${name} fits the counter front width`);
            assert.equal(mesh.metadata.coffeeSurface, 'counter-front');
            f.renderer.focusAnchor(key);
            assert.ok(surfaceDiameter(f, name) >= 44, `${name} has real 44px touch edge spacing`);
            assert.equal(f.renderer.activateFocused(), true, `${name} stays available with a customer at the service point`);
            tap(f, name);
            assert.deepEqual(f.actions.at(-1), mesh.metadata.coffeeAction, `${name} has a real tappable front center with a service customer`);
          }
        }
        assert.deepEqual(f.actions, [
          { type: 'counter', id: 'counter-a' }, { type: 'counter', id: 'counter-a' },
          { type: 'recipe', id: 'counter-a' }, { type: 'recipe', id: 'counter-a' },
          { type: 'counter', id: 'counter-b' }, { type: 'counter', id: 'counter-b' },
          { type: 'recipe', id: 'counter-b' }, { type: 'recipe', id: 'counter-b' },
        ]);
      } finally { f.dispose(); }
    });
  }
}

test('TC-3D-009 vault owns manager level affordance and no removed scene action survives', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    state.manager.level = 7;
    const before = JSON.stringify(state);
    f.renderer.update(state, 0);
    assert.equal(JSON.stringify(state), before);
    const scene = f.renderer.scene;
    const label = scene.getMeshByName('vault-bank-label');
    assert.equal(label.metadata.coffeeManagerLevel, 7);
    assert.deepEqual(label.metadata.coffeeAction, { type: 'vault' });
    for (const name of ['shop-pause-control', 'shop-settings-control', 'service-panel-case', 'manager-cart-control']) assert.equal(scene.getMeshByName(name), null, `${name} is removed`);
    for (const name of ['wall-service-panel', 'manager-cart-clipboard']) assert.equal(scene.getTransformNodeByName(name), null, `${name} is removed`);
    for (const mesh of scene.meshes) assert.ok(!['pause', 'settings', 'manager'].includes(mesh.metadata?.coffeeAction?.type), `${mesh.name} has no obsolete action`);
    const cart = scene.getTransformNodeByName('manager-cash-cart');
    for (const mesh of cart.getChildMeshes()) assert.equal(mesh.metadata?.coffeeAction, undefined, 'trolley is ordinary visible geometry');
    const base = scene.getMeshByName('cart-base');
    assert.ok(base.scaling.x <= 1 && base.scaling.z <= .7, 'small cart has no giant manager-grade board');
    tap(f, 'vault-bank-label', 'vault');
    assert.deepEqual(f.actions, [{ type: 'vault' }]);
  } finally { f.dispose(); }
});

test('TC-3D-009 pending money tag shares the banknote cluster and cannot become a raised register', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    state.counters[0].pendingCash = 950;
    state.counters[1].pendingCash = 110;
    f.renderer.update(state, 0);
    const scene = f.renderer.scene;
    for (const id of ['counter-a', 'counter-b']) {
      const cluster = scene.getTransformNodeByName(`${id}-cash-cluster`);
      const tag = scene.getTransformNodeByName(`${id}-cash-tag`);
      const label = scene.getMeshByName(`${id}-cash-total`);
      const firstNote = scene.getTransformNodeByName(`${id}-cash-0`);
      assert.equal(firstNote.parent, cluster);
      assert.equal(tag.parent, cluster);
      assert.equal(label.parent, tag);
      assert.equal(label.metadata.coffeeCashRoot, cluster.name);
      assert.equal(label.metadata.coffeeAmount, state.counters.find(counter => counter.id === id).pendingCash);
      assert.ok(label.isEnabled() && firstNote.isEnabled());
      label.computeWorldMatrix(true);
      const cashPoint = label.getAbsolutePosition().clone();
      const notePoint = firstNote.getAbsolutePosition().clone();
      assert.ok(Math.abs(cashPoint.y - notePoint.y) < .06, 'tag is flat at note height');
      assert.ok(Math.hypot(cashPoint.x - notePoint.x, cashPoint.z - notePoint.z) < .6, 'amount is directly adjacent to real money');
      assert.ok(label.getBoundingInfo().boundingBox.maximumWorld.y < 1.30, 'no above-counter register screen');
      assert.ok(Math.abs(Vector3.TransformNormal(new Vector3(0, 0, 1), label.getWorldMatrix()).normalize().y) > .99, 'amount surface is horizontal');
      const shift = new Vector3(.4, .1, -.2);
      cluster.position.addInPlace(shift);
      cluster.computeWorldMatrix(true); tag.computeWorldMatrix(true); label.computeWorldMatrix(true); firstNote.computeWorldMatrix(true);
      assert.ok(Vector3.Distance(label.getAbsolutePosition().subtract(cashPoint), shift) < 1e-6, 'moving the cash location moves its amount exactly');
      assert.ok(Vector3.Distance(firstNote.getAbsolutePosition().subtract(notePoint), shift) < 1e-6, 'notes share the same movement');
      assert.equal(scene.getMeshByName(`${id}-register-foot`), null);
    }
    state.counters.forEach(counter => counter.pendingCash = 0);
    f.renderer.update(state, 0);
    for (const id of ['counter-a', 'counter-b']) {
      assert.equal(scene.getTransformNodeByName(`${id}-cash-cluster`).isEnabled(), false);
      assert.equal(scene.getMeshByName(`${id}-cash-total`).isEnabled(), false, 'zero money has no stranded amount slab');
    }
  } finally { f.dispose(); }
});

test('TC-3D-009 render-only manager route is continuous at all stops with unchanged cash and logical timing', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    const scene = f.renderer.scene;
    const vaultX = scene.getTransformNodeByName('cash-vault').position.x;
    const manager = scene.getTransformNodeByName('manager');
    for (const [target, logicalX, expectedX, phase] of [
      [0, -8, vaultX, 'moving'], [0, -4, vaultX / 2, 'moving'], [0, 0, 0, 'collecting'],
      [1, 0, 0, 'moving'], [1, 2.5, 2.5, 'moving'], [1, 5, 5, 'collecting'],
      [2, 5, 5, 'moving'], [2, -1.5, (5 + vaultX) / 2, 'moving'], [2, -8, vaultX, 'depositing'],
      [0, -8, vaultX, 'moving'],
    ]) {
      Object.assign(state.manager, { target, x: logicalX, phase });
      state.manager.carrying = 700;
      const before = JSON.stringify(state);
      f.renderer.update(state, .1);
      assert.equal(JSON.stringify(state), before, 'mapping never writes snapshot coordinates, phase, money or timers');
      assert.ok(Math.abs(managerPresentationX(state.manager) - expectedX) < 1e-9);
      assert.ok(Math.abs(manager.position.x - expectedX) < 1e-9, 'no interpolation lag at the actual handoff');
      assert.equal(manager.position.z, -1.7);
      assert.equal(scene.getTransformNodeByName('cart-cash-0').isEnabled(), true);
    }
    // The original core still deposits at logical -8 after exactly 0.6 simulated seconds.
    Object.assign(state.manager, { target: 2, x: -8, phase: 'depositing', timer: 0, carrying: 700 });
    state.totalEarned = 700;
    assert.equal(validateState(state).ok, true, 'authoritative timing starts from a conserved ledger');
    const engine = createEngine(state);
    engine.advance(.55);
    f.renderer.update(engine.state, 0);
    assert.equal(engine.state.wallet, 1200);
    assert.equal(engine.state.manager.carrying, 700);
    assert.equal(manager.position.x, vaultX, 'pending deposit is underneath the moved physical vault');
    engine.advance(.05);
    f.renderer.update(engine.state, 0);
    assert.equal(engine.state.wallet, 1900);
    assert.equal(validateState(engine.state).ok, true, 'deposit preserves the full persisted ledger');
    assert.equal(engine.state.manager.x, -8, 'authoritative economy coordinates remain original');
    assert.equal(engine.state.manager.target, 0);
    assert.equal(engine.state.manager.carrying, 0);
    assert.equal(manager.position.x, vaultX, 'new outgoing segment starts at the same visual endpoint');
    assert.equal(scene.getTransformNodeByName('cart-cash-0').isEnabled(), false);
    assert.deepEqual(engine.drainEvents().map(event => [event.type, event.amount]), [['deposited', 700]]);
  } finally { f.dispose(); }
});


test('TC-3D-009 receipt ink fits long exact amounts without cropping or abbreviation (canvas-context unit check)', () => {
  const f = fixture();
  try {
    const drawn = [];
    const ctx = {
      font: '',
      measureText(value) { return { width: value.length * Number(this.font.match(/([\d.]+)px/)[1]) * .64 }; },
      fillText(value, x, y) { drawn.push({ value, x, y, width: this.measureText(value).width, font: this.font }); },
    };
    // A direct paint-helper check does not claim real font/pixel rendering acceptance.
    const value = '¥ 1234567.89';
    const font = f.renderer.text(ctx, value, 256, 115.2, 124, '#477448', 484);
    assert.ok(font < 124);
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0].value, value, 'full integer-cent amount stays exact');
    assert.ok(drawn[0].width <= 484 + 1e-9, 'the measured glyph line fits the paper interior');
  } finally { f.dispose(); }
});
