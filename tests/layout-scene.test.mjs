import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { CoffeeScene } = await import('../src/slice/render/CoffeeScene.ts');
const { createInitialState } = await import('../src/slice/core/engine.ts');
const { initialLayout, interactionPoint } = await import('../src/slice/core/layout.ts');

// Structural CPU evidence only. Browser/pixel/input-device acceptance is separate.
class Canvas {
  events = new Map(); captured = new Set();
  constructor(width = 1280, height = 900) { this.width = width; this.height = height; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  emit(type, values) { this.events.get(type)?.({ pointerId: 1, isPrimary: true, button: 0, timeStamp: 100, ...values }); }
}
function fixture(width, height) {
  const canvas = new Canvas(width, height), actions = [];
  const engine = new NullEngine({ renderWidth: canvas.width, renderHeight: canvas.height, textureSize: 512 });
  const renderer = new CoffeeScene(canvas, action => actions.push(action), { engine, shadows: false });
  const state = createInitialState(); state.layout = initialLayout();
  renderer.update(state, 0);
  return { renderer, scene: renderer.scene, state, canvas, engine, actions, dispose() { renderer.dispose(); engine.dispose(); } };
}
function active(state, expanded = false) { state.layout = initialLayout(); state.layout.active = true; state.layout.expanded = expanded; return state.layout; }
function counts(f) { return [f.scene.meshes.length, f.scene.geometries.length, f.scene.materials.length, f.scene.textures.length, f.renderer.labels.length]; }
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} ~= ${expected}`); }
function world(node) { node.computeWorldMatrix(true); return node.getAbsolutePosition(); }
function project(f, mesh) { return Vector3.Project(world(mesh), Matrix.Identity(), f.scene.getTransformMatrix(), f.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight())); }

test('TC-3D-025 legacy room keeps physical controls and adds embodied renovation/expansion entrances', () => {
  const f = fixture();
  try {
    assert.equal(f.scene.meshes.filter(mesh => mesh.metadata?.coffeeLabel).length, 11);
    assert.equal(f.scene.getMeshByName('queue-rug-0').isEnabled(), true);
    for (const key of ['renovate', 'expansion']) {
      f.renderer.focusAnchor(key);
      assert.equal(f.renderer.projectAnchor(key).visible, true);
      assert.equal(f.renderer.activateFocused(), true, key);
    }
    assert.deepEqual(f.actions, [{ type: 'renovate' }, { type: 'renovate' }]);
    assert.equal(f.scene.getTransformNodeByName('expansion-locked-divider').isEnabled(), true);
    assert.equal(f.scene.getMeshByName('expansion-floor').metadata.coffeeExpansion, 'locked');
  } finally { f.dispose(); }
});

test('TC-3D-025 counter body, staff, money and both plaques follow one moved 90-degree footprint', () => {
  const f = fixture();
  try {
    const layout = active(f.state);
    Object.assign(layout.furniture[0], { x: -4, z: 2, rotation: 1 });
    f.state.counters[0].x = -4; f.state.counters[0].pendingCash = 330;
    const before = JSON.stringify(f.state);
    f.renderer.update(f.state, 0);
    assert.equal(JSON.stringify(f.state), before, 'presentation cannot mutate the business snapshot');
    const root = f.scene.getTransformNodeByName('counter-a-station');
    close(root.rotation.y, -Math.PI / 2);
    for (const [name, x, z] of [
      ['counter-a-body', -4, 2], ['counter-a-countertop', -4, 2],
      ['counter-a-barista', -3.11, 2.2], ['counter-a-cash-cluster', -4.04, .92],
      ['counter-a-upgrade-plaque', -3.235, 3.01], ['counter-a-recipe-selector', -3.235, .99],
    ]) {
      const mesh = f.scene.getNodeByName(name), position = world(mesh);
      close(position.x, x); close(position.z, z);
    }
    const body = f.scene.getMeshByName('counter-a-body');
    body.computeWorldMatrix(true);
    close(body.getBoundingInfo().boundingBox.maximumWorld.z - body.getBoundingInfo().boundingBox.minimumWorld.z, 3.4);
    assert.equal(f.scene.getTransformNodeByName('counter-a-cash-cluster').isEnabled(), true);
    assert.equal(f.scene.getMeshByName('queue-rug-0').isEnabled(), false);
    assert.equal(f.scene.getTransformNodeByName('left-waiting-bench').isEnabled(), false);
    assert.equal(f.scene.getMeshByName('manager-route').isEnabled(), false);
    const shadow = f.scene.getMeshByName('counter-a-barista-contact-shadow');
    close(shadow.position.x, -3.11); close(shadow.position.z, 2.2);
    assert.equal(f.scene.meshes.filter(mesh => mesh.name === 'counter-a-body').length, 1);
  } finally { f.dispose(); }
});

test('TC-3D-025 new C/D counters reconcile, stored furniture disappears and owned labels are disposed without shared materials', () => {
  const f = fixture();
  try {
    const layout = active(f.state, true);
    for (const [letter, x, z] of [['c', 0, 6], ['d', 13, 2]]) {
      layout.furniture.push({ id: `counter-${letter}`, kind: 'counter', counterId: `counter-${letter}`, x, z, rotation: 0, stored: false });
      f.state.counters.push({ id: `counter-${letter}`, x, level: 1, recipe: 'espresso', pendingCash: 0, brewed: 0, brew: null });
    }
    f.renderer.update(f.state, 0);
    assert.equal(f.renderer.stations.size, 4);
    assert.equal(f.scene.getTransformNodeByName('expansion-locked-divider').isEnabled(), false);
    assert.equal(f.scene.getMeshByName('expansion-floor').metadata.coffeeExpansion, 'open');
    const owned = f.renderer.labels.filter(label => label.mesh.name.startsWith('counter-c-'));
    let disposedInk = 0; for (const label of owned) label.texture = { dispose() { disposedInk++; } };
    const ownMaterials = owned.map(label => label.mesh.material);
    const wood = f.scene.getMeshByName('counter-c-body').material;
    layout.furniture.find(item => item.id === 'counter-c').stored = true;
    f.renderer.update(f.state, 0);
    assert.equal(disposedInk, 3);
    assert.equal(f.scene.getNodeByName('counter-c-station'), null);
    assert.equal(f.scene.getMeshByName('counter-c-barista-contact-shadow'), null);
    assert.equal(f.renderer.projectAnchor('counter-c-upgrade').visible, false);
    assert.ok(ownMaterials.every(material => !f.scene.materials.includes(material)));
    assert.ok(f.scene.materials.includes(wood));
    assert.ok([...f.renderer.staticCasters].every(mesh => !mesh.isDisposed()));
    assert.equal(f.renderer.stations.size, 3);
  } finally { f.dispose(); }
});

test('TC-3D-025 table and chair share the rotated unit and dining customer occupies its reserved seat with a cup', () => {
  const f = fixture();
  try {
    const layout = active(f.state);
    const table = { id: 'table-1', kind: 'table', x: -4, z: 4, rotation: 1, stored: false };
    layout.furniture.push(table);
    const seat = interactionPoint(table, 'seat');
    f.state.customers = [{ id: 31, ...seat, phase: 'dining', counterId: 'counter-a', timer: 0, hasCup: true, skin: 0, seatId: table.id }];
    f.renderer.update(f.state, 0);
    const chair = f.scene.getMeshByName('table-1-chair-seat'), top = f.scene.getMeshByName('table-1-table-top');
    assert.equal(chair.parent, top.parent);
    close(world(chair).x, seat.x); close(world(chair).z, seat.z);
    const diner = f.scene.getTransformNodeByName('customer-31');
    close(diner.position.x, seat.x); close(diner.position.z, seat.z); close(diner.rotation.y, Math.PI / 2);
    assert.ok(diner.position.y < 0);
    close(f.scene.getTransformNodeByName('customer-31-left-hip').rotation.x, -1.4);
    assert.equal(f.scene.getTransformNodeByName('customer-31-takeaway').isEnabled(), true);
    f.state.customers[0].phase = 'leaving'; delete f.state.customers[0].seatId;
    f.renderer.update(f.state, 0);
    close(diner.position.y, 0); close(f.scene.getTransformNodeByName('customer-31-left-hip').rotation.x, 0);
  } finally { f.dispose(); }
});

test('TC-3D-025 detached preview shows valid/invalid footprint, real object selection and grid-cell taps, and cancel restores the shop', () => {
  const f = fixture();
  try {
    const preview = structuredClone(f.state.layout); preview.active = true;
    f.renderer.setRenovationPreview(preview, 'counter-a', true);
    f.renderer.update(f.state, 0);
    assert.equal(f.renderer.gridCells.size, 18 * 13);
    const ghost = f.scene.getMeshByName('renovation-footprint-ghost');
    assert.equal(ghost.metadata.coffeePlacementValid, true); close(ghost.scaling.x, 4.98); close(ghost.scaling.z, 2.98);
    const green = ghost.material;
    preview.furniture[0].rotation = 1;
    f.renderer.setRenovationPreview(preview, 'counter-a', false);
    assert.equal(ghost.metadata.coffeePlacementValid, false); assert.notEqual(ghost.material, green);
    close(ghost.scaling.x, 2.98); close(ghost.scaling.z, 4.98);
    preview.furniture[0].rotation = 0;
    f.renderer.setRenovationPreview(preview, 'counter-a', true);
    f.renderer.focusAnchor('counter-a-upgrade');
    const plaque = project(f, f.scene.getMeshByName('counter-a-upgrade-plaque'));
    f.canvas.emit('pointerdown', { clientX: plaque.x, clientY: plaque.y });
    f.canvas.emit('pointerup', { clientX: plaque.x, clientY: plaque.y, timeStamp: 200 });
    assert.deepEqual(f.actions.pop(), { type: 'layout-select', id: 'counter-a' });
    const target = f.renderer.projectLayoutCell(-4, 4);
    f.renderer.panBy(target.x - f.canvas.width / 2, target.y - f.canvas.height / 2);
    const cell = f.renderer.projectLayoutCell(-4, 4);
    f.canvas.emit('pointerdown', { clientX: cell.x, clientY: cell.y });
    f.canvas.emit('pointerup', { clientX: cell.x, clientY: cell.y, timeStamp: 200 });
    assert.deepEqual(f.actions.pop(), { type: 'layout-cell', x: -4, z: 4 });
    preview.furniture[0].x = -4;
    f.renderer.setRenovationPreview(preview, 'counter-a', false);
    assert.equal(f.scene.getTransformNodeByName('counter-a-station').position.x, -4);
    assert.equal(f.state.layout.furniture[0].x, 0, 'draft never writes through to live state');
    f.renderer.setRenovationPreview(null);
    assert.equal(f.scene.getTransformNodeByName('counter-a-station').position.x, 0);
    assert.equal(f.scene.getMeshByName('renovation-footprint-ghost'), null);
    assert.equal(f.renderer.gridCells.size, 0);
    assert.equal(f.scene.getMeshByName('queue-rug-0').isEnabled(), true);
  } finally { f.dispose(); }
});

test('TC-3D-025 stable snapshots and repeated edits do not accumulate geometry, label materials or textures', () => {
  const f = fixture();
  try {
    const layout = active(f.state, true);
    layout.furniture.push({ id: 'table-1', kind: 'table', x: -4, z: 4, rotation: 0, stored: false });
    f.renderer.update(f.state, 0);
    // Warm up the bounded preview material palette before measuring repeated cycles.
    f.renderer.setRenovationPreview(layout, 'table-1', false); f.renderer.setRenovationPreview(layout, 'table-1', true); f.renderer.setRenovationPreview(null);
    const baseline = counts(f);
    for (let i = 0; i < 24; i++) {
      const draft = structuredClone(layout);
      draft.furniture[0].x = i % 2 ? -3 : 1;
      draft.furniture[0].rotation = i % 4;
      draft.furniture.find(item => item.id === 'table-1').rotation = i % 4;
      f.renderer.setRenovationPreview(draft, 'counter-a', i % 2 === 0);
      const editCounts = counts(f);
      for (let frame = 0; frame < 3; frame++) f.renderer.update(f.state, .016);
      assert.deepEqual(counts(f), editCounts, 'unchanged frames allocate no presentation resources');
      f.renderer.setRenovationPreview(null);
      assert.deepEqual(counts(f), baseline, 'exiting preview disposes all temporary geometry');
    }
    layout.furniture[1].stored = true; f.renderer.update(f.state, 0);
    layout.furniture[1].stored = false; f.renderer.update(f.state, 0);
    assert.deepEqual(counts(f), baseline, 'restore creates exactly one replacement set of owned labels');
  } finally { f.dispose(); }
});

for (const [width, height] of [[390, 844], [844, 390]]) test(`TC-3D-025 expanded edge is reachable at ${width}×${height} without zooming out`, () => {
  const f = fixture(width, height);
  try {
    const layout = active(f.state, true); f.renderer.setRenovationPreview(layout);
    for (const [x, z] of [[-7, 9], [16, 9], [16, -3]]) {
      const projected = f.renderer.projectLayoutCell(x, z);
      f.renderer.panBy(projected.x - width / 2, projected.y - height / 2);
      const visible = f.renderer.projectLayoutCell(x, z);
      assert.equal(visible.visible, true, `${x},${z}`);
      assert.ok(Math.abs(visible.x - width / 2) < .01); assert.ok(Math.abs(visible.y - height / 2) < 40);
    }
    assert.equal(f.renderer.gridCells.size, 24 * 13);
  } finally { f.dispose(); }
});

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) test(`TC-3D-025 separate physical controls remain visible and actionable at every turn, ${width}×${height}`, () => {
  const f = fixture(width, height);
  try {
    const layout = active(f.state);
    Object.assign(layout.furniture[0], { x: -3, z: 3 });
    for (let rotation = 0; rotation < 4; rotation++) {
      layout.furniture[0].rotation = rotation;
      f.renderer.update(f.state, 0);
      const recipe = f.scene.getMeshByName('counter-a-recipe-selector'), upgrade = f.scene.getMeshByName('counter-a-upgrade-plaque');
      assert.ok(project(f, recipe).x < project(f, upgrade).x, 'recipe remains screen-left of upgrade');
      for (const [key, mesh, action] of [['counter-a-recipe', recipe, { type: 'recipe', id: 'counter-a' }], ['counter-a-upgrade', upgrade, { type: 'counter', id: 'counter-a' }]]) {
        f.renderer.focusAnchor(key);
        assert.equal(f.renderer.projectAnchor(key).visible, true);
        assert.equal(f.renderer.activateFocused(), true, `keyboard ${key} turn ${rotation}`);
        assert.deepEqual(f.actions.pop(), action);
        const point = project(f, mesh);
        f.canvas.emit('pointerdown', { clientX: point.x, clientY: point.y });
        f.canvas.emit('pointerup', { clientX: point.x, clientY: point.y, timeStamp: 200 });
        assert.deepEqual(f.actions.pop(), action, `real ray ${key} turn ${rotation}`);
        assert.equal(mesh.parent.name, 'counter-a-station');
        assert.equal(mesh.billboardMode, 0);
        assert.equal(mesh.material.disableDepthWrite, false);
      }
    }
  } finally { f.dispose(); }
});

test('TC-3D-025 topology edits invalidate cached furniture shadows while identical previews do not', () => {
  const f = fixture();
  try {
    let invalidations = 0;
    const map = { refreshRate: 1, renderList: [], resetRefreshCounter() { invalidations++; } };
    f.renderer.shadowGenerator = {
      getShadowMap: () => map,
      addShadowCaster(mesh) { if (!map.renderList.includes(mesh)) map.renderList.push(mesh); },
      removeShadowCaster(mesh) { map.renderList = map.renderList.filter(item => item !== mesh); },
      dispose() {},
    };
    const draft = structuredClone(f.state.layout); draft.active = true;
    f.renderer.setRenovationPreview(draft, 'counter-a');
    assert.equal(invalidations, 1);
    assert.equal(map.refreshRate, 0);
    const baseline = map.renderList.length;
    f.renderer.setRenovationPreview(draft, 'counter-a');
    assert.equal(invalidations, 1);
    draft.furniture[0].x = -3;
    f.renderer.setRenovationPreview(draft, 'counter-a');
    assert.equal(invalidations, 2);
    assert.equal(map.renderList.length, baseline);
    assert.ok(map.renderList.every(mesh => !/^(customer-|manager-|cart-|counter-[a-d]-barista)/.test(mesh.name)));
    draft.furniture[1].stored = true;
    f.renderer.setRenovationPreview(draft, 'counter-a');
    assert.equal(invalidations, 3);
    assert.ok(map.renderList.every(mesh => !mesh.isDisposed()));
    assert.ok(map.renderList.every(mesh => !mesh.name.startsWith('counter-b-')));
  } finally { f.dispose(); }
});

test('TC-3D-025 active manager and close-in trolley fit the reserved half-metre radius through turns and handoffs', () => {
  const f = fixture();
  try {
    active(f.state);
    f.state.manager.carrying = 9999;
    f.renderer.update(f.state, .016);
    const person = f.scene.getTransformNodeByName('manager');
    const cart = f.scene.getTransformNodeByName('manager-cash-cart');
    let radius = 0;
    for (const phase of ['moving', 'collecting', 'depositing']) for (let turn = 0; turn < 16; turn++) {
      f.state.manager.phase = phase;
      const angle = turn * Math.PI / 8;
      f.state.manager.x += Math.sin(angle) * .05;
      f.state.manager.z += Math.cos(angle) * .05;
      f.state.manager.nav = [{ x: f.state.manager.x + Math.sin(angle), z: f.state.manager.z + Math.cos(angle) }];
      f.renderer.animationTime = turn * .17;
      f.renderer.update(f.state, .016);
      for (const mesh of [...person.getChildMeshes(), ...cart.getChildMeshes()]) {
        if (!mesh.isEnabled()) continue;
        mesh.computeWorldMatrix(true);
        for (const point of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
          const distance = Math.hypot(point.x - person.position.x, point.z - person.position.z);
          radius = Math.max(radius, distance);
          assert.ok(distance < .5, `${phase} turn ${turn} ${mesh.name}: radius ${distance}`);
        }
      }
    }
    assert.ok(radius > .3, 'the assertion measures actual solids rather than an empty hierarchy');
    assert.equal(cart.scaling.x, .43);
    assert.equal(person.scaling.x, .8);
  } finally { f.dispose(); }
});

test('TC-3D-025 active waiting manager stops walking without changing legacy animation or cart proportions', () => {
  const f = fixture();
  try {
    active(f.state);
    f.state.manager.phase = 'moving';
    f.state.manager.nav = [{ x: 8, z: -2 }];
    f.renderer.animationTime = .1;
    f.renderer.update(f.state, .016);
    const leftLeg = f.scene.getTransformNodeByName('manager-left-hip');
    const rightLeg = f.scene.getTransformNodeByName('manager-right-hip');
    assert.notEqual(leftLeg.rotation.x, 0);
    delete f.state.manager.nav;
    const position = [f.state.manager.x, f.state.manager.z];
    f.renderer.update(f.state, .016);
    assert.equal(leftLeg.rotation.x, 0);
    close(rightLeg.rotation.x, 0);
    assert.equal(f.scene.getTransformNodeByName('manager').position.y, 0);
    assert.deepEqual([f.state.manager.x, f.state.manager.z], position);
    f.state.layout = initialLayout();
    f.renderer.update(f.state, .016);
    assert.notEqual(leftLeg.rotation.x, 0, 'legacy moving phase retains its original gait');
    const manager = f.scene.getTransformNodeByName('manager'), cart = f.scene.getTransformNodeByName('manager-cash-cart');
    assert.equal(manager.scaling.x, .97); assert.equal(cart.scaling.x, 1);
    close(cart.position.x - manager.position.x, .7); close(cart.position.z - manager.position.z, -.55);
  } finally { f.dispose(); }
});
