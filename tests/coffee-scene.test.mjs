import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
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
const { GRID, initialLayout, layoutEntrySpawn, layoutExit, layoutExitAnchor } = await import('../src/slice/core/layout.ts');

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
    assert.ok(initialMeshes > 200, 'original furniture, machines, people and room geometry remain; surface patterns no longer need hundreds of duplicate tile meshes');
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
  ['expansion', 'expansion-marker', { type: 'renovate' }],
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

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) {
  for (const dpr of [1, 1.75]) {
    test(`TC-3D-023 counter coffee left / upgrade right at ${width}×${height}, DPR ${dpr}: separate physical targets (projection/input only)`, () => {
      const f = fixture(width, height, 1 / dpr);
      try {
        const expected = [];
        for (const id of ['counter-a', 'counter-b']) {
          f.renderer.focusAnchor(`${id}-recipe`);
          const selector = f.renderer.scene.getMeshByName(`${id}-recipe-selector`);
          const upgrade = f.renderer.scene.getMeshByName(`${id}-upgrade-plaque`);
          const mount = mesh => f.renderer.scene.getMeshByName(mesh.metadata.coffeeMount);
          const projectedXs = mesh => {
            mesh.computeWorldMatrix(true);
            return mesh.getBoundingInfo().boundingBox.vectorsWorld.map(point => Vector3.Project(point, Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight())).x / dpr);
          };
          const coffeeRight = Math.max(...[selector, mount(selector)].flatMap(projectedXs));
          const upgradeLeft = Math.min(...[upgrade, mount(upgrade)].flatMap(projectedXs));
          assert.ok(coffeeRight < upgradeLeft, `${id}: selector and its mount are entirely screen-left of upgrade and its mount (${coffeeRight.toFixed(2)} < ${upgradeLeft.toFixed(2)})`);
          const actionMeshes = f.renderer.scene.meshes.filter(mesh => mesh.metadata?.coffeeAction?.id === id);
          assert.deepEqual(actionMeshes.map(mesh => mesh.name).sort(), [selector, mount(selector), upgrade, mount(upgrade)].map(mesh => mesh.name).sort(), `${id}: only the two mounted physical controls dispatch actions, never the whole cabinet`);
          for (const [mesh, key, action] of [
            [selector, `${id}-recipe`, { type: 'recipe', id }],
            [upgrade, `${id}-upgrade`, { type: 'counter', id }],
          ]) {
            f.renderer.focusAnchor(key);
            assert.equal(f.renderer.projectAnchor(key).visible, true);
            assert.ok(surfaceDiameter(f, mesh.name) >= 24, `${key}: the actual polygon still has a 24px touch diameter`);
            const point = screenPoint(f, mesh.name);
            const pick = f.renderer.scene.pick(point.x / dpr, point.y / dpr);
            assert.equal(pick?.pickedMesh, mesh, `${key}: ray hits the visible label itself`);
            tap(f, mesh.name);
            expected.push(action);
            assert.deepEqual(f.actions, expected, `${key}: pointer invokes only its own panel action`);
            assert.equal(f.renderer.activateFocused(), true, `${key}: separate keyboard action remains available`);
            expected.push(action);
            assert.deepEqual(f.actions, expected);
          }
          const body = f.renderer.scene.getMeshByName(`${id}-body`);
          assert.equal(body.isPickable, true, `${id}: cabinet remains an occluding solid`);
          assert.equal(body.metadata?.coffeeAction, undefined, `${id}: undecorated cabinet is not an upgrade shortcut`);
          // This visible gap between front slats is outside both plaques.
          const gap = screenPoint(f, body.name, new Vector3(.25 / body.scaling.x, 0, .5));
          const gapPick = f.renderer.scene.pick(gap.x / dpr, gap.y / dpr);
          assert.equal(gapPick?.pickedMesh, body, `${id}: middle gap really hits cabinet, not an invisible overlay`);
          f.canvas.emit('pointerdown', { ...gap, timeStamp: 300 });
          f.canvas.emit('pointerup', { ...gap, timeStamp: 400 });
          assert.deepEqual(f.actions, expected, `${id}: tapping between coffee and upgrade opens neither panel`);
        }
      } finally { f.dispose(); }
    });
  }
}

test('TC-3D-023 each A/B front control respects solid occlusion and a press cannot transfer between coffee and upgrade', () => {
  const f = fixture(390, 844, 1 / 1.75);
  try {
    const expected = [];
    for (const id of ['counter-a', 'counter-b']) {
      for (const [key, name, action] of [
        [`${id}-recipe`, `${id}-recipe-selector`, { type: 'recipe', id }],
        [`${id}-upgrade`, `${id}-upgrade-plaque`, { type: 'counter', id }],
      ]) {
        f.renderer.focusAnchor(key);
        const blocker = addForegroundBlocker(f, name);
        tap(f, name);
        assert.equal(f.renderer.activateFocused(), false, `${key}: fully covered control cannot activate by keyboard`);
        assert.deepEqual(f.actions, expected, `${key}: no pointer click-through`);
        blocker.dispose();
        tap(f, name);
        expected.push(action);
        assert.equal(f.renderer.activateFocused(), true, `${key}: uncovering restores its own keyboard action`);
        expected.push(action);
        assert.deepEqual(f.actions, expected);
      }
      f.renderer.focusAnchor(`${id}-recipe`);
      const left = screenPoint(f, `${id}-recipe-selector`), right = screenPoint(f, `${id}-upgrade-plaque`);
      for (const [down, up] of [[left, right], [right, left]]) {
        f.canvas.emit('pointerdown', { ...down, timeStamp: 500 });
        f.canvas.emit('pointerup', { ...up, timeStamp: 600 });
      }
      assert.deepEqual(f.actions, expected, `${id}: neither press can be retargeted to its neighboring control`);
    }
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

test('TC-3D-001 cups, brew progress and machine upgrades are state-driven', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    state.counters[0].level = 2;
    state.counters[0].recipe = 'latte'; // Existing brew retains its original espresso appearance.
    state.counters[0].pendingCash = 950;
    state.counters[0].brew = { recipe: 'espresso', customerId: 10, elapsed: 2, duration: 4, price: 110 };
    state.customers = [{ id: 10, x: 0, z: 1.5, phase: 'serving', counterId: 'counter-a', timer: 0, hasCup: false, skin: 2 }];
    f.renderer.update(state, .05);
    const scene = f.renderer.scene;
    assert.equal(scene.getMeshByName('counter-a-progress').isEnabled(), true);
    assert.ok(Math.abs(scene.getMeshByName('counter-a-progress-fill').scaling.x - .45) < 1e-9);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').isEnabled(), true);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').scaling.x, .82);
    assert.equal(scene.getTransformNodeByName('customer-10-takeaway').isEnabled(), false, 'cup remains at the machine during brewing');
    assert.equal(scene.getTransformNodeByName('counter-a-upgrade-copper').isEnabled(), true);
    state.counters[0].brew.elapsed = 4;
    state.customers[0].phase = 'receiving'; state.customers[0].hasCup = true;
    f.renderer.update(state, .05);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').isEnabled(), false, 'the handed cup is no longer drawn on the machine');
    assert.equal(scene.getTransformNodeByName('customer-10-takeaway').isEnabled(), true, 'exactly one cup is shown during receipt');
    state.counters[0].brew = null; state.counters[0].pendingCash = 0;
    f.renderer.update(state, .05);
    assert.equal(scene.getMeshByName('counter-a-progress').isEnabled(), false);
    assert.equal(scene.getTransformNodeByName('counter-a-ready-cup').isEnabled(), false);
    assert.equal(scene.getTransformNodeByName('customer-10-takeaway').isEnabled(), true, 'departing customer carries the actual cup');
  } finally { f.dispose(); }
});

test('TC-3D-027 closing admissions keeps guests animated; closed empty shop freezes and disposal is safe', () => {
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
  assert.notDeepEqual([pose(customer), pose(leg)], before, 'existing guests finish with an animated gait after closing');
  state.customers = []; f.renderer.update(state, .1);
  const frozenTime = f.renderer.animationTime;
  for (let frame = 0; frame < 10; frame++) f.renderer.update(state, .1);
  assert.equal(f.renderer.animationTime, frozenTime, 'the drained closed shop stops ambient motion');
  assert.equal(f.canvas.listenerCount(), 6);
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
    test(`TC-3D-006 physical ${width}×${height} at DPR ${dpr}: cutaway, shared anchors and reachable controls (projection only)`, () => {
      const f = fixture(width, height, 1 / dpr);
      try {
        const initial = physicalControls.map(([key]) => f.renderer.projectAnchor(key));
        assert.equal(f.canvas.width, width, 'canvas has the actual physical viewport CSS width');
        assert.equal(f.canvas.height, height, 'no wide scrolling canvas surrogate');
        assert.equal(f.renderer.scene.getMeshByName('shop-plinth'), null, 'floor meets the exterior ground rather than a floating plinth');
        if (width < height && width < 500) {
          assert.ok(initial.filter(point => !point.visible).length >= 2, 'portrait crops the world rather than fitting every small target');
          const camera = f.renderer.scene.activeCamera;
          const span = camera.orthoRight - camera.orthoLeft;
          assert.ok(span < 6, 'portrait retains large counters');
        }
        const counter = f.renderer.scene.getMeshByName('counter-a-countertop');
        counter.computeWorldMatrix(true);
        const projected = counter.getBoundingInfo().boundingBox.vectorsWorld.map(v => Vector3.Project(v, Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight())));
        const counterWidth = (Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) / dpr;
        assert.ok(counterWidth >= (height < 500 ? 110 : width >= 1000 ? 130 : 190), `counter has meaningful screen scale (${counterWidth.toFixed(0)} CSS px)`);
        for (const [key, mesh] of physicalControls) {
          f.renderer.focusAnchor(key);
          const p = f.renderer.projectAnchor(key), physical = screenPoint(f, mesh);
          assert.equal(p.visible, true, `${key} can be brought fully into view at its physical size`);
          assert.ok(p.x >= 12 && p.x <= width - 12 && p.y >= 12 && p.y <= height - 12);
          const footprint = f.renderer.getAnchorFootprint(key);
          assert.ok(footprint.width >= 24 && footprint.height >= 24, `${key} actual geometry is at least 24 CSS px in both axes (${footprint.width.toFixed(1)}×${footprint.height.toFixed(1)})`);
          assert.ok(Math.abs(p.x - (physical.clientX - 35)) < .01 && Math.abs(p.y - (physical.clientY - 80)) < .01, `${key} diagnostic and physical target share the same world point`);
          tap(f, mesh);
        }
        assert.deepEqual(f.actions, physicalControls.map(([, , action]) => action), 'DPR is applied exactly once when picking each surviving physical control');
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
          const pick = f.renderer.scene.pick(x, y, mesh => Boolean(mesh.metadata?.coffeeEnvironment || mesh.metadata?.coffeeExterior), false, camera);
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
    assert.deepEqual(f.renderer.projectAnchor('counter-a-upgrade'), { x: 0, y: 0, visible: false });
    f.renderer.focusAnchor('counter-a-upgrade');
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
  // a 24px circle fits on the actual projected parallelogram, not just its bounding box.
  return Math.abs(ex * fy - ey * fx) / Math.max(Math.hypot(ex, ey), Math.hypot(fx, fy));
}

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) {
  for (const dpr of [1, 1.75]) {
    test(`TC-3D-008 actual control polygon accepts a 24px circle at ${width}×${height}, DPR ${dpr} (geometry only)`, () => {
      const f = fixture(width, height, 1 / dpr);
      try {
        for (const [key, mesh] of physicalControls) {
          f.renderer.focusAnchor(key);
          const diameter = surfaceDiameter(f, mesh);
          assert.ok(diameter >= 24, `${key}: actual plane edge spacing ${diameter.toFixed(2)} CSS px`);
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
    assert.equal(labels.length, 7);
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
      assert.equal(mesh.billboardMode, 0, `${mesh.name}: no billboard progress/control`);
      if (mesh.metadata?.coffeeAction) {
        assert.equal(mesh.isVisible, true, `${mesh.name}: no hidden action hitbox`);
        assert.equal(mesh.material?.alpha ?? 1, 1, `${mesh.name}: action geometry is opaque`);
      }
    }
    assert.equal(f.renderer.scene.getMeshByName('counter-a-progress').parent.name, 'counter-a-machine');
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
    f.renderer.focusAnchor('counter-b-upgrade');
    const blocker = addForegroundBlocker(f, 'counter-b-upgrade-plaque');
    assert.equal(f.renderer.projectAnchor('counter-b-upgrade').visible, true, 'projection alone does not know occlusion');
    tap(f, 'counter-b-upgrade-plaque');
    assert.equal(f.renderer.activateFocused(), false, 'fully covered focused mesh cannot activate');
    assert.deepEqual(f.actions, [], 'no predicate-only click-through');
    blocker.setEnabled(false);
    tap(f, 'counter-b-upgrade-plaque');
    assert.equal(f.renderer.activateFocused(), true);
    assert.deepEqual(f.actions, [{ type: 'counter', id: 'counter-b' }, { type: 'counter', id: 'counter-b' }]);
    f.renderer.panBy(100000, 100000);
    assert.equal(f.renderer.projectAnchor('counter-b-upgrade').visible, false);
    assert.equal(f.renderer.activateFocused(), false, 'panned-away control cannot activate');
  } finally { f.dispose(); }
});

test('TC-3D-008 pointer start and release require the same visible physical mesh, exactly once', () => {
  const f = fixture();
  try {
    f.renderer.focusAnchor('counter-a-upgrade');
    const point = screenPoint(f, 'counter-a-upgrade-plaque');
    const state = createInitialState();
    const furnishing = f.renderer.scene.getTransformNodeByName('counter-a-station');
    const originalX = furnishing.position.x;
    f.canvas.emit('pointerdown', { ...point, timeStamp: 10 });
    // A QA-only transform change verifies the guard without mutating the simulation snapshot.
    for (const mesh of furnishing.getChildMeshes()) mesh.unfreezeWorldMatrix();
    furnishing.position.x += 2;
    f.renderer.update(state, 0);
    f.canvas.emit('pointerup', { ...point, timeStamp: 160 });
    assert.deepEqual(f.actions, [], 'surface leaving the original press cannot retarget it');
    f.renderer.focusAnchor('counter-a-upgrade');
    const moved = screenPoint(f, 'counter-a-upgrade-plaque');
    const blocker = addForegroundBlocker(f, 'counter-a-upgrade-plaque');
    f.canvas.emit('pointerdown', { ...moved, timeStamp: 200 });
    blocker.setEnabled(false);
    f.canvas.emit('pointerup', { ...moved, timeStamp: 300 });
    assert.deepEqual(f.actions, [], 'press on foreground cannot become a newly uncovered action');
    f.renderer.focusAnchor('counter-a-upgrade');
    const centered = screenPoint(f, 'counter-a-upgrade-plaque');
    f.canvas.emit('pointerdown', { ...centered, timeStamp: 350 });
    furnishing.position.x = originalX;
    f.renderer.update(state, 0);
    furnishing.position.x = originalX + 2;
    f.renderer.update(state, 0);
    f.canvas.emit('pointerup', { ...centered, timeStamp: 550 });
    assert.deepEqual(f.actions, [], 'moving away and back invalidates the original press');
    tap(f, 'counter-a-upgrade-plaque', 'counter-a-upgrade');
    f.canvas.emit('pointerup', { ...moved, timeStamp: 620 });
    assert.deepEqual(f.actions, [{ type: 'counter', id: 'counter-a' }], 'one captured tap fires once');
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
    f.renderer.focusAnchor('counter-a-upgrade');
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
    f.renderer.focusAnchor('counter-a-recipe');
    const mesh = f.renderer.scene.meshes.find(mesh => mesh.metadata?.coffeeAnchor === 'counter-a-recipe');
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

function bounds(mesh) {
  mesh.computeWorldMatrix(true);
  return mesh.getBoundingInfo().boundingBox;
}
function projectedBounds(f, meshes) {
  const scene = f.renderer.scene;
  const scale = f.engine.getHardwareScalingLevel();
  const points = meshes.flatMap(mesh => bounds(mesh).vectorsWorld.map(world => {
    const p = Vector3.Project(world, Matrix.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight()));
    return { x: p.x * scale, y: p.y * scale };
  }));
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}

// Evaluate the actual box UV basis rather than trusting descriptive metadata. The repeating
// ink can only follow the room axes if the face's UV edges map to those physical axes.
function faceUVBasis(mesh, axis) {
  const positions = mesh.getVerticesData('position');
  const normals = mesh.getVerticesData('normal');
  const uv = mesh.getVerticesData('uv');
  mesh.computeWorldMatrix(true);
  const vertices = [];
  for (let i = 0; i < positions.length / 3; i++) {
    if (normals[i * 3 + axis] < .99) continue;
    vertices.push({ u: uv[i * 2], v: uv[i * 2 + 1], world: Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), mesh.getWorldMatrix()) });
  }
  const origin = vertices.find(p => p.u === 0 && p.v === 0);
  return {
    u: vertices.find(p => p.u === 1 && p.v === 0).world.subtract(origin.world),
    v: vertices.find(p => p.u === 0 && p.v === 1).world.subtract(origin.world),
  };
}

test('TC-3D-010 pattern ink uses equal floor-axis strokes and diffuse contrast without self-light', () => {
  const f = fixture();
  try {
    const painted = [];
    const ctx = { fillStyle: '', fillRect(...rect) { painted.push({ fill: this.fillStyle, rect }); } };
    const floor = f.renderer.scene.getMeshByName('continuous-shop-floor');
    const pattern = floor.material.metadata.coffeePattern;
    f.renderer.paintSurfacePattern(ctx, pattern.fill, pattern.seam, true);
    assert.deepEqual(painted, [
      { fill: '#e7ddc8', rect: [0, 0, 512, 512] },
      { fill: '#c2b49b', rect: [0, 0, 3, 512] },
      { fill: '#c2b49b', rect: [0, 0, 512, 3] },
    ], 'one repeated texture has exactly the same muted seam color and thickness on both floor axes');
    painted.length = 0;
    f.renderer.paintSurfacePattern(ctx, '#286c67', '#205f5b', false);
    assert.deepEqual(painted, [
      { fill: '#286c67', rect: [0, 0, 512, 512] },
      { fill: '#205f5b', rect: [0, 0, 8, 512] },
    ], 'wall panel joints are vertical ink on the wall plane');
    const ambient = f.renderer.scene.getLightByName('soft-skylight');
    const sun = f.renderer.scene.getLightByName('warm-window-light');
    assert.ok(ambient.intensity + sun.intensity * Math.abs(sun.direction.normalizeToNew().y) <= 1.05, 'pale horizontal surfaces avoid the previous diffuse-overexposure budget');
    const channels = value => value.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255);
    const fill = channels(pattern.fill.slice(1)), seam = channels(pattern.seam.slice(1));
    assert.ok(fill.every((value, i) => value - seam[i] > .13), 'grout has a nontrivial diffuse contrast before actual browser/color-management QA');
  } finally { f.dispose(); }
});

test('TC-3D-011 static work is frozen while live actors, cups and physical controls stay correct', () => {
  const f = fixture();
  try {
    const scene = f.renderer.scene;
    assert.equal(scene.getMeshByName('continuous-shop-floor').isWorldMatrixFrozen, true);
    assert.equal(scene.getMeshByName('counter-a-countertop').isWorldMatrixFrozen, true);
    assert.equal(scene.getMeshByName('counter-a-progress-fill').isWorldMatrixFrozen, false);
    assert.equal(scene.getMeshByName('counter-a-ready-cup-cup').isWorldMatrixFrozen, false);
    assert.equal(scene.getMeshByName('shared-box').isWorldMatrixFrozen, false, 'later clones never inherit a frozen source matrix');
    const before = f.renderer.readRenderStats();
    assert.ok(before.frozenMeshes >= 100, 'fixed room geometry avoids per-frame world-matrix updates');
    const state = createInitialState();
    state.customers = [{ id: 1, x: 0, z: 2, phase: 'leaving', counterId: 'counter-a', timer: 0, hasCup: true, skin: 0 }];
    f.renderer.update(state, 0);
    const actor = scene.getMeshByName('customer-1-shirt');
    assert.equal(actor.isWorldMatrixFrozen, false);
    const oldX = actor.getAbsolutePosition().x;
    state.customers[0].x = 1;
    f.renderer.update(state, 0);
    assert.ok(Math.abs(actor.getAbsolutePosition().x - oldX - 1) < 1e-6, 'new actor meshes follow their live parent');
    for (const caster of f.renderer.staticCasters) {
      assert.ok(!/^(customer-|manager-|cart-|counter-[ab]-barista)/.test(caster.name), `${caster.name} cannot enter the cached furniture shadow map`);
      assert.equal(caster.isDisposed(), false);
    }
    state.customers = [];
    f.renderer.update(state, 0);
    assert.equal(f.renderer.readRenderStats().meshCount, before.meshCount, 'departed people do not accumulate scene resources');
    for (const [key] of physicalControls) { f.renderer.focusAnchor(key); assert.equal(f.renderer.activateFocused(), true, key); }
    assert.equal(f.actions.length, physicalControls.length);
  } finally { f.dispose(); }
});

test('TC-3D-026 floor has no route carpets or arrows', () => {
  const f = fixture();
  try {
    const removed = /^(queue-rug-|manager-route$|route-dash-|departure-aisle-|departure-return-lane$|customer-exit-boundary$|welcome-runner$|(?:queue|departure|entry)-arrow-)/;
    assert.ok(!f.renderer.scene.meshes.some(mesh => removed.test(mesh.name)));
    assert.equal(f.renderer.scene.getMeshByName('continuous-shop-floor').metadata.coffeeSurface, 'floor');
    assert.ok(f.renderer.scene.getMeshByName('entrance-threshold'));
  } finally { f.dispose(); }
});

test('TC-3D-026 moving contact disks remain above the uninterrupted physical tile floor', () => {
  const f = fixture();
  try {
    const state = createInitialState();
    state.customers = [{ id: 99, x: 0, z: 6.11, phase: 'queue', counterId: 'counter-a', timer: 0, hasCup: false, skin: 0 }];
    f.renderer.update(state, 0);
    const scene = f.renderer.scene;
    const shadow = bounds(scene.getMeshByName('customer-99-contact-shadow'));
    assert.ok(shadow.minimumWorld.y > bounds(scene.getMeshByName('continuous-shop-floor')).maximumWorld.y);
  } finally { f.dispose(); }
});

test('TC-3D-011 cached shadow bounds cover static furniture and upgrades invalidate once (NullEngine math)', () => {
  const f = fixture();
  try {
    const scene = f.renderer.scene;
    const generator = new ShadowGenerator(1024, scene.getLightByName('warm-window-light'));
    f.renderer.shadowGenerator = generator;
    f.renderer.prepareStaticGeometry();
    const map = generator.getShadowMap();
    assert.equal(map.refreshRate, 0);
    assert.ok(map.renderList.length > 50);
    assert.ok(map.renderList.every(mesh => !/^(customer-|manager-|cart-|counter-[ab]-barista)/.test(mesh.name)));
    const matrix = generator.getTransformMatrix().clone();
    for (const mesh of map.renderList) {
      for (const corner of bounds(mesh).vectorsWorld) {
        const point = Vector3.TransformCoordinates(corner, matrix);
        assert.ok(Math.abs(point.x) <= 1.001 && Math.abs(point.y) <= 1.001 && Math.abs(point.z) <= 1.001, `${mesh.name} is inside the cached shadow frustum`);
      }
    }
    let invalidations = 0;
    const reset = map.resetRefreshCounter.bind(map);
    map.resetRefreshCounter = () => { invalidations++; reset(); };
    const state = createInitialState();
    // Exercise invalidation directly: NullEngine has no GPU-ready shadow effects.
    f.renderer.updateStation(f.renderer.stations.get('counter-a'), state.counters[0], false);
    assert.equal(invalidations, 0, 'unchanged frames do not refresh furniture shadows');
    state.counters[0].level = 6;
    // Exercise invalidation directly: NullEngine has no GPU-ready shadow effects.
    f.renderer.updateStation(f.renderer.stations.get('counter-a'), state.counters[0], false);
    assert.equal(invalidations, 1, 'enabling machine extras refreshes their static shadow');
    // Exercise invalidation directly: NullEngine has no GPU-ready shadow effects.
    f.renderer.updateStation(f.renderer.stations.get('counter-a'), state.counters[0], false);
    assert.equal(invalidations, 1);
    f.renderer.focusAnchor('invite'); f.renderer.resize();
    assert.deepEqual(generator.getTransformMatrix().asArray(), matrix.asArray(), 'pan/resize do not move the fixed-world shadow projection');
  } finally { f.dispose(); }
});

test('TC-3D-012 renderer pairs Babylon frame boundaries and changes quality without rebuilding the scene', () => {
  const f = fixture();
  try {
    const scene = f.renderer.scene;
    const meshes = scene.meshes.length;
    const frames = f.renderer.readRenderStats().renderedFrames;
    const frameId = f.engine.frameId;
    f.renderer.update(createInitialState(), 1 / 60);
    assert.equal(f.engine.frameId, frameId + 1);
    assert.equal(f.renderer.readRenderStats().renderedFrames, frames + 1);
    for (const [mode, target] of [['clear-60', 60], ['balanced', 60], ['low-power', 30], ['smooth', null]]) {
      f.renderer.setRenderMode(mode);
      assert.equal(f.renderer.readRenderStats().renderMode, mode);
      assert.equal(f.renderer.readRenderStats().targetFps, target);
      assert.equal(f.renderer.scene, scene);
      assert.equal(scene.meshes.length, meshes);
    }
  } finally { f.dispose(); }
});

test('TC-3D-014 QA identity reads actual customer mesh and CSS projection without changing render objects', () => {
  const f = fixture(1280, 900, 2);
  try {
    const core = createEngine(); core.invite(); f.renderer.update(core.state, .016);
    const mesh = f.renderer.scene.getTransformNodeByName('customer-1');
    assert.ok(mesh);
    const meshCount = f.renderer.scene.meshes.length;
    const pose = f.renderer.readCustomerPose(1);
    assert.equal(pose.x, mesh.position.x); assert.equal(pose.z, mesh.position.z);
    const projected = Vector3.Project(new Vector3(mesh.position.x, mesh.position.y + 2.25, mesh.position.z), Matrix.Identity(), f.renderer.scene.getTransformMatrix(), f.renderer.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight()));
    assert.ok(Math.abs(pose.screenX - (35 + projected.x * 2)) < 1e-7);
    assert.ok(Math.abs(pose.screenY - (80 + projected.y * 2)) < 1e-7);
    pose.x = 999; assert.equal(f.renderer.readCustomerPose(1).x, core.state.customers[0].x);
    mesh.position.x = 999;
    assert.equal(f.renderer.readCustomerPose(1).x, 999, 'readback must use the mesh, not a remembered simulation snapshot');
    assert.equal(f.renderer.readCustomerPose(1).inViewport, false, 'camera offscreen is still an existing mesh');
    assert.equal(f.renderer.scene.meshes.length, meshCount);
    assert.equal(f.renderer.readCustomerPose(null), null); assert.equal(f.renderer.readCustomerPose(999), null);
    core.state.customers = []; f.renderer.update(core.state, .016);
    assert.equal(f.renderer.readCustomerPose(1), null);
    f.renderer.dispose(); assert.equal(f.renderer.readCustomerPose(1), null);
  } finally { f.dispose(); }
});


test('TC-3D-027 finite cutaway exposes an exterior and removes manager, vault, cash piles and coffee wall controls completely', () => {
  const f = fixture();
  try {
    const scene = f.renderer.scene, floor = bounds(scene.getMeshByName('continuous-shop-floor'));
    assert.ok(Math.abs(floor.minimumWorld.x - (GRID.minX - .5)) < 1e-6);
    assert.ok(Math.abs(floor.maximumWorld.x - (GRID.maxX + .5)) < 1e-6);
    assert.ok(Math.abs(floor.maximumWorld.z - (GRID.maxZ + .5)) < 1e-6);
    assert.equal(scene.getMeshByName('rear-wall').scaling.y, 3.3, 'trimmed wall does not fill the viewport with a giant room');
    assert.equal(scene.getMeshByName('front-wall'), null, 'the near side is cut away');
    for (const name of ['continuous-shop-floor', 'expansion-floor']) {
      const mesh = scene.getMeshByName(name), uv = faceUVBasis(mesh, 1);
      const material = name === 'expansion-floor' ? f.renderer.expansionTiles : mesh.material;
      const pattern = material.metadata.coffeePattern;
      assert.ok(Math.abs(uv.u.length() / pattern.repeatU - 1) < 1e-6);
      assert.ok(Math.abs(uv.v.length() / pattern.repeatV - 1) < 1e-6, 'one-metre tile ink keeps the same scale across the expansion');
    }
    for (const name of ['exterior-lawn', 'rear-pavement', 'entrance-outside-walk', 'exit-outside-walk', 'neighborhood-road']) assert.ok(scene.getMeshByName(name), name);
    for (const node of [...scene.meshes, ...scene.transformNodes]) assert.ok(!/^(manager(?:-|$)|cart-|vault-|cash-vault|menu-|counter-\w-cash)/.test(node.name), `${node.name} must not retain removed systems`);
    assert.ok(scene.meshes.every(mesh => !['menu', 'vault', 'layout-wall'].includes(mesh.metadata?.coffeeAction?.type)));
    assert.equal(scene.getMeshByName('brand-sign').metadata.coffeeAction, undefined, 'brand is not an extra renovation menu');
    for (const key of ['menu-espresso', 'menu-latte', 'vault', 'renovate']) assert.equal(f.renderer.projectAnchor(key).visible, false);
    const before = [scene.meshes.length, scene.materials.length, scene.textures.length];
    const state = createInitialState(); state.coffeeLevels.espresso = 5; state.coffeeLevels.latte = 3;
    state.layout.coffeeSigns.forEach(sign => sign.stored = false);
    f.renderer.update(state, 0);
    assert.deepEqual([scene.meshes.length, scene.materials.length, scene.textures.length], before, 'legacy wall sign records cannot resurrect scene controls');
    assert.equal(f.renderer.pickLayoutPlacement(400, 400, 'menu-espresso'), null);
    for (const name of ['garden-plant-entry', 'garden-plant-front', 'garden-plant-rear']) {
      const root = scene.getTransformNodeByName(name);
      assert.ok(root.position.x < GRID.minX - .5 || root.position.x > GRID.expandedMaxX + .5 || root.position.z < GRID.minZ - .5 || root.position.z > GRID.maxZ + .5, `${name} cannot become an unmodelled navigation obstacle`);
    }
  } finally { f.dispose(); }
});

for (const expanded of [false, true]) test(`TC-3D-027 actual entrance is screen-right and exit screen-left with clear crossings, expanded=${expanded}`, () => {
  const f = fixture();
  try {
    const state = createInitialState(); state.layout.expanded = expanded; f.renderer.update(state, 0);
    const scene = f.renderer.scene, entrance = scene.getTransformNodeByName('entrance-doorway'), exit = scene.getTransformNodeByName('exit-doorway');
    assert.deepEqual(entrance.position.asArray(), [GRID.entry.x - .5, 0, GRID.entry.z]);
    assert.deepEqual(exit.position.asArray(), [layoutExitAnchor(state.layout).x + .5, 0, layoutExit(state.layout).z]);
    const entryScreen = f.renderer.projectLayoutCell(entrance.position.x, entrance.position.z);
    const exitScreen = f.renderer.projectLayoutCell(exit.position.x, exit.position.z);
    assert.ok(entryScreen.x > exitScreen.x + 300, 'right and left describe the actual camera projection');
    if (!expanded) { assert.equal(entryScreen.visible, true); assert.equal(exitScreen.visible, true); }
    assert.equal(scene.getMeshByName('invite-guest-sign').metadata.coffeeDoorLabel, 'entrance');
    assert.equal(scene.getMeshByName('exit-door-sign').metadata.coffeeDoorLabel, 'exit');
    for (const doorway of [entrance, exit]) {
      const start = new Vector3(doorway.position.x - .6, 1, doorway.position.z);
      const hit = scene.pickWithRay(new Ray(start, new Vector3(1, 0, 0), 1.2));
      assert.equal(hit?.hit, false, 'real body-height ray crosses the open threshold without a door panel or decorative obstacle');
    }
    for (const point of [layoutEntrySpawn(), layoutExit(state.layout)]) {
      const pick = scene.pickWithRay(new Ray(new Vector3(point.x, .5, point.z), new Vector3(0, -1, 0), 1));
      assert.equal(pick?.pickedMesh?.metadata.coffeeExterior, 'paving', 'actors start and end on the visible exterior pavement');
    }
    assert.equal(scene.getTransformNodeByName('expanded-rear-wall').isEnabled(), expanded);
    assert.equal(scene.getTransformNodeByName('expansion-locked-divider').isEnabled(), !expanded);
  } finally { f.dispose(); }
});

test('TC-3D-027 backdrops change only exterior colors, stay bounded and do not mutate business state', () => {
  const f = fixture();
  try {
    const state = createInitialState(), original = JSON.stringify(state), scene = f.renderer.scene;
    const protectedMaterials = ['continuous-shop-floor', 'rear-wall', 'counter-a-body', 'counter-a-upgrade-plaque'].map(name => [scene.getMeshByName(name), scene.getMeshByName(name).material]);
    const paints = [];
    for (const theme of ['garden', 'terrace', 'sunset']) {
      f.renderer.setBackdrop(theme); f.renderer.update(state, 0);
      paints.push(scene.getMeshByName('exterior-lawn').material.diffuseColor.toHexString());
      for (const [mesh, material] of protectedMaterials) assert.equal(mesh.material, material);
      assert.equal(JSON.stringify(state), original);
    }
    assert.equal(new Set(paints).size, 3);
    const baseline = [scene.meshes.length, scene.materials.length, scene.textures.length];
    for (let cycle = 0; cycle < 15; cycle++) for (const theme of ['garden', 'terrace', 'sunset']) f.renderer.setBackdrop(theme);
    assert.deepEqual([scene.meshes.length, scene.materials.length, scene.textures.length], baseline);
    f.renderer.dispose(); f.renderer.setBackdrop('garden');
  } finally { f.dispose(); }
});
