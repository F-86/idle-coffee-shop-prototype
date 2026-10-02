import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Exercise the production scene/event reconciliation without a browser or GPU.
// The fake display objects/tween scheduler do not verify rendered appearance.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'phaser') return { url: 'test:phaser', shortCircuit: true };
    if (specifier.endsWith('.png')) return { url: 'test:asset', shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:phaser') return { format: 'module', source: 'export class Scene {}', shortCircuit: true };
    if (url === 'test:asset') return { format: 'module', source: 'export default "test-asset.png"', shortCircuit: true };
    if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    return nextLoad(url, context);
  }
});
const { ShopScene } = await import('../src/game/ShopScene.ts');

function displayObject(x = 0, y = 0) {
  return {
    x, y, scaleX: 1, scaleY: 1, displayHeight: 78, destroyed: false,
    setPosition(x, y) { Object.assign(this, { x, y }); return this; },
    setDisplaySize(width, height) { this.displayHeight = height; return this; },
    setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; },
    setText(text) { this.text = text; return this; },
    destroy() { this.destroyed = true; },
    ...Object.fromEntries(['setDepth', 'setVisible', 'setOrigin', 'setAlpha', 'setTint'].map(name => [name, function () { return this; }]))
  };
}
function setup() {
  const scene = new ShopScene();
  const tweens = [];
  const killed = [];
  scene.scale = { width: 1280, height: 720, on() {} };
  scene.add = { image: displayObject, text: displayObject };
  scene.tweens = { add(tween) { tweens.push(tween); }, killTweensOf(target) { killed.push(target); } };
  scene.create();
  const customer = { id: 'customer-1', status: 'serving' };
  const view = {
    isOpen: true,
    counters: Object.fromEntries(['counter1', 'counter2', 'counter3'].map(key => [key, { unlocked: key === 'counter1', baristas: 1, drink: 'americano', queue: key === 'counter1' ? [customer] : [] }])),
    managerMotion: { position: 7 }, manager: { carrying: 0 }
  };
  scene.setView(view);
  return { scene, view, customer, tweens, killed };
}

test('a stale snapshot cannot cancel departure between event delivery and the next UI sync', () => {
  const { scene, view, customer, tweens, killed } = setup();
  const node = scene.customerNodes.get(customer.id);
  scene.handleEvent({ type: 'cup-delivered', counterKey: 'counter1', customer, amount: 10 });
  const departure = tweens.find(tween => tween.targets === node && tween.alpha === 0);
  assert.ok(departure, 'delivery starts an exit tween');
  const killsAfterEvent = killed.length;
  for (let frame = 0; frame < 8; frame += 1) scene.update(); // Before the 120ms snapshot refresh.
  assert.equal(killed.length, killsAfterEvent, 'stale render must leave exit tweens running');
  assert.equal(scene.customerMotions.get(customer.id).leaving, true);
  assert.equal(scene.customerLabels.get(customer.id).text, '取杯中');
  view.counters.counter1.queue = [];
  scene.setView(view);
  assert.equal(node.destroyed, false, 'new snapshot must allow the departure to finish');
  departure.onComplete();
  assert.equal(node.destroyed, true);
  assert.equal(scene.customerNodes.has(customer.id), false);
  assert.equal(scene.customerLabels.has(customer.id), false);
  assert.equal(scene.customerMotions.has(customer.id), false);
});

test('queue advancement and unrelated removal still reconcile normally', () => {
  const { scene, view, customer, tweens } = setup();
  view.counters.counter1.queue.unshift({ id: 'new-customer', status: 'waiting' });
  scene.setView(view);
  assert.equal(scene.customerMotions.get(customer.id).index, 1);
  assert.ok(tweens.some(tween => tween.targets === scene.customerNodes.get(customer.id) && tween.duration === 650));
  const node = scene.customerNodes.get('new-customer');
  view.counters.counter1.queue.shift();
  scene.setView(view);
  assert.equal(node.destroyed, true);
  assert.equal(scene.customerNodes.has('new-customer'), false);
});
