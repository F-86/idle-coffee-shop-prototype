import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import postcss from 'postcss';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { RenderBudget, readRenderMode, isRenderMode, RENDER_MODE_KEY } = await import('../src/slice/render/RenderBudget.ts');
const { FrameInterpolator } = await import('../src/slice/render/FrameInterpolator.ts');
const { RouteDiagnostics, isRouteQA } = await import('../src/slice/qa/RouteDiagnostics.ts');
const { RouteQAPanel } = await import('../src/slice/qa/RouteQAPanel.ts');
const { createEngine, createInitialState, recipeById, managerSpeed } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, createMemoryStorage } = await import('../src/slice/core/persistence.ts');

// These checks inspect actual markup/CSS and execute actual app handlers with a fake
// DOM/scene and real core/save repository. They are NOT browser/native-dialog/pixel QA.
const main = readFileSync(new URL('../src/slice/main.ts', import.meta.url), 'utf8');
const css = postcss.parse(readFileSync(new URL('../src/slice/style.css', import.meta.url), 'utf8'));
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const template = main.match(/root\.innerHTML\s*=\s*(`[\s\S]+?`)\s*;\s*const \$/)?.[1];
assert.ok(template, 'the actual app markup is available to inspect');
const html = runInNewContext(`${stripTypeScriptTypes(`globalThis.html = ${template};`)}\nhtml;`, {}, { timeout: 1000 });
const modalStart = html.indexOf('<dialog '), modalEnd = html.indexOf('</dialog>') + '</dialog>'.length;
const modal = html.slice(modalStart, modalEnd);
const outsideModal = html.slice(0, modalStart) + html.slice(modalEnd);
function rules(selector) {
  const found = [];
  css.walkRules(rule => { if (rule.selector.split(',').map(s => s.trim()).includes(selector)) found.push(rule); });
  return found;
}
function declarations(selector, property) {
  return rules(selector).flatMap(rule => rule.nodes.filter(node => node.type === 'decl' && node.prop === property).map(node => node.value));
}
function openingTags(markup, tag) { return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(match => match[0]); }

class FakeElement {
  listeners = new Map();
  attributes = new Map();
  dataset = {};
  style = {};
  hidden = false;
  disabled = false;
  isConnected = true;
  textContent = '';
  focused = 0;
  children = [];
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  append(...nodes) { for (const node of nodes) { this.children.push(node); if (!this.ownerDocument._nodes.includes(node)) this.ownerDocument._nodes.push(node); } }
  remove() { for (const child of this.children) child.remove(); const index = this.ownerDocument._nodes.indexOf(this); if (index >= 0) this.ownerDocument._nodes.splice(index, 1); this.isConnected = false; }
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), toggle: (name, force) => { const add = force ?? !classes.has(name); add ? classes.add(name) : classes.delete(name); return add; } };
  }
  get id() { return this.attributes.get('id') ?? ''; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    if (name === 'class') this.classList.add(...String(value).split(/\s+/));
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  toggleAttribute(name, force) { const on = force ?? !this.hasAttribute(name); if (on) this.setAttribute(name, ''); else { this.attributes.delete(name); if (name === 'disabled') this.disabled = false; if (name === 'hidden') this.hidden = false; } return on; }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value.startsWith('#')) return this.id === value.slice(1);
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      if (value.startsWith('[')) return this.hasAttribute(value.slice(1, -1));
      return this.tagName.toLowerCase() === value;
    });
  }
  closest(selector) { return this.matches(selector) ? this : null; }
  addEventListener(type, listener, options = {}) {
    const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set);
    options.signal?.addEventListener('abort', () => set.delete(listener), { once: true });
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, values = {}) {
    const event = { type, target: this, detail: 1, prevented: false, preventDefault() { this.prevented = true; }, ...values };
    for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
    return event;
  }
  focus() { this.focused++; this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 100, right: 500, top: 100, bottom: 650, width: 400, height: 550 }; }
}
function fixture({ initial = createInitialState(), raw, savedAtAgoSeconds = 0, storageUnavailable = false, writeUnavailable = false, conflictDuringClaim = false, deferDialogClose = false, renderMode, query = '?qa=1', renderUnavailable = false } = {}) {
  const clock = { now: Date.now(), performance: 0 };
  const nodes = [], closeEvents = [];
  const document = new FakeElement('document', null);
  document.ownerDocument = document;
  document._nodes = nodes;
  document.activeElement = null;
  document.hidden = false;
  const root = new FakeElement('div', document);
  root.setAttribute('id', 'slice-root');
  root.querySelector = selector => nodes.find(node => node.matches(selector)) ?? null;
  root.querySelectorAll = selector => nodes.filter(node => node.matches(selector));
  Object.defineProperty(root, 'innerHTML', { set(markup) {
    nodes.length = 0;
    for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/g)) {
      const element = new FakeElement(match[1], document);
      for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(attribute[1], attribute[2] ?? '');
      if (element.tagName === 'DIALOG') {
        element.open = false;
        element.showModalCalls = 0;
        element.showModal = () => { element.previousFocus = document.activeElement; element.open = true; element.showModalCalls++; root.querySelector('#dialog-close')?.focus(); };
        element.close = () => { if (!element.open) return; element.open = false; if (element.previousFocus) element.previousFocus.focus(); else document.activeElement = null; const notify = () => element.emit('close'); if (deferDialogClose) closeEvents.push(notify); else notify(); };
      }
      nodes.push(element);
    }
  } });
  document.querySelector = selector => selector === '#slice-root' ? root : root.querySelector(selector);
  document.querySelectorAll = selector => root.querySelectorAll(selector);
  const downloads = [], blobs = [];
  document.createElement = tag => { const element = new FakeElement(tag, document); element.click = () => downloads.push(element); return element; };
  const memory = createMemoryStorage();
  if (raw !== undefined) memory.setItem(SAVE_KEY, raw);
  else if (initial) { const repo = new LocalSaveRepository(memory); repo.load(clock.now); assert.equal(repo.save(initial, clock.now - savedAtAgoSeconds * 1000).ok, true); }
  if (renderMode !== undefined) memory.setItem(RENDER_MODE_KEY, renderMode);
  const storageControl = { writeUnavailable };
  let storageReads = 0;
  const storage = storageUnavailable ? { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('storage unavailable'); }, removeItem() { throw new Error('storage unavailable'); } } : {
    getItem(key) {
      if (key === SAVE_KEY && conflictDuringClaim && ++storageReads === 2) {
        const foreign = JSON.parse(memory.getItem(SAVE_KEY)); foreign.recordChangeTag = 'concurrent-offline-claim';
        memory.setItem(SAVE_KEY, JSON.stringify(foreign));
      }
      return memory.getItem(key);
    },
    setItem(key, value) { if (storageControl.writeUnavailable) throw new Error('writes unavailable'); memory.setItem(key, value); },
    removeItem(key) { if (storageControl.writeUnavailable) throw new Error('writes unavailable'); memory.removeItem(key); },
  };
  const window = new FakeElement('window', document);
  window.localStorage = storage;
  window.visualViewport = new FakeElement('visualViewport', document);
  window.confirm = () => true;
  const frames = new Map(), timers = new Map();
  let nextId = 0, renderer, observer, hmrCleanup;
  class FakeScene {
    updates = []; focusCalls = []; selection = []; interactionCalls = []; interactionEnabled = true; panCalls = []; focused = null; activationCalls = 0; disposed = false; resizeCalls = 0;
    constructor(canvas, action, options) { if (renderUnavailable) throw Error('WebGL unavailable in test fixture'); this.canvas = canvas; this.action = action; this.renderMode = options.renderMode; renderer = this; }
    setRenderMode(mode) { this.renderMode = mode; this.resize(); }
    update(state, dt) { this.updates.push({ state: structuredClone(state), dt }); }
    readCustomerPose(id) { const customer = this.updates.at(-1)?.state.customers.find(customer => customer.id === id); return customer ? { x: customer.x, z: customer.z, screenX: 200, screenY: 250, inViewport: true } : null; }
    selectedCounter(id) { this.selection.push(id); }
    resize() { this.resizeCalls++; }
    focusAnchor(key) { if (!this.interactionEnabled || !['counter-a-recipe', 'counter-a-upgrade', 'counter-b-recipe', 'counter-b-upgrade', 'menu-espresso', 'menu-latte', 'vault', 'invite'].includes(key)) return; this.focusCalls.push(key); this.focused = key; }
    getFocus() { return this.focused; }
    focusNext(direction) {
      const keys = ['counter-a-recipe', 'counter-a-upgrade', 'counter-b-recipe', 'counter-b-upgrade', 'menu-espresso', 'menu-latte', 'vault', 'invite'];
      const current = this.focused ? keys.indexOf(this.focused) : -1;
      this.focusAnchor(keys[current < 0 ? (direction < 0 ? keys.length - 1 : 0) : (current + direction + keys.length) % keys.length]);
      return this.focused;
    }
    panBy(...args) { this.panCalls.push(args); }
    activateFocused() { this.activationCalls++; if (!this.focused || !this.interactionEnabled) return false; this.activateAnchor(this.focused); return true; }
    projectAnchor() { return { x: 200, y: 250, visible: true }; }
    setInteractionEnabled(value) { this.interactionEnabled = value; this.interactionCalls.push(value); }
    getAnchorFootprint() { return { width: 60, height: 60 }; }
    dispose() { this.disposed = true; }
    activateAnchor(key) {
      const actions = { invite: { type: 'invite' }, vault: { type: 'vault' }, 'menu-espresso': { type: 'menu', recipe: 'espresso' }, 'menu-latte': { type: 'menu', recipe: 'latte' }, 'counter-a-recipe': { type: 'recipe', id: 'counter-a' }, 'counter-b-recipe': { type: 'recipe', id: 'counter-b' }, 'counter-a-upgrade': { type: 'counter', id: 'counter-a' }, 'counter-b-upgrade': { type: 'counter', id: 'counter-b' } };
      if (actions[key]) this.action(actions[key]);
    }
  }
  class FakeResizeObserver {
    observed = []; disconnected = false;
    constructor(callback) { this.callback = callback; observer = this; }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnected = true; }
  }
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const source = main.replace(/^import\s[\s\S]*?;\n/gm, '').replace(/if \(import\.meta\.hot\) import\.meta\.hot\.dispose\(\(\) => cleanup\(\)\);/, 'captureCleanup(() => cleanup());');
  const context = { document, window, location: { search: query }, HTMLElement: FakeElement, HTMLCanvasElement: FakeElement, HTMLButtonElement: FakeElement, Date: FakeDate, performance: { now: () => clock.performance }, AbortController, ResizeObserver: FakeResizeObserver, CoffeeScene: FakeScene, RenderBudget, FrameInterpolator, RouteDiagnostics, isRouteQA, RouteQAPanel, readRenderMode, isRenderMode, RENDER_MODE_KEY, structuredClone, createEngine, recipeById, managerSpeed, LocalSaveRepository, SAVE_KEY, URLSearchParams, URL: { createObjectURL: blob => { blobs.push(blob); return `blob:qa-${blobs.length}`; }, revokeObjectURL() {} }, Blob, console, setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id), captureCleanup: callback => { hmrCleanup = callback; } };
  runInNewContext(stripTypeScriptTypes(source), context, { timeout: 1500 });
  const debug = window.__coffeeSliceDebug;
  const state = () => structuredClone(debug.readState());
  return { clock, document, window, root, nodes, renderer, observer, frames, timers, memory, storageControl, downloads, blobs, state, flushCloseEvents() { for (const callback of closeEvents.splice(0)) callback(); }, element: selector => root.querySelector(selector), action: action => renderer.action(action), click(selector, extra = {}) { const target = root.querySelector(selector); assert.ok(target, selector); if (!target.disabled) { const event = { target, detail: 1, ...extra }; target.emit('click', event); root.emit('click', event); } }, tick(seconds = .2) { clock.now += seconds * 1000; clock.performance += seconds * 1000; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(clock.performance); }, dispose() { hmrCleanup?.(); } };
}

test('TC-3D-008 REQ-3D-015 full-viewport scene has no webpage frame or page scroll (static contract)', () => {
  assert.deepEqual(declarations('.coffee-world', 'position'), ['fixed']);
  assert.deepEqual(declarations('.coffee-world', 'inset'), ['0']);
  assert.deepEqual(declarations('.coffee-world', 'width'), ['100vw']);
  assert.deepEqual(declarations('.coffee-world', 'height'), ['100vh', '100dvh']);
  for (const selector of ['html', 'body', '#slice-root']) { assert.deepEqual(declarations(selector, 'margin'), ['0']); assert.deepEqual(declarations(selector, 'overflow'), ['hidden']); }
  assert.deepEqual(declarations('#coffee-canvas', 'width'), ['100%']);
  assert.deepEqual(declarations('#coffee-canvas', 'height'), ['100%']);
  assert.deepEqual(declarations('#coffee-canvas', 'touch-action'), ['none']);
  assert.equal(declarations('.coffee-world', 'border').length, 0);
  assert.equal(declarations('.coffee-world', 'border-radius').length, 0);
  assert.equal(declarations('#coffee-canvas', 'min-width').length, 0);
  assert.doesNotMatch(outsideModal, /<aside\b|counter-card|station-card|save-panel|经营卡片/);
  assert.equal(openingTags(outsideModal, 'canvas').length, 1);
});

test('TC-3D-009 REQ-3D-016 permanent HUD contains only a noninteractive ¥ amount and accessible settings (static contract)', () => {
  const hud = html.match(/<header\b[^>]*class="hud"[\s\S]*?<\/header>/)?.[0];
  assert.ok(hud);
  assert.equal(openingTags(hud, 'button').length, 1);
  assert.match(openingTags(hud, 'button')[0], /id="settings"/);
  assert.match(openingTags(hud, 'button')[0], /aria-label="[^"]*设置[^"]*"/);
  assert.equal(openingTags(hud, 'strong').length, 1);
  assert.match(hud, /id="wallet"/);
  assert.doesNotMatch(hud, /open-status|coin-mark|hud-actions|id="pause"|咖啡币|营业中|休息中|¤|<small\b/);
  assert.deepEqual(declarations('.hud', 'pointer-events'), ['none']);
  assert.deepEqual(declarations('.wallet-chip', 'pointer-events'), ['auto'], 'the visible amount blocks clicks on obscured scene pixels without becoming an action');
  assert.deepEqual(declarations('.wallet-chip', 'touch-action'), ['none']);
  assert.deepEqual(declarations('.wallet-chip', 'user-select'), ['none']);
  assert.deepEqual(openingTags(outsideModal, 'button'), openingTags(hud, 'button'));
  assert.doesNotMatch(outsideModal, /<nav\b|data-anchor=|world-controls|world-button|营业牌|暂停|经理推车/);
  assert.doesNotMatch(main, /positionControls|beginAnchorPointer|\.style\.transform\s*=\s*`translate\(/, 'no permanent screen-projected DOM controls remain');
  assert.equal(rules('.world-button').length, 0);
  assert.ok(declarations('.settings-button', 'pointer-events').includes('auto'));
  for (const property of ['width', 'height']) assert.ok(declarations('.settings-button', property).some(value => Number.parseFloat(value) >= 44), `HUD settings ${property} is at least 44px`);
  assert.doesNotMatch(main, /function togglePause\(|action\.type === "(?:pause|manager|settings)"/);
  assert.doesNotMatch(modal, /id="manager-panel"|data-open-manager|data-focus="(?:pause|manager|settings)"/);
});

test('TC-3D-008 REQ-3D-013 all rendered amounts use ¥ with two fractional digits (app harness)', () => {
  const f = fixture();
  try {
    assert.match(f.element('#wallet').textContent, /^¥\s?\d+\.\d{2}$/);
    const beforeWallet = f.state();
    const wallet = f.nodes.find(node => node.classList.contains('wallet-chip'));
    wallet.emit('pointerdown'); f.root.emit('click', { target: wallet });
    assert.deepEqual(f.state(), beforeWallet);
    assert.equal(f.element('#operation-dialog').open, false, 'amount display has no action route');
    for (const action of [{ type: 'counter', id: 'counter-a' }, { type: 'menu', recipe: 'latte' }, { type: 'vault' }]) {
      f.action(action);
      const shown = f.nodes.filter(node => !node.hidden && /\d+\.\d{2}/.test(node.textContent)).map(node => node.textContent);
      assert.ok(shown.length);
      for (const text of shown) { assert.doesNotMatch(text, /¤|\d\.\d{2}\s*币/); assert.match(text, /¥\s?\d+\.\d{2}/, text); }
      f.click('#dialog-close');
    }
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 scene actions and HUD settings open the correct details without hidden DOM anchors (app harness)', () => {
  const f = fixture();
  try {
    for (const [action, expected] of [[{ type: 'counter', id: 'counter-b' }, 'counter-panel'], [{ type: 'recipe', id: 'counter-a' }, 'counter-panel'], [{ type: 'menu', recipe: 'latte' }, 'coffee-panel'], [{ type: 'vault' }, 'vault-panel']]) {
      const before = f.state();
      f.action(action);
      assert.equal(f.element('#operation-dialog').open, true);
      assert.deepEqual(f.nodes.filter(node => node.classList.contains('operation-panel') && !node.hidden).map(node => node.id), [expected]);
      assert.deepEqual(f.state(), before, 'opening scene detail does not alter economy');
      f.click('#dialog-close');
    }
    const before = f.state();
    f.click('#settings');
    assert.equal(f.element('#operation-dialog').open, true);
    assert.deepEqual(f.nodes.filter(node => node.classList.contains('operation-panel') && !node.hidden).map(node => node.id), ['settings-panel']);
    assert.deepEqual(f.state(), before);
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 removed pause/manager/settings scene routes and pause hotkeys cannot alter play (app harness)', () => {
  const f = fixture();
  try {
    assert.equal(f.element('#pause'), null);
    assert.ok(f.element('#settings'));
    const before = f.state();
    for (const type of ['pause', 'manager', 'settings']) f.action({ type });
    for (const key of ['p', 'P', 'Pause', 'Escape']) f.element('#coffee-canvas').emit('keydown', { key, repeat: false });
    assert.deepEqual(f.state(), before);
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.state().paused, false);
    f.tick(.5);
    assert.ok(f.state().elapsed > before.elapsed, 'current play continues without a user pause route');
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 only HUD settings remains outside the closed native operation dialog (static contract)', () => {
  assert.ok(modalStart >= 0);
  assert.doesNotMatch(openingTags(modal, 'dialog')[0], /\bopen(?:\s|=|>)/);
  const panels = openingTags(modal, 'div').filter(tag => tag.includes('class="operation-panel"'));
  assert.equal(panels.length, 4);
  for (const panel of panels) assert.match(panel, /\bhidden(?:\s|>)/);
  assert.doesNotMatch(outsideModal, /class="operation-panel"|id="counter-panel"|id="settings-panel"/);
  assert.deepEqual(declarations('[hidden]', 'display'), ['none']);
  assert.ok(rules('[hidden]')[0].nodes.some(node => node.prop === 'display' && node.important));
  assert.match(main, /dialog\.showModal\(\)/, 'native modal provides inert background/Escape, still requiring browser QA');
  assert.match(main, /on\(dialog, "close"/);
  assert.match(main, /on\(\$\("#dialog-close"\), "click", closePanel\)/);
  assert.match(main, /event\.target === dialog/);
});

test('TC-3D-008 REQ-3D-015 modal close/backdrop restore canvas focus and reject background scene actions (app harness)', () => {
  const f = fixture();
  try {
    const canvas = f.element('#coffee-canvas'), dialog = f.element('#operation-dialog');
    canvas.focus();
    f.action({ type: 'counter', id: 'counter-a' });
    assert.equal(f.document.activeElement, f.element('#dialog-close'));
    assert.equal(f.renderer.interactionEnabled, false);
    assert.deepEqual(f.renderer.interactionCalls, [false]);
    const before = f.state();
    f.action({ type: 'pause' });
    f.action({ type: 'invite' });
    assert.deepEqual(f.state(), before, 'scene callback cannot mutate background while modal is open');
    f.click('#dialog-close');
    assert.equal(dialog.open, false);
    assert.equal(f.renderer.interactionEnabled, true);
    assert.deepEqual(f.renderer.interactionCalls, [false, true]);
    assert.equal(f.document.activeElement, canvas, 'scene detail close returns to the actual canvas');
    f.action({ type: 'vault' });
    dialog.emit('click', { target: dialog, clientX: 90, clientY: 90 });
    assert.equal(dialog.open, false, 'click outside the dialog rectangle closes it');
    f.action({ type: 'vault' });
    dialog.emit('click', { target: dialog, clientX: 150, clientY: 150 });
    assert.equal(dialog.open, true, 'click in the dialog content does not dismiss it');
    dialog.close(); // Simulates the close event native Escape supplies; not proof of browser Escape.
    assert.equal(f.document.activeElement, canvas);
    f.action({ type: 'invite' });
    assert.ok(f.state().customers.length > before.customers.length, 'physical input is usable after dismissing a modal');
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-014 scene keyboard access is provided on the real canvas with instructions (static contract)', () => {
  const canvas = openingTags(outsideModal, 'canvas')[0];
  assert.match(canvas, /tabindex="0"/);
  assert.match(canvas, /aria-describedby="[^"]+"/);
  assert.match(outsideModal, /键盘|Tab|Enter|方向键|空格/);
  assert.match(main, /keydown/);
  assert.deepEqual(openingTags(outsideModal, 'button').map(tag => /id="([^"]+)"/.exec(tag)?.[1]), ['settings'], 'keyboard support cannot reintroduce offscreen duplicate scene buttons');
  assert.ok(rules('#coffee-canvas:focus-visible').length, 'keyboard users can locate their scene focus');
  assert.ok(declarations('#coffee-canvas:focus-visible', 'outline-offset').some(value => Number.parseFloat(value) < 0), 'full-viewport focus ring must be inset so overflow:hidden does not clip it');
});

test('TC-3D-008 REQ-3D-014 actual canvas keys select, pan and activate scene objects once, with modal/modifier guards (app harness)', () => {
  const f = fixture();
  try {
    const canvas = f.element('#coffee-canvas');
    canvas.emit('pointerdown');
    assert.equal(f.document.activeElement, canvas);
    let event = canvas.emit('keydown', { key: 'ArrowRight' });
    assert.equal(event.prevented, true);
    assert.equal(f.renderer.getFocus(), 'counter-a-recipe');
    assert.match(f.element('#toast').textContent, /柜台 A 配方牌/);
    canvas.emit('keydown', { key: 'ArrowLeft' });
    assert.equal(f.renderer.getFocus(), 'invite');
    canvas.emit('keydown', { key: 'ArrowUp' }); canvas.emit('keydown', { key: 'ArrowDown' });
    assert.deepEqual(f.renderer.panCalls, [[0, 80], [0, -80]]);
    const focusCount = f.renderer.focusCalls.length;
    event = canvas.emit('keydown', { key: 'ArrowRight', ctrlKey: true });
    assert.equal(event.prevented, false);
    assert.equal(f.renderer.focusCalls.length, focusCount);
    event = canvas.emit('keydown', { key: 'Tab' });
    assert.equal(event.prevented, false, 'ordinary Tab keeps normal browser focus navigation');
    canvas.emit('keydown', { key: 'Home' });
    assert.equal(f.renderer.getFocus(), 'counter-a-recipe');
    canvas.emit('keydown', { key: 'Enter', repeat: true });
    assert.equal(f.renderer.activationCalls, 0, 'held Enter cannot repeat purchase/open action');
    canvas.emit('keydown', { key: 'Enter', repeat: false });
    assert.equal(f.renderer.activationCalls, 1);
    assert.equal(f.element('#counter-panel').hidden, false);
    canvas.emit('keydown', { key: 'ArrowRight' });
    canvas.emit('keydown', { key: ' ', repeat: false });
    assert.equal(f.renderer.getFocus(), 'counter-a-recipe', 'inert modal background cannot change selected scene object');
    assert.equal(f.renderer.activationCalls, 1);
    f.click('#dialog-close');
    f.renderer.focusAnchor('vault');
    canvas.emit('keydown', { key: ' ', repeat: false });
    assert.equal(f.element('#vault-panel').hidden, false);
    canvas.emit('keydown', { key: ' ', repeat: true });
    assert.equal(f.state().paused, false, 'Space operates focused geometry and never hides a pause toggle');
    f.click('#dialog-close');
    f.click('#settings');
    assert.equal(f.element('#settings-panel').hidden, false);
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-015 dialog recipe/upgrade/navigation routes preserve core rules and visible close focus (app harness)', () => {
  const f = fixture();
  try {
    f.action({ type: 'counter', id: 'counter-a' });
    const latte = f.nodes.find(node => node.dataset.selectRecipe === 'latte');
    f.root.emit('click', { target: latte });
    assert.equal(f.state().counters[0].recipe, 'latte');
    const beforeUpgrade = f.state();
    f.click('#counter-upgrade');
    assert.equal(f.state().counters[0].level, beforeUpgrade.counters[0].level + 1);
    assert.ok(f.state().wallet < beforeUpgrade.wallet);
    f.click('#dialog-close');
    f.action({ type: 'vault' });
    assert.equal(f.element('#manager-panel'), null);
    assert.equal(f.element('#manager-upgrade').disabled, true, 'vault owns the manager upgrade and uses its existing quote');
    assert.match(f.element('#manager-rank').textContent, /^Lv\. 1$/);
    assert.equal(f.document.activeElement, f.element('#dialog-close'));
    f.click('#dialog-close');
    f.action({ type: 'menu', recipe: 'espresso' });
    const assign = f.nodes.find(node => node.dataset.assign === 'counter-b');
    f.root.emit('click', { target: assign });
    assert.equal(f.state().counters[1].recipe, 'espresso');
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
    assert.equal(f.renderer.focusCalls.at(-1), 'counter-b-recipe');
    f.click('#settings');
    const entryJump = f.nodes.find(node => node.dataset.focus === 'invite');
    f.root.emit('click', { target: entryJump });
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.renderer.focusCalls.at(-1), 'invite');
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-017 manager grade, efficiency and upgrade belong to the vault and preserve the core quote (app harness)', () => {
  const vaultMarkup = modal.slice(modal.indexOf('id="vault-panel"'), modal.indexOf('id="settings-panel"'));
  for (const id of ['manager-rank', 'manager-speed', 'manager-status', 'manager-preview', 'manager-upgrade']) assert.match(vaultMarkup, new RegExp(`id="${id}"`));
  assert.equal(openingTags(modal, 'button').filter(tag => tag.includes('id="manager-upgrade"')).length, 1);
  assert.doesNotMatch(html, /manager-panel|data-open-manager|经理推车|米\/秒/);
  const f = fixture();
  try {
    const expected = createEngine(f.state()), quote = expected.managerQuote();
    f.action({ type: 'vault' });
    assert.equal(f.element('#vault-panel').hidden, false);
    assert.match(f.element('#manager-rank').textContent, /^Lv\. 1$/);
    assert.equal(f.element('#manager-speed').textContent, '100%');
    assert.match(f.element('#manager-preview').textContent, /107%/);
    assert.match(f.element('#manager-upgrade').textContent, /¥10\.00/);
    assert.equal(f.element('#manager-upgrade').disabled, false);
    assert.equal(expected.upgradeManager(), true);
    f.click('#manager-upgrade');
    assert.deepEqual(f.state(), expected.snapshot(), 'the vault purchase has exactly the core cost, rank and event changes');
    assert.equal(f.state().wallet, 1200 - quote.cost);
    assert.equal(f.element('#manager-rank').textContent, 'Lv. 2');
    assert.equal(f.element('#manager-speed').textContent, '107%');
    assert.equal(f.element('#manager-upgrade').disabled, true, 'a repeated purchase cannot exceed the current wallet');
    f.click('#manager-upgrade');
    assert.deepEqual(f.state(), expected.snapshot());
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, f.state());
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 HUD settings uses the same modal input guard and restores its own visible focus (app harness)', () => {
  const f = fixture();
  try {
    const settings = f.element('#settings'), dialog = f.element('#operation-dialog');
    settings.focus(); f.click('#settings');
    assert.equal(dialog.open, true);
    assert.equal(f.renderer.interactionEnabled, false);
    assert.equal(f.document.activeElement, f.element('#dialog-close'));
    const before = f.state();
    f.action({ type: 'invite' }); f.action({ type: 'vault' }); f.click('#settings');
    assert.deepEqual(f.state(), before);
    assert.equal(f.element('#settings-panel').hidden, false);
    assert.equal(dialog.showModalCalls, 1, 'a repeated HUD click cannot reopen or replace the current modal');
    f.tick(.5);
    const expected = createEngine(before); expected.advance(.5);
    assert.deepEqual(f.state(), expected.snapshot(), 'a settings modal suspends input while automatic play keeps running');
    f.click('#dialog-close');
    assert.equal(f.renderer.interactionEnabled, true);
    assert.equal(f.document.activeElement, settings, 'HUD settings is still a visible keyboard return target');
    f.click('#settings');
    dialog.close(); // Native Escape behavior still requires browser QA.
    assert.equal(f.document.activeElement, settings);
    assert.equal(f.renderer.interactionEnabled, true);
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-015 post-dialog navigation survives native asynchronous close-event ordering (app harness)', () => {
  const f = fixture({ deferDialogClose: true });
  try {
    f.click('#settings');
    const jump = f.nodes.find(node => node.dataset.focus === 'vault');
    f.root.emit('click', { target: jump });
    assert.equal(f.element('#operation-dialog').open, false);
    f.flushCloseEvents();
    assert.equal(f.renderer.focusCalls.at(-1), 'vault', 'native close-event delay must not discard the pending scene navigation while input is suspended');
    f.action({ type: 'menu', recipe: 'espresso' });
    const assign = f.nodes.find(node => node.dataset.assign === 'counter-b');
    f.root.emit('click', { target: assign });
    f.flushCloseEvents();
    assert.equal(f.state().counters[1].recipe, 'espresso');
    assert.equal(f.renderer.focusCalls.at(-1), 'counter-b-recipe', 'assignment must reveal the destination physical counter after asynchronous dismissal');
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-015 a stale queued close cannot dismantle a newly reopened native dialog (app harness)', () => {
  const f = fixture({ deferDialogClose: true });
  try {
    f.element('#coffee-canvas').focus();
    f.click('#settings');
    f.click('#dialog-close');
    assert.equal(f.renderer.interactionEnabled, true);
    f.action({ type: 'vault' });
    assert.equal(f.renderer.interactionEnabled, false);
    f.flushCloseEvents();
    assert.equal(f.element('#operation-dialog').open, true);
    assert.equal(f.element('#vault-panel').hidden, false);
    assert.equal(f.renderer.interactionEnabled, false, 'an older close event must not unlock a new modal background');
    const focus = f.document.activeElement, before = f.state();
    f.action({ type: 'pause' });
    assert.deepEqual(f.state(), before);
    assert.equal(f.document.activeElement, focus);
    f.tick(.5);
    assert.match(f.element('#dialog-title').textContent, /金库/);
    f.click('#dialog-close');
    f.flushCloseEvents();
    assert.equal(f.renderer.interactionEnabled, true);
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 physical invite remains cooldown/conflict guarded without duplicate DOM handlers (app harness)', () => {
  const f = fixture();
  try {
    const expected = createEngine(f.state()); expected.invite(); expected.invite();
    f.action({ type: 'invite' }); f.action({ type: 'invite' });
    assert.deepEqual(f.state(), expected.snapshot(), 'one accepted invite keeps the existing three-guest core rule; immediate repeat is rejected');
    assert.ok(f.state().inviteCooldown > 0);
    const foreign = JSON.parse(f.memory.getItem(SAVE_KEY)); foreign.recordChangeTag = 'invite-conflict';
    f.memory.setItem(SAVE_KEY, JSON.stringify(foreign));
    f.window.emit('storage', { key: SAVE_KEY, newValue: JSON.stringify(foreign) });
    const paused = f.state();
    assert.equal(paused.paused, true);
    f.action({ type: 'invite' });
    assert.deepEqual(f.state(), paused);
    assert.equal(f.element('#invite'), null, 'no parallel DOM invite can duplicate a geometry tap');
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-015 modal controls maintain 44px targets, safe-area and dynamic viewport hooks (static contract)', () => {
  assert.match(index, /viewport-fit=cover/);
  for (const property of ['width', 'height']) for (const value of declarations('.dialog-close', property)) assert.ok(Number.parseFloat(value) >= 44, `.dialog-close ${property}: ${value}`);
  for (const selector of ['.primary-button', '.secondary-button', '.assign-buttons button', '.settings-grid button', '.jump-grid button', '.recipe-picker button', 'summary']) assert.ok(declarations(selector, 'min-height').some(value => Number.parseFloat(value) >= 44), selector);
  for (const [property, inset] of [['left', 'left'], ['top', 'top']]) assert.ok(declarations('.hud', property).every(value => value.includes(`safe-area-inset-${inset}`)));
  assert.ok(declarations('.operation-dialog', 'max-height').every(value => value.includes('dvh') && value.includes('safe-area-inset-bottom')));
  assert.match(main, /sizeObserver\?\.observe\(\$\("#coffee-canvas"\)\)/);
  assert.match(main, /on\(visualViewport, "resize"/);
  assert.match(main, /sizeObserver\?\.disconnect\(\)/);
  assert.match(main, /listeners\.abort\(\)/);
});

test('TC-3D-008 REQ-3D-006 HUD settings preserve manual save and export, with corrupt bytes protected (app harness)', async () => {
  const f = fixture();
  try {
    f.click('#settings');
    f.click('#save');
    const envelope = JSON.parse(f.memory.getItem(SAVE_KEY));
    assert.deepEqual(envelope.state, f.state());
    f.click('#export');
    assert.equal(f.downloads.length, 1);
    assert.equal(f.downloads[0].download, 'mellow-bean-local-backup.json');
    assert.deepEqual(JSON.parse(await f.blobs[0].text()).state, f.state());
  } finally { f.dispose(); }
  const raw = '{ definitely not a save';
  const corrupt = fixture({ raw });
  try {
    corrupt.click('#settings');
    assert.equal(corrupt.element('#new-shop').hidden, false);
    corrupt.click('#save');
    corrupt.tick(10);
    assert.equal(corrupt.memory.getItem(SAVE_KEY), raw, 'manual/autosave must not overwrite unreadable source bytes');
    corrupt.click('#export');
    assert.equal(corrupt.downloads.length, 1);
    assert.equal(await corrupt.blobs[0].text(), raw, 'corrupt export preserves exact original bytes instead of exporting invented replacement state');
  } finally { corrupt.dispose(); }
});

test('TC-3D-008 REQ-3D-015 names and save feedback are transient; disabled browser storage still permits backup (app harness)', async () => {
  const f = fixture({ storageUnavailable: true });
  try {
    assert.match(f.element('#save-status').textContent, /不可用/);
    f.click('#settings');
    f.click('#save');
    assert.match(f.element('#save-status').textContent, /失败/);
    assert.equal(f.element('#toast').classList.contains('visible'), true);
    for (const callback of [...f.timers.values()]) callback();
    assert.equal(f.element('#toast').classList.contains('visible'), false, 'feedback does not become permanent HUD');
    f.click('#export');
    assert.equal(f.downloads.length, 1);
    assert.deepEqual(JSON.parse(await f.blobs[0].text()).state, f.state());
    assert.doesNotMatch(outsideModal, /pan-hint|open-status/);
    assert.match(main, /setTimeout\([\s\S]*?#toast[\s\S]*?classList\.remove\("visible"\)[\s\S]*?3500\)/);
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-006 external save conflict freezes and blocks removed pause routes and purchases (app harness)', () => {
  const f = fixture();
  try {
    const newer = JSON.parse(f.memory.getItem(SAVE_KEY)); newer.recordChangeTag = 'other-client';
    f.memory.setItem(SAVE_KEY, JSON.stringify(newer));
    f.window.emit('storage', { key: SAVE_KEY, newValue: JSON.stringify(newer) });
    assert.equal(f.state().paused, true);
    f.action({ type: 'pause' });
    assert.equal(f.state().paused, true, 'removed pause callback must not bypass conflict protection');
    f.action({ type: 'counter', id: 'counter-a' });
    assert.equal(f.element('#counter-upgrade').disabled, true);
    f.click('#dialog-close');
    f.click('#settings');
    assert.equal(f.element('#reload').hidden, false);
    assert.match(f.element('#save-status').textContent, /变化|最新/);
    f.click('#save');
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).recordChangeTag, 'other-client');
  } finally { f.dispose(); }
});

function pausedProgress() {
  const engine = createEngine(); engine.advance(22); engine.togglePause(); return engine.snapshot();
}
function omitPauseClaims(state) {
  const copy = structuredClone(state); delete copy.paused; delete copy.lastOfflineClaimId; delete copy.offlineClaimIds; return copy;
}

// Write authentic pre-route-v2 bytes directly: repository.save would normalize them
// before the app's loader sees them and would hide boot/reload migration regressions.
function legacyRouteProgress(routeVersion) {
  const state = createInitialState();
  if (routeVersion === undefined) delete state.managerRouteVersion;
  else state.managerRouteVersion = routeVersion;
  state.paused = true;
  state.stepCarry = .037;
  state.eventSequence = 12;
  state.lastOfflineClaimId = 'legacy-already-claimed';
  state.offlineClaimIds = ['legacy-already-claimed'];
  state.manager = { x: -4, z: -1.7, carrying: 70, phase: 'moving', target: 0, timer: 0, level: 1 };
  state.counters[0].pendingCash = 200;
  state.counters[1].pendingCash = 300;
  state.totalEarned = 570;
  return state;
}

test('TC-3D-010 legacy raw route saves resume once, finish their current sweep and persist the real B-first route (app harness)', () => {
  for (const routeVersion of [undefined, 1]) for (const age of [10, 3600]) {
    const initial = legacyRouteProgress(routeVersion);
    const raw = JSON.stringify({ schemaVersion: 1, savedAt: Date.now() - age * 1000, recordChangeTag: `legacy-route-${routeVersion}-${age}`, state: initial });
    const f = fixture({ raw });
    try {
      const expected = structuredClone(initial);
      expected.managerRouteVersion = 2;
      expected.manager.x = 4.4;
      expected.manager.finishLegacySweep = true;
      assert.equal(f.state().paused, false, 'only current play resumes after the old paused interval is settled');
      assert.deepEqual(omitPauseClaims(f.state()), omitPauseClaims(expected), 'boot changes route coordinates/version only; assets, timer, event sequence and partial fixed step survive');
      assert.equal(f.renderer.updates.length, 0, 'the first real snapshot is delivered by the single RAF owner');
      const wallet = f.state().wallet;
      let safety = 0;
      while (f.state().manager.finishLegacySweep && safety++ < 200) {
        const before = f.state();
        f.tick(.05);
        if (f.state().manager.finishLegacySweep) assert.equal(f.state().wallet, wallet, 'legacy collection is still unavailable until the physical vault deposit');
        else {
          assert.equal(before.manager.phase, 'depositing');
          assert.equal(before.manager.x, 8.8);
        }
      }
      assert.ok(safety < 200, 'the in-flight legacy sweep reaches a terminating deposit');
      assert.equal(f.state().wallet, wallet + 570, 'exactly the carried and pending money is credited once');
      assert.equal(f.state().manager.carrying, 0);
      assert.equal(f.state().manager.target, 1, 'the next real sweep leaves the left vault for nearest counter B');
      assert.equal(f.state().manager.x, 8.8);
      assert.equal(f.state().manager.finishLegacySweep, undefined);
      f.click('#settings'); f.click('#save');
      const saved = JSON.parse(f.memory.getItem(SAVE_KEY)).state;
      assert.deepEqual(saved, f.state());
      assert.equal(saved.managerRouteVersion, 2);
      const reopened = fixture({ raw: f.memory.getItem(SAVE_KEY) });
      try { assert.deepEqual(reopened.state(), saved, 'a route-v2 save is not remapped or deposited again on immediate reboot'); }
      finally { reopened.dispose(); }
    } finally { f.dispose(); }
  }
});

test('TC-3D-010 failed legacy-route offline settlement preserves bytes and freezes migrated assets until successful reload (app harness)', () => {
  for (const mode of ['writeUnavailable', 'conflictDuringClaim']) {
    const initial = legacyRouteProgress(1);
    initial.paused = false;
    initial.stepCarry = 0;
    initial.manager = { x: -8, z: -1.7, carrying: 570, phase: 'depositing', target: 2, timer: .55, level: 1 };
    initial.counters.forEach(counter => counter.pendingCash = 0);
    const raw = JSON.stringify({ schemaVersion: 1, savedAt: Date.now() - 3600000, recordChangeTag: `legacy-failed-${mode}`, state: initial });
    const f = fixture({ raw, [mode]: true });
    try {
      const protectedRaw = f.memory.getItem(SAVE_KEY), frozen = f.state();
      assert.equal(frozen.paused, true);
      assert.equal(frozen.managerRouteVersion, 2);
      assert.equal(frozen.manager.x, 8.8);
      assert.equal(frozen.manager.target, 2);
      assert.equal(frozen.manager.timer, .55);
      assert.equal(frozen.manager.carrying, 570);
      assert.equal(frozen.wallet, 1200);
      assert.equal(frozen.elapsed, 0);
      assert.equal(f.element('#reload').hidden, false);
      f.tick(20);
      assert.deepEqual(f.state(), frozen, 'failed anchor settlement cannot grant partial offline progress or complete the pending deposit');
      f.click('#settings'); f.click('#save');
      assert.equal(f.memory.getItem(SAVE_KEY), protectedRaw, 'blocked manual/autosave keeps original or concurrent legacy bytes');
      f.storageControl.writeUnavailable = false;
      f.click('#reload');
      assert.equal(f.state().paused, false);
      assert.ok(f.state().elapsed >= 1800 && f.state().elapsed <= 1810, 'successful reload settles the single previously unpaid offline interval');
      assert.equal(f.state().managerRouteVersion, 2);
      const once = f.state(), onceRaw = f.memory.getItem(SAVE_KEY);
      assert.ok(once.wallet > 1200);
      f.click('#reload');
      assert.deepEqual(f.state(), once, 'repeated reload cannot repeat migration or the credited offline interval');
      assert.equal(f.memory.getItem(SAVE_KEY), onceRaw);
    } finally { f.dispose(); }
  }
});

test('TC-3D-010 migration persists before a hidden first frame and BFCache/repeated saves cannot remap or claim twice (app harness)', () => {
  const initial = legacyRouteProgress(undefined);
  const raw = JSON.stringify({ schemaVersion: 1, savedAt: Date.now() - 10000, recordChangeTag: 'legacy-hidden-before-raf', state: initial });
  const f = fixture({ raw });
  try {
    const first = f.state();
    assert.equal(first.manager.x, 4.4);
    assert.equal(first.managerRouteVersion, 2);
    assert.equal(first.manager.finishLegacySweep, true);
    assert.equal(f.renderer.updates.length, 0);
    f.document.hidden = true; f.document.emit('visibilitychange');
    assert.equal(f.frames.size, 0);
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, first, 'hiding before the initial RAF persists the canonical route and unchanged assets');
    f.clock.now += 45000; f.clock.performance += 45000;
    f.document.hidden = false; f.document.emit('visibilitychange');
    const resumed = f.state();
    assert.equal(resumed.elapsed, 22.5, 'only the hidden45s interval is advanced at offline efficiency');
    assert.equal(resumed.managerRouteVersion, 2);
    assert.equal(resumed.manager.finishLegacySweep, undefined, 'the in-flight old sweep completes once and thereafter follows the real route');
    assert.equal(f.frames.size, 1);
    f.window.emit('pageshow', { persisted: true });
    assert.deepEqual(f.state(), resumed, 'visibility and BFCache do not both claim the same interval');
    assert.equal(f.frames.size, 1);
    f.click('#settings'); f.click('#save'); f.click('#save');
    assert.deepEqual(f.state(), resumed, 'manual saves cannot normalize canonical route-v2 coordinates again');
    const saved = JSON.parse(f.memory.getItem(SAVE_KEY));
    assert.deepEqual(saved.state, resumed);
    assert.equal(saved.savedAt, f.clock.now);
    const reopened = fixture({ raw: f.memory.getItem(SAVE_KEY) });
    try { assert.deepEqual(reopened.state(), resumed, 'reopening already anchored hidden progress never repeats the migrated sweep or offline earnings'); }
    finally { reopened.dispose(); }
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 valid previous paused saves resume current play without paused-interval income on boot (app harness)', () => {
  for (const savedAtAgoSeconds of [10, 3600]) {
    const initial = pausedProgress(), f = fixture({ initial, savedAtAgoSeconds });
    try {
      assert.equal(f.state().paused, false, `valid ${savedAtAgoSeconds}s old pause must not strand the no-pause UI`);
      assert.deepEqual(omitPauseClaims(f.state()), omitPauseClaims(initial), 'repository first settles the old pause with zero elapsed, income, movement or asset changes');
      assert.equal(f.element('#reload').hidden, true);
      const before = f.state();
      f.tick(.5);
      const expected = createEngine(before); expected.advance(.5);
      assert.deepEqual(f.state(), expected.snapshot(), 'only the new online interval advances after automatic resume');
      f.click('#settings'); f.click('#save');
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, false);
      const reloaded = fixture({ raw: f.memory.getItem(SAVE_KEY) });
      try { assert.deepEqual(reloaded.state(), f.state(), 'immediate new boot cannot reclaim the already settled paused interval'); }
      finally { reloaded.dispose(); }
    } finally { f.dispose(); }
  }
});

test('TC-3D-009 REQ-3D-016 reading a valid external paused save resumes only current play after conflict recovery (app harness)', () => {
  const f = fixture();
  try {
    const paused = pausedProgress();
    const latest = { schemaVersion: 1, savedAt: f.clock.now - 3600000, recordChangeTag: 'valid-paused-other-window', state: paused };
    const raw = JSON.stringify(latest); f.memory.setItem(SAVE_KEY, raw);
    f.window.emit('storage', { key: SAVE_KEY, newValue: raw });
    assert.equal(f.state().paused, true);
    f.click('#settings'); f.click('#reload');
    assert.equal(f.state().paused, false);
    assert.deepEqual(omitPauseClaims(f.state()), omitPauseClaims(paused), 'reload claims no income or movement from the paused hour');
    assert.equal(f.element('#reload').hidden, true);
    const before = f.state();
    f.tick(.5);
    const expected = createEngine(before); expected.advance(.5);
    assert.deepEqual(f.state(), expected.snapshot());
    f.click('#save');
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, false);
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-006 failed offline writes or a concurrent claim keep paused valid saves conflict-protected (app harness)', () => {
  for (const mode of ['writeUnavailable', 'conflictDuringClaim']) {
    const initial = pausedProgress(), f = fixture({ initial, savedAtAgoSeconds: 3600, [mode]: true });
    try {
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      assert.equal(before.paused, true, `${mode} must not be unlocked by valid-pause automatic resume`);
      assert.deepEqual(omitPauseClaims(before), omitPauseClaims(initial));
      assert.equal(f.element('#reload').hidden, false);
      for (const type of ['pause', 'manager', 'settings', 'invite']) f.action({ type });
      f.tick(20);
      assert.deepEqual(f.state(), before);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, 'blocked autosave cannot replace the valid original or another client');
      f.action({ type: 'vault' });
      assert.equal(f.element('#manager-upgrade').disabled, true);
      f.click('#manager-upgrade');
      assert.deepEqual(f.state(), before);
      f.click('#dialog-close'); f.click('#settings'); f.click('#save');
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      if (mode === 'writeUnavailable') {
        f.click('#reload');
        assert.equal(f.state().paused, true, 'repeated failed reload still cannot resume protected play');
        f.storageControl.writeUnavailable = false;
        f.click('#reload');
        assert.equal(f.state().paused, false, 'explicit successful latest-save recovery can resume current play');
        assert.deepEqual(omitPauseClaims(f.state()), omitPauseClaims(initial));
      }
    } finally { f.dispose(); }
  }
});

test('TC-3D-009 REQ-3D-006 bad, future and foreign saves preserve source bytes through HUD settings and reload (app harness)', async () => {
  const initial = createInitialState();
  const badLedger = structuredClone(initial); badLedger.wallet++;
  const badDeposit = structuredClone(initial); Object.assign(badDeposit.manager, { x: 0, target: 2, phase: 'depositing' });
  const badRouteSegment = structuredClone(initial); badRouteSegment.manager.x = 0;
  const cases = [
    '{ definitely not a save',
    JSON.stringify({ schemaVersion: 2, state: initial }),
    JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), recordChangeTag: 'future-manager-route', state: { ...initial, managerRouteVersion: 3 } }),
    JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), recordChangeTag: 'bad-ledger', state: badLedger }),
    JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), recordChangeTag: 'bad-physical-deposit', state: badDeposit }),
    JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), recordChangeTag: 'bad-route-segment', state: badRouteSegment }),
    JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), recordChangeTag: 'foreign-schema', state: { schemaVersion: 1, economyVersion: 1, paused: true } }),
  ];
  for (const raw of cases) {
    const f = fixture({ raw });
    try {
      f.click('#settings');
      assert.equal(f.element('#new-shop').hidden, false);
      f.click('#save'); f.tick(10);
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      f.click('#export');
      assert.equal(await f.blobs[0].text(), raw, 'backup must preserve the source instead of a resumed invented state');
      f.window.emit('storage', { key: SAVE_KEY, newValue: 'changed elsewhere' });
      assert.equal(f.state().paused, true);
      f.click('#reload');
      f.click('#save'); f.tick(10);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, 'failed compatible reload does not release source-byte protection');
      assert.equal(f.element('#new-shop').hidden, false);
    } finally { f.dispose(); }
  }
});

test('TC-3D-008 REQ-3D-004 hidden/BFCache resume applies elapsed time only once and retains one RAF owner (app harness)', () => {
  const f = fixture();
  try {
    f.tick(.5);
    f.document.hidden = true; f.document.emit('visibilitychange');
    assert.equal(f.frames.size, 0);
    const hidden = f.state();
    f.clock.now += 45000; f.clock.performance += 45000;
    f.document.hidden = false; f.document.emit('visibilitychange');
    const resumed = f.state();
    assert.ok(resumed.elapsed > hidden.elapsed);
    assert.equal(f.frames.size, 1);
    f.window.emit('pageshow', { persisted: true });
    assert.deepEqual(f.state(), resumed, 'visibility and BFCache callbacks cannot double-claim the same interval');
    assert.equal(f.frames.size, 1);
    f.window.emit('pagehide', { persisted: true });
    assert.equal(f.renderer.disposed, false, 'BFCache suspension must not destroy its scene');
    f.clock.now += 2000; f.clock.performance += 2000;
    f.window.emit('pageshow', { persisted: true });
    assert.equal(f.frames.size, 1);
    assert.ok(f.state().elapsed > resumed.elapsed);
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-004 final disposal removes UI listeners, observer and RAF; late scene actions are harmless (app harness)', () => {
  const f = fixture();
  f.window.emit('pagehide', { persisted: false });
  assert.equal(f.renderer.disposed, true);
  assert.equal(f.observer.disconnected, true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  for (const target of [f.root, f.document, f.window, f.window.visualViewport, ...f.nodes]) assert.equal([...target.listeners.values()].reduce((n, listeners) => n + listeners.size, 0), 0);
  const before = f.state();
  f.action({ type: 'pause' }); f.action({ type: 'invite' }); f.click('#settings');
  assert.deepEqual(f.state(), before);
  assert.equal(f.element('#operation-dialog').open, false);
  f.dispose();
});

test('TC-3D-011 explicit low-power app submits budgeted renders and keeps authoritative elapsed time', () => {
  const f = fixture({ renderMode: 'low-power' });
  try {
    for (let i = 0; i < 1200; i++) f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, 300);
    assert.ok(Math.abs(f.state().elapsed - 10) < 1e-8);
    assert.equal(f.frames.size, 1, 'there is still exactly one live RAF owner');
    const rendered = f.renderer.updates.length;
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.tick(5);
    assert.equal(f.renderer.updates.length, rendered);
    f.document.hidden = false; f.document.emit('visibilitychange');
    f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, rendered, 'reset does not immediately render a stale catch-up frame');
    f.tick(1 / 40);
    assert.equal(f.renderer.updates.length, rendered + 1);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});

test('TC-3D-011 sub-frame visibility and BFCache saves settle visible time once without extra renders', () => {
  const f = fixture({ renderMode: 'low-power' });
  try {
    for (let cycle = 0; cycle < 10; cycle++) {
      f.tick(.025);
      f.document.hidden = true; f.document.emit('visibilitychange');
      f.window.emit('pagehide', { persisted: true });
      f.tick(.010);
      f.document.hidden = false; f.document.emit('visibilitychange');
      f.window.emit('pageshow', { persisted: true });
    }
    assert.ok(Math.abs(f.state().elapsed + f.state().stepCarry - .35) < 1e-8, 'visible skipped frames and hidden intervals are each applied once');
    assert.equal(f.renderer.updates.length, 0, 'lifecycle settlement never schedules a catch-up render');
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});


test('TC-3D-011 delayed duplicate pageshow preserves the newly visible tail', () => {
  const f = fixture();
  try {
    f.tick(.025);
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.tick(.010);
    f.window.emit('pagehide', { persisted: true });
    f.document.hidden = false; f.document.emit('visibilitychange');
    f.tick(.015);
    f.window.emit('pageshow', { persisted: true });
    assert.ok(Math.abs(f.state().elapsed + f.state().stepCarry - .05) < 1e-8);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});


test('TC-3D-012 default app draws every display frame using interpolated poses, without extra RAF owners', () => {
  const f = fixture();
  try {
    assert.equal(f.renderer.renderMode, 'smooth');
    for (let i = 0; i < 120; i++) f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, 120);
    assert.ok(Math.abs(f.state().elapsed - 1) < 1e-9);
    const poses = f.renderer.updates.slice(12, 100).map(update => update.state.manager.x);
    for (let i = 1; i < poses.length; i++) assert.ok(Math.abs(poses[i - 1] - poses[i] - 2.6 / 120) < 1e-8);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});

test('TC-3D-012 quality selection changes renderer/budget, persists separately, and preserves economy', () => {
  const f = fixture({ renderMode: 'low-power' });
  try {
    f.tick(.01);
    f.click('#settings');
    const before = f.state();
    const smooth = f.nodes.find(node => node.dataset.renderMode === 'smooth');
    f.root.emit('click', { target: smooth });
    assert.equal(f.renderer.renderMode, 'smooth');
    assert.equal(f.memory.getItem(RENDER_MODE_KEY), 'smooth');
    assert.equal(smooth.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(f.state(), before);
    f.tick(.006);
    assert.ok(Math.abs(f.state().elapsed + f.state().stepCarry - .016) < 1e-9);
    assert.equal(f.renderer.updates.length, 1);
    assert.equal(f.frames.size, 1);
    f.root.emit('click', { target: smooth });
    assert.equal(f.frames.size, 1, 'repeat selection does not create another loop');
  } finally { f.dispose(); }
  const blocked = fixture({ writeUnavailable: true });
  try {
    blocked.click('#settings');
    const low = blocked.nodes.find(node => node.dataset.renderMode === 'low-power');
    blocked.root.emit('click', { target: low });
    assert.equal(blocked.renderer.renderMode, 'low-power');
    assert.match(blocked.element('#toast').textContent, /已生效.*未允许保存/);
  } finally { blocked.dispose(); }
});

test('TC-3D-014 QA panel/debug are absent by default and explicit opt-in leaves saves and one-RAF timing unchanged', () => {
  for (const query of ['', '?qa', '?qa=0', '?qa=false']) {
    const f = fixture({ query });
    try {
      assert.equal(f.element('.route-qa'), null); assert.equal(f.element('.route-qa-marker'), null);
      assert.equal(f.window.__coffeeSliceDebug, undefined);
      f.tick(20); f.click('#settings'); f.click('#save');
      const expected = createEngine(); expected.advance(20);
      assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, expected.snapshot());
      assert.equal(f.frames.size, 1);
    } finally { f.dispose(); }
  }
  const f = fixture();
  try {
    assert.ok(f.element('.route-qa')); assert.ok(f.window.__coffeeSliceDebug.readRoutes);
    f.action({ type: 'invite' }); f.tick(10);
    assert.equal(f.frames.size, 1);
    const read = f.window.__coffeeSliceDebug.readRoutes();
    assert.equal(read.selectedId, 1); assert.ok(read.sample.scene);
    assert.equal(f.element('.route-qa-marker').textContent, '#1');
    assert.match(f.element('.route-qa').children.find(child => child.tagName === 'PRE').textContent, /不能证明|passage/);
    const selectB = f.element('.route-qa').children.find(child => child.textContent === '下一位 B');
    const before = f.state(); selectB.emit('click'); assert.deepEqual(f.state(), before);
    f.tick(.001);
    const changed = f.window.__coffeeSliceDebug.readRoutes();
    assert.equal(changed.sample.authority.counterId, 'counter-b');
    assert.equal(f.element('.route-qa-marker').textContent, `#${changed.selectedId}`);
    const raw = f.memory.getItem(SAVE_KEY); f.click('#settings'); f.click('#save');
    assert.ok(raw); assert.doesNotMatch(f.memory.getItem(SAVE_KEY), /trackedRecords|routeTrace|diagnostic/);
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.clock.now += 60000; f.clock.performance += 60000;
    f.document.hidden = false; f.document.emit('visibilitychange'); f.tick(.001);
    const resumed = f.window.__coffeeSliceDebug.readRoutes();
    assert.equal(resumed.session, 2); assert.equal(resumed.terminal, null);
    assert.match(resumed.reason, /discontinuity/);
  } finally { f.dispose(); }
  assert.equal(f.window.__coffeeSliceDebug, undefined); assert.equal(f.element('.route-qa'), null); assert.equal(f.element('.route-qa-marker'), null);
});

test('TC-3D-014 QA sessions reset on reload/new shop and report missing renderer honestly (app harness)', () => {
  const f = fixture();
  try {
    f.tick(3); const session = f.window.__coffeeSliceDebug.readRoutes().session;
    f.click('#settings'); f.click('#reload');
    const reloaded = f.window.__coffeeSliceDebug.readRoutes();
    assert.equal(reloaded.session, session + 1); assert.equal(reloaded.reason, 'save reload');
    assert.equal(reloaded.records.length, 0); assert.equal(reloaded.selectedId, null);
    f.tick(.2); assert.equal(f.window.__coffeeSliceDebug.readRoutes().sample.time, f.state().elapsed);
  } finally { f.dispose(); }
  const fresh = fixture({ raw: '{bad save' });
  try {
    fresh.tick(3); fresh.click('#settings'); fresh.click('#new-shop');
    const reset = fresh.window.__coffeeSliceDebug.readRoutes();
    assert.equal(reset.session, 2); assert.equal(reset.reason, 'new shop'); assert.equal(reset.records.length, 0);
    fresh.tick(3);
    assert.equal(fresh.window.__coffeeSliceDebug.readRoutes().selectedId, 1, 'new customer 1 is explicitly a different session');
  } finally { fresh.dispose(); }
  const unavailable = fixture({ renderUnavailable: true });
  try {
    unavailable.tick(3);
    const read = unavailable.window.__coffeeSliceDebug.readRoutes();
    assert.equal(read.sample.rendererAvailable, false); assert.equal(read.sample.scene, null);
    assert.equal(unavailable.element('.route-qa-marker').hidden, true);
    assert.match(unavailable.element('.route-qa').children.find(child => child.tagName === 'PRE').textContent, /renderer unavailable/);
    assert.equal(unavailable.element('#render-error').hidden, false);
  } finally { unavailable.dispose(); }
});

test('TC-3D-014 legacy-route actors are visibly marked rather than misreported as early new-route exits', () => {
  const initial = createInitialState(); initial.customerRouteVersion = 1; initial.nextCustomerId = 2;
  initial.customers = [{ id: 1, counterId: 'counter-a', phase: 'leaving', hasCup: true, skin: 0, timer: 2, x: -7, z: 5 }];
  const f = fixture({ initial });
  try {
    f.tick(.2);
    const text = f.element('.route-qa').children.find(child => child.tagName === 'PRE');
    assert.match(text.textContent, /LEGACY route/);
    f.tick(.3);
    assert.match(text.textContent, /terminal.*despawn.*LEGACY route/);
    assert.equal(f.window.__coffeeSliceDebug.readRoutes().terminal.x, -8);
  } finally { f.dispose(); }
});
