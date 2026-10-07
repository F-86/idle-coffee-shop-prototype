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
const { createEngine, createInitialState } = await import('../src/slice/core/engine.ts');
const { addFurniture, initialLayout, interactionPoint } = await import('../src/slice/core/layout.ts');
const { validateState } = await import('../src/slice/core/persistence.ts');
const { FrameInterpolator } = await import('../src/slice/render/FrameInterpolator.ts');

// Structural CPU evidence only. Browser/pixel/input-device acceptance is separate.
class Canvas {
  events = new Map(); captured = new Set();
  constructor(width = 1280, height = 900, left = 0, top = 0) { this.width = width; this.height = height; this.left = left; this.top = top; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
  getBoundingClientRect() { return { left: this.left, top: this.top, width: this.width, height: this.height }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  emit(type, values) { this.events.get(type)?.({ pointerId: 1, isPrimary: true, button: 0, timeStamp: 100, ...values }); }
}
function fixture(width, height, scale = 1, left = 0, top = 0) {
  const canvas = new Canvas(width, height, left, top), actions = [];
  const engine = new NullEngine({ renderWidth: canvas.width / scale, renderHeight: canvas.height / scale, textureSize: 512 });
  engine.getHardwareScalingLevel = () => scale;
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
function clientWorld(f, position) {
  f.scene.updateTransformMatrix(true);
  const point = Vector3.Project(position, Matrix.Identity(), f.scene.getTransformMatrix(), f.scene.activeCamera.viewport.toGlobal(f.engine.getRenderWidth(), f.engine.getRenderHeight()));
  return { clientX: f.canvas.left + point.x * f.canvas.width / f.engine.getRenderWidth(), clientY: f.canvas.top + point.y * f.canvas.height / f.engine.getRenderHeight() };
}
function clientMesh(f, name) { return clientWorld(f, world(f.scene.getMeshByName(name))); }

test('TC-3D-025 cutaway keeps counter controls and an embodied expansion entrance', () => {
  const f = fixture();
  try {
    assert.equal(f.scene.meshes.filter(mesh => mesh.metadata?.coffeeLabel).length, 5);
    assert.equal(f.scene.getMeshByName('queue-rug-0'), null);
    for (const key of ['expansion']) {
      f.renderer.focusAnchor(key);
      assert.equal(f.renderer.projectAnchor(key).visible, true);
      assert.equal(f.renderer.activateFocused(), true, key);
    }
    assert.deepEqual(f.actions, [{ type: 'renovate' }]);
    assert.equal(f.scene.getTransformNodeByName('expansion-locked-divider').isEnabled(), true);
    assert.equal(f.scene.getMeshByName('expansion-floor').metadata.coffeeExpansion, 'locked');
  } finally { f.dispose(); }
});

test('EXPANSION-SIGN-001 the complete sign remains for either available axis and disappears at full size including reload',()=>{
  const parts=['expansion-marker','expansion-marker-post','expansion-plus-horizontal','expansion-plus-vertical'];
  const f=fixture();try{
    for(const [width,depth]of [[0,0],[3,0],[0,3],[3,2],[3,3],[0,0]]){
      Object.assign(f.state.layout,{widthSteps:width,depthSteps:depth,expanded:width>0});const before=structuredClone(f.state),available=width<3||depth<3;f.renderer.update(f.state,0);
      for(const name of parts)assert.equal(f.scene.getMeshByName(name).isEnabled(),available,name);
      assert.equal(f.scene.getMeshByName('continuous-shop-floor').isEnabled(),true);assert.equal(f.scene.getMeshByName('expansion-floor').isEnabled(),true,'purchased floor remains');
      if(available){f.renderer.focusAnchor('expansion');assert.equal(f.renderer.projectAnchor('expansion').visible,true);assert.equal(f.renderer.activateFocused(),true);}
      else{assert.equal(f.renderer.projectAnchor('expansion').visible,false);assert.equal(f.renderer.getFocus(),null);f.renderer.focusAnchor('expansion');assert.equal(f.renderer.getFocus(),null);assert.equal(f.renderer.activateFocused(),false);for(let i=0;i<10;i++)assert.notEqual(f.renderer.focusNext(),'expansion');}
      assert.deepEqual(f.state,before);
    }
    const reload=fixture();try{Object.assign(reload.state.layout,{widthSteps:3,depthSteps:3,expanded:true});reload.renderer.update(reload.state,0);for(const name of parts)assert.equal(reload.scene.getMeshByName(name).isEnabled(),false);assert.equal(reload.renderer.projectAnchor('expansion').visible,false);}finally{reload.dispose();}
  }finally{f.dispose();}
});

test('EXPANSION-SIGN-002 max-size preview disables an existing press and cancelling restores the available expansion sign',()=>{
  const f=fixture();try{
    Object.assign(f.state.layout,{widthSteps:3,depthSteps:2,expanded:true});f.renderer.update(f.state,0);f.renderer.focusAnchor('expansion');const point=clientMesh(f,'expansion-marker'),before=structuredClone(f.state);f.canvas.emit('pointerdown',{...point,timeStamp:100});
    const draft=structuredClone(f.state.layout);draft.depthSteps=3;f.renderer.setRenovationPreview(draft);f.renderer.update(f.state,0);f.canvas.emit('pointerup',{...point,timeStamp:200});assert.equal(f.actions.length,0);assert.equal(f.renderer.projectAnchor('expansion').visible,false);
    f.renderer.setRenovationPreview(null);f.renderer.update(f.state,0);f.renderer.focusAnchor('expansion');assert.equal(f.renderer.projectAnchor('expansion').visible,true);assert.equal(f.renderer.activateFocused(),true);assert.deepEqual(f.actions,[{type:'renovate'}]);assert.deepEqual(f.state,before);
  }finally{f.dispose();}
});

test('TC-3D-025 counter body, staff and both plaques follow one moved 90-degree footprint', () => {
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
      ['counter-a-barista', -3.11, 2.2],
      ['counter-a-upgrade-plaque', -3.235, 3.01], ['counter-a-recipe-selector', -3.235, .99],
    ]) {
      const mesh = f.scene.getNodeByName(name), position = world(mesh);
      close(position.x, x); close(position.z, z);
    }
    const body = f.scene.getMeshByName('counter-a-body');
    body.computeWorldMatrix(true);
    close(body.getBoundingInfo().boundingBox.maximumWorld.z - body.getBoundingInfo().boundingBox.minimumWorld.z, 3.4);
    assert.equal(f.scene.getTransformNodeByName('counter-a-cash-cluster'), null);
    assert.equal(f.scene.getMeshByName('queue-rug-0'), null);
    assert.equal(f.scene.getTransformNodeByName('left-waiting-bench'), null);
    assert.equal(f.scene.getMeshByName('manager-route'), null);
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
    assert.equal(disposedInk, 2);
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
    f.state.customers[0].z += .1;
    f.renderer.update(f.state, 0);
    close(diner.position.y, 0); close(f.scene.getTransformNodeByName('customer-31-left-hip').rotation.x, 0);
  } finally { f.dispose(); }
});

function assertFacingTable(f, id, table) {
  const head=world(f.scene.getMeshByName(`customer-${id}-head`));
  const eyes=world(f.scene.getMeshByName(`customer-${id}-eye--0.115`)).add(world(f.scene.getMeshByName(`customer-${id}-eye-0.115`))).scale(.5);
  const seat=interactionPoint(table,'seat'),face=new Vector3(eyes.x-head.x,0,eyes.z-head.z).normalize(),toward=new Vector3(table.x-seat.x,0,table.z-seat.z).normalize();
  close(Vector3.Dot(face,toward),1);
  const root=f.scene.getTransformNodeByName(`customer-${id}`);
  close(root.position.x,seat.x);close(root.position.z,seat.z);close(root.position.y,-.045);
  close(f.scene.getTransformNodeByName(`customer-${id}-left-hip`).rotation.x,-1.4);
  close(f.scene.getTransformNodeByName(`customer-${id}-right-hip`).rotation.x,-1.4);
}

function faceDirection(f,id){const head=world(f.scene.getMeshByName(`customer-${id}-head`)),eyes=world(f.scene.getMeshByName(`customer-${id}-eye--0.115`)).add(world(f.scene.getMeshByName(`customer-${id}-eye-0.115`))).scale(.5);return new Vector3(eyes.x-head.x,0,eyes.z-head.z).normalize();}
test('COUNTER-FACING-001 all rotated service points retain inward facing across arrival, service and waiting departures',()=>{
  const f=fixture();try{let id=500;
    for(let rotation=0;rotation<4;rotation++)for(const phase of ['entering','queue','serving','receiving','seeking-seat','leaving'])for(const routed of [false,true]){
      const layout=active(f.state),counter=layout.furniture[0];counter.rotation=rotation;const service=interactionPoint(counter,'service'),toward=new Vector3(counter.x-service.x,0,counter.z-service.z).normalize();
      const guest={id:++id,...service,phase,counterId:'counter-a',timer:0,hasCup:['receiving','seeking-seat','leaving'].includes(phase),skin:4,...(routed?{nav:[{x:service.x+1,z:service.z}]}:{})};f.state.customers=[guest];const before=structuredClone(f.state);
      const waiting=!routed||!['leaving','seeking-seat'].includes(phase),expected=waiting?toward:new Vector3(1,0,0);
      for(const dt of [0,.016,.016]){f.renderer.update(f.state,dt);close(Vector3.Dot(faceDirection(f,id),expected),1);close(f.scene.getTransformNodeByName(`customer-${id}-left-hip`).rotation.x,0);}
      assert.deepEqual(f.state,before);const yaw=f.scene.getTransformNodeByName(`customer-${id}`).rotation.y;guest.x+=toward.z*.12;guest.z-=toward.x*.12;f.renderer.update(f.state,.016);const root=f.scene.getTransformNodeByName(`customer-${id}`);close(root.position.x,guest.x);close(root.position.z,guest.z);if(waiting)assert.notEqual(root.rotation.y,yaw,'displayed departure releases service facing even before its old phase changes');
    }
  }finally{f.dispose();}
});

test('COUNTER-FACING-002 moved/stored counters and canceled previews cannot keep a stale service facing',()=>{
  const f=fixture();try{
    const layout=active(f.state),counter=layout.furniture[1];counter.rotation=2;const service=interactionPoint(counter,'service');f.state.customers=[{id:700,...service,phase:'leaving',counterId:'counter-b',timer:0,hasCup:true,skin:4}];f.renderer.update(f.state,0);close(faceDirection(f,700).z,1);
    const preview=structuredClone(layout);preview.furniture[1].x+=2;f.renderer.setRenovationPreview(preview);f.state.customers[0].id=701;f.renderer.update(f.state,0);close(faceDirection(f,701).z,-1,'old location no longer forces a service heading');
    f.renderer.setRenovationPreview(null);f.renderer.update(f.state,0);close(faceDirection(f,701).z,1);
    counter.stored=true;f.state.customers[0].id=702;f.renderer.update(f.state,0);close(faceDirection(f,702).z,-1);
  }finally{f.dispose();}
});

test('COUNTER-FACING-003 a real paid customer waiting at a reversed counter reloads facing inward',()=>{
  const f=fixture(),engine=createEngine();try{
    engine.togglePause();engine.beginLayoutEdit();const draft=engine.createLayoutDraft();draft.furniture[1].rotation=2;assert.equal(engine.commitLayout(draft).ok,true);engine.togglePause();
    const interpolation=new FrameInterpolator(engine.state),service=interactionPoint(draft.furniture[1],'service');let captured=false;
    for(let frame=0;frame<7200&&!captured;frame++){
      const view=interpolation.advance(engine,1/60),guest=view.customers.find(c=>c.counterId==='counter-b'&&c.phase==='leaving'&&!c.nav&&c.x===service.x&&c.z===service.z);if(!guest)continue;
      assert.equal(validateState(engine.snapshot()).ok,true);const before=structuredClone(view);f.renderer.update(view,0);close(faceDirection(f,guest.id).z,1);for(let i=0;i<10;i++)f.renderer.update(view,1/60);close(faceDirection(f,guest.id).z,1);assert.deepEqual(view,before);captured=true;
    }
    assert.equal(captured,true,'ordinary traffic produces the screenshot-compatible blocked departure');
  }finally{f.dispose();}
});

test('SEAT-FACING-001 dining and reloaded departing guests face the actual table in all four rotations while still on the chair',()=>{
  const f=fixture();try{
    for(let rotation=0;rotation<4;rotation++)for(const phase of ['dining','leaving'])for(const routed of phase==='dining'?[false]:[false,true]){
      const layout=active(f.state),table={id:'table-1',kind:'table',x:-4,z:4,rotation,stored:false};layout.furniture.push(table);
      const seat=interactionPoint(table,'seat'),id=100+rotation*4+(phase==='leaving'?2:0)+Number(routed);
      const guest={id,...seat,phase,counterId:'counter-a',timer:0,hasCup:true,skin:rotation,...(phase==='dining'?{seatId:table.id}:{}),...(routed?{nav:[{x:seat.x,z:seat.z+1}]}:{})};
      f.state.customers=[guest];const before=structuredClone(f.state);
      f.renderer.update(f.state,0);assertFacingTable(f,id,table);
      assert.equal(f.scene.getTransformNodeByName(`customer-${id}-takeaway`).isEnabled(),true);
      for(let frame=0;frame<8;frame++){f.renderer.update(f.state,.016);assertFacingTable(f,id,table);}
      assert.deepEqual(f.state,before,'seat appearance never writes route ownership, tips, clocks or save state');
      guest.x+=.12;f.renderer.update(f.state,.016);
      const root=f.scene.getTransformNodeByName(`customer-${id}`);close(root.position.x,guest.x);close(root.position.z,guest.z);assert.ok(root.position.y>=0);assert.ok(Number.isFinite(root.rotation.y));
      assert.notEqual(f.scene.getTransformNodeByName(`customer-${id}-left-hip`).rotation.x,-1.4,'physical departure releases the seated legs');
    }
  }finally{f.dispose();}
});

test('SEAT-FACING-002 the last interpolated dining frame releases the chair when the displayed position begins to leave',()=>{
  const f=fixture();try{for(let rotation=0;rotation<4;rotation++){
    const layout=active(f.state),table={id:'table-1',kind:'table',x:-4,z:4,rotation,stored:false};layout.furniture.push(table);
    const seat=interactionPoint(table,'seat'),id=200+rotation;f.state.customers=[{id,...seat,phase:'dining',counterId:'counter-a',timer:5.95,hasCup:true,skin:1,seatId:table.id}];
    const interpolation=new FrameInterpolator(f.state);f.renderer.update(f.state,0);assertFacingTable(f,id,table);
    const next=structuredClone(f.state);next.stepCarry=.025;next.customers[0].phase='leaving';delete next.customers[0].seatId;next.customers[0].x+=.1;
    const before=structuredClone(next),view=interpolation.sample(next);assert.equal(view.customers[0].phase,'dining');close(view.customers[0].x,seat.x+.05);
    f.renderer.update(view,.025);const root=f.scene.getTransformNodeByName(`customer-${id}`);close(root.position.x,view.customers[0].x);close(root.position.z,view.customers[0].z);assert.ok(root.position.y>=0,'no extra chair snap on the departure boundary');assert.deepEqual(next,before);
  }}finally{f.dispose();}
});

test('SEAT-FACING-003 moved, rotated or stored chairs cannot leave a stale waiting pose',()=>{
  const f=fixture();try{
    const layout=active(f.state),table={id:'table-1',kind:'table',x:-4,z:4,rotation:1,stored:false};layout.furniture.push(table);
    const seat=interactionPoint(table,'seat');f.state.customers=[{id:310,...seat,phase:'leaving',counterId:'counter-a',timer:0,hasCup:true,skin:1}];f.renderer.update(f.state,0);assertFacingTable(f,310,table);
    const preview=structuredClone(layout);preview.furniture.find(item=>item.id===table.id).x=0;f.renderer.setRenovationPreview(preview,table.id);f.renderer.update(f.state,0);close(f.scene.getTransformNodeByName('customer-310').position.y,0);
    f.renderer.setRenovationPreview(null);f.renderer.update(f.state,0);assertFacingTable(f,310,table);
    table.x=0;table.rotation=3;f.renderer.update(f.state,0);close(f.scene.getTransformNodeByName('customer-310').position.y,0);
    Object.assign(f.state.customers[0],interactionPoint(table,'seat'));f.renderer.update(f.state,0);assertFacingTable(f,310,table);
    table.stored=true;f.renderer.update(f.state,0);close(f.scene.getTransformNodeByName('customer-310').position.y,0);assert.equal(f.scene.getMeshByName('table-1-chair-seat'),null);
  }finally{f.dispose();}
});

test('SEAT-FACING-004 real core completion waits seated, survives reload, and departs without a delayed-phase snap',()=>{
  for(const draining of [false,true]){
    const f=fixture(),engine=createEngine();let reload;
    try{
      engine.togglePause();engine.beginLayoutEdit();const draft=engine.createLayoutDraft(),table=addFurniture(draft,'table',-4,4);table.rotation=2;assert.equal(engine.commitLayout(draft).ok,true);engine.togglePause();
      if(draining){assert.equal(engine.invite(),true);engine.togglePause();}
      const seat=interactionPoint(table,'seat'),interpolation=new FrameInterpolator(engine.state);let waited=false,departed=false,delayedDeparture=false,dined=false;
      for(let frame=0;frame<1800&&!departed;frame++){
        const view=interpolation.advance(engine,1/60),guest=view.customers.find(c=>c.id===1);if(!guest)continue;
        const onSeat=Math.abs(guest.x-seat.x)<1e-8&&Math.abs(guest.z-seat.z)<1e-8;
        if(guest.phase==='dining'&&onSeat&&!dined){f.renderer.update(view,1/60);assertFacingTable(f,1,table);dined=true;}
        if(guest.phase==='leaving'&&onSeat){
          const before=structuredClone(view);f.renderer.update(view,1/60);assertFacingTable(f,1,table);assert.deepEqual(view,before);
          assert.equal(validateState(engine.snapshot()).ok,true);
          if(!waited){reload=fixture();reload.renderer.update(view,0);assertFacingTable(reload,1,table);}waited=true;
        }
        if(dined&&!onSeat&&(guest.phase==='dining'||guest.phase==='leaving')){
          const before=structuredClone(view);f.renderer.update(view,1/60);const root=f.scene.getTransformNodeByName('customer-1');close(root.position.x,guest.x);close(root.position.z,guest.z);assert.ok(root.position.y>=0);assert.deepEqual(view,before);assert.equal(validateState(engine.snapshot()).ok,true);
          delayedDeparture=guest.phase==='dining';departed=true;
        }
      }
      assert.equal(dined,true);assert.equal(departed,true);assert.equal(draining?delayedDeparture:waited,true,draining?'interpolation retains dining during the first actual departure':'normal traffic blocks the exit route while the guest stays at the chair');
    }finally{reload?.dispose();f.dispose();}
  }
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
    assert.equal(f.scene.getMeshByName('queue-rug-0'), null);
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
    const scale=f.scene.activeCamera.orthoTop;
    for (const [x, z] of [[-7, 9], [16, 9], [16, -3]]) {
      const projected = f.renderer.projectLayoutCell(x, z);
      f.renderer.panBy(projected.x - width / 2, projected.y - height / 2);
      const visible = f.renderer.projectLayoutCell(x, z);
      assert.equal(visible.visible, true, `${x},${z}`);
      // Finite-map framing keeps a usable edge tile visible, without centering
      // the corner and pushing half the viewport outside the scenery.
      assert.deepEqual(f.renderer.pickLayoutPlacement(visible.x,visible.y,'new-table'),{x,z});
      assert.equal(f.scene.activeCamera.orthoTop,scale);
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
    const draft = structuredClone(f.state.layout); draft.active = true; draft.furniture[0].rotation = 1;
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

for (const [width, height] of [[1280, 900], [390, 844], [844, 390]]) for (const dpr of [1, 1.75]) {
  test(`TC-3D-026 placement ray snaps the true floor behind furniture at ${width}×${height}, DPR ${dpr}`, () => {
    const f = fixture(width, height, 1 / dpr, 35, 80);
    try {
      const draft = active(f.state);
      f.renderer.setRenovationPreview(draft, 'counter-a');
      f.renderer.focusAnchor('counter-a-upgrade');
      for (const [x, z] of [[0, 0], [.35, -.4], [-2.25, 1.25]]) {
        const pointer = clientWorld(f, new Vector3(x, 0, z));
        assert.deepEqual(f.renderer.pickLayoutPlacement(pointer.clientX, pointer.clientY, 'counter-a'), { x: Math.round(x) || 0, z: Math.round(z) || 0 });
      }
      const pointer = clientWorld(f, new Vector3(0, 0, 0));
      assert.notEqual(f.renderer.pickAt(pointer.clientX, pointer.clientY)?.name, 'continuous-shop-floor', 'a real cabinet/grid surface occludes the floor ray');
      assert.deepEqual(f.renderer.pickLayoutPlacement(pointer.clientX, pointer.clientY, 'new-table'), { x: 0, z: 0 }, 'external catalogue uses the same geometric picker');
      for (const coords of [[34, 80], [35, 79], [35 + width + 1, 80], [35, 80 + height + 1], [NaN, 100]]) assert.equal(f.renderer.pickLayoutPlacement(...coords, 'counter-a'), null);
      const outside = f.renderer.projectLayoutCell(-9, 4);
      f.renderer.panBy(outside.x - width / 2, outside.y - height / 2);
      const illegal = clientWorld(f, new Vector3(-9, 0, 4));
      assert.deepEqual(f.renderer.pickLayoutPlacement(illegal.clientX, illegal.clientY, 'counter-a'), { x: -9, z: 4 }, 'an illegal floor drop stays illegal rather than clamping');
    } finally { f.dispose(); }
  });
}

test('TC-3D-026 real furniture drag emits start/move/end, keeps the camera fixed and suppresses selection on release', () => {
  const f = fixture();
  try {
    const draft = active(f.state);
    const before = JSON.stringify(f.state);
    f.renderer.setRenovationPreview(draft, 'counter-a');
    f.renderer.focusAnchor('counter-a-upgrade');
    const start = clientMesh(f, 'counter-a-upgrade-plaque');
    assert.equal(f.renderer.pickAt(start.clientX, start.clientY)?.name, 'counter-a-upgrade-plaque');
    const camera = f.scene.activeCamera.position.asArray();
    f.canvas.emit('pointerdown', start);
    f.canvas.emit('pointermove', { clientX: start.clientX + 4, clientY: start.clientY });
    assert.deepEqual(f.actions, [], 'touch slop remains a tap');
    const move = { clientX: start.clientX + 28, clientY: start.clientY + 24 };
    f.canvas.emit('pointermove', move);
    assert.deepEqual(f.actions, [
      { type: 'layout-drag', phase: 'start', id: 'counter-a', ...start },
      { type: 'layout-drag', phase: 'move', id: 'counter-a', ...move },
    ]);
    assert.deepEqual(f.scene.activeCamera.position.asArray(), camera, 'dragging an object cannot pan the room');
    const candidate = structuredClone(draft);
    Object.assign(candidate.furniture[0], { x: -4, z: 3 });
    f.renderer.setRenovationPreview(candidate, 'counter-a', false);
    f.renderer.update(f.state, 0);
    f.canvas.emit('pointerup', { ...move, timeStamp: 2100 });
    assert.deepEqual(f.actions.at(-1), { type: 'layout-drag', phase: 'end', id: 'counter-a', ...move });
    assert.equal(f.actions.length, 3, 'a long drag still ends exactly once without click activation');
    f.canvas.emit('pointerup', move);
    assert.equal(f.actions.length, 3);
    assert.equal(f.canvas.captured.size, 0);
    assert.equal(JSON.stringify(f.state), before);
    assert.equal(f.scene.getMeshByName('renovation-footprint-ghost').metadata.coffeePlacementValid, false);
  } finally { f.dispose(); }
});

test('TC-3D-026 every drag interruption releases capture exactly once and cannot commit after cancellation', () => {
  const f = fixture();
  try {
    for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'disable', 'mode-exit', 'silent', 'dispose']) {
      const draft = active(f.state);
      f.renderer.setInteractionEnabled(true);
      f.renderer.setRenovationPreview(draft, 'counter-a');
      f.renderer.focusAnchor('counter-a-upgrade');
      const point = clientMesh(f, 'counter-a-upgrade-plaque');
      f.actions.length = 0;
      f.canvas.emit('pointerdown', point);
      f.canvas.emit('pointermove', { clientX: point.clientX + 20, clientY: point.clientY });
      assert.equal(f.actions[0]?.phase, 'start', reason);
      if (reason === 'disable') f.renderer.setInteractionEnabled(false);
      else if (reason === 'mode-exit') f.renderer.setRenovationPreview(null);
      else if (reason === 'silent') f.renderer.cancelLayoutDrag();
      else if (reason === 'dispose') f.renderer.dispose();
      else f.canvas.emit(reason, point);
      assert.equal(f.canvas.captured.size, 0, reason);
      assert.equal(f.actions.length, reason === 'silent' ? 2 : 3, reason);
      if (reason !== 'silent') assert.equal(f.actions.at(-1).phase, 'cancel', reason);
      f.canvas.emit('pointerup', point);
      f.canvas.emit('lostpointercapture', point);
      assert.ok(!f.actions.some(action => action.phase === 'end' || action.type === 'layout-select'), reason);
      assert.equal(f.actions.length, reason === 'silent' ? 2 : 3, 'duplicate termination stays harmless');
    }
  } finally { f.dispose(); }
});

test('TC-3D-026 empty floor still pans and foreign pointers cannot steal an object gesture', () => {
  const f = fixture();
  try {
    f.renderer.setRenovationPreview(active(f.state), 'counter-a');
    let cell = f.renderer.projectLayoutCell(-4, 4);
    f.renderer.panBy(cell.x - f.canvas.width / 2, cell.y - f.canvas.height / 2);
    cell = f.renderer.projectLayoutCell(-4, 4);
    const camera = f.scene.activeCamera.position.asArray();
    f.canvas.emit('pointerdown', { clientX: cell.x, clientY: cell.y });
    f.canvas.emit('pointermove', { clientX: cell.x + 40, clientY: cell.y + 25, pointerId: 2 });
    assert.deepEqual(f.scene.activeCamera.position.asArray(), camera);
    f.canvas.emit('pointermove', { clientX: cell.x + 40, clientY: cell.y + 25 });
    assert.notDeepEqual(f.scene.activeCamera.position.asArray(), camera);
    f.canvas.emit('pointerup', { clientX: cell.x + 40, clientY: cell.y + 25 });
    assert.deepEqual(f.actions, []);
  } finally { f.dispose(); }
});

test('COUNTER-FACING-004 a real diner walking across its old service tile keeps moving direction including reload',()=>{
 const f=fixture(),engine=createEngine();let reload;try{
  engine.togglePause();engine.beginLayoutEdit();const draft=engine.createLayoutDraft();draft.furniture[0].stored=true;const table=addFurniture(draft,'table',1,2);table.rotation=3;assert.equal(engine.commitLayout(draft).ok,true);engine.togglePause();engine.invite();engine.togglePause();const service=interactionPoint(draft.furniture[1],'service');let traversed=false;
  for(let tick=0;tick<1000&&!traversed;tick++){engine.advance(.05);const state=engine.snapshot(),guest=state.customers[0];f.renderer.update(state,.05);if(!guest||guest.phase!=='leaving'||!guest.nav?.length||guest.x!==service.x||guest.z!==service.z)continue;
   assert.equal(validateState(state).ok,true);assert.ok(faceDirection(f,guest.id).x>.999);assert.notEqual(f.scene.getTransformNodeByName(`customer-${guest.id}-left-hip`).rotation.x,0);reload=fixture();reload.renderer.update(state,0);assert.ok(faceDirection(reload,guest.id).x>.999);traversed=true;
  }
  assert.equal(traversed,true);
 }finally{reload?.dispose();f.dispose();}
});
