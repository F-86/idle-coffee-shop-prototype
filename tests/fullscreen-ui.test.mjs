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
const { PerformanceQAPanel } = await import('../src/slice/qa/PerformanceQAPanel.ts');
const { createEngine, createInitialState, recipeById, counterPrice, counterBrewSeconds, coffeePrice, coffeeBrewSeconds, COFFEE_MAX_LEVEL } = await import('../src/slice/core/engine.ts');
const { LocalSaveRepository, SAVE_KEY, createMemoryStorage } = await import('../src/slice/core/persistence.ts');
const { addFurniture, getLayout, GRID, LAYOUT_PRICES, layoutCost, MAX_COUNTERS, MAX_TABLES, moveFurniture, rotateFurniture, storeFurniture, validateLayout } = await import('../src/slice/core/layout.ts');
const { createPortableSave, parsePortableSave, overviewOf, portableFilename, MAX_PORTABLE_BYTES } = await import('../src/slice/core/portableSave.ts');

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
const permanentOutsideModal = outsideModal.replace(/<aside id="(?:welcome-guide|renovation-panel)"[\s\S]*?<\/aside>/g, "").replace(/<section id="migration-notice"[\s\S]*?<\/section>/g, "");
const ONBOARDING_KEY = "mellow-bean:welcome-guide:v1";
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
  _hidden = false;
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = Boolean(value); if (value) this.attributes.set("hidden", ""); else this.attributes.delete("hidden"); }
  disabled = false;
  isConnected = true;
  _textContent = '';
  textWrites = 0;
  get textContent() { return this._textContent; }
  set textContent(value) { this._textContent = value; this.textWrites++; }
  value = '';
  checked = false;
  files = null;
  captured = new Set();
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  focused = 0;
  children = [];
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; if (!this.ownerDocument._nodes.includes(node)) this.ownerDocument._nodes.push(node); } }
  remove() { for (const child of [...this.children]) child.remove(); const index = this.ownerDocument._nodes.indexOf(this); if (index >= 0) this.ownerDocument._nodes.splice(index, 1); if (this.parentElement) { const childIndex = this.parentElement.children.indexOf(this); if (childIndex >= 0) this.parentElement.children.splice(childIndex, 1); } this.isConnected = false; }
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
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
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
function fixture({ initial = createInitialState(), raw, savedAtAgoSeconds = 0, storageUnavailable = false, readUnavailable = false, writeUnavailable = false, conflictDuringClaim = false, deferDialogClose = false, renderMode, backdropPreference, query = '?qa=1', renderUnavailable = false, onboardingFlag, onboardingReadUnavailable = false, onboardingWriteUnavailable = false, initiallyHidden = false, navigator = {}, portableOverrides = {}, now = Date.now() } = {}) {
  const clock = { now, performance: 0 };
  const nodes = [], closeEvents = [];
  const document = new FakeElement('document', null);
  document.ownerDocument = document;
  document._nodes = nodes;
  document.activeElement = null;
  document.hidden = initiallyHidden;
  document.hasFocus = () => true;
  const root = new FakeElement('div', document);
  root.setAttribute('id', 'slice-root');
  root.querySelector = selector => nodes.find(node => node.matches(selector)) ?? null;
  root.querySelectorAll = selector => nodes.filter(node => node.matches(selector));
  Object.defineProperty(root, 'innerHTML', { set(markup) {
    nodes.length = 0;
    root.children = [];
    const stack = [root];
    for (const match of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)>/g)) {
      if (match[1]) {
        const index = stack.findLastIndex(node => node.tagName === match[2].toUpperCase());
        if (index > 0) stack.splice(index);
        continue;
      }
      const element = new FakeElement(match[2], document);
      element.parentElement = stack.at(-1);
      element.parentElement.children.push(element);
      if (!['input', 'path', 'br', 'hr', 'img'].includes(match[2])) stack.push(element);
      for (const attribute of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(attribute[1], attribute[2] ?? '');
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
  const downloads = [], blobs = [], revokedUrls = [], storageWrites = [], fileTasks = new Set();
  const trackFileTask = operation => (...args) => {
    const task = Promise.resolve().then(() => operation(...args));
    fileTasks.add(task);
    task.then(() => fileTasks.delete(task), () => fileTasks.delete(task));
    return task;
  };
  document.createElement = tag => { const element = new FakeElement(tag, document); element.click = () => downloads.push(element); return element; };
  const memory = createMemoryStorage();
  if (raw !== undefined) memory.setItem(SAVE_KEY, raw);
  else if (initial) { const repo = new LocalSaveRepository(memory); repo.load(clock.now); assert.equal(repo.save(initial, clock.now - savedAtAgoSeconds * 1000).ok, true); }
  if (onboardingFlag !== undefined) memory.setItem(ONBOARDING_KEY, onboardingFlag);
  if (renderMode !== undefined) memory.setItem(RENDER_MODE_KEY, renderMode);
  if (backdropPreference !== undefined) memory.setItem('mellow-bean:backdrop:v1', backdropPreference);
  const storageControl = { readUnavailable, writeUnavailable, removeUnavailable: false };
  let storageReads = 0;
  const storage = storageUnavailable ? { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('storage unavailable'); }, removeItem() { throw new Error('storage unavailable'); } } : {
    getItem(key) {
      if (key === ONBOARDING_KEY && onboardingReadUnavailable) throw new Error("onboarding read unavailable");
      if (storageControl.readUnavailable) throw new Error('reads unavailable');
      if (key === SAVE_KEY && conflictDuringClaim && ++storageReads === 2) {
        const foreign = JSON.parse(memory.getItem(SAVE_KEY)); foreign.recordChangeTag = 'concurrent-offline-claim';
        memory.setItem(SAVE_KEY, JSON.stringify(foreign));
      }
      return memory.getItem(key);
    },
    setItem(key, value) { if (key === ONBOARDING_KEY && onboardingWriteUnavailable) throw new Error("onboarding write unavailable"); if (storageControl.writeUnavailable) throw new Error('writes unavailable'); memory.setItem(key, value); storageWrites.push({ key, value }); },
    removeItem(key) { if (storageControl.writeUnavailable || storageControl.removeUnavailable) throw new Error('writes unavailable'); memory.removeItem(key); },
  };
  const window = new FakeElement('window', document);
  window.localStorage = storage;
  window.visualViewport = new FakeElement('visualViewport', document);
  window.confirm = () => true;
  const frames = new Map(), timers = new Map(), timerDelays = new Map();
  let nextId = 0, renderer, observer, hmrCleanup;
  class FakeScene {
    statsReads = 0; poseReads = 0;
    updates = []; focusCalls = []; selection = []; interactionCalls = []; interactionEnabled = true; panCalls = []; focused = null; activationCalls = 0; disposed = false; resizeCalls = 0;
    constructor(canvas, action, options) { if (renderUnavailable) throw Error('WebGL unavailable in test fixture'); this.canvas = canvas; this.action = action; this.renderMode = options.renderMode; renderer = this; }
    setBackdrop(value) { this.backdrop = value; }
    setRenderMode(mode) { this.renderMode = mode; this.resize(); }
    update(state, dt) { this.updates.push({ state: structuredClone(state), dt }); }
    readRenderStats() { this.statsReads++; return { targetFps: this.renderMode === 'smooth' ? null : this.renderMode === 'low-power' ? 30 : 60, renderWidth: 800, renderHeight: 1100, meshCount: 200, renderedFrames: this.updates.length }; }
    readCustomerPose(id) { this.poseReads++; const customer = this.updates.at(-1)?.state.customers.find(customer => customer.id === id); return customer ? { x: customer.x, z: customer.z, screenX: 200, screenY: 250, inViewport: true } : null; }
    setRenovationPreview(layout, selectedId, valid) { this.renovation = layout ? structuredClone({ layout, selectedId, valid }) : null; }
    pickLayoutPlacement(clientX, clientY, id) { return this.placementPicker?.(clientX, clientY, id) ?? null; }
    cancelLayoutDrag() { this.cancelDragCalls = (this.cancelDragCalls ?? 0) + 1; }
    selectedCounter(id) { this.selection.push(id); }
    resize() { this.resizeCalls++; }
    focusAnchor(key) { if (!this.interactionEnabled || !['counter-a-recipe', 'counter-a-upgrade', 'counter-b-recipe', 'counter-b-upgrade', 'invite'].includes(key)) return; this.focusCalls.push(key); this.focused = key; }
    getFocus() { return this.focused; }
    focusNext(direction) {
      const keys = ['counter-a-recipe', 'counter-a-upgrade', 'counter-b-recipe', 'counter-b-upgrade', 'invite'];
      const current = this.focused ? keys.indexOf(this.focused) : -1;
      this.focusAnchor(keys[current < 0 ? (direction < 0 ? keys.length - 1 : 0) : (current + direction + keys.length) % keys.length]);
      return this.focused;
    }
    panBy(...args) { this.panCalls.push(args); }
    activateFocused() { this.activationCalls++; if (!this.focused || !this.interactionEnabled) return false; this.activateAnchor(this.focused); return true; }
    projectAnchor() { return { x: 200, y: 250, visible: true }; }
    projectLayoutItem() { return { x: 200, y: 250, visible: true }; }
    setInteractionEnabled(value) { this.interactionEnabled = value; this.interactionCalls.push(value); }
    getAnchorFootprint() { return { width: 60, height: 60 }; }
    dispose() { this.disposed = true; }
    activateAnchor(key) {
      const actions = { invite: { type: 'invite' }, 'counter-a-recipe': { type: 'recipe', id: 'counter-a' }, 'counter-b-recipe': { type: 'recipe', id: 'counter-b' }, 'counter-a-upgrade': { type: 'counter', id: 'counter-a' }, 'counter-b-upgrade': { type: 'counter', id: 'counter-b' } };
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
  const context = { document, window, location: { search: query }, HTMLElement: FakeElement, HTMLCanvasElement: FakeElement, HTMLButtonElement: FakeElement, HTMLInputElement: FakeElement, Date: FakeDate, performance: { now: () => clock.performance }, AbortController, ResizeObserver: FakeResizeObserver, CoffeeScene: FakeScene, RenderBudget, FrameInterpolator, RouteDiagnostics, isRouteQA, RouteQAPanel, PerformanceQAPanel, readRenderMode, isRenderMode, RENDER_MODE_KEY, structuredClone, createEngine, recipeById, counterPrice, counterBrewSeconds, coffeePrice, coffeeBrewSeconds, COFFEE_MAX_LEVEL, addFurniture, getLayout, GRID, LAYOUT_PRICES, layoutCost, MAX_COUNTERS, MAX_TABLES, moveFurniture, rotateFurniture, storeFurniture, validateLayout, LocalSaveRepository, SAVE_KEY, createPortableSave: trackFileTask(portableOverrides.createPortableSave ?? createPortableSave), parsePortableSave: trackFileTask(portableOverrides.parsePortableSave ?? parsePortableSave), overviewOf, portableFilename, MAX_PORTABLE_BYTES, crypto: globalThis.crypto, TextEncoder, File, navigator, URLSearchParams, URL: { createObjectURL: blob => { blobs.push(blob); return `blob:qa-${blobs.length}`; }, revokeObjectURL: url => revokedUrls.push(url) }, Blob, console, setTimeout: (callback, delay = 0) => { const id = ++nextId; timers.set(id, callback); timerDelays.set(id, delay); return id; }, clearTimeout: id => { timers.delete(id); timerDelays.delete(id); }, requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id), captureCleanup: callback => { hmrCleanup = callback; } };
  runInNewContext(stripTypeScriptTypes(source), context, { timeout: 1500 });
  const debug = window.__coffeeSliceDebug;
  const state = () => structuredClone(debug.readState());
  async function flushOffline({ dismissResult = true } = {}) {
    // Actual async repository yields are routed through the app's zero-delay
    // macrotask boundary. Toast/download timers remain pending as in a browser.
    for (let n = 0; n < 100000; n++) {
      const pending = [...timers].filter(([id]) => timerDelays.get(id) === 0);
      for (const [id, callback] of pending) { timers.delete(id); timerDelays.delete(id); callback(); }
      await new Promise(resolve => setImmediate(resolve));
      if (![...timers.keys()].some(id => timerDelays.get(id) === 0)) {
        if (dismissResult && !root.querySelector('#offline-result').hidden && root.querySelector('#operation-dialog').open) root.querySelector('#offline-done').emit('click');
        return;
      }
    }
    assert.fail('offline job failed to reach a terminal state');
  }
  return { clock, document, window, root, nodes, renderer, observer, frames, timers, memory, storageControl, storageWrites, downloads, blobs, revokedUrls, state, flushOffline,
    chooseFile(file) {
      const input = root.querySelector('#file-input'); assert.ok(input, 'actual file picker input exists');
      input.files = file ? [{ ...file, name: file.name ?? 'test-save.json', size: file.size ?? new TextEncoder().encode(typeof file.text === 'string' ? file.text : '').byteLength, text: trackFileTask(() => typeof file.text === 'function' ? file.text() : file.text) }] : [];
      input.value = file ? `C:\\fakepath\\${file.name ?? 'test-save.json'}` : '';
      input.emit('change');
    },
    async flushFiles() {
      // Track the real imported encoder/parser promises rather than replacing
      // handlers or guessing how many WebCrypto worker turns they will take.
      for (let pass = 0; pass < 100; pass++) {
        if (fileTasks.size) await Promise.allSettled([...fileTasks]);
        await new Promise(resolve => setImmediate(resolve));
        if (!fileTasks.size) return;
      }
      assert.fail('portable file operations failed to settle');
    },
    async untilFile(predicate) {
      for (let pass = 0; pass < 1000; pass++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.fail('portable file handler did not reach the expected state');
    },
    async stepOffline() {
    const pending = [...timers].find(([id]) => timerDelays.get(id) === 0);
    assert.ok(pending, 'an actual pending offline macrotask exists');
    const [id, callback] = pending; timers.delete(id); timerDelays.delete(id); callback();
    await new Promise(resolve => setImmediate(resolve));
  }, flushCloseEvents() { for (const callback of closeEvents.splice(0)) callback(); }, element: selector => root.querySelector(selector), action: action => renderer.action(action), click(selector, extra = {}) { const target = root.querySelector(selector); assert.ok(target, selector); if (!target.disabled) { const event = { target, detail: 1, ...extra }; target.emit('click', event); root.emit('click', event); if (target.tagName === 'SUMMARY') target.parentElement.toggleAttribute('open'); } }, tick(seconds = .2) { clock.now += seconds * 1000; clock.performance += seconds * 1000; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(clock.performance); }, dispose() { hmrCleanup?.(); } };
}

function openCoffee(f, recipe = 'espresso') {
  f.click('#dock-coffee');
  const tab = f.nodes.find(node => node.dataset.viewCoffee === recipe);
  assert.ok(tab, `coffee tab ${recipe}`);
  f.root.emit('click', { target: tab });
}
function openAction(f, action) {
  if (action.type === 'menu') openCoffee(f, action.recipe);
  else if (action.type === 'background') f.click('#dock-background');
  else f.action(action);
}
function assertProtected(f, paused = false) {
  assert.equal(f.state().paused, paused, 'recovery freeze preserves the durable business pause');
  assert.equal(f.element('#business-toggle').disabled, true);
  assert.equal(f.element('#business-status').textContent, '进度已保护');
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
  assert.doesNotMatch(permanentOutsideModal, /<aside\b|counter-card|station-card|save-panel|经营卡片/);
  assert.equal(openingTags(outsideModal, 'canvas').length, 1);
});

test('TC-3D-009 REQ-3D-016 compact HUD exposes money, durable pause and settings while pictured dock owns everyday actions', () => {
  const hud = html.match(/<header\b[^>]*class="hud"[\s\S]*?<\/header>/)?.[0];
  assert.ok(hud);
  assert.deepEqual(openingTags(hud, 'button').map(tag => /id="([^"]+)"/.exec(tag)?.[1]), ['business-toggle', 'settings']);
  assert.match(hud, /id="wallet"/); assert.match(hud, /id="business-status"/);
  assert.match(hud, /aria-pressed="false"/);
  assert.deepEqual(declarations('.hud', 'pointer-events'), ['none']);
  assert.deepEqual(declarations('.wallet-chip', 'pointer-events'), ['auto']);
  assert.deepEqual(declarations('.wallet-chip', 'touch-action'), ['none']);
  assert.deepEqual(declarations('.wallet-chip', 'user-select'), ['none']);
  const dock = outsideModal.match(/<nav id="action-dock"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(dock);
  assert.deepEqual(openingTags(dock, 'button').map(tag => /id="([^"]+)"/.exec(tag)?.[1]), ['dock-coffee', 'dock-background', 'dock-furniture', 'dock-invite']);
  assert.equal(openingTags(dock, 'img').length, 4);
  for (const tag of openingTags(dock, 'button')) assert.match(tag, /aria-label="[^"]+"/);
  assert.doesNotMatch(main, /positionControls|beginAnchorPointer/);
  assert.equal(rules('.world-button').length, 0);
  assert.doesNotMatch(modal, /id="(?:vault-panel|manager-panel|manager-upgrade)"/);
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
    for (const [action, amountIds] of [[{ type: 'counter', id: 'counter-a' }, ['counter-price', 'counter-next-price', 'counter-upgrade']], [{ type: 'menu', recipe: 'latte' }, ['coffee-price', 'coffee-next-price', 'coffee-upgrade']]]) {
      openAction(f, action);
      for (const id of amountIds) {
        const text = f.element(`#${id}`).textContent;
        assert.doesNotMatch(text, /¤|\d\.\d{2}\s*币/);
        assert.match(text, /¥\s?\d+\.\d{2}(?!\d)/, `${id}: ${text}`);
      }
      f.click('#dialog-close');
    }
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 scene actions and HUD settings open the correct details without hidden DOM anchors (app harness)', () => {
  const f = fixture();
  try {
    for (const [action, expected] of [[{ type: 'counter', id: 'counter-b' }, 'counter-panel'], [{ type: 'recipe', id: 'counter-a' }, 'recipe-panel'], [{ type: 'menu', recipe: 'latte' }, 'coffee-panel'], [{ type: 'background' }, 'background-panel']]) {
      const before = f.state();
      openAction(f, action);
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

test('TC-3D-009 REQ-3D-016 only the explicit HUD pause changes business state; retired routes remain inert', () => {
  const f = fixture();
  try {
    const before = f.state();
    for (const type of ['pause', 'manager', 'settings', 'vault', 'menu']) f.action({ type, recipe: 'latte' });
    for (const key of ['p', 'P', 'Pause', 'Escape']) f.element('#coffee-canvas').emit('keydown', { key, repeat: false });
    assert.deepEqual(f.state(), before);
    assert.equal(f.element('#operation-dialog').open, false);
    f.click('#business-toggle');
    assert.equal(f.state().paused, true);
    assert.equal(f.element('#business-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(f.element('#business-toggle').textContent, '恢复营业');
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, true);
    const paused = f.state(); f.tick(5); assert.deepEqual(f.state(), paused);
    f.click('#business-toggle');
    assert.equal(f.state().paused, false);
    assert.equal(f.element('#business-toggle').getAttribute('aria-pressed'), 'false');
    f.tick(.5); assert.ok(f.state().elapsed > before.elapsed);
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 HUD and dock remain outside the closed native operation dialog (static contract)', () => {
  assert.ok(modalStart >= 0);
  assert.doesNotMatch(openingTags(modal, 'dialog')[0], /\bopen(?:\s|=|>)/);
  const panels = openingTags(modal, 'div').filter(tag => tag.includes('class="operation-panel"'));
  assert.equal(panels.length, 7);
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
    f.click('#dock-background');
    dialog.emit('click', { target: dialog, clientX: 90, clientY: 90 });
    assert.equal(dialog.open, false, 'click outside the dialog rectangle closes it');
    f.click('#dock-background');
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
  assert.deepEqual(openingTags(permanentOutsideModal, 'button').map(tag => /id="([^"]+)"/.exec(tag)?.[1]), ['business-toggle', 'settings', 'dock-coffee', 'dock-background', 'dock-furniture', 'dock-invite'], 'all permanent buttons are visible business or dock controls');
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
    assert.equal(f.element('#recipe-panel').hidden, false);
    canvas.emit('keydown', { key: 'ArrowRight' });
    canvas.emit('keydown', { key: ' ', repeat: false });
    assert.equal(f.renderer.getFocus(), 'counter-a-recipe', 'inert modal background cannot change selected scene object');
    assert.equal(f.renderer.activationCalls, 1);
    f.click('#dialog-close');
    f.renderer.focusAnchor('counter-b-upgrade');
    canvas.emit('keydown', { key: ' ', repeat: false });
    assert.equal(f.element('#counter-panel').hidden, false);
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
    f.action({ type: 'recipe', id: 'counter-a' });
    const latte = f.nodes.find(node => node.dataset.selectRecipe === 'latte');
    f.root.emit('click', { target: latte });
    assert.equal(f.state().counters[0].recipe, 'latte');
    f.click('#dialog-close');
    f.action({ type: 'counter', id: 'counter-a' });
    const beforeUpgrade = f.state();
    f.click('#counter-upgrade');
    assert.equal(f.state().counters[0].level, beforeUpgrade.counters[0].level + 1);
    assert.ok(f.state().wallet < beforeUpgrade.wallet);
    f.click('#dialog-close');
    f.click('#dock-background');
    assert.equal(f.element('#manager-panel'), null);
    assert.equal(f.element('#manager-upgrade'), null);
    assert.equal(f.element('#background-panel').hidden, false);
    assert.equal(f.document.activeElement, f.element('#dialog-close'));
    f.click('#dialog-close');
    const beforeCoffee = f.state();
    openCoffee(f, 'espresso');
    assert.equal(f.element('#coffee-panel').hidden, false);
    assert.deepEqual(f.state(), beforeCoffee, 'opening coffee details cannot assign it to a counter');
    f.click('#dialog-close');
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
    f.click('#settings');
    f.click("#dialog-close");
    f.element("#coffee-canvas").emit("keydown", { key: "ArrowLeft" });
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.renderer.focusCalls.at(-1), 'invite');
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-017 handover credits income directly with no vault or manager operation', () => {
  assert.doesNotMatch(html, /id="(?:vault-panel|manager-panel|manager-upgrade|manager-rank|pending|carrying)"/);
  const f = fixture();
  try {
    let before = f.state();
    for (let steps = 0; !f.state().totalServed && steps < 2000; steps++) { before = f.state(); f.tick(.05); }
    const served = f.state();
    assert.ok(served.totalServed > 0, 'a real customer reaches handover');
    assert.ok(served.wallet > before.wallet, 'handover credits the wallet immediately');
    assert.equal(served.wallet - before.wallet, served.totalEarned - before.totalEarned);
    assert.ok(served.counters.every(counter => counter.pendingCash === 0));
    assert.equal(served.manager.carrying, 0);
    assert.deepEqual(served.manager, createInitialState().manager, 'the compatibility manager never moves');
    f.tick(.15);
    assert.equal(f.element('#wallet').textContent, centsLabel(f.state().wallet), 'HUD reflects direct credit on its next bounded refresh');
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
    f.action({ type: 'invite' }); f.click('#dock-background'); f.click('#settings');
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
    f.click('#dialog-close');
    f.element('#coffee-canvas').emit('keydown', { key: 'ArrowLeft' });
    f.element('#coffee-canvas').emit('keydown', { key: 'ArrowLeft' });
    assert.equal(f.element('#operation-dialog').open, false);
    f.flushCloseEvents();
    assert.equal(f.renderer.focusCalls.at(-1), 'counter-b-upgrade', 'native close-event delay must not discard the pending scene navigation while input is suspended');
    const before = f.state();
    openCoffee(f, 'espresso');
    f.click('#dialog-close');
    f.action({ type: 'recipe', id: 'counter-b' });
    f.flushCloseEvents();
    assert.equal(f.element('#recipe-panel').hidden, false, 'stale coffee close cannot dismiss the newly opened recipe chooser');
    assert.equal(f.renderer.interactionEnabled, false);
    assert.deepEqual(f.state(), before, 'coffee dismissal and reopening recipe choice are read-only');
    f.click('#dialog-close'); f.flushCloseEvents();
    f.click('#settings');
    f.click('#dialog-close');
    f.element('#coffee-canvas').emit('keydown', { key: 'Home' });
    f.element('#coffee-canvas').emit('keydown', { key: 'ArrowRight' });
    f.element('#coffee-canvas').emit('keydown', { key: 'ArrowRight' });
    f.flushCloseEvents();
    assert.equal(f.renderer.focusCalls.at(-1), 'counter-b-recipe', 'settings navigation still reveals the physical counter after asynchronous dismissal');
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
    f.click('#dock-background');
    assert.equal(f.renderer.interactionEnabled, false);
    f.flushCloseEvents();
    assert.equal(f.element('#operation-dialog').open, true);
    assert.equal(f.element('#background-panel').hidden, false);
    assert.equal(f.renderer.interactionEnabled, false, 'an older close event must not unlock a new modal background');
    const focus = f.document.activeElement, before = f.state();
    f.action({ type: 'pause' });
    assert.deepEqual(f.state(), before);
    assert.equal(f.document.activeElement, focus);
    f.tick(.5);
    assert.match(f.element('#dialog-title').textContent, /店外景色/);
    f.click('#dialog-close');
    f.flushCloseEvents();
    assert.equal(f.renderer.interactionEnabled, true);
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 physical and dock invites share cooldown and conflict protection (app harness)', () => {
  const f = fixture();
  try {
    const expected = createEngine(f.state()); expected.invite(); expected.invite();
    f.click('#dock-invite'); f.action({ type: 'invite' }); f.click('#dock-invite');
    assert.deepEqual(f.state(), expected.snapshot(), 'one accepted invite keeps the existing three-guest core rule; immediate repeat is rejected');
    assert.ok(f.state().inviteCooldown > 0);
    const foreign = JSON.parse(f.memory.getItem(SAVE_KEY)); foreign.recordChangeTag = 'invite-conflict';
    f.memory.setItem(SAVE_KEY, JSON.stringify(foreign));
    f.window.emit('storage', { key: SAVE_KEY, newValue: JSON.stringify(foreign) });
    const paused = f.state();
    assertProtected(f);
    f.action({ type: 'invite' }); f.click('#dock-invite'); f.element('#dock-invite').emit('click');
    assert.deepEqual(f.state(), paused);
    assert.equal(f.element('#dock-invite').disabled, true);
    assert.equal(f.element('#invite'), null, 'the removed duplicate scene button stays absent');
  } finally { f.dispose(); }
});

test('TC-3D-008 REQ-3D-015 modal controls maintain 44px targets, safe-area and dynamic viewport hooks (static contract)', () => {
  assert.match(index, /viewport-fit=cover/);
  for (const property of ['width', 'height']) for (const value of declarations('.dialog-close', property)) assert.ok(Number.parseFloat(value) >= 44, `.dialog-close ${property}: ${value}`);
  for (const selector of ['.primary-button', '.secondary-button', '.settings-grid button', '.recipe-picker button', '.quiet-details summary']) assert.ok(declarations(selector, 'min-height').some(value => Number.parseFloat(value) >= 44), selector);
  for (const [property, inset] of [['left', 'left'], ['top', 'top']]) assert.ok(declarations('.hud', property).every(value => value.includes(`safe-area-inset-${inset}`)));
  assert.ok(declarations('.operation-dialog', 'max-height').every(value => value.includes('dvh') && value.includes('safe-area-inset-bottom')));
  assert.match(main, /sizeObserver\?\.observe\(\$\("#coffee-canvas"\)\)/);
  assert.match(main, /on\(visualViewport, "resize"/);
  assert.match(main, /sizeObserver\?\.disconnect\(\)/);
  assert.match(main, /listeners\.abort\(\)/);
});

test('TC-3D-008 REQ-3D-006 HUD settings preserve manual save and export, with corrupt bytes protected (app harness)', async () => {
  const f = fixture();
  await f.flushOffline();
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
  await corrupt.flushOffline();
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

test('TC-3D-008 REQ-3D-015 names and save feedback are transient; unreadable startup stays protected without exporting a fake shop (app harness)', async () => {
  const f = fixture({ storageUnavailable: true });
  await f.flushOffline();
  try {
    assert.match(f.element('#save-status').textContent, /拒绝读取|不可用/);
    f.click('#settings');
    f.click('#save');
    assert.match(f.element('#save-status').textContent, /拒绝读取|不可用/);
    assert.equal(f.element('#toast').classList.contains('visible'), true);
    for (const callback of [...f.timers.values()]) callback();
    assert.equal(f.element('#toast').classList.contains('visible'), false, 'feedback does not become permanent HUD');
    f.click('#export');
    assert.equal(f.element('#export').disabled, true); assert.equal(f.downloads.length, 0);
    assertProtected(f); assert.equal(f.element('#reload').hidden, false);
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
    assertProtected(f);
    f.action({ type: 'pause' });
    assertProtected(f);
    f.action({ type: 'counter', id: 'counter-a' });
    assert.equal(f.element('#counter-upgrade').disabled, true);
    f.click('#dialog-close');
    f.click('#settings');
    assert.equal(f.element('#reload').hidden, false);
    assert.match(f.element('#save-status').textContent, /变化|最新|更新/);
    f.click('#save');
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).recordChangeTag, 'other-client');
  } finally { f.dispose(); }
});

function pausedProgress() {
  const engine = createEngine(); engine.advance(22); engine.togglePause(); return engine.snapshot();
}
function omitOfflineClaims(state) {
  const copy = structuredClone(state); delete copy.lastOfflineClaimId; delete copy.offlineClaimIds; return copy;
}

// Write authentic pre-route-v2 bytes directly: repository.save would normalize them
// before the app's loader sees them and would hide boot/reload migration regressions.
function legacyRouteProgress(routeVersion) {
  const state = createInitialState();
  state.economyVersion = 2; delete state.layout; state.customerRouteVersion = 2;
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

test('TC-3D-010 legacy raw route saves transfer pending and carried receipts once while keeping user pause', async () => {
  for (const routeVersion of [undefined, 1]) for (const age of [10, 3600]) {
    const initial = legacyRouteProgress(routeVersion);
    const raw = JSON.stringify({ schemaVersion: 1, savedAt: Date.now() - age * 1000, recordChangeTag: `legacy-route-${routeVersion}-${age}`, state: initial });
    const f = fixture({ raw });
    await f.flushOffline();
    try {
      const migrated = f.state();
      assert.equal(migrated.paused, true);
      assert.equal(migrated.economyVersion, 4);
      assert.equal(migrated.wallet, initial.wallet + 570);
      assert.equal(migrated.totalEarned, initial.totalEarned, 'legacy receipts were already minted');
      assert.equal(migrated.spend, initial.spend); assert.equal(migrated.elapsed, initial.elapsed);
      assert.equal(migrated.eventSequence, initial.eventSequence); assert.equal(migrated.stepCarry, initial.stepCarry);
      assert.deepEqual(migrated.coffeeLevels, initial.coffeeLevels);
      assert.ok(migrated.counters.every(counter => counter.pendingCash === 0));
      assert.deepEqual(migrated.manager, createInitialState().manager);
      assert.equal(f.renderer.updates.length, 0);
      f.tick(10); assert.deepEqual(f.state(), migrated, 'paused migration cannot operate or credit receipts again');
      f.click('#settings'); f.click('#save');
      const saved = JSON.parse(f.memory.getItem(SAVE_KEY)).state;
      assert.deepEqual(saved, migrated);
      const reopened = fixture({ raw: f.memory.getItem(SAVE_KEY), now: f.clock.now });
      try { await reopened.flushOffline(); assert.deepEqual(reopened.state(), saved, 'a canonical save never repeats the receipt transfer'); }
      finally { reopened.dispose(); }
    } finally { f.dispose(); }
  }
});

test('TC-3D-010 failed legacy settlement protects original bytes and transferred assets until successful recovery', async () => {
  for (const mode of ['writeUnavailable', 'conflictDuringClaim']) {
    const initial = legacyRouteProgress(1); initial.paused = false; initial.stepCarry = 0;
    initial.manager = { x: -8, z: -1.7, carrying: 570, phase: 'depositing', target: 2, timer: .55, level: 1 };
    initial.counters.forEach(counter => counter.pendingCash = 0);
    const raw = JSON.stringify({ schemaVersion: 1, savedAt: Date.now() - 3600000, recordChangeTag: `legacy-failed-${mode}`, state: initial });
    const f = fixture({ raw, [mode]: true }); await f.flushOffline();
    try {
      const protectedRaw = f.memory.getItem(SAVE_KEY), frozen = f.state();
      assertProtected(f); assert.equal(frozen.managerRouteVersion, 2);
      assert.equal(frozen.wallet, 1770); assert.equal(frozen.totalEarned, 570);
      assert.equal(frozen.manager.carrying, 0); assert.equal(frozen.elapsed, 0);
      assert.ok(frozen.counters.every(counter => counter.pendingCash === 0));
      f.tick(20); assert.deepEqual(f.state(), frozen, 'failed claim cannot publish partial offline earnings');
      f.click('#settings'); f.click('#save'); assert.equal(f.memory.getItem(SAVE_KEY), protectedRaw);
      f.storageControl.writeUnavailable = false; f.click('#reload'); await f.flushOffline();
      assert.equal(f.state().paused, false); assert.equal(f.element('#business-toggle').disabled, false);
      assert.ok(f.state().elapsed >= 1800 && f.state().elapsed <= 1810);
      const once = f.state(), onceRaw = f.memory.getItem(SAVE_KEY);
      assert.ok(once.wallet > 1770);
      f.click('#reload'); await f.flushOffline(); assert.deepEqual(f.state(), once); assert.equal(f.memory.getItem(SAVE_KEY), onceRaw);
    } finally { f.dispose(); }
  }
});

test('TC-3D-010 migration before a hidden first frame and repeated BFCache events never repay legacy receipts', async () => {
  const initial = legacyRouteProgress(undefined);
  const raw = JSON.stringify({ schemaVersion: 1, savedAt: Date.now() - 10000, recordChangeTag: 'legacy-hidden-before-raf', state: initial });
  const f = fixture({ raw }); await f.flushOffline();
  try {
    const first = f.state(); assert.equal(first.wallet, 1770); assert.equal(first.paused, true);
    assert.equal(first.manager.carrying, 0); assert.equal(f.renderer.updates.length, 0);
    f.document.hidden = true; f.document.emit('visibilitychange'); assert.equal(f.frames.size, 0);
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, first);
    f.clock.now += 45000; f.clock.performance += 45000;
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    const resumed = f.state();
    assert.deepEqual(omitOfflineClaims(resumed), omitOfflineClaims(first), 'closed shop gets no hidden-interval time, movement or earnings');
    assert.equal(resumed.paused, true); assert.equal(f.frames.size, 1);
    f.window.emit('pageshow', { persisted: true }); await f.flushOffline(); assert.deepEqual(f.state(), resumed);
    f.click('#settings'); f.click('#save'); f.click('#save'); assert.deepEqual(f.state(), resumed);
    const saved = JSON.parse(f.memory.getItem(SAVE_KEY)); assert.deepEqual(saved.state, resumed); assert.equal(saved.savedAt, f.clock.now);
    const reopened = fixture({ raw: f.memory.getItem(SAVE_KEY), now: f.clock.now });
    try { await reopened.flushOffline(); assert.deepEqual(reopened.state(), resumed); }
    finally { reopened.dispose(); }
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-016 paused saves stay closed across reload without paused-interval income', async () => {
  for (const savedAtAgoSeconds of [10, 3600]) {
    const initial = pausedProgress(), f = fixture({ initial, savedAtAgoSeconds }); await f.flushOffline();
    try {
      assert.equal(f.state().paused, true); assert.equal(f.element('#business-toggle').textContent, '恢复营业');
      assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(initial), 'paused offline time never advances income, movement or brews');
      assert.equal(f.element('#reload').hidden, true);
      const before = f.state(), expected = createEngine(before); expected.advance(.5); f.tick(.5);
      assert.deepEqual(f.state(), expected.snapshot(), 'existing customers may drain online while arrivals remain stopped');
      assert.equal(f.state().nextCustomerId, before.nextCustomerId);
      f.click('#settings'); f.click('#save');
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, true);
      const reloaded = fixture({ raw: f.memory.getItem(SAVE_KEY), now: f.clock.now });
      try { await reloaded.flushOffline(); assert.deepEqual(reloaded.state(), f.state()); }
      finally { reloaded.dispose(); }
      f.click('#dialog-close'); f.click('#business-toggle'); assert.equal(f.state().paused, false);
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, false);
    } finally { f.dispose(); }
  }
});

test('TC-3D-009 REQ-3D-016 recovering an external paused save preserves its pause until explicit resume', async () => {
  const f = fixture(); await f.flushOffline();
  try {
    const paused = pausedProgress();
    const raw = JSON.stringify({ schemaVersion: 1, savedAt: f.clock.now - 3600000, recordChangeTag: 'valid-paused-other-window', state: paused });
    f.memory.setItem(SAVE_KEY, raw); f.window.emit('storage', { key: SAVE_KEY, newValue: raw }); assertProtected(f);
    f.click('#settings'); f.click('#reload'); await f.flushOffline();
    assert.equal(f.state().paused, true); assert.equal(f.element('#business-toggle').disabled, false);
    assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(paused), 'recovery adds no earnings for the paused hour');
    assert.equal(f.element('#reload').hidden, true);
    const before = f.state(), expected = createEngine(before); expected.advance(.5); f.tick(.5);
    assert.deepEqual(f.state(), expected.snapshot()); assert.equal(f.state().nextCustomerId, before.nextCustomerId);
    f.click('#save'); assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, true);
    f.click('#dialog-close'); f.click('#business-toggle'); assert.equal(f.state().paused, false);
  } finally { f.dispose(); }
});

test('TC-3D-009 REQ-3D-006 failed offline writes or a concurrent claim keep paused valid saves conflict-protected (app harness)', async () => {
  for (const mode of ['writeUnavailable', 'conflictDuringClaim']) {
    const initial = pausedProgress(), f = fixture({ initial, savedAtAgoSeconds: 3600, [mode]: true });
    await f.flushOffline();
    try {
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      assertProtected(f, true);
      assert.deepEqual(omitOfflineClaims(before), omitOfflineClaims(initial));
      assert.equal(f.element('#reload').hidden, false);
      for (const type of ['pause', 'manager', 'settings', 'invite']) f.action({ type });
      f.tick(20);
      assert.deepEqual(f.state(), before);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, 'blocked autosave cannot replace the valid original or another client');
      openCoffee(f);
      assert.equal(f.element('#coffee-upgrade').disabled, true);
      f.click('#coffee-upgrade');
      assert.deepEqual(f.state(), before);
      f.click('#dialog-close'); f.click('#settings'); f.click('#save');
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      if (mode === 'writeUnavailable') {
        f.click('#reload'); await f.flushOffline();
        assertProtected(f, true);
        f.storageControl.writeUnavailable = false;
        f.click('#reload'); await f.flushOffline();
        assert.equal(f.state().paused, true, 'recovery does not resume a player-paused shop');
        assert.equal(f.element('#business-toggle').disabled, false);
        assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(initial));
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
    await f.flushOffline();
    try {
      f.click('#settings');
      assert.equal(f.element('#new-shop').hidden, false);
      f.click('#save'); f.tick(10);
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      f.click('#export');
      assert.equal(await f.blobs[0].text(), raw, 'backup must preserve the source instead of a resumed invented state');
      f.window.emit('storage', { key: SAVE_KEY, newValue: 'changed elsewhere' });
      assertProtected(f);
      f.click('#reload'); await f.flushOffline();
      f.click('#save'); f.tick(10);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, 'failed compatible reload does not release source-byte protection');
      assert.equal(f.element('#new-shop').hidden, false);
    } finally { f.dispose(); }
  }
});

test('TC-3D-008 REQ-3D-004 hidden/BFCache resume applies elapsed time only once and retains one RAF owner (app harness)', async () => {
  const f = fixture();
  await f.flushOffline();
  try {
    f.tick(.5);
    f.document.hidden = true; f.document.emit('visibilitychange');
    assert.equal(f.frames.size, 0);
    const hidden = f.state();
    f.clock.now += 45000; f.clock.performance += 45000;
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    const resumed = f.state();
    assert.ok(resumed.elapsed > hidden.elapsed);
    assert.equal(f.frames.size, 1);
    f.window.emit('pageshow', { persisted: true }); await f.flushOffline();
    assert.deepEqual(f.state(), resumed, 'visibility and BFCache callbacks cannot double-claim the same interval');
    assert.equal(f.frames.size, 1);
    f.window.emit('pagehide', { persisted: true });
    assert.equal(f.renderer.disposed, false, 'BFCache suspension must not destroy its scene');
    f.clock.now += 2000; f.clock.performance += 2000;
    f.window.emit('pageshow', { persisted: true }); await f.flushOffline();
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

test('TC-3D-011 explicit low-power app submits budgeted renders and keeps authoritative elapsed time', async () => {
  const f = fixture({ renderMode: 'low-power' });
  await f.flushOffline();
  try {
    for (let i = 0; i < 1200; i++) f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, 300);
    assert.ok(Math.abs(f.state().elapsed - 10) < 1e-8);
    assert.equal(f.frames.size, 1, 'there is still exactly one live RAF owner');
    const rendered = f.renderer.updates.length;
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.tick(5);
    assert.equal(f.renderer.updates.length, rendered);
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, rendered, 'reset does not immediately render a stale catch-up frame');
    f.tick(1 / 40);
    assert.equal(f.renderer.updates.length, rendered + 1);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});

test('TC-3D-011 sub-frame visibility and BFCache saves settle visible time once without extra renders', async () => {
  const f = fixture({ renderMode: 'low-power' });
  await f.flushOffline();
  try {
    for (let cycle = 0; cycle < 10; cycle++) {
      f.tick(.025);
      f.document.hidden = true; f.document.emit('visibilitychange');
      f.window.emit('pagehide', { persisted: true });
      f.tick(.010);
      f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
      f.window.emit('pageshow', { persisted: true }); await f.flushOffline();
    }
    assert.ok(Math.abs(f.state().elapsed + f.state().stepCarry - .33) < 1e-8, 'visible skipped frames and hidden intervals are each applied once');
    assert.equal(f.renderer.updates.length, 0, 'lifecycle settlement never schedules a catch-up render');
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});


test('TC-3D-011 delayed duplicate pageshow preserves the newly visible tail', async () => {
  const f = fixture();
  await f.flushOffline();
  try {
    f.tick(.025);
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.tick(.010);
    f.window.emit('pagehide', { persisted: true });
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    f.tick(.015);
    f.window.emit('pageshow', { persisted: true }); await f.flushOffline();
    assert.ok(Math.abs(f.state().elapsed + f.state().stepCarry - .048) < 1e-8);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});


test('TC-3D-012 default app draws every display frame using interpolated poses, without extra RAF owners', () => {
  const moving = createEngine(); moving.invite(); moving.advance(.5);
  const f = fixture({ initial: moving.snapshot() });
  try {
    assert.equal(f.renderer.renderMode, 'smooth');
    for (let i = 0; i < 120; i++) f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, 120);
    assert.ok(Math.abs(f.state().elapsed - 1.5) < 1e-9);
    const poses = f.renderer.updates.slice(12, 100).map(update => update.state.customers.find(customer => customer.id === 1).z);
    for (let i = 1; i < poses.length; i++) assert.ok(Math.abs(poses[i - 1] - poses[i] - 2.5 / 120) < 1e-8);
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

test('TC-3D-014 QA panel/debug are absent by default and explicit opt-in leaves saves and one-RAF timing unchanged', async () => {
  for (const query of ['', '?qa', '?qa=0', '?qa=false']) {
    const f = fixture({ query });
    try {
      assert.equal(f.element('.route-qa'), null); assert.equal(f.element('.route-qa-marker'), null);
      assert.equal(f.element('.performance-qa'), null);
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
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline(); f.tick(.001);
    const resumed = f.window.__coffeeSliceDebug.readRoutes();
    assert.equal(resumed.session, 2); assert.equal(resumed.terminal, null);
    assert.match(resumed.reason, /discontinuity/);
  } finally { f.dispose(); }
  assert.equal(f.window.__coffeeSliceDebug, undefined); assert.equal(f.element('.route-qa'), null); assert.equal(f.element('.route-qa-marker'), null);
});

test('TC-3D-014 QA sessions reset on reload/new shop and report missing renderer honestly (app harness)', async () => {
  const f = fixture();
  await f.flushOffline();
  try {
    f.tick(3); const session = f.window.__coffeeSliceDebug.readRoutes().session;
    f.click('#settings'); f.click('#reload'); await f.flushOffline();
    const reloaded = f.window.__coffeeSliceDebug.readRoutes();
    assert.equal(reloaded.session, session + 1); assert.equal(reloaded.reason, 'save reload');
    assert.equal(reloaded.records.length, 0); assert.equal(reloaded.selectedId, null);
    f.tick(.2); assert.equal(f.window.__coffeeSliceDebug.readRoutes().sample.time, f.state().elapsed);
  } finally { f.dispose(); }
  const fresh = fixture({ raw: '{bad save' });
  await fresh.flushOffline();
  try {
    fresh.tick(3); fresh.click('#settings'); fresh.click('#new-shop');
    const reset = fresh.window.__coffeeSliceDebug.readRoutes();
    assert.equal(reset.session, 2); assert.equal(reset.reason, 'new shop'); assert.equal(reset.records.length, 0);
    fresh.tick(3);
    assert.equal(fresh.window.__coffeeSliceDebug.readRoutes().selectedId, 1, 'new customer 1 is explicitly a different session');
  } finally { fresh.dispose(); }
  const unavailable = fixture({ renderUnavailable: true });
  await unavailable.flushOffline();
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
  const initial = createInitialState(); initial.economyVersion = 2; delete initial.layout; initial.customerRouteVersion = 1; initial.nextCustomerId = 2;
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

function openPerformance(f) {
  const panel = f.element('.performance-qa'); panel.open = true; panel.emit('toggle');
  return { panel, text: panel.children.find(child => child.tagName === 'PRE'),
    restart: panel.children.find(child => child.textContent === '重新开始计时'),
    freeze: panel.children.find(child => child.textContent === '冻结读数') };
}

test('TC-3D-015 performance panel is idle while closed, 1Hz when open, and leaves business state/save unchanged', () => {
  const f = fixture(), reference = fixture({ query: '' });
  try {
    assert.equal(f.element('.performance-qa').open, false);
    for (let i = 0; i < 100; i++) { f.tick(.01); reference.tick(.01); }
    assert.equal(f.renderer.statsReads, 0); assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    const p = openPerformance(f);
    let writes = 0, value = p.text.textContent;
    Object.defineProperty(p.text, 'textContent', { get: () => value, set: next => { writes++; value = next; } });
    for (let i = 0; i < 601; i++) { f.tick(.01); reference.tick(.01); }
    const stats = f.window.__coffeeSliceDebug.readPerformance();
    assert.equal(stats.totalIntervals, 600); assert.equal(stats.totalMs, 6000); assert.equal(stats.fps, 100);
    assert.equal(f.renderer.statsReads, 7); assert.equal(writes, 7);
    assert.match(value, /p50 10.00ms · p95 10.00ms/); assert.match(value, /mode smooth/);
    assert.match(value, /viewport 400×550 CSS/); assert.match(value, /buffer 800×1100/);
    assert.match(value, /customers.*counter-a Lv1.*open/); assert.match(value, /不是模拟时间、GPU耗时、上屏帧或温度/);
    f.click('#settings'); f.click('#save'); reference.click('#settings'); reference.click('#save');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, JSON.parse(reference.memory.getItem(SAVE_KEY)).state);
    assert.doesNotMatch(f.memory.getItem(SAVE_KEY), /totalIntervals|p95Ms|capacityLimited/);
    assert.equal(f.frames.size, 1); assert.equal(f.timers.size, reference.timers.size);
    p.panel.open = false; p.panel.emit('toggle');
    const reads = f.renderer.statsReads;
    for (let i = 0; i < 120; i++) f.tick(1 / 60);
    assert.equal(f.renderer.statsReads, reads); assert.equal(writes, 7);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
  } finally { f.dispose(); reference.dispose(); }
  assert.equal(f.element('.performance-qa'), null);
});

test('TC-3D-015 counts rendered frames only, with no hidden/BFCache/mode/resize/reload cross-segment gap', async () => {
  const f = fixture({ renderMode: 'low-power' });
  await f.flushOffline();
  try {
    openPerformance(f);
    for (let i = 0; i < 120; i++) f.tick(1 / 120);
    const s = f.window.__coffeeSliceDebug.readPerformance();
    assert.equal(s.totalIntervals, f.renderer.updates.length - 1);
    assert.ok(Math.abs(s.fps - 30) < 1e-8); assert.ok(Math.abs(s.p50Ms - 1000 / 30) < 1e-8);
    f.document.hidden = true; f.document.emit('visibilitychange');
    assert.equal(f.frames.size, 0); assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    f.clock.now += 60_000; f.clock.performance += 60_000;
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    for (let i = 0; i < 8; i++) f.tick(1 / 120);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalOver50, 0);
    const resets = [
      () => { const smooth = f.nodes.find(node => node.dataset.renderMode === 'smooth'); f.root.emit('click', { target: smooth }); },
      () => f.observer.callback(), () => f.window.emit('resize'), () => f.window.visualViewport.emit('resize'),
      () => { f.window.emit('pagehide', { persisted: true }); f.clock.performance += 3000; f.clock.now += 3000; f.window.emit('pageshow', { persisted: true }); },
      () => { f.click('#settings'); f.click('#reload'); },
    ];
    for (const reset of resets) {
      reset(); await f.flushOffline(); assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
      f.tick(.01); f.tick(.01);
      assert.equal(f.window.__coffeeSliceDebug.readPerformance().p95Ms, 10);
      assert.equal(f.frames.size, 1);
    }
  } finally { f.dispose(); }
});

test('TC-3D-015 frozen results are stable and restart clears only diagnostics', () => {
  const f = fixture();
  try {
    const p = openPerformance(f); f.tick(.01); f.tick(.01); f.tick(1);
    const state = f.state(); p.freeze.emit('click'); assert.deepEqual(f.state(), state);
    const text = p.text.textContent, stats = f.window.__coffeeSliceDebug.readPerformance(), reads = f.renderer.statsReads;
    for (let i = 0; i < 100; i++) f.tick(.01);
    p.freeze.emit('click'); assert.equal(p.text.textContent, text);
    assert.deepEqual(f.window.__coffeeSliceDebug.readPerformance(), stats); assert.equal(f.renderer.statsReads, reads);
    assert.match(text, /^FROZEN/);
    const current = f.state(); p.restart.emit('click'); assert.deepEqual(f.state(), current);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    f.tick(.01); f.tick(.01); assert.equal(f.window.__coffeeSliceDebug.readPerformance().p95Ms, 10);
  } finally { f.dispose(); }
});

test('TC-3D-015 visible-but-unfocused pages cannot contaminate foreground timing', () => {
  const f = fixture();
  try {
    const p = openPerformance(f); f.tick(.01); f.tick(.01);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 1);
    f.document.hasFocus = () => false; f.window.emit('blur');
    f.tick(1); f.tick(1);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    assert.match(p.text.textContent, /PAUSED · page unfocused/);
    f.document.hasFocus = () => true; f.window.emit('focus'); f.tick(.01); f.tick(.01);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().p95Ms, 10);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalOver50, 0);
  } finally { f.dispose(); }
});

test('TC-3D-015 observed focus loss excludes its gap even when lifecycle events are missing', () => {
  const f = fixture();
  try {
    const p = openPerformance(f); f.tick(.01); f.tick(.01);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 1);
    f.document.hasFocus = () => false;
    f.tick(1); f.tick(1); // Deliberately no window blur/focus events.
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    assert.match(p.text.textContent, /PAUSED · page unfocused/);
    f.document.hasFocus = () => true;
    f.tick(.01); // First resumed render establishes a new timestamp origin.
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    f.tick(.01);
    const resumed = f.window.__coffeeSliceDebug.readPerformance();
    assert.equal(resumed.p95Ms, 10); assert.equal(resumed.totalMs, 10);
    assert.equal(resumed.totalOver50, 0); assert.equal(resumed.totalOver100, 0);
    assert.match(resumed.reason, /observed pause/);
    assert.equal(f.frames.size, 1);
    const state = f.state();
    assert.ok(Math.abs(state.elapsed + state.stepCarry - 2.04) < 1e-9, 'all 2.04 seconds still reach the business simulation');
  } finally { f.dispose(); }
});

test('TC-3D-015 context loss invalidates measurements even when the scene object survives', () => {
  const f = fixture();
  try {
    const p = openPerformance(f); f.tick(.01); f.tick(.01);
    f.element('#coffee-canvas').emit('webglcontextlost'); f.tick(1); f.tick(1);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    assert.match(p.text.textContent, /BLOCKED.*WebGL context lost/);
    f.element('#coffee-canvas').emit('webglcontextrestored'); f.tick(.01); f.tick(.01);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().p95Ms, 10);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalOver50, 0);
  } finally { f.dispose(); }
});

test('TC-3D-015 unavailable renderer never reports fake FPS; collapsed route panel skips pose/DOM capture', () => {
  const unavailable = fixture({ renderUnavailable: true });
  try {
    const p = openPerformance(unavailable); unavailable.tick(1); unavailable.tick(1);
    const stats = unavailable.window.__coffeeSliceDebug.readPerformance();
    assert.equal(stats.fps, null); assert.equal(stats.totalIntervals, 0);
    assert.match(p.text.textContent, /BLOCKED · renderer unavailable/); assert.match(p.text.textContent, /FPS —/);
  } finally { unavailable.dispose(); }
  const f = fixture();
  try {
    f.tick(10);
    const panel = f.element('.route-qa'), text = panel.children.find(child => child.tagName === 'PRE');
    const oldText = text.textContent, oldReads = f.renderer.poseReads;
    panel.open = false; panel.emit('toggle');
    assert.equal(f.element('.route-qa-marker').hidden, true);
    for (let i = 0; i < 60; i++) f.tick(1 / 60);
    assert.equal(f.renderer.poseReads, oldReads); assert.equal(text.textContent, oldText);
    panel.open = true; panel.emit('toggle'); f.tick(.1);
    assert.equal(f.renderer.poseReads, oldReads + 1); assert.notEqual(text.textContent, oldText);
    assert.ok(f.window.__coffeeSliceDebug.readRoutes().records.length);
  } finally { f.dispose(); }
});


test('TC-3D-016 four native quality buttons expose selection, clear labels and a roomy two-column layout', () => {
  const picker = html.match(/<div class="render-mode-picker"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(picker);
  assert.match(picker, /role="group"/);
  assert.match(picker, /aria-labelledby="render-mode-label"/);
  assert.match(picker, /aria-describedby="render-mode-note"/);
  assert.deepEqual(openingTags(picker, 'button').map(tag => tag.match(/data-render-mode="([^"]+)"/)[1]), ['smooth', 'clear-60', 'balanced', 'low-power']);
  assert.match(picker, /data-render-mode="clear-60">清晰 60 帧<small>同等清晰度<\/small>/);
  assert.deepEqual(declarations('.render-mode-picker', 'grid-template-columns'), ['repeat(2, minmax(0, 1fr))']);
  assert.ok(declarations('.render-mode-picker button', 'min-height').every(value => parseFloat(value) >= 44));
});

test('TC-3D-016 clear-60 renders 60 of 120Hz with continuous poses and identical saved progression', async () => {
  const moving = createEngine(); moving.invite(); moving.advance(.5);
  const f = fixture({ renderMode: 'clear-60', initial: moving.snapshot() });
  const reference = createEngine(moving.snapshot()); reference.advance(10);
  try {
    assert.equal(f.renderer.renderMode, 'clear-60');
    for (let i = 0; i < 1200; i++) f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, 600);
    assert.deepEqual(f.state(), reference.snapshot());
    const poses = f.renderer.updates.slice(6, 50).map(update => update.state.customers.find(customer => customer.id === 1).z);
    for (let i = 1; i < poses.length; i++) assert.ok(Math.abs(poses[i - 1] - poses[i] - 2.5 / 60) < 1e-8);
    f.click('#settings'); f.click('#save');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, reference.snapshot());
    assert.doesNotMatch(f.memory.getItem(SAVE_KEY), /clear-60|renderMode/);
    assert.equal(f.frames.size, 1);
    const rendered = f.renderer.updates.length;
    f.document.hidden = true; f.document.emit('visibilitychange'); f.tick(5);
    assert.equal(f.renderer.updates.length, rendered);
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline(); f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, rendered);
    f.tick(1 / 120);
    assert.equal(f.renderer.updates.length, rendered + 1);
  } finally { f.dispose(); }
});

test('TC-3D-016 existing preferences and two-counter saves survive clear-60 selection and reload', () => {
  const progressed = createEngine(); progressed.advance(120);
  for (const oldMode of [undefined, 'smooth', 'balanced', 'low-power']) {
    const f = fixture({ initial: progressed.snapshot(), renderMode: oldMode });
    let reloaded;
    try {
      assert.equal(f.renderer.renderMode, oldMode ?? 'smooth', 'no existing or absent preference is silently migrated');
      const before = f.state(), saved = f.memory.getItem(SAVE_KEY);
      f.click('#settings');
      const clear = f.nodes.find(node => node.dataset.renderMode === 'clear-60');
      assert.ok(clear);
      f.root.emit('click', { target: clear });
      f.root.emit('click', { target: clear });
      assert.equal(f.renderer.renderMode, 'clear-60');
      assert.equal(f.renderer.resizeCalls, 1, 'repeat selection does not rebuild or resize again');
      assert.equal(f.memory.getItem(RENDER_MODE_KEY), 'clear-60');
      assert.equal(f.memory.getItem(SAVE_KEY), saved, 'selection does not write the existing save bytes');
      assert.deepEqual(f.state(), before);
      for (const button of f.nodes.filter(node => node.dataset.renderMode)) assert.equal(button.getAttribute('aria-pressed'), String(button === clear));
      assert.match(f.element('#render-mode-note').textContent, /相同.*清晰度.*60.*经营速度不变/);
      f.click('#dialog-close'); f.click('#settings');
      assert.equal(clear.getAttribute('aria-pressed'), 'true');
      reloaded = fixture({ raw: saved, renderMode: f.memory.getItem(RENDER_MODE_KEY), now: JSON.parse(saved).savedAt });
      assert.equal(reloaded.renderer.renderMode, 'clear-60');
      assert.deepEqual(reloaded.state(), before);
      assert.equal(f.frames.size, 1);
    } finally { f.dispose(); reloaded?.dispose(); }
  }
  const blocked = fixture({ writeUnavailable: true });
  try {
    const saved = blocked.memory.getItem(SAVE_KEY);
    blocked.click('#settings');
    const clear = blocked.nodes.find(node => node.dataset.renderMode === 'clear-60');
    blocked.root.emit('click', { target: clear });
    assert.equal(blocked.renderer.renderMode, 'clear-60');
    assert.match(blocked.element('#toast').textContent, /已生效.*未允许保存/);
    assert.equal(blocked.memory.getItem(SAVE_KEY), saved);
  } finally { blocked.dispose(); }
});

test('TC-3D-016 clear-60 QA records the new target and isolates mode changes into fresh segments', () => {
  const f = fixture();
  try {
    const p = openPerformance(f);
    f.tick(.01); f.tick(.01);
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 1);
    f.click('#settings');
    const clear = f.nodes.find(node => node.dataset.renderMode === 'clear-60');
    f.root.emit('click', { target: clear });
    assert.equal(f.window.__coffeeSliceDebug.readPerformance().totalIntervals, 0);
    f.click('#dialog-close');
    for (let i = 0; i < 240; i++) f.tick(1 / 120);
    assert.match(p.text.textContent, /mode clear-60 · target 60/);
    assert.match(p.text.textContent, /buffer 800×1100/);
    assert.ok(Math.abs(f.window.__coffeeSliceDebug.readPerformance().fps - 60) < 1e-8);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});


test('TC-3D-019 failed latest-save reads retain the 570-earned frozen shop and cannot overwrite it after storage recovers', async () => {
  const initial = createInitialState(); initial.wallet += 570; initial.totalEarned = 570;
  const f = fixture({ initial, now: 130000, savedAtAgoSeconds: 30, writeUnavailable: true });
  await f.flushOffline();
  try {
    const durable = f.memory.getItem(SAVE_KEY), frozen = f.state();
    assertProtected(f); assert.equal(frozen.totalEarned, 570);
    const session = f.window.__coffeeSliceDebug.readRoutes().session;
    f.storageControl.writeUnavailable = false; f.storageControl.readUnavailable = true;
    f.click('#settings'); f.click('#reload'); await f.flushOffline(); f.click('#reload'); await f.flushOffline();
    assert.deepEqual(f.state(), frozen, 'failed reload must never publish the initial-shop fallback');
    assert.equal(f.window.__coffeeSliceDebug.readRoutes().session, session, 'failed recovery is not a state replacement');
    assert.equal(f.element('#reload').hidden, false);
    assert.match(f.element('#save-status').textContent, /读取.*失败|拒绝读取|不可用/);
    assert.equal(f.element('#new-shop').hidden, true, 'unreadable storage is not permission to reset');
    f.storageControl.readUnavailable = false;
    f.click('#save'); f.tick(10); f.action({ type: 'invite' });
    f.document.hidden = true; f.document.emit('visibilitychange'); f.tick(35);
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline(); f.window.emit('pageshow', { persisted: true }); await f.flushOffline();
    assert.deepEqual(f.state(), frozen, 'save, RAF and visibility cannot release failed recovery');
    assert.equal(f.memory.getItem(SAVE_KEY), durable, 'recovering storage alone cannot authorize an overwrite');
    f.click('#reload'); await f.flushOffline();
    assert.equal(f.state().paused, false); assert.ok(f.state().totalEarned >= 570);
    assert.equal(f.element('#reload').hidden, true);
    const once = f.state(), claimed = f.memory.getItem(SAVE_KEY);
    f.click('#reload'); await f.flushOffline(); assert.deepEqual(f.state(), once); assert.equal(f.memory.getItem(SAVE_KEY), claimed);
    f.tick(.1); assert.ok(f.state().elapsed > once.elapsed);
    f.click('#save'); assert.ok(JSON.parse(f.memory.getItem(SAVE_KEY)).state.totalEarned >= 570);
  } finally { f.dispose(); }
});

test('TC-3D-019 corrupt, future and missing reloads preserve current progress; only confirmed new-shop can replace it', async () => {
  const progressed = createEngine(); progressed.advance(120);
  for (const replacement of ['{ corrupt latest archive', JSON.stringify({ schemaVersion: 2 }), null]) {
    const f = fixture({ initial: progressed.snapshot(), now: 130000 });
    await f.flushOffline();
    try {
      if (replacement === null) f.memory.removeItem(SAVE_KEY); else f.memory.setItem(SAVE_KEY, replacement);
      f.window.emit('storage', { key: SAVE_KEY, newValue: replacement });
      const frozen = f.state();
      f.click('#settings'); f.click('#reload'); await f.flushOffline();
      assert.deepEqual(f.state(), frozen);
      assert.equal(f.element('#reload').hidden, false); assert.equal(f.element('#new-shop').hidden, false);
      assert.match(f.element('#save-status').textContent, replacement === null ? /未找到|缺失/ : /存档/);
      f.click('#save'); f.tick(10); assert.equal(f.memory.getItem(SAVE_KEY), replacement);
      assert.deepEqual(f.state(), frozen);
      if (replacement !== null) {
        f.click('#export'); assert.equal(await f.blobs.at(-1).text(), replacement);
        assert.equal(f.element('#export-current').hidden, false);
        f.click('#export-current'); assert.deepEqual(JSON.parse(await f.blobs.at(-1).text()).state, frozen);
      }
      f.window.confirm = () => false;
      f.click('#new-shop'); assert.deepEqual(f.state(), frozen); assert.equal(f.memory.getItem(SAVE_KEY), replacement);
      const backups = [], setItem = f.memory.setItem;
      f.memory.setItem = (key, value) => { if (key.startsWith(`${SAVE_KEY}-backup-`)) backups.push(value); setItem(key, value); };
      f.window.confirm = () => true; f.click('#new-shop');
      assert.equal(f.state().totalEarned, 0); assert.equal(f.state().paused, false);
      assert.equal(f.element('#reload').hidden, true); assert.equal(f.element('#new-shop').hidden, true);
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.totalEarned, 0);
      assert.deepEqual(backups, replacement === null ? [] : [replacement]);
      const fresh = f.state(); f.tick(.05); assert.ok(f.state().elapsed > fresh.elapsed);
    } finally { f.dispose(); }
  }
});

test('TC-3D-019 startup read failure stays protected until a successful read, while a verified empty first launch starts normally', async () => {
  const progressed = createEngine(); progressed.advance(120);
  const f = fixture({ initial: progressed.snapshot(), readUnavailable: true, now: 130000 });
  await f.flushOffline();
  try {
    const durable = f.memory.getItem(SAVE_KEY), blocked = f.state();
    assertProtected(f); assert.equal(f.element('#reload').hidden, false);
    f.storageControl.readUnavailable = false;
    f.tick(10); f.click('#save'); assert.equal(f.memory.getItem(SAVE_KEY), durable);
    assert.deepEqual(f.state(), blocked);
    f.click('#reload'); await f.flushOffline(); assert.equal(f.state().paused, false);
    const recovered = createEngine(progressed.snapshot()); recovered.advance(8);
    assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(recovered.snapshot()), 'the previously unpaid ten-second gap is recovered at 80%');
  } finally { f.dispose(); }
  const fresh = fixture({ initial: null, now: 130000 });
  await fresh.flushOffline();
  try {
    assert.equal(fresh.state().paused, false); assert.equal(fresh.element('#reload').hidden, true);
    fresh.tick(.1); fresh.click('#save'); assert.equal(JSON.parse(fresh.memory.getItem(SAVE_KEY)).state.elapsed, .1);
  } finally { fresh.dispose(); }
});


test('TC-3D-019 cancelled reload, failed reset and a new concurrent save never release recovery protection', async () => {
  const progressed = createEngine(); progressed.advance(120);
  const f = fixture({ initial: progressed.snapshot(), now: 130000 });
  await f.flushOffline();
  try {
    const original = f.memory.getItem(SAVE_KEY), replacement = '{ unreadable replacement';
    f.memory.setItem(SAVE_KEY, replacement); f.window.emit('storage', { key: SAVE_KEY, newValue: replacement });
    const frozen = f.state();
    f.window.confirm = () => false; f.click('#reload'); await f.flushOffline(); assert.deepEqual(f.state(), frozen);
    f.window.confirm = () => true; f.click('#reload'); await f.flushOffline();
    for (const failure of ['writeUnavailable', 'removeUnavailable']) {
      f.storageControl[failure] = true; f.click('#new-shop'); f.storageControl[failure] = false;
      assert.deepEqual(f.state(), frozen); assert.equal(f.memory.getItem(SAVE_KEY), replacement);
      assert.equal(f.element('#reload').hidden, false);
      f.click('#save'); assert.equal(f.memory.getItem(SAVE_KEY), replacement);
    }
    f.memory.setItem(SAVE_KEY, original);
    f.click('#new-shop');
    assert.equal(f.memory.getItem(SAVE_KEY), original, 'reset cannot erase a newly replaced CAS base');
    assert.deepEqual(f.state(), frozen);
    f.click('#reload'); await f.flushOffline(); assert.equal(f.state().paused, false);
    assert.deepEqual(f.state(), progressed.snapshot());
  } finally { f.dispose(); }
});

test('TC-3D-019 startup outage followed by missing data needs explicit new-shop, never automatic recovery', () => {
  const f = fixture({ initial: null, now: 130000, readUnavailable: true });
  try {
    const frozen = f.state(); f.storageControl.readUnavailable = false;
    f.click('#reload'); f.click('#reload');
    assert.deepEqual(f.state(), frozen); assertProtected(f);
    assert.match(f.element('#save-status').textContent, /未找到/);
    assert.equal(f.element('#reload').hidden, false); assert.equal(f.element('#new-shop').hidden, false);
    f.tick(10); f.click('#save'); assert.equal(f.memory.getItem(SAVE_KEY), null);
    f.click('#new-shop'); assert.equal(f.state().paused, false);
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.totalEarned, 0);
  } finally { f.dispose(); }
});

test('TC-3D-019 shutdown after failed recovery never writes prior or fallback state', async () => {
  for (const path of ['dispose', 'pagehide']) {
    const progressed = createEngine(); progressed.advance(120);
    const f = fixture({ initial: progressed.snapshot(), now: 130000, savedAtAgoSeconds: 30, writeUnavailable: true });
    const durable = f.memory.getItem(SAVE_KEY);
    f.storageControl.writeUnavailable = false; f.storageControl.readUnavailable = true;
    f.click('#reload'); await f.flushOffline(); f.storageControl.readUnavailable = false;
    if (path === 'dispose') f.dispose(); else f.window.emit('pagehide', { persisted: false });
    assert.equal(f.memory.getItem(SAVE_KEY), durable);
    assert.equal(f.frames.size, 0);
    assert.equal(f.renderer.disposed, true);
  }
});

test('TC-3D-019 protected raw export survives a later read outage and clears after recovery', async () => {
  const progressed = createEngine(); progressed.advance(120);
  const f = fixture({ initial: progressed.snapshot(), now: 130000 });
  await f.flushOffline();
  try {
    const good = f.memory.getItem(SAVE_KEY), broken = '{ damaged';
    f.memory.setItem(SAVE_KEY, broken); f.window.emit('storage', { key: SAVE_KEY, newValue: broken });
    f.click('#reload'); await f.flushOffline(); const frozen = f.state();
    f.storageControl.readUnavailable = true; f.click('#reload'); await f.flushOffline();
    f.click('#export'); assert.equal(await f.blobs.at(-1).text(), broken);
    f.click('#export-current'); assert.deepEqual(JSON.parse(await f.blobs.at(-1).text()).state, frozen);
    f.storageControl.readUnavailable = false; f.memory.setItem(SAVE_KEY, good); f.click('#reload'); await f.flushOffline();
    assert.equal(f.element('#export-current').hidden, true);
    assert.equal(f.element('#export').disabled, false);
    f.click('#export'); assert.deepEqual(JSON.parse(await f.blobs.at(-1).text()).state, progressed.snapshot());
  } finally { f.dispose(); }
});

// Exact asynchronous UI/lifecycle contracts. These use the real engine and
// repository, deterministic visible/hidden clocks, and explicit macrotask yields.
test('TC-3D-020 unlimited 80% loading stays responsive, exposes only committed assets, and accounts visible work time', async () => {
  const initial = createInitialState();
  const f = fixture({ initial, now: 20_000_000, savedAtAgoSeconds: 10800 });
  try {
    const raw = f.memory.getItem(SAVE_KEY), frozen = f.state();
    assert.equal(f.element('#offline-panel').hidden, false);
    assert.equal(f.element('#offline-working').hidden, false);
    assert.equal(f.element('#offline-result').hidden, true);
    assertProtected(f);
    assert.equal(frozen.wallet, initial.wallet);
    assert.equal(frozen.lastOfflineClaimId, null);
    assert.match(f.element('#offline-progress-text').textContent, /0%/);
    assert.doesNotMatch(f.element('#toast').textContent, /已计入当前金额/);
    await f.stepOffline();
    const progress = Number(f.element('#offline-progress').getAttribute('value'));
    assert.ok(progress > 0 && progress < 1, 'a partial exact chunk reports progress before final commit');
    assert.equal(f.memory.getItem(SAVE_KEY), raw); assert.deepEqual(f.state(), frozen);
    f.tick(2.5); f.click('#save'); f.click('#business-toggle');
    assert.deepEqual(f.state(), frozen, 'rendering and business controls cannot publish speculative progress');
    assert.equal(f.memory.getItem(SAVE_KEY), raw, 'yielding and loading never write an intermediate claim');
    f.window.emit('pageshow', { persisted: true });
    assert.equal(f.frames.size, 1, 'duplicate resume does not create another clock owner');
    await f.flushOffline({ dismissResult: false });
    const committed = JSON.parse(f.memory.getItem(SAVE_KEY));
    const expected = createEngine(initial), report = expected.applyOffline(10800, f.state().lastOfflineClaimId);
    assert.equal(committed.state.elapsed, 8640, 'three hours are all credited at 80%, without the old two-hour cap');
    assert.equal(committed.savedAt, 20_000_000, 'the commit anchors its endpoint, not the end of computation');
    assert.deepEqual(f.state(), expected.snapshot());
    assert.equal(f.element('#offline-result').hidden, false);
    assert.equal(f.element('#offline-deposited').textContent, `¥${(report.amount / 100).toFixed(2)}`);
    assert.equal(f.element('#offline-duration').textContent, '离开了 3 小时');
    assert.equal(f.state().wallet - initial.wallet, report.amount, 'the reward is the committed wallet delta');
    assert.equal(f.state().totalEarned - initial.totalEarned, report.generatedAmount, 'generated sales remain in the accounting, not the reward label');
    for (const id of ['offline-legacy', 'offline-generated', 'offline-pending']) assert.equal(f.element(`#${id}`), null, `${id} is no longer normal-player presentation`);
    f.click('#offline-done'); f.click('#save');
    expected.advance(2.5);
    assert.deepEqual(f.state(), expected.snapshot(), 'foreground computation time is ordinary 100% online time, including save before the next RAF');
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).savedAt, f.clock.now);
    const once = f.state(), onceRaw = f.memory.getItem(SAVE_KEY);
    f.window.emit('pageshow', { persisted: true }); f.click('#reload'); await f.flushOffline();
    assert.deepEqual(f.state(), once); assert.equal(f.memory.getItem(SAVE_KEY), onceRaw);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});

test('TC-3D-020 cancel, native close and retry retain original raw and never stamp a partial claim', async () => {
  for (const cancel of ['#offline-cancel', '#dialog-close', 'native-close']) {
    const f = fixture({ now: 5_000_000, savedAtAgoSeconds: 3600 });
    try {
      const original = f.memory.getItem(SAVE_KEY), frozen = f.state();
      if (cancel === 'native-close') f.element('#operation-dialog').close(); else f.click(cancel);
      await f.flushOffline();
      assert.deepEqual(f.state(), frozen);
      assert.equal(f.memory.getItem(SAVE_KEY), original);
      assert.equal(f.element('#reload').hidden, false);
      assert.equal(f.element('#operation-dialog').open, false);
      assert.match(f.element('#save-status').textContent, /取消.*保留/);
      f.tick(3); f.click('#save');
      assert.equal(f.memory.getItem(SAVE_KEY), original);
      f.click('#settings'); f.click('#reload'); await f.flushOffline();
      assert.equal(f.state().paused, false);
      assert.equal(f.state().elapsed, 2882.4);
      assert.equal(f.state().offlineClaimIds.length, 1, 'canceled work creates no claim id');
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).savedAt, f.clock.now);
      assert.equal(f.frames.size, 1);
    } finally { f.dispose(); }
  }
});

test('TC-3D-020 hiding pending work cancels and restarts its unpaid interval once, including BFCache duplicates', async () => {
  const f = fixture({ now: 5_000_000, savedAtAgoSeconds: 3600 });
  try {
    const original = f.memory.getItem(SAVE_KEY), frozen = f.state();
    f.tick(2);
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.window.emit('pagehide', { persisted: true });
    assert.equal(f.frames.size, 0);
    await f.flushOffline();
    assert.equal(f.memory.getItem(SAVE_KEY), original); assert.deepEqual(f.state(), frozen);
    f.clock.now += 60000; f.clock.performance += 60000;
    f.document.hidden = false; f.document.emit('visibilitychange');
    f.window.emit('pageshow', { persisted: true });
    await f.flushOffline();
    assert.equal(f.state().elapsed, 2929.6);
    assert.equal(f.state().offlineClaimIds.length, 1);
    const once = f.state(), raw = f.memory.getItem(SAVE_KEY);
    f.window.emit('pageshow', { persisted: true }); f.document.emit('visibilitychange');
    assert.deepEqual(f.state(), once); assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.equal(f.frames.size, 1);
  } finally { f.dispose(); }
});

test('TC-3D-020 pending storage conflict, newer read and disposal invalidate all late completion callbacks', async () => {
  for (const kind of ['storage', 'reload', 'dispose']) {
    const f = fixture({ now: 5_000_000, savedAtAgoSeconds: 3600 });
    try {
      const frozen = f.state();
      const foreignState = createEngine(); foreignState.advance(11);
      const foreign = JSON.stringify({ schemaVersion: 1, offlinePolicyVersion: 3, savedAt: f.clock.now, recordChangeTag: `new-${kind}`, state: foreignState.snapshot() });
      if (kind === 'dispose') f.dispose();
      else {
        f.memory.setItem(SAVE_KEY, foreign);
        if (kind === 'storage') f.window.emit('storage', { key: SAVE_KEY, newValue: foreign });
        else f.click('#reload');
      }
      const durable = f.memory.getItem(SAVE_KEY);
      await f.flushOffline();
      assert.equal(f.memory.getItem(SAVE_KEY), durable);
      assert.deepEqual(f.state(), kind === 'reload' ? foreignState.snapshot() : frozen);
      assert.doesNotMatch(f.element('#toast').textContent, /离开期间已存入金库/);
      if (kind === 'dispose') { assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); }
      else assert.equal(f.frames.size, 1);
    } finally { f.dispose(); }
  }
});

test('TC-3D-020 hidden retry retains unsaved source after write failure and cancellation, including sub-tick gaps', async () => {
  for (const gap of [.01, 60]) {
    const f = fixture({ now: 500_000 });
    try {
      f.tick(5);
      const live = f.state(), old = f.memory.getItem(SAVE_KEY);
      f.storageControl.writeUnavailable = true;
      f.document.hidden = true; f.document.emit('visibilitychange');
      assert.equal(f.memory.getItem(SAVE_KEY), old, 'failed departure save leaves older durable bytes');
      f.clock.now += gap * 1000; f.clock.performance += gap * 1000;
      f.document.hidden = false; f.document.emit('visibilitychange');
      if (gap >= 1) f.click('#offline-cancel');
      await f.flushOffline();
      assert.equal(f.state().elapsed, live.elapsed);
      assert.equal(f.memory.getItem(SAVE_KEY), old);
      f.storageControl.writeUnavailable = false;
      f.click('#reload'); await f.flushOffline();
      const expected = createEngine(live); expected.applyOffline(gap, f.state().lastOfflineClaimId);
      assert.deepEqual(f.state(), expected.snapshot(), 'retry preserves the live five seconds, rather than silently loading older bytes');
      assert.equal(f.state().offlineClaimIds.length, 1);
    } finally { f.dispose(); }
  }
});

test('TC-3D-020 legacy policy settles its old interval once while the result shows only committed money and away time', async () => {
  const initial = createInitialState();
  const now = 20_000_000, raw = JSON.stringify({ schemaVersion: 1, savedAt: now - 3 * 3600000, recordChangeTag: 'legacy-policy-details', state: initial });
  const f = fixture({ raw, now });
  try {
    await f.flushOffline({ dismissResult: false });
    const expected = createEngine(initial), legacy = expected.applyOffline(10800, f.state().lastOfflineClaimId, 1);
    assert.deepEqual(f.state(), expected.snapshot());
    assert.equal(f.state().elapsed, 3600);
    assert.equal(f.element('#offline-legacy'), null, 'migration diagnostics stay out of the compact result');
    assert.equal(f.element('#offline-deposited').textContent, `¥${(legacy.amount / 100).toFixed(2)}`);
    assert.equal(f.element('#offline-duration').textContent, '离开了 3 小时');
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).offlinePolicyVersion, 3);
    f.click('#offline-done');
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.clock.now += 60000; f.clock.performance += 60000;
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline({ dismissResult: false });
    const current = expected.applyOffline(60, f.state().lastOfflineClaimId, 3);
    assert.deepEqual(f.state(), expected.snapshot(), 'later intervals use the unchanged 80% policy');
    assert.equal(f.state().elapsed, 3648);
    assert.equal(f.element('#offline-deposited').textContent, `¥${(current.amount / 100).toFixed(2)}`);
    assert.equal(f.element('#offline-duration').textContent, '离开了 1 分钟');
  } finally { f.dispose(); }
});


test('TC-3D-020 rounded away-time presentation retains the exact fractional settlement', async () => {
  const f = fixture({ now: 500_000, savedAtAgoSeconds: 30.1 });
  try {
    await f.flushOffline({ dismissResult: false });
    assert.equal(f.element('#offline-duration').textContent, '离开了 30 秒');
    const expected = createEngine(); expected.applyOffline(30.1, f.state().lastOfflineClaimId);
    assert.deepEqual(f.state(), expected.snapshot(), 'flooring the display must not quantize the actual 24.08-second settlement');
    assert.ok(Math.abs(f.state().elapsed + f.state().stepCarry - 24.08) < 1e-9);
  } finally { f.dispose(); }
});


test('TC-3D-020 visibility observed before its event cannot discard a completed hidden interval', async () => {
  for (const transition of ['before-yield', 'during-commit']) {
    const f = fixture({ now: 500_000 });
    try {
      f.tick(5);
      f.document.hidden = true; f.document.emit('visibilitychange');
      const original = f.memory.getItem(SAVE_KEY);
      f.clock.now += 60000; f.clock.performance += 60000;
      f.document.hidden = false; f.document.emit('visibilitychange');
      assert.equal(f.state().elapsed, 5);
      if (transition === 'before-yield') f.document.hidden = true;
      else {
        const setItem = f.memory.setItem;
        f.memory.setItem = (key, value) => {
          setItem(key, value);
          // A real document can become hidden before its queued event. This
          // hook forces that observation after final computation, at its write.
          if (key === SAVE_KEY) f.document.hidden = true;
        };
      }
      await f.flushOffline();
      if (transition === 'before-yield') {
        assert.equal(f.memory.getItem(SAVE_KEY), original, 'hidden detection aborts before the next compute/commit slice');
        assert.equal(f.state().elapsed, 5);
      } else {
        assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.elapsed, 53);
        assert.equal(f.state().elapsed, 53, 'a durable committed state must be installed even when its UI callback sees hidden');
      }
      f.document.emit('visibilitychange');
      f.clock.now += 10000; f.clock.performance += 10000;
      // Stop the artificial hook from forcing the following resume hidden.
      if (transition === 'during-commit') {
        const bytes = f.memory.getItem(SAVE_KEY);
        const replacement = createMemoryStorage(); replacement.setItem(SAVE_KEY, bytes);
        f.memory.setItem = replacement.setItem; f.memory.getItem = replacement.getItem;
      }
      f.document.hidden = false; f.document.emit('visibilitychange');
      await f.flushOffline();
      assert.equal(f.state().elapsed, 61, 'five online seconds plus seventy hidden seconds at80% survive the event race');
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.elapsed, 61);
      assert.equal(f.frames.size, 1);
    } finally { f.dispose(); }
  }
});

test('TC-3D-020 unexplained long foreground RAF gaps freeze without partial simulation or save, until explicit recovery', async () => {
  const f = fixture({ now: 500_000 });
  try {
    f.tick(5); f.click('#save');
    const source = f.state(), raw = f.memory.getItem(SAVE_KEY);
    f.tick(61);
    assertProtected(f);
    assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(source));
    assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.match(f.element('#save-status').textContent, /页面长时间未更新.*无法确认.*已保护当前进度/);
    f.click('#save');
    f.document.hidden = true; f.document.emit('visibilitychange');
    f.clock.now += 10000; f.clock.performance += 10000;
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(source), 'visibility alone cannot unlock a protected unexplained interval');
    f.click('#reload'); await f.flushOffline();
    const expected = createEngine(source); expected.applyOffline(71, f.state().lastOfflineClaimId);
    assert.deepEqual(f.state(), expected.snapshot(), 'only explicit latest-save recovery selects the durable interval for offline settlement');
  } finally { f.dispose(); }
});

test('TC-3D-020 save and every business action guard unclassified foreground time before the next RAF', () => {
  for (const action of ['save', 'invite', 'recipe', 'counter', 'coffee', 'pause']) {
    const initial = createEngine(); initial.advance(22);
    const f = fixture({ initial: initial.snapshot(), now: 500_000 });
    try {
      const source = f.state(), raw = f.memory.getItem(SAVE_KEY);
      f.clock.now += 61000; f.clock.performance += 61000;
      if (action === 'save') f.click('#save');
      if (action === 'invite') f.action({ type: 'invite' });
      if (action === 'recipe') {
        f.action({ type: 'recipe', id: 'counter-a' });
        f.root.emit('click', { target: f.nodes.find(node => node.dataset.selectRecipe === 'latte') });
      }
      if (action === 'counter') { f.action({ type: 'counter', id: 'counter-a' }); f.click('#counter-upgrade'); }
      if (action === 'coffee') { openCoffee(f, 'espresso'); f.click('#coffee-upgrade'); }
      if (action === 'pause') f.click('#business-toggle');
      assertProtected(f);
      assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(source), `${action} cannot change business before an unclassified long gap`);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, `${action} cannot stamp an unaccounted time anchor`);
    } finally { f.dispose(); }
  }
});

test('TC-3D-020 verified 300-second foreground computation tail advances before purchases, recipe changes and invites', async () => {
  for (const action of ['save', 'invite', 'recipe', 'counter', 'coffee', 'pause']) {
    const initial = createEngine(); initial.advance(22);
    for (let i = 0; i < 1000 && !initial.state.counters.some(counter => counter.brew); i++) initial.advance(.05);
    assert.ok(initial.state.counters.some(counter => counter.brew), 'fixture includes existing brew snapshots');
    const f = fixture({ initial: initial.snapshot(), now: 5_000_000, savedAtAgoSeconds: 3600 });
    try {
      for (let turn = 0; turn < 10; turn++) { f.tick(30); await f.stepOffline(); }
      await f.flushOffline();
      const committed = JSON.parse(f.memory.getItem(SAVE_KEY)).state;
      assert.ok(Math.abs(committed.elapsed - initial.state.elapsed - 2880) < 1e-8);
      assert.equal(f.state().paused, false, 'known computation is excluded from the long unclassified-gap guard');
      const expected = createEngine(committed); expected.advance(300);
      if (action === 'save') f.click('#save');
      if (action === 'invite') { expected.invite(); f.action({ type: 'invite' }); }
      if (action === 'recipe') {
        expected.setRecipe('counter-a', 'latte');
        f.action({ type: 'recipe', id: 'counter-a' });
        f.root.emit('click', { target: f.nodes.find(node => node.dataset.selectRecipe === 'latte') });
      }
      if (action === 'counter') { expected.upgrade('counter-a'); f.action({ type: 'counter', id: 'counter-a' }); f.click('#counter-upgrade'); }
      if (action === 'coffee') { expected.upgradeCoffee('espresso'); openCoffee(f, 'espresso'); f.click('#coffee-upgrade'); }
      if (action === 'pause') { expected.togglePause(); f.click('#business-toggle'); }
      assert.deepEqual(f.state(), expected.snapshot(), `${action} occurs strictly after the100% foreground tail, preserving existing brew snapshots`);
      f.click('#save');
      assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).savedAt, f.clock.now);
      const once = f.state(), raw = f.memory.getItem(SAVE_KEY);
      f.clock.now += 61000; f.clock.performance += 61000;
      f.click('#save');
      assertProtected(f, once.paused);
      assert.deepEqual(f.state(), once);
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
    } finally { f.dispose(); }
  }
});


test('TC-3D-020 system suspension during a pending visible job cannot become verified foreground time', async () => {
  const f = fixture({ now: 5_000_000, savedAtAgoSeconds: 3600 });
  try {
    const original = f.memory.getItem(SAVE_KEY), source = f.state();
    f.clock.now += 86400000; f.clock.performance += 86400000;
    assert.equal(f.document.hidden, false);
    await f.flushOffline();
    assert.equal(f.memory.getItem(SAVE_KEY), original, 'an unexplained one-day turn gap cancels before the final claim');
    assert.deepEqual(f.state(), source, 'neither offline candidate nor unbounded synchronous foreground debt is installed');
    assert.match(f.element('#save-status').textContent, /页面长时间未更新.*无法确认.*已保护当前进度/);
    assert.equal(f.element('#settings-panel').hidden, false);
    assert.equal(f.element('#reload').hidden, false);
    f.click('#save'); f.tick(.1);
    assert.equal(f.memory.getItem(SAVE_KEY), original);
  } finally { f.dispose(); }
});

// Portable-save tests drive main.ts's actual DOM handlers. File/Share/Blob APIs
// are simulated; this is deliberately not Safari, Android, native picker or
// pixel evidence. The codec, game engine and local repository remain real.
function deferredFileOperation() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function portableFixture({ seconds = 90, savedAt = 1000, exportedAt = 2000, saveId = 'portable-source', revision = 7, state, ...fields } = {}) {
  const engine = createEngine(); engine.advance(seconds);
  const snapshot = state ?? engine.snapshot();
  return createPortableSave({ gameSchemaVersion: 1, economyVersion: snapshot.economyVersion, offlinePolicyVersion: 3, savedAt, exportedAt, saveId, revision, overview: overviewOf(snapshot), state: snapshot, ...fields });
}
function openFilePanel(f) {
  if (!f.element('#operation-dialog').open) f.click('#settings');
  f.click('#save-files');
  assert.equal(f.element('#files-panel').hidden, false, 'settings opens the actual file-management panel');
}
async function reviewPortable(f, file) {
  openFilePanel(f); f.chooseFile({ text: file.text }); await f.flushFiles();
  assert.equal(f.element('#file-review').hidden, false, 'verified file has a visible replacement preview');
}
function confirmPortable(f) {
  f.element('#file-other-tabs').checked = true;
  f.element('#file-other-tabs').emit('change');
  f.click('#file-confirm');
}
function portableWrites(f) { return f.storageWrites.filter(write => write.key === SAVE_KEY); }
function importBackupWrites(f) { return f.storageWrites.filter(write => write.key.startsWith(`${SAVE_KEY}-import-backup-`)); }


test('TC-3D-021 portable file controls expose explicit import review and manual sharing (static contract)', () => {
  assert.match(modal, /id="save-files"/);
  const picker = openingTags(modal, 'input').find(tag => /id="file-input"/.test(tag));
  assert.ok(picker); assert.match(picker, /type="file"/); assert.match(picker, /accept="[^"]*\.json/);
  const acknowledgement = openingTags(modal, 'input').find(tag => /id="file-other-tabs"/.test(tag));
  assert.ok(acknowledgement); assert.match(acknowledgement, /type="checkbox"/);
  for (const id of ['file-review', 'file-current-summary', 'file-incoming-summary', 'file-confirm', 'file-cancel', 'file-prepare', 'file-download', 'file-share', 'file-back', 'backup-live', 'backup-original']) assert.match(modal, new RegExp(`id="${id}"`));
  assert.match(modal, /手动/); assert.match(modal, /同步/);
});

test('TC-3D-021 reading and previewing a verified file freezes without modifying pause, money or durable bytes', async () => {
  const incoming = await portableFixture();
  const initial = createEngine(); initial.advance(22);
  const f = fixture({ initial: initial.snapshot(), now: 130000 });
  try {
    const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
    await reviewPortable(f, incoming);
    assert.deepEqual(f.state(), before, 'read and preview must not install incoming state or mutate paused');
    assert.equal(f.state().paused, false, 'review uses UI freeze rather than engine.pause');
    assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.equal(portableWrites(f).length, 0);
    assert.equal(importBackupWrites(f).length, 0);
    assert.ok(f.element('#file-current-summary').textContent.length > 0);
    assert.ok(f.element('#file-incoming-summary').textContent.length > 0);
    assert.notEqual(f.element('#file-current-summary').textContent, f.element('#file-incoming-summary').textContent);
    assert.equal(f.element('#file-confirm').disabled, true, 'other-tabs acknowledgement is required');
    f.click('#file-confirm'); f.tick(12); f.click('#save');
    assert.deepEqual(f.state(), before, 'RAF/autosave/manual-save cannot advance or persist a reviewed shop');
    assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.equal(portableWrites(f).length, 0);
    f.click('#file-cancel');
    assert.equal(f.element('#file-review').hidden, true);
    assert.deepEqual(f.state(), before, 'cancel does not replay preview dwell time');
    f.tick(.1);
    assert.ok(f.state().elapsed > before.elapsed && f.state().elapsed < before.elapsed + .2, 'normal live time resumes without catch-up for the review interval');
  } finally { f.dispose(); }
});

test('TC-3D-021 confirm makes exactly one backup and replacement with a fresh branch and no file-era offline credit', async () => {
  const incoming = await portableFixture({ savedAt: 1000, exportedAt: 2000, revision: 19 });
  const initial = createEngine(); initial.advance(22);
  const f = fixture({ initial: initial.snapshot(), now: 5_000_000 });
  try {
    f.tick(.25);
    const before = f.state(), raw = f.memory.getItem(SAVE_KEY), oldEnvelope = JSON.parse(raw);
    assert.notDeepEqual(before, oldEnvelope.state, 'fixture has unsaved live progress distinct from the durable bytes');
    await reviewPortable(f, incoming);
    confirmPortable(f); f.click('#file-confirm');
    assert.equal(portableWrites(f).length, 1, 'repeated confirm cannot repeat the replacement');
    assert.equal(importBackupWrites(f).length, 1);
    const envelope = JSON.parse(f.memory.getItem(SAVE_KEY));
    assert.deepEqual(envelope.state, incoming.payload.state);
    assert.deepEqual(f.state(), incoming.payload.state, 'import does not settle the old file timestamp');
    assert.equal(envelope.savedAt, f.clock.now);
    assert.equal(envelope.revision, 1);
    assert.notEqual(envelope.saveId, incoming.payload.saveId);
    assert.notEqual(envelope.saveId, oldEnvelope.saveId);
    assert.ok(envelope.importedFileHashes.includes(incoming.fingerprint));
    const backup = JSON.parse(f.memory.getItem(envelope.lastImportBackupKey));
    assert.equal(backup.originalRaw, raw); assert.deepEqual(backup.liveState, before);
    assert.equal(f.element('#file-review').hidden, true);
    assert.equal(f.element('#backup-live').hidden, false);
    f.click('#backup-live'); await f.flushFiles(); f.click('#file-download');
    const restored = await parsePortableSave(await f.blobs.at(-1).text());
    assert.equal(restored.ok, true); assert.deepEqual(restored.file.payload.state, before);
    assert.notEqual(restored.file.payload.saveId, oldEnvelope.saveId, 'unsaved recovery snapshot has its own identity');
    assert.equal(restored.file.payload.revision, 1);
    f.click('#file-download');
    const repeatedRecovery = await parsePortableSave(await f.blobs.at(-1).text());
    assert.equal(repeatedRecovery.file.payload.saveId, restored.file.payload.saveId, 'repeated download retains prepared recovery identity');
    f.click('#backup-original');
    assert.equal(await f.blobs.at(-1).text(), raw, 'original backup preserves the exact durable source bytes');
  } finally { f.dispose(); }
});

test('TC-3D-021 cancel, back, close, Escape and native close clear an active review and preserve the current shop', async () => {
  const incoming = await portableFixture();
  for (const action of ['cancel', 'back', 'close', 'escape', 'native-close']) {
    const f = fixture({ now: 130000 });
    try {
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      await reviewPortable(f, incoming);
      f.tick(3);
      if (action === 'cancel') f.click('#file-cancel');
      if (action === 'back') f.click('#file-back');
      if (action === 'close') f.click('#dialog-close');
      if (action === 'escape') { const event = f.element('#operation-dialog').emit('cancel'); if (!event.prevented) f.element('#operation-dialog').close(); }
      if (action === 'native-close') f.element('#operation-dialog').close();
      assert.equal(f.element('#file-review').hidden, true, action);
      assert.deepEqual(f.state(), before, action);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, action);
      f.click('#file-confirm');
      assert.equal(portableWrites(f).length, 0, `${action} makes the old confirm inert`);
      f.tick(.1); assert.ok(f.state().elapsed > before.elapsed && f.state().elapsed < before.elapsed + .2, action);
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 late file parsing cannot reopen or replace after cancel, back, close, Escape, hide, storage change or disposal', async () => {
  const incoming = await portableFixture();
  for (const action of ['cancel', 'back', 'close', 'escape', 'hide', 'storage', 'dispose']) {
    const parsed = deferredFileOperation(), release = deferredFileOperation();
    const f = fixture({ now: 130000, portableOverrides: { parsePortableSave: async text => { const result = await parsePortableSave(text); parsed.resolve(); await release.promise; return result; } } });
    try {
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      openFilePanel(f); f.chooseFile({ text: incoming.text }); await parsed.promise;
      if (action === 'cancel') f.click('#file-cancel');
      if (action === 'back') f.click('#file-back');
      if (action === 'close') f.click('#dialog-close');
      if (action === 'escape') { const event = f.element('#operation-dialog').emit('cancel'); if (!event.prevented) f.element('#operation-dialog').close(); }
      if (action === 'hide') { f.document.hidden = true; f.document.emit('visibilitychange'); }
      if (action === 'storage') { f.memory.setItem(SAVE_KEY, 'foreign update'); f.window.emit('storage', { key: SAVE_KEY, newValue: 'foreign update' }); }
      if (action === 'dispose') f.dispose();
      const bytesAfterAction = f.memory.getItem(SAVE_KEY), writesAfterAction = f.storageWrites.length;
      release.resolve(); await f.flushFiles();
      assert.equal(f.element('#file-review').hidden, true, action);
      assert.equal(f.memory.getItem(SAVE_KEY), bytesAfterAction, `${action}: late parsing cannot write`);
      assert.equal(f.storageWrites.length, writesAfterAction, action);
      assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(before), `${action}: late parsing cannot replace the current game`);
      assert.equal(importBackupWrites(f).length, 0, action);
      if (!['hide', 'storage', 'dispose'].includes(action)) assert.equal(bytesAfterAction, raw, action);
    } finally { release.resolve(); await f.flushFiles(); f.dispose(); }
  }
});

test('TC-3D-021 newer file selection wins even when an older valid parse resolves last', async () => {
  const older = await portableFixture({ seconds: 90, saveId: 'older-file' });
  const newer = await portableFixture({ seconds: 180, saveId: 'newer-file' });
  const parsed = deferredFileOperation(), release = deferredFileOperation();
  const f = fixture({ now: 130000, portableOverrides: { parsePortableSave: async text => { const result = await parsePortableSave(text); if (text === older.text) { parsed.resolve(); await release.promise; } return result; } } });
  try {
    openFilePanel(f); f.chooseFile({ text: older.text }); await parsed.promise;
    f.chooseFile({ text: newer.text });
    await f.untilFile(() => !f.element('#file-review').hidden);
    const summary = f.element('#file-incoming-summary').textContent;
    release.resolve(); await f.flushFiles();
    assert.equal(f.element('#file-incoming-summary').textContent, summary, 'old completion cannot replace the latest preview');
    confirmPortable(f);
    assert.deepEqual(f.state(), newer.payload.state);
    assert.equal(portableWrites(f).length, 1);
  } finally { release.resolve(); await f.flushFiles(); f.dispose(); }
});


test('TC-3D-021 oversized, malformed, unsupported and read-failing files never become a writable review', async () => {
  const good = await portableFixture();
  const future = JSON.parse(good.text); future.formatVersion = 999;
  const wrongSchema = JSON.parse(good.text), payload = JSON.parse(wrongSchema.payloadText);
  payload.gameSchemaVersion = 99; wrongSchema.payloadText = JSON.stringify(payload);
  wrongSchema.integrity.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wrongSchema.payloadText)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const cases = [
    { name: 'too-large.json', size: MAX_PORTABLE_BYTES + 1, text() { assert.fail('size guard must reject before calling File.text'); } },
    { name: 'lying-size.json', size: 1, text: ' '.repeat(MAX_PORTABLE_BYTES + 1) },
    { name: 'broken.json', text: '{ broken JSON' },
    { name: 'raw-recovery.json', text: JSON.stringify({ schemaVersion: 1, state: good.payload.state }) },
    { name: 'future.json', text: JSON.stringify(future) },
    { name: 'future-game.json', text: JSON.stringify(wrongSchema) },
    { name: 'unreadable.json', size: 1, text: () => Promise.reject(Error('simulated file read denial')) },
  ];
  for (const file of cases) {
    const f = fixture({ now: 130000 });
    try {
      const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
      openFilePanel(f); f.chooseFile(file); await f.flushFiles();
      assert.equal(f.element('#file-review').hidden, true, file.name);
      f.click('#file-confirm');
      assert.deepEqual(f.state(), before, file.name);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, file.name);
      assert.equal(f.storageWrites.length, 0, file.name);
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 choosing no file or an invalid replacement discards an older ready review', async () => {
  const incoming = await portableFixture();
  for (const replacement of [null, { text: 'not a portable file' }]) {
    const f = fixture({ now: 130000 });
    try {
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      await reviewPortable(f, incoming);
      f.chooseFile(replacement); await f.flushFiles();
      assert.equal(f.element('#file-review').hidden, true);
      confirmPortable(f);
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      assert.deepEqual(f.state(), before);
      assert.equal(portableWrites(f).length, 0);
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 preparing a portable export includes the visible pre-RAF tail and downloads verified unique files', async () => {
  const initial = createEngine(); initial.advance(22);
  const f = fixture({ initial: initial.snapshot(), now: 130000 });
  try {
    openFilePanel(f);
    f.clock.now += 375; f.clock.performance += 375;
    f.click('#file-prepare'); await f.flushFiles();
    const expected = createEngine(initial.snapshot()); expected.advance(.375);
    assert.deepEqual(f.state(), expected.snapshot(), 'prepare settles the real foreground tail before taking the export snapshot');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, expected.snapshot());
    assert.equal(f.element('#file-download').disabled, false);
    f.click('#file-download'); f.click('#file-download');
    assert.equal(f.downloads.length, 2);
    const first = await parsePortableSave(await f.blobs[0].text());
    assert.equal(first.ok, true);
    assert.deepEqual(first.file.payload.state, expected.snapshot());
    assert.equal(first.file.payload.savedAt, f.clock.now);
    assert.equal(first.file.payload.exportedAt, f.clock.now);
    assert.notEqual(f.downloads[0].download, f.downloads[1].download, 'manual downloads cannot silently reuse a stale filename');
    assert.match(f.downloads[0].download, /^mellow-bean-.*\.json$/);
    assert.equal(f.blobs[0].type, 'application/json');
  } finally { f.dispose(); }
});

test('TC-3D-021 share uses verified files, falls back when unsupported, and never downloads after user cancellation', async () => {
  for (const mode of ['supported', 'unsupported', 'missing', 'aborted', 'failed']) {
    const shares = [], checks = [];
    const navigator = mode === 'missing' ? {} : {
      canShare: data => { checks.push(data); return mode !== 'unsupported'; },
      async share(data) { shares.push(data); if (mode === 'aborted') throw new DOMException('user canceled sharing', 'AbortError'); if (mode === 'failed') throw new Error('share unavailable'); },
    };
    const f = fixture({ now: 130000, navigator });
    try {
      openFilePanel(f); f.click('#file-prepare'); await f.flushFiles();
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      f.click('#file-share'); await f.flushFiles();
      const supported = ['supported', 'aborted', 'failed'].includes(mode);
      assert.equal(shares.length, supported ? 1 : 0, mode);
      assert.equal(f.downloads.length, ['unsupported', 'missing'].includes(mode) ? 1 : 0, mode);
      if (mode === 'failed') { assert.match(f.element('#file-status').textContent, /下载/); f.click('#file-download'); assert.equal(f.downloads.length, 1, 'share failure offers an explicit download retry'); }
      if (supported) {
        assert.equal(shares[0].files.length, 1); assert.ok(shares[0].files[0] instanceof File);
        const shared = await parsePortableSave(await shares[0].files[0].text());
        assert.equal(shared.ok, true); assert.deepEqual(shared.file.payload.state, before);
        assert.ok(checks.length > 0, 'canShare is checked before native share');
      }
      assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), raw);
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 import backup failure or a silent storage race preserves current state without replacing foreign bytes', async () => {
  const incoming = await portableFixture();
  for (const mode of ['backup-failure', 'silent-conflict']) {
    const f = fixture({ now: 130000 });
    try {
      const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
      await reviewPortable(f, incoming);
      if (mode === 'backup-failure') f.storageControl.writeUnavailable = true;
      else f.memory.setItem(SAVE_KEY, 'new foreign bytes without a delivered storage event');
      confirmPortable(f);
      assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(before));
      assert.equal(f.memory.getItem(SAVE_KEY), mode === 'backup-failure' ? raw : 'new foreign bytes without a delivered storage event');
      assert.equal(portableWrites(f).length, 0);
      f.storageControl.writeUnavailable = false;
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 corrupt and unreadable startup cannot export placeholder portable progress; corrupt original bytes remain recoverable', async () => {
  const incoming = await portableFixture();
  for (const mode of ['corrupt', 'unreadable']) {
    const raw = '{ exact corrupt startup bytes\n';
    const f = fixture({ now: 130000, ...(mode === 'corrupt' ? { raw } : { readUnavailable: true }) });
    try {
      const before = f.state(), durable = f.memory.getItem(SAVE_KEY);
      openFilePanel(f); f.click('#file-prepare'); await f.flushFiles(); f.click('#file-download');
      assert.equal(f.downloads.length, 0, mode);
      assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), durable);
      if (mode === 'corrupt') {
        f.click('#file-back'); f.click('#export'); assert.equal(await f.blobs.at(-1).text(), raw);
        await reviewPortable(f, incoming); confirmPortable(f);
        assert.deepEqual(f.state(), incoming.payload.state);
        f.click('#backup-live'); await f.flushFiles();
        assert.equal(f.element('#file-download').disabled, true, 'no invented live backup for corrupt startup placeholder');
        f.click('#backup-original'); assert.equal(await f.blobs.at(-1).text(), raw);
        assert.equal(JSON.parse(importBackupWrites(f)[0].value).liveState, null);
      }
    } finally { f.dispose(); }
  }
});


test('TC-3D-021 pending File.text reads cannot revive a preview after close, hide, replacement selection or disposal', async () => {
  const incoming = await portableFixture();
  for (const action of ['close', 'hide', 'new-file', 'dispose']) {
    const started = deferredFileOperation(), release = deferredFileOperation();
    const f = fixture({ now: 130000 });
    try {
      openFilePanel(f); f.chooseFile({ size: incoming.text.length, text: () => { started.resolve(); return release.promise; } });
      await started.promise;
      if (action === 'close') f.click('#dialog-close');
      if (action === 'hide') { f.document.hidden = true; f.document.emit('visibilitychange'); }
      if (action === 'new-file') { f.chooseFile({ text: 'invalid newer choice' }); await f.untilFile(() => /未改变|不是|无法/.test(f.element('#file-status').textContent)); }
      if (action === 'dispose') f.dispose();
      const raw = f.memory.getItem(SAVE_KEY), before = f.state(), writes = f.storageWrites.length;
      release.resolve(incoming.text); await f.flushFiles();
      assert.equal(f.element('#file-review').hidden, true, action);
      assert.deepEqual(f.state(), before, action);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, action);
      assert.equal(f.storageWrites.length, writes, action);
      assert.equal(importBackupWrites(f).length, 0, action);
    } finally { release.resolve(incoming.text); await f.flushFiles(); f.dispose(); }
  }
});

test('TC-3D-021 active review is invalidated by storage, visibility and disposal with no review-dwell earnings', async () => {
  const incoming = await portableFixture();
  for (const action of ['storage', 'hide', 'dispose']) {
    const f = fixture({ now: 130000 });
    try {
      await reviewPortable(f, incoming);
      const before = f.state();
      f.tick(12);
      if (action === 'storage') { f.memory.setItem(SAVE_KEY, 'new foreign source'); f.window.emit('storage', { key: SAVE_KEY, newValue: 'new foreign source' }); }
      if (action === 'hide') { f.document.hidden = true; f.document.emit('visibilitychange'); }
      if (action === 'dispose') f.dispose();
      assert.equal(f.element('#file-review').hidden, true, action);
      assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(before), action);
      assert.equal(importBackupWrites(f).length, 0, action);
      if (action === 'storage') {
        f.click('#file-confirm'); assert.equal(f.memory.getItem(SAVE_KEY), 'new foreign source'); assertProtected(f);
      } else {
        const saved = JSON.parse(f.memory.getItem(SAVE_KEY));
        assert.deepEqual(saved.state, before, `${action}: no review pause bit or dwell progress leaks into the saved state`);
        assert.equal(saved.savedAt, f.clock.now);
      }
      if (action === 'hide') {
        f.clock.now += 1000; f.clock.performance += 1000;
        f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
        const expected = createEngine(before); expected.applyOffline(1, f.state().lastOfflineClaimId);
        assert.deepEqual(f.state(), expected.snapshot(), 'resume credits only the hidden second at80%, never the12-second review');
      }
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 asynchronous export generation is discarded after navigation, hide, storage, another file or disposal', async () => {
  const incoming = await portableFixture();
  for (const action of ['back', 'close', 'escape', 'hide', 'storage', 'new-file', 'dispose']) {
    const started = deferredFileOperation(), release = deferredFileOperation();
    const f = fixture({ now: 130000, portableOverrides: { createPortableSave: async payload => { const result = await createPortableSave(payload); started.resolve(); await release.promise; return result; } } });
    try {
      openFilePanel(f); f.click('#file-prepare'); await started.promise;
      if (action === 'back') f.click('#file-back');
      if (action === 'close') f.click('#dialog-close');
      if (action === 'escape') { const event = f.element('#operation-dialog').emit('cancel'); if (!event.prevented) f.element('#operation-dialog').close(); }
      if (action === 'hide') { f.document.hidden = true; f.document.emit('visibilitychange'); }
      if (action === 'storage') { f.memory.setItem(SAVE_KEY, 'new export-time foreign source'); f.window.emit('storage', { key: SAVE_KEY, newValue: 'new export-time foreign source' }); }
      if (action === 'new-file') { f.chooseFile({ text: incoming.text }); await f.untilFile(() => !f.element('#file-review').hidden); }
      if (action === 'dispose') f.dispose();
      const raw = f.memory.getItem(SAVE_KEY), state = f.state(), status = f.element('#file-status').textContent, writes = f.storageWrites.length;
      release.resolve(); await f.flushFiles();
      assert.equal(f.element('#file-download').disabled, true, action);
      assert.equal(f.element('#file-share').disabled, true, action);
      assert.equal(f.element('#file-export-summary').textContent, '', action);
      assert.equal(f.element('#file-status').textContent, status, `${action}: stale success does not overwrite the current message`);
      assert.equal(f.memory.getItem(SAVE_KEY), raw, action);
      assert.deepEqual(f.state(), state, action);
      assert.equal(f.storageWrites.length, writes, action);
      assert.equal(f.downloads.length, 0, action);
    } finally { release.resolve(); await f.flushFiles(); f.dispose(); }
  }
});

test('TC-3D-021 generation captures one saved snapshot while live play continues, and repeated prepare stays single-flight', async () => {
  const started = deferredFileOperation(), release = deferredFileOperation();
  let generations = 0;
  const f = fixture({ now: 130000, portableOverrides: { createPortableSave: async payload => { generations++; const result = await createPortableSave(payload); started.resolve(); await release.promise; return result; } } });
  try {
    openFilePanel(f); f.click('#file-prepare'); await started.promise;
    const preparedState = f.state(), durable = f.memory.getItem(SAVE_KEY);
    f.click('#file-prepare'); f.click('#file-share'); f.click('#file-download');
    assert.equal(generations, 1); assert.equal(f.downloads.length, 0);
    f.tick(.2); assert.ok(f.state().elapsed > preparedState.elapsed, 'hashing an export does not freeze the game');
    release.resolve(); await f.flushFiles(); f.click('#file-download');
    const decoded = await parsePortableSave(await f.blobs.at(-1).text());
    assert.equal(decoded.ok, true); assert.deepEqual(decoded.file.payload.state, preparedState);
    assert.equal(f.memory.getItem(SAVE_KEY), durable, 'finishing generation cannot write a new anchor');
    assert.equal(portableWrites(f).length, 1);
  } finally { release.resolve(); await f.flushFiles(); f.dispose(); }
});

test('TC-3D-021 failed durable save cannot prepare a portable current-progress file', async () => {
  for (const mode of ['write', 'read', 'silent-conflict']) {
    const f = fixture({ now: 130000 });
    try {
      openFilePanel(f);
      f.tick(.1);
      const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
      if (mode === 'write') f.storageControl.writeUnavailable = true;
      if (mode === 'read') f.storageControl.readUnavailable = true;
      if (mode === 'silent-conflict') f.memory.setItem(SAVE_KEY, 'new durable bytes');
      f.click('#file-prepare'); await f.flushFiles(); f.click('#file-download');
      assert.equal(f.downloads.length, 0, mode); assert.equal(f.element('#file-download').disabled, true, mode);
      assert.match(f.element('#file-status').textContent, /尚未安全保存|恢复/, mode);
      assert.deepEqual(omitOfflineClaims(f.state()), omitOfflineClaims(before), mode);
      assert.equal(f.memory.getItem(SAVE_KEY), mode === 'silent-conflict' ? 'new durable bytes' : raw, mode);
      assert.equal(portableWrites(f).length, 0, mode);
      f.storageControl.writeUnavailable = false; f.storageControl.readUnavailable = false;
    } finally { f.dispose(); }
  }
});

test('TC-3D-021 a repeated previously imported file warns before an explicit replacement and earns no extra offline credit', async () => {
  const incoming = await portableFixture();
  const f = fixture({ now: 130000 });
  try {
    await reviewPortable(f, incoming);
    assert.equal(f.element('#file-repeat-warning').hidden, true);
    confirmPortable(f);
    f.tick(.2); const progressed = f.state();
    assert.ok(progressed.elapsed > incoming.payload.state.elapsed);
    f.chooseFile({ text: incoming.text }); await f.flushFiles();
    assert.equal(f.element('#file-repeat-warning').hidden, false);
    assert.deepEqual(f.state(), progressed, 'warning does not perform the repeat import');
    assert.equal(f.element('#file-confirm').disabled, true, 'acknowledgement never carries across imports');
    confirmPortable(f);
    assert.deepEqual(f.state(), incoming.payload.state, 'explicit repeated import returns to the file snapshot without rewards');
    assert.equal(portableWrites(f).length, 2);
    assert.equal(importBackupWrites(f).length, 2);
    assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).revision, 1);
  } finally { f.dispose(); }
});

// TC-3D-022 checks the player-facing panel redesign against actual templates,
// styles and event handlers. Native file dialogs, screen-reader traversal,
// touch hit-testing and responsive pixels still require independent browser QA.
const detailsBlocks = [...modal.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(match => match[0]);
const withoutDetails = markup => markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
const centsLabel = cents => `¥${(cents / 100).toFixed(2)}`;

test('TC-3D-022 panel controls keep unique accessible IDs and an enabled styled native file picker (static contract)', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'the redesign must not duplicate control, heading or description IDs');
  for (const match of html.matchAll(/\b(?:aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(ids.includes(id), `accessible-name/description target ${id} exists`);
  }
  for (const match of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(ids.includes(match[1]), `label target ${match[1]} exists`);
  assert.match(modal, /<dialog\b[^>]*aria-labelledby="dialog-title"/);
  assert.match(modal, /<label\b[^>]*for="file-input"[^>]*>[\s\S]*?选择存档文件[\s\S]*?<input\b[^>]*id="file-input"/);
  const picker = openingTags(modal, 'input').find(tag => /id="file-input"/.test(tag));
  assert.match(picker, /type="file"/); assert.match(picker, /accept="application\/json,\.json"/);
  assert.doesNotMatch(picker, /\s(?:disabled|hidden|aria-hidden|tabindex)(?:[\s=>])/);
  assert.match(picker, /aria-describedby="file-picker-note file-selection"/);
  assert.deepEqual(declarations('.file-picker input', 'display'), ['block']);
  assert.ok(declarations('.file-picker input', 'min-height').some(value => Number.parseFloat(value) >= 44));
  assert.equal(declarations('.file-picker input', 'opacity').includes('0'), false);
  for (const selector of ['.file-picker input::file-selector-button', '.file-picker input::-webkit-file-upload-button']) {
    assert.ok(rules(selector).length > 0, `${selector} styles the real browser button`);
    assert.ok(declarations(selector, 'background').length > 0);
    assert.ok(declarations(selector, 'min-height').some(value => Number.parseFloat(value) > 0));
  }
  assert.ok(declarations('input:focus-visible', 'outline').length > 0);
  assert.match(modal, /id="file-review"[^>]*tabindex="-1"[^>]*role="region"[^>]*aria-label="导入存档预览"/);
  assert.match(modal, /<label\b[^>]*class="file-confirm-label"[^>]*>\s*<input\b[^>]*id="file-other-tabs"[^>]*>[\s\S]*?已关闭其他游戏标签页和窗口[\s\S]*?<\/label>/);
});

test('TC-3D-022 technical metadata and full ledger are closed disclosures while replacement safeguards remain visible (static contract)', () => {
  assert.equal(detailsBlocks.length, 5, 'graphics, counter management and file detail disclosures remain');
  for (const block of detailsBlocks) {
    const tag = openingTags(block, 'details')[0];
    assert.doesNotMatch(tag, /\s(?:open|aria-hidden)(?:[\s=>])/);
    assert.match(block, /^<details\b[^>]*>\s*<summary>[\s\S]+?<\/summary>/, 'every disclosure has a native named summary');
  }
  for (const id of ['file-current-details', 'file-incoming-details']) {
    const disclosure = detailsBlocks.find(block => block.includes(`id="${id}"`));
    assert.ok(disclosure, `${id} stays available inside a default-closed disclosure`);
    assert.doesNotMatch(withoutDetails(modal), new RegExp(`id="${id}"`));
  }
  const fileMarkup = modal.slice(modal.indexOf('<div id="files-panel"'), modal.indexOf('<div id="offline-panel"'));
  const confirmation = withoutDetails(fileMarkup.slice(fileMarkup.indexOf('<div id="file-review"')));
  for (const safety of [/当前小店将被完整替换/, /较早进度会回退/, /金币不合并/, /文件导出至本次导入之间不补离线收益/, /替换前会先校验本地备份/, /备份失败就停止/, /已关闭其他游戏标签页和窗口/, /多窗口同时写入可能造成冲突/]) assert.match(confirmation, safety, 'essential confirmation text cannot be hidden in details');
  for (const id of ['file-current-summary', 'file-incoming-summary', 'file-older-warning', 'file-repeat-warning', 'file-confirm', 'file-cancel']) assert.match(confirmation, new RegExp(`id="${id}"`));
  const offlineMarkup = modal.slice(modal.indexOf('<div id="offline-result"'));
  assert.match(offlineMarkup, /本次到账/); assert.match(offlineMarkup, /已计入当前金额/); assert.match(offlineMarkup, /回到小店/);
  assert.doesNotMatch(offlineMarkup, /offline-(?:generated|pending|legacy)|有效经营|期间售出|台面待收|经理运送|50%|SHA-256/);
});

test('TC-3D-022 selected render mode stays visually and accessibly selected across panel navigation without changing the shop', () => {
  for (const mode of ['smooth', 'clear-60', 'balanced', 'low-power']) {
    const f = fixture({ renderMode: mode });
    try {
      const raw = f.memory.getItem(SAVE_KEY), before = f.state();
      f.click('#settings'); openFilePanel(f); f.click('#file-back'); f.click('#dialog-close');
      f.click('#dock-background'); f.click('#dialog-close'); f.click('#settings');
      for (const button of f.nodes.filter(node => node.dataset.renderMode)) {
        const selected = button.dataset.renderMode === mode;
        assert.equal(button.classList.contains('active'), selected, `${mode}: visible selection`);
        assert.equal(button.getAttribute('aria-pressed'), String(selected), `${mode}: accessible selection`);
      }
      assert.equal(f.renderer.renderMode, mode);
      assert.equal(f.memory.getItem(RENDER_MODE_KEY), mode);
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      assert.deepEqual(f.state(), before);
    } finally { f.dispose(); }
  }
});

test('TC-3D-022 file preview names and focuses the chosen file, permits cancel/reselection, and requires renewed overwrite acknowledgement', async () => {
  const incoming = await portableFixture();
  const f = fixture({ now: 130000 });
  try {
    const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
    openFilePanel(f);
    assert.equal(f.element('#file-input').disabled, false);
    const name = '<my saved shop>.json';
    f.chooseFile({ name, text: incoming.text });
    assert.equal(f.element('#file-input').disabled, false, 'the native picker remains available while a previous read is pending');
    await f.flushFiles();
    assert.equal(f.element('#file-input').value, '', 'the native value is cleared so choosing the same file can fire change again');
    assert.equal(f.element('#file-input').disabled, false, 'a ready review does not block choosing another file');
    assert.equal(f.element('#file-selection').hidden, false);
    assert.equal(f.element('#file-selection').textContent, `正在预览：${name}`, 'untrusted filenames are plain text');
    assert.equal(f.document.activeElement, f.element('#file-review'), 'focus moves to the review rather than to an unavailable disabled confirmation button');
    assert.equal(f.element('#file-confirm').disabled, true);
    f.element('#file-other-tabs').checked = true; f.element('#file-other-tabs').emit('change');
    assert.equal(f.element('#file-confirm').disabled, false);
    f.click('#file-cancel');
    assert.equal(f.element('#file-review').hidden, true);
    assert.equal(f.element('#file-selection').hidden, true);
    assert.equal(f.element('#file-other-tabs').checked, false);
    assert.equal(f.element('#file-confirm').disabled, true);
    assert.equal(f.document.activeElement, f.element('#file-input'), 'explicit cancel returns focus to the visible native picker');
    assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.equal(importBackupWrites(f).length, 0);
    f.chooseFile({ name, text: incoming.text }); await f.flushFiles();
    assert.equal(f.element('#file-review').hidden, false);
    assert.equal(f.element('#file-confirm').disabled, true, 'previous acknowledgement cannot approve a newly selected file');
    f.element('#file-confirm').emit('click');
    assert.equal(portableWrites(f).length, 0, 'the actual handler independently guards unacknowledged overwrite');
    confirmPortable(f);
    assert.equal(portableWrites(f).length, 1); assert.equal(importBackupWrites(f).length, 1);
    assert.deepEqual(f.state(), incoming.payload.state, 'explicit replacement uses exactly the chosen snapshot');
    assert.equal(f.element('#file-selection').hidden, true);
    assert.equal(f.document.activeElement, f.element('#file-input'), 'successful replacement cannot leave focus inside the now-hidden review');
  } finally { f.dispose(); }
});

test('TC-3D-022 an older file warns before replacement, equal/newer files clear that warning, and summaries retain hidden metadata', async () => {
  const now = 130000;
  const initial = createEngine(); initial.advance(45);
  const f = fixture({ initial: initial.snapshot(), now });
  try {
    const current = f.state(), raw = f.memory.getItem(SAVE_KEY), durable = JSON.parse(raw);
    for (const savedAt of [now - 1, now, now + 1, now - 5000]) {
      const incoming = await portableFixture({ savedAt, exportedAt: now + 1000, saveId: `source-${savedAt}`, revision: 27 });
      openFilePanel(f); f.chooseFile({ name: `${savedAt}.json`, text: incoming.text }); await f.flushFiles();
      assert.equal(f.element('#file-older-warning').hidden, savedAt >= now, `warning follows file save time ${savedAt} versus durable time ${now}`);
      assert.equal(f.element('#file-confirm').disabled, true, 'a warning or reselect never authorizes replacement');
      const currentSummary = f.element('#file-current-summary').textContent;
      const incomingSummary = f.element('#file-incoming-summary').textContent;
      assert.ok(currentSummary.includes(centsLabel(current.wallet)));
      assert.ok(incomingSummary.includes(centsLabel(incoming.payload.state.wallet)));
      for (const summary of [currentSummary, incomingSummary]) assert.doesNotMatch(summary, /SHA-256|营业额|待收|运送|当前未存盘| · r\d+/);
      assert.equal(currentSummary.includes(durable.saveId), false);
      assert.equal(incomingSummary.includes(incoming.payload.saveId), false);
      assert.equal(incomingSummary.includes(incoming.fingerprint), false);
      const currentDetails = f.element('#file-current-details').textContent;
      const incomingDetails = f.element('#file-incoming-details').textContent;
      assert.ok(currentDetails.includes(durable.saveId)); assert.ok(currentDetails.includes(`r${durable.revision}`));
      assert.match(currentDetails, /营业额.*已售/); assert.match(currentDetails, /营业中.*经营/);
      assert.ok(incomingDetails.includes(incoming.payload.saveId)); assert.ok(incomingDetails.includes('r27'));
      assert.ok(incomingDetails.includes(`SHA-256 ${incoming.fingerprint}`));
      assert.match(incomingDetails, /导出/); assert.match(incomingDetails, /营业额.*已售/); assert.match(incomingDetails, /营业中.*经营/);
      assert.deepEqual(f.state(), current); assert.equal(f.memory.getItem(SAVE_KEY), raw);
    }
    f.click('#file-cancel');
    assert.equal(portableWrites(f).length, 0); assert.equal(importBackupWrites(f).length, 0);
  } finally { f.dispose(); }
});

test('TC-3D-024 blocked save recovery is contextual in 小店存档 and retains frozen assets and recovery controls', async () => {
  for (const cause of ['corrupt', 'unreadable', 'storage-conflict', 'cancel-offline']) {
    const f = fixture({ now: 130000, ...(cause === 'corrupt' ? { raw: '{invalid save' } : cause === 'unreadable' ? { readUnavailable: true } : cause === 'cancel-offline' ? { savedAtAgoSeconds: 60 } : {}) });
    try {
      if (cause === 'storage-conflict') {
        f.click('#settings');
        assert.equal(f.element('#save-recovery').hidden, true, 'healthy saves hide contextual recovery');
        f.memory.setItem(SAVE_KEY, 'other-window-save');
        f.window.emit('storage', { key: SAVE_KEY, newValue: 'other-window-save' });
      }
      if (cause === 'cancel-offline') { f.click('#offline-cancel'); await f.flushOffline(); }
      openFilePanel(f);
      assert.equal(isVisible(f, '#save-recovery'), true);
      assert.equal(f.element('#save-recovery').hidden, false, `${cause}: recovery is not left hidden`);
      assert.equal(f.element('#reload').hidden, false, cause);
      assert.equal(f.element('#save-status').textContent.length > 0, true, cause);
      const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
      assertProtected(f);
      f.click('#save'); f.tick(.1); f.action({ type: 'invite' });
      assert.deepEqual(f.state(), before, cause); assert.equal(f.memory.getItem(SAVE_KEY), raw, cause);
    } finally { f.dispose(); }
  }
});

test('TC-3D-024 a normal file-panel save failure exposes backup recovery immediately without replacing durable bytes', async () => {
  const f = fixture();
  try {
    openFilePanel(f);
    assert.equal(f.element('#save-recovery').hidden, true);
    const raw = f.memory.getItem(SAVE_KEY);
    f.tick(.25);
    const live = f.state();
    assert.notDeepEqual(live, JSON.parse(raw).state, 'there is real unsaved progress to protect');
    f.storageControl.writeUnavailable = true;
    f.click('#save');
    assert.equal(f.element('#files-panel').hidden, false);
    assert.equal(isVisible(f, '#save-recovery'), true);
    assert.equal(f.element('#save-recovery').hidden, false, 'ordinary write/quota failure immediately reveals backups in the file panel');
    assert.match(f.element('#save-status').textContent, /保存失败.*导出备份/);
    assert.equal(f.memory.getItem(SAVE_KEY), raw);
    assert.deepEqual(f.state(), live);
    assert.equal(f.element('#export').disabled, false);
    f.click('#export');
    assert.equal(f.downloads.length, 1);
    assert.deepEqual(JSON.parse(await f.blobs[0].text()).state, live, 'the revealed backup action exports the actual live progress');
    f.storageControl.writeUnavailable = false;
    f.click('#save');
    assert.equal(f.element('#save-status').textContent, '本地已保存');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, live);
  } finally { f.dispose(); }
});

test('TC-3D-022 offline reward reports exact direct wallet credit and zero while paused', async () => {
  for (const paused of [false, true]) {
    const initial = createInitialState(); initial.paused = paused;
    const f = fixture({ initial, now: 130000, savedAtAgoSeconds: 30.999 });
    try {
      await f.flushOffline({ dismissResult: false });
      const after = f.state(), credited = after.wallet - initial.wallet;
      assert.equal(credited, after.totalEarned - initial.totalEarned);
      if (paused) assert.equal(credited, 0); else assert.ok(credited > 0);
      assert.ok(after.counters.every(counter => counter.pendingCash === 0)); assert.equal(after.manager.carrying, 0);
      assert.deepEqual(after, JSON.parse(f.memory.getItem(SAVE_KEY)).state);
      if (paused) {
        assert.equal(f.element('#operation-dialog').open, false, 'a closed shop has no earnings reward to announce');
        assert.equal(f.element('#business-status').textContent, '已暂停营业');
      } else {
        assert.equal(f.element('#offline-deposited').textContent, centsLabel(credited));
        assert.equal(f.element('#offline-duration').textContent, '离开了 30 秒');
      }
      const bytes = f.memory.getItem(SAVE_KEY);
      f.click('#offline-done'); f.click('#offline-done');
      assert.equal(f.element('#operation-dialog').open, false); assert.deepEqual(f.state(), after); assert.equal(f.memory.getItem(SAVE_KEY), bytes);
      assert.equal(f.state().paused, paused, 'dismissing a reward never changes the business pause');
    } finally { f.dispose(); }
  }
});

test('TC-3D-022 human away duration floors seconds without changing exact settlement or minute boundaries', async () => {
  for (const [seconds, label] of [[59.999, '离开了 59 秒'], [60, '离开了 1 分钟'], [61.999, '离开了 1 分钟 1 秒']]) {
    const f = fixture({ now: 500000, savedAtAgoSeconds: seconds });
    try {
      await f.flushOffline({ dismissResult: false });
      assert.equal(f.element('#offline-duration').textContent, label);
      const expected = createEngine(); expected.applyOffline(seconds, f.state().lastOfflineClaimId);
      assert.deepEqual(f.state(), expected.snapshot(), 'presentation flooring never changes simulation time');
    } finally { f.dispose(); }
  }
});

test('TC-3D-022 counter upgrades show real cost and before/after benefits while retaining insufficient-funds and capped behavior', () => {
  for (const id of ['counter-a', 'counter-b']) {
    const f = fixture();
    try {
      f.action({ type: 'counter', id });
      const before = f.state(), expected = createEngine(before), quote = expected.quote(id);
      assert.ok(quote.afterPrice > quote.beforePrice); assert.ok(quote.afterSeconds < quote.beforeSeconds);
      assert.equal(f.element('#counter-price').textContent, centsLabel(quote.beforePrice));
      assert.equal(f.element('#counter-seconds').textContent, `${quote.beforeSeconds.toFixed(2)} 秒`);
      assert.equal(f.element('#counter-next-price').textContent, `→ ${centsLabel(quote.afterPrice)}`);
      assert.equal(f.element('#counter-next-seconds').textContent, `→ ${quote.afterSeconds.toFixed(2)} 秒`);
      assert.equal(f.element('#counter-upgrade').textContent, `升级柜台 · ${centsLabel(quote.cost)}`);
      assert.equal(f.element('#counter-upgrade').disabled, false);
      assert.equal(f.element('#counter-funds').textContent, '');
      f.click('#counter-upgrade'); assert.equal(expected.upgrade(id), true);
      assert.deepEqual(f.state(), expected.snapshot());
      assert.equal(before.wallet - f.state().wallet, quote.cost);
      assert.equal(f.state().spend - before.spend, quote.cost);
      const next = expected.quote(id);
      assert.equal(f.element('#counter-upgrade').disabled, true);
      assert.equal(f.element('#counter-funds').textContent, `还差 ${centsLabel(next.cost - f.state().wallet)}`);
      const insufficient = f.state();
      f.click('#counter-upgrade'); f.element('#counter-upgrade').emit('click');
      assert.deepEqual(f.state(), insufficient, 'disabled UI and the actual purchase handler both reject insufficient funds');
    } finally { f.dispose(); }
    const capped = createInitialState(); capped.counters.find(counter => counter.id === id).level = 20;
    const g = fixture({ initial: capped });
    try {
      g.action({ type: 'counter', id }); const before = g.state();
      assert.match(g.element('#counter-level').textContent, /20.*MAX/);
      assert.equal(g.element('#counter-next-price').textContent, '已达上限');
      assert.equal(g.element('#counter-next-seconds').textContent, '已达上限');
      assert.equal(g.element('#counter-upgrade').textContent, '已满级');
      assert.equal(g.element('#counter-upgrade').disabled, true);
      assert.equal(g.element('#counter-funds').textContent, '');
      g.click('#counter-upgrade'); g.element('#counter-upgrade').emit('click');
      assert.deepEqual(g.state(), before, 'max-level upgrades cannot charge money or increase levels');
    } finally { g.dispose(); }
  }
});

test('TC-3D-022 background selection persists cosmetically without spending and survives reload', () => {
  const f = fixture();
  try {
    const before = f.state(), bytes = f.memory.getItem(SAVE_KEY);
    assert.equal(f.renderer.backdrop, 'garden'); f.click('#dock-background');
    for (const backdrop of ['terrace', 'sunset', 'garden']) {
      const button = f.nodes.find(node => node.dataset.backdrop === backdrop);
      f.root.emit('click', { target: button });
      assert.equal(f.renderer.backdrop, backdrop); assert.equal(f.memory.getItem('mellow-bean:backdrop:v1'), backdrop);
      assert.equal(button.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), bytes);
      const reload = fixture({ backdropPreference: backdrop });
      try { assert.equal(reload.renderer.backdrop, backdrop); assert.deepEqual(reload.state(), before); }
      finally { reload.dispose(); }
    }
    f.click('#dialog-close');
    const stale = f.nodes.find(node => node.dataset.backdrop === 'sunset'); f.root.emit('click', { target: stale });
    assert.equal(f.renderer.backdrop, 'garden', 'closed-panel controls cannot change preferences');
  } finally { f.dispose(); }
  for (const backdropPreference of ['unknown', '{broken']) {
    const f = fixture({ backdropPreference }); try { assert.equal(f.renderer.backdrop, 'garden'); } finally { f.dispose(); }
  }
});

function panelMarkup(id, nextId) { return modal.slice(modal.indexOf(`id="${id}"`), modal.indexOf(`id="${nextId}"`)); }
function fundedInitial(wallet) {
  const state = createInitialState();
  state.totalEarned = Math.max(0, wallet - state.wallet);
  state.spend = Math.max(0, state.wallet - wallet);
  state.wallet = wallet;
  return state;
}

test('TC-3D-023 REQ-3D-033 recipe choice, counter upgrades and coffee upgrades have distinct controls (static contract)', () => {
  const recipe = panelMarkup('recipe-panel', 'counter-panel');
  const counter = panelMarkup('counter-panel', 'coffee-panel');
  const coffee = panelMarkup('coffee-panel', 'background-panel');
  assert.equal(openingTags(recipe, 'button').length, 2);
  assert.match(recipe, /data-select-recipe="espresso"/); assert.match(recipe, /data-select-recipe="latte"/);
  assert.match(recipe, /下一杯生效/);
  assert.doesNotMatch(recipe, /id="(?:counter|coffee)-upgrade"|data-assign/);
  assert.equal(openingTags(counter, 'button').length, 1);
  assert.match(counter, /id="counter-upgrade"/);
  assert.doesNotMatch(counter, /data-select-recipe|data-assign|id="coffee-upgrade"/);
  assert.equal(openingTags(coffee, 'button').length, 3);
  assert.match(coffee, /data-view-coffee="espresso"/); assert.match(coffee, /data-view-coffee="latte"/);
  for (const id of ['coffee-level', 'coffee-price', 'coffee-next-price', 'coffee-seconds', 'coffee-next-seconds', 'coffee-upgrade', 'coffee-funds']) assert.match(coffee, new RegExp(`id="${id}"`));
  assert.doesNotMatch(coffee, /data-select-recipe|data-assign|id="counter-upgrade"|柜台\s*[AB]/);
  assert.doesNotMatch(html, /data-assign|assign-buttons|counter-payback/);
});

test('TC-3D-023 REQ-3D-033 both counter entrances and both coffee menus open only their own read-only panel', () => {
  const initial = fundedInitial(50000);
  initial.counters[0].level = 4; initial.counters[1].level = 7;
  initial.coffeeLevels = { espresso: 3, latte: 6 };
  const f = fixture({ initial });
  try {
    for (const id of ['counter-a', 'counter-b']) {
      for (const type of ['recipe', 'counter']) {
        const before = f.state(), bytes = f.memory.getItem(SAVE_KEY);
        f.action({ type, id });
        assert.deepEqual(f.nodes.filter(node => node.classList.contains('operation-panel') && !node.hidden).map(node => node.id), [`${type}-panel`]);
        assert.match(f.element('#dialog-eyebrow').textContent, new RegExp(`柜台 ${id === 'counter-a' ? 'A' : 'B'}`));
        assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), bytes);
        if (type === 'recipe') {
          const selected = before.counters.find(counter => counter.id === id);
          for (const recipe of ['espresso', 'latte']) {
            const button = f.nodes.find(node => node.dataset.selectRecipe === recipe);
            assert.equal(button.classList.contains('active'), selected.recipe === recipe);
            assert.equal(button.getAttribute('aria-pressed'), String(selected.recipe === recipe));
            assert.equal(f.element(`#recipe-${recipe}-stats`).textContent, `${centsLabel(counterPrice(recipe, selected.level, id, before.coffeeLevels[recipe]))} · ${counterBrewSeconds(recipe, selected.level, id, before.coffeeLevels[recipe]).toFixed(2)} 秒`);
          }
        } else {
          const quote = createEngine(before).quote(id);
          assert.equal(f.element('#counter-price').textContent, centsLabel(quote.beforePrice));
          assert.equal(f.element('#counter-seconds').textContent, `${quote.beforeSeconds.toFixed(2)} 秒`);
          assert.equal(f.element('#counter-next-price').textContent, `→ ${centsLabel(quote.afterPrice)}`);
          assert.equal(f.element('#counter-next-seconds').textContent, `→ ${quote.afterSeconds.toFixed(2)} 秒`);
        }
        f.click('#dialog-close');
      }
    }
    for (const recipe of ['espresso', 'latte']) {
      const before = f.state(), bytes = f.memory.getItem(SAVE_KEY), quote = createEngine(before).coffeeQuote(recipe);
      openCoffee(f, recipe);
      assert.deepEqual(f.nodes.filter(node => node.classList.contains('operation-panel') && !node.hidden).map(node => node.id), ['coffee-panel']);
      assert.equal(f.element('#dialog-title').textContent, recipeById[recipe].name);
      assert.equal(f.element('#coffee-level').textContent, `Lv. ${quote.level} → ${quote.nextLevel}`);
      assert.equal(f.element('#coffee-price').textContent, centsLabel(coffeePrice(recipe, before.coffeeLevels[recipe])));
      assert.equal(f.element('#coffee-seconds').textContent, `${coffeeBrewSeconds(recipe, before.coffeeLevels[recipe]).toFixed(2)} 秒`);
      assert.equal(f.element('#coffee-next-price').textContent, `→ ${centsLabel(quote.afterPrice)}`);
      assert.equal(f.element('#coffee-next-seconds').textContent, `→ ${quote.afterSeconds.toFixed(2)} 秒`);
      assert.deepEqual(f.state(), before, 'viewing coffee never changes a counter recipe, level, balance or brew');
      assert.equal(f.memory.getItem(SAVE_KEY), bytes, 'viewing does not write the save');
      f.click('#dialog-close');
    }
  } finally { f.dispose(); }
});

test('TC-3D-023 REQ-3D-033 hidden and closed recipe/counter/coffee handlers cannot mutate a different panel', () => {
  const f = fixture({ initial: fundedInitial(50000) });
  try {
    for (const action of [{ type: 'recipe', id: 'counter-b' }, { type: 'counter', id: 'counter-b' }, { type: 'menu', recipe: 'latte' }, { type: 'background' }]) {
      openAction(f, action);
      const before = f.state(), bytes = f.memory.getItem(SAVE_KEY);
      if (action.type !== 'recipe') f.root.emit('click', { target: f.nodes.find(node => node.dataset.selectRecipe === 'espresso') });
      if (action.type !== 'counter') f.element('#counter-upgrade').emit('click');
      if (action.type !== 'menu') f.element('#coffee-upgrade').emit('click');
      const removedAssign = new FakeElement('button', f.document); removedAssign.setAttribute('data-assign', 'counter-a');
      f.root.emit('click', { target: removedAssign });
      assert.deepEqual(f.state(), before, `${action.type}: only this panel's own action is allowed`);
      assert.equal(f.memory.getItem(SAVE_KEY), bytes);
      f.click('#dialog-close');
      const closed = f.state();
      f.element('#counter-upgrade').emit('click'); f.element('#coffee-upgrade').emit('click');
      f.root.emit('click', { target: f.nodes.find(node => node.dataset.selectRecipe === 'espresso') });
      assert.deepEqual(f.state(), closed, 'stale controls cannot mutate a closed dialog');
    }
  } finally { f.dispose(); }
});

test('TC-3D-023 REQ-3D-033 recipe selection affects only the selected counter and leaves its current brew intact', () => {
  for (const id of ['counter-a', 'counter-b']) {
    const engine = createEngine();
    for (let i = 0; i < 1000 && !engine.state.counters.find(counter => counter.id === id).brew; i++) engine.advance(.1);
    const initial = engine.snapshot(), original = initial.counters.find(counter => counter.id === id);
    assert.ok(original.brew, 'fixture starts while this counter is brewing');
    const recipe = original.recipe === 'espresso' ? 'latte' : 'espresso';
    const f = fixture({ initial });
    try {
      f.action({ type: 'recipe', id });
      const before = f.state(), expected = createEngine(before);
      const button = f.nodes.find(node => node.dataset.selectRecipe === recipe);
      f.root.emit('click', { target: button }); assert.equal(expected.setRecipe(id, recipe), true);
      assert.deepEqual(f.state(), expected.snapshot());
      const selected = f.state().counters.find(counter => counter.id === id);
      assert.deepEqual(selected.brew, original.brew, 'price, recipe, duration and elapsed of the in-flight cup remain snapshotted');
      assert.deepEqual(f.state().counters.find(counter => counter.id !== id), before.counters.find(counter => counter.id !== id));
      assert.deepEqual(f.state().coffeeLevels, before.coffeeLevels);
      assert.equal(f.state().wallet, before.wallet); assert.equal(f.state().spend, before.spend);
      assert.equal(button.classList.contains('active'), true); assert.equal(button.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, f.state());
      const once = f.state(); f.root.emit('click', { target: button });
      assert.deepEqual(f.state(), once, 'selecting the current recipe again is idempotent');
      f.click('#dialog-close'); f.action({ type: 'recipe', id });
      assert.equal(button.getAttribute('aria-pressed'), 'true', 'reopening preserves the selected coffee');
      for (let n = 0; n < 1000 && f.state().counters.find(counter => counter.id === id).brew?.recipe !== recipe; n++) f.tick(.1);
      const nextBrew = f.state().counters.find(counter => counter.id === id).brew;
      assert.equal(nextBrew?.recipe, recipe, 'the next cup uses the newly selected coffee');
      assert.equal(nextBrew.price, counterPrice(recipe, selected.level, id, before.coffeeLevels[recipe]));
      assert.equal(nextBrew.duration, counterBrewSeconds(recipe, selected.level, id, before.coffeeLevels[recipe]));
    } finally { f.dispose(); }
  }
});

test('TC-3D-023 REQ-3D-033 coffee upgrades charge their own quote and cannot upgrade or reassign either counter', () => {
  for (const recipe of ['espresso', 'latte']) {
    const quote = createEngine().coffeeQuote(recipe), initial = fundedInitial(quote.cost);
    const f = fixture({ initial });
    try {
      // Deliberately select B first: the coffee operation must use viewedRecipe,
      // not a stale selected counter or the recipe served by that counter.
      f.action({ type: 'counter', id: 'counter-b' }); f.click('#dialog-close');
      openCoffee(f, recipe);
      const before = f.state(), expected = createEngine(before);
      assert.equal(f.element('#coffee-upgrade').textContent, `升级咖啡 · ${centsLabel(quote.cost)}`);
      assert.equal(f.element('#coffee-upgrade').disabled, false); assert.equal(f.element('#coffee-funds').textContent, '');
      f.click('#coffee-upgrade'); assert.equal(expected.upgradeCoffee(recipe), true);
      assert.deepEqual(f.state(), expected.snapshot());
      assert.deepEqual(f.state().counters, before.counters); assert.deepEqual(f.state().manager, before.manager);
      assert.equal(f.state().coffeeLevels[recipe], before.coffeeLevels[recipe] + 1);
      const other = recipe === 'espresso' ? 'latte' : 'espresso';
      assert.equal(f.state().coffeeLevels[other], before.coffeeLevels[other]);
      assert.equal(before.wallet - f.state().wallet, quote.cost); assert.equal(f.state().spend - before.spend, quote.cost);
      assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, f.state());
      const next = expected.coffeeQuote(recipe);
      assert.equal(f.element('#coffee-price').textContent, centsLabel(next.beforePrice));
      assert.equal(f.element('#coffee-seconds').textContent, `${next.beforeSeconds.toFixed(2)} 秒`);
      assert.equal(f.element('#coffee-upgrade').disabled, true);
      assert.equal(f.element('#coffee-funds').textContent, `还差 ${centsLabel(next.cost - f.state().wallet)}`);
      const once = f.state(), bytes = f.memory.getItem(SAVE_KEY);
      f.click('#coffee-upgrade'); f.element('#coffee-upgrade').emit('click');
      assert.deepEqual(f.state(), once, 'disabled UI and real handler reject repeated insufficient-funds purchases');
      assert.equal(f.memory.getItem(SAVE_KEY), bytes);
      f.click('#dialog-close'); openCoffee(f, recipe);
      assert.equal(f.element('#coffee-level').textContent, `Lv. ${next.level} → ${next.nextLevel}`);
    } finally { f.dispose(); }
    const capped = fundedInitial(50000); capped.coffeeLevels[recipe] = COFFEE_MAX_LEVEL;
    const g = fixture({ initial: capped });
    try {
      openCoffee(g, recipe); const before = g.state(), bytes = g.memory.getItem(SAVE_KEY);
      assert.equal(g.element('#coffee-level').textContent, `Lv. ${COFFEE_MAX_LEVEL} · MAX`);
      assert.equal(g.element('#coffee-next-price').textContent, '已达上限'); assert.equal(g.element('#coffee-next-seconds').textContent, '已达上限');
      assert.equal(g.element('#coffee-upgrade').textContent, '已满级'); assert.equal(g.element('#coffee-upgrade').disabled, true);
      assert.equal(g.element('#coffee-funds').textContent, '');
      g.click('#coffee-upgrade'); g.element('#coffee-upgrade').emit('click');
      assert.deepEqual(g.state(), before); assert.equal(g.memory.getItem(SAVE_KEY), bytes);
    } finally { g.dispose(); }
  }
});

test('TC-3D-023 REQ-3D-033 counter upgrade after coffee upgrades retains independent selected-counter scope', () => {
  for (const id of ['counter-a', 'counter-b']) {
    const initial = fundedInitial(50000); initial.coffeeLevels = { espresso: 5, latte: 3 };
    const f = fixture({ initial });
    try {
      f.action({ type: 'counter', id });
      const before = f.state(), expected = createEngine(before), quote = expected.quote(id);
      f.click('#counter-upgrade'); assert.equal(expected.upgrade(id), true);
      assert.deepEqual(f.state(), expected.snapshot());
      assert.deepEqual(f.state().coffeeLevels, before.coffeeLevels);
      assert.deepEqual(f.state().counters.find(counter => counter.id !== id), before.counters.find(counter => counter.id !== id));
      assert.equal(before.wallet - f.state().wallet, quote.cost);
      assert.equal(f.state().counters.find(counter => counter.id === id).recipe, before.counters.find(counter => counter.id === id).recipe);
    } finally { f.dispose(); }
  }
});

test('TC-3D-023 REQ-3D-033 a short offline interruption restores the exact recipe/counter/coffee panel', async () => {
  for (const [action, panel] of [[{ type: 'recipe', id: 'counter-b' }, 'recipe'], [{ type: 'counter', id: 'counter-b' }, 'counter'], [{ type: 'menu', recipe: 'latte' }, 'coffee']]) {
    const f = fixture({ now: 500000, initial: fundedInitial(50000) });
    try {
      openAction(f, action);
      const title = f.element('#dialog-title').textContent, eyebrow = f.element('#dialog-eyebrow').textContent;
      f.document.hidden = true; f.document.emit('visibilitychange');
      f.clock.now += 20000; f.clock.performance += 20000;
      f.document.hidden = false; f.document.emit('visibilitychange');
      assert.equal(f.element('#offline-panel').hidden, false);
      await f.flushOffline({ dismissResult: false });
      assert.equal(f.element('#operation-dialog').open, true);
      assert.equal(f.element(`#${panel}-panel`).hidden, false);
      assert.equal(f.element('#dialog-title').textContent, title); assert.equal(f.element('#dialog-eyebrow').textContent, eyebrow);
      assert.equal(f.renderer.interactionEnabled, false);
      f.click('#dialog-close'); assert.equal(f.renderer.interactionEnabled, true);
    } finally { f.dispose(); }
  }
});

test('TC-3D-023 REQ-3D-033 save conflict or canceled settlement blocks all split business actions', async () => {
  for (const cause of ['storage-conflict', 'canceled-offline']) {
    const f = fixture({ initial: fundedInitial(50000), now: 500000 });
    try {
      if (cause === 'storage-conflict') {
        const foreign = JSON.parse(f.memory.getItem(SAVE_KEY)); foreign.recordChangeTag = 'split-panels-conflict';
        f.memory.setItem(SAVE_KEY, JSON.stringify(foreign));
        f.window.emit('storage', { key: SAVE_KEY, newValue: JSON.stringify(foreign) });
      } else {
        f.document.hidden = true; f.document.emit('visibilitychange');
        f.clock.now += 60000; f.clock.performance += 60000;
        f.document.hidden = false; f.document.emit('visibilitychange');
        f.click('#offline-cancel'); await f.flushOffline({ dismissResult: false });
      }
      const protectedState = f.state(), bytes = f.memory.getItem(SAVE_KEY);
      assertProtected(f);
      for (const action of [{ type: 'recipe', id: 'counter-b' }, { type: 'counter', id: 'counter-b' }, { type: 'menu', recipe: 'espresso' }]) {
        openAction(f, action);
        if (action.type === 'recipe') {
          const button = f.nodes.find(node => node.dataset.selectRecipe === 'espresso');
          assert.equal(button.disabled, true); f.root.emit('click', { target: button });
        } else {
          const kind = action.type === 'menu' ? 'coffee' : 'counter';
          assert.equal(f.element(`#${kind}-upgrade`).disabled, true);
          assert.equal(f.element(`#${kind}-funds`).textContent, '请先恢复存档');
          f.element(`#${kind}-upgrade`).emit('click');
        }
        assert.deepEqual(f.state(), protectedState, `${cause}: ${action.type} cannot bypass recovery protection`);
        assert.equal(f.memory.getItem(SAVE_KEY), bytes);
        f.click('#dialog-close');
      }
    } finally { f.dispose(); }
  }
});

test('TC-3D-023 REQ-3D-033 portable preview, cancellation, replacement and recovery retain independent coffee progress', async () => {
  const current = fundedInitial(50000); current.coffeeLevels = { espresso: 3, latte: 5 };
  const source = fundedInitial(30000); source.coffeeLevels = { espresso: 7, latte: 2 };
  const incoming = await portableFixture({ state: source, savedAt: 1000, exportedAt: 2000, saveId: 'coffee-progress-source' });
  assert.equal(JSON.parse(incoming.text).formatVersion, 4);
  const f = fixture({ initial: current, now: 130000 });
  try {
    const before = f.state(), bytes = f.memory.getItem(SAVE_KEY);
    await reviewPortable(f, incoming);
    for (const suffix of ['summary', 'details']) {
      assert.match(f.element(`#file-current-${suffix}`).textContent, /浓缩 Lv\. 3 · 拿铁 Lv\. 5/);
      assert.match(f.element(`#file-incoming-${suffix}`).textContent, /浓缩 Lv\. 7 · 拿铁 Lv\. 2/);
    }
    assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), bytes);
    f.click('#file-cancel');
    assert.deepEqual(f.state(), before, 'cancel preserves current coffee levels and the entire shop');
    assert.equal(f.memory.getItem(SAVE_KEY), bytes);
    assert.equal(portableWrites(f).length, 0); assert.equal(importBackupWrites(f).length, 0);

    await reviewPortable(f, incoming); confirmPortable(f);
    assert.deepEqual(f.state(), source, 'confirmed import replaces all coffee progress with the selected snapshot');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, source);
    assert.equal(portableWrites(f).length, 1); assert.equal(importBackupWrites(f).length, 1);
    const envelope = JSON.parse(f.memory.getItem(SAVE_KEY));
    const backup = JSON.parse(f.memory.getItem(envelope.lastImportBackupKey));
    assert.deepEqual(backup.liveState.coffeeLevels, current.coffeeLevels);
    assert.equal(backup.originalRaw, bytes);

    f.click('#backup-live'); await f.flushFiles();
    assert.match(f.element('#file-export-summary').textContent, /浓缩 Lv\. 3 · 拿铁 Lv\. 5/);
    assert.equal(f.element('#file-download').disabled, false);
    f.click('#file-download');
    const recoveryText = await f.blobs.at(-1).text(), recovery = await parsePortableSave(recoveryText);
    assert.equal(JSON.parse(recoveryText).formatVersion, 4, 'recovery download uses the coffee-aware portable format');
    assert.equal(recovery.ok, true);
    assert.equal(recovery.file.payload.economyVersion, 4);
    assert.deepEqual(recovery.file.payload.state, before, 'recovery export preserves the entire pre-import live snapshot');
    assert.deepEqual(recovery.file.payload.overview.coffeeLevels, current.coffeeLevels);
    assert.deepEqual(f.state(), source, 'exporting the old shop cannot replace current progress');

    await reviewPortable(f, recovery.file);
    assert.match(f.element('#file-current-summary').textContent, /浓缩 Lv\. 7 · 拿铁 Lv\. 2/);
    assert.match(f.element('#file-incoming-summary').textContent, /浓缩 Lv\. 3 · 拿铁 Lv\. 5/);
    confirmPortable(f);
    assert.deepEqual(f.state(), before, 'the exported recovery file can restore both independent coffee levels through the real handler');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, before);
  } finally { f.dispose(); }
});

// TC-3D-024: DOM ancestry is used here so an enabled hidden control cannot
// masquerade as a reachable recovery flow. This remains a simulated DOM check.
function isVisible(f, selector) {
  let node = f.element(selector);
  if (!node) return false;
  while (node) {
    if (node.hidden || (node.tagName === 'DIALOG' && !node.open)) return false;
    const parent = node.parentElement;
    if (parent?.tagName === 'DETAILS' && !parent.hasAttribute('open') && node.tagName !== 'SUMMARY') return false;
    node = parent;
  }
  return true;
}
function visibleClick(f, selector) {
  assert.equal(isVisible(f, selector), true, `${selector} must be reachable through the visible UI`);
  assert.equal(f.element(selector).disabled, false, `${selector} must be enabled`);
  f.click(selector);
}

test('TC-3D-024 settings has exactly two primary entries and graphics expands without introducing save actions', () => {
  const f = fixture();
  try {
    visibleClick(f, '#settings');
    assert.deepEqual(f.element('#settings-panel').children.map(node => node.id), ['display-settings', 'save-files']);
    assert.equal(f.element('#display-settings').hasAttribute('open'), false);
    const summary = f.element('#display-settings').children[0];
    assert.equal(summary.tagName, 'SUMMARY');
    for (const button of f.nodes.filter(node => node.dataset.renderMode)) {
      button.setAttribute('id', `graphics-${button.dataset.renderMode}-test`);
      assert.equal(isVisible(f, `#${button.id}`), false);
    }
    // The native summary owns collapsed state; the fixture mirrors that default action.
    summary.setAttribute('id', 'graphics-summary-test');
    visibleClick(f, '#graphics-summary-test');
    assert.equal(f.element('#display-settings').hasAttribute('open'), true);
    const balanced = f.nodes.find(node => node.dataset.renderMode === 'balanced');
    balanced.setAttribute('id', 'balanced-test');
    visibleClick(f, '#balanced-test');
    assert.equal(f.memory.getItem(RENDER_MODE_KEY), 'balanced');
    assert.equal(f.element('#render-mode-current').textContent, '平衡');
    visibleClick(f, '#graphics-summary-test');
    assert.equal(isVisible(f, '#balanced-test'), false);
    visibleClick(f, '#save-files');
    assert.equal(isVisible(f, '#save'), true);
    assert.equal(isVisible(f, '#save-recovery'), false);
    visibleClick(f, '#file-back');
    assert.equal(f.element('#display-settings').hasAttribute('open'), false);
    assert.equal(isVisible(f, '#save'), false);
    assert.equal(f.element('#render-mode-current').textContent, '平衡');
    for (const old of ['逛逛小店', '怎么玩', '<summary>备份与恢复</summary>', 'data-focus=']) assert.equal(html.includes(old), false);
    assert.equal(f.element('#save-recovery').tagName, 'SECTION', 'recovery is a contextual card rather than a duplicate submenu');
  } finally { f.dispose(); }
});

test('TC-3D-024 quota failure surfaces on the save entry and clears only after a successful durable retry', async () => {
  const f = fixture();
  try {
    const raw = f.memory.getItem(SAVE_KEY);
    f.storageControl.writeUnavailable = true;
    f.tick(9); // Real autosave path, without a manual-save button in settings.
    assert.equal(f.memory.getItem(SAVE_KEY), raw);
    visibleClick(f, '#settings');
    assert.match(f.element('#save-entry-summary').textContent, /需要处理/);
    assert.equal(isVisible(f, '#save-recovery'), false, 'the settings screen remains two entries');
    visibleClick(f, '#save-files');
    assert.equal(isVisible(f, '#save-recovery'), true);
    visibleClick(f, '#export');
    assert.deepEqual(JSON.parse(await f.blobs[0].text()).state, f.state());
    f.storageControl.writeUnavailable = false;
    visibleClick(f, '#save');
    assert.equal(isVisible(f, '#save-recovery'), false);
    assert.match(f.element('#save-entry-summary').textContent, /自动保存/);
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, f.state());
  } finally { f.dispose(); }
});

test('TC-3D-024 corrupt and future saves expose original bytes and protected new-shop confirmation inside files', async () => {
  for (const raw of ['{broken original', JSON.stringify({ schemaVersion: 9876, untouched: 'future save' })]) {
    const f = fixture({ raw });
    try {
      visibleClick(f, '#settings'); visibleClick(f, '#save-files');
      assert.equal(isVisible(f, '#save-recovery'), true);
      assert.equal(f.element('#save').disabled, true);
      assert.equal(f.element('#file-prepare').disabled, true);
      assert.equal(f.element('#export-current').hidden, true);
      visibleClick(f, '#export');
      assert.equal(await f.blobs[0].text(), raw);
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      f.window.confirm = () => false;
      visibleClick(f, '#new-shop');
      assert.equal(f.memory.getItem(SAVE_KEY), raw);
      f.window.confirm = () => true;
      visibleClick(f, '#new-shop');
      assert.equal(f.state().paused, false);
      assert.equal(isVisible(f, '#save-recovery'), false);
      assert.equal(isVisible(f, '#welcome-guide'), false, 'recovery/new-shop is not newcomer onboarding');
    } finally { f.dispose(); }
  }
});

test('TC-3D-024 missing or unreadable sources stay frozen and retryable through the save panel', () => {
  for (const failure of ['missing', 'read']) {
    const f = fixture();
    try {
      visibleClick(f, '#settings'); visibleClick(f, '#save-files');
      f.memory.removeItem(SAVE_KEY);
      if (failure === 'read') f.storageControl.readUnavailable = true;
      f.window.emit('storage', { key: SAVE_KEY, newValue: null });
      visibleClick(f, '#reload');
      assertProtected(f);
      assert.equal(isVisible(f, '#save-recovery'), true);
      assert.equal(f.element('#save').disabled, true);
      assert.equal(f.memory.getItem(SAVE_KEY), null);
      assert.equal(isVisible(f, '#export'), true, 'previously valid current state is still recoverable');
      if (failure === 'missing') assert.equal(isVisible(f, '#new-shop'), true);
      assert.equal(isVisible(f, '#reload'), true);
      f.tick(10); assert.equal(f.memory.getItem(SAVE_KEY), null);
    } finally { f.dispose(); }
  }
});

test('TC-3D-024 first exposure is four skippable scene steps with no modal or saved pause mutation', () => {
  const f = fixture({ initial: null }), oracle = fixture({ initial: null, onboardingFlag: 'completed' });
  try {
    assert.equal(isVisible(f, '#welcome-guide'), true);
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.state().paused, false);
    assert.equal(f.memory.getItem(SAVE_KEY), null, 'starting guidance never writes game data');
    assert.deepEqual(f.storageWrites.map(item => item.key), [ONBOARDING_KEY]);
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'shown');
    assert.equal(f.renderer.focusCalls.at(-1), 'counter-a-recipe');
    for (const control of ['counter-a-upgrade', '#dock-coffee', '#business-toggle']) {
      visibleClick(f, '#guide-next');
      if (control.startsWith('#')) assert.equal(f.document.activeElement, f.element(control));
      else assert.equal(f.renderer.focusCalls.at(-1), control);
      assert.equal(f.renderer.interactionEnabled, true);
      f.tick(.5); oracle.tick(.5);
      assert.deepEqual(f.state(), oracle.state(), 'the guide cannot pause, advance or reset simulation time');
    }
    assert.equal(f.element('#guide-next').textContent, '开始营业');
    visibleClick(f, '#guide-next');
    assert.equal(isVisible(f, '#welcome-guide'), false);
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'completed');
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
    f.click('#guide-next'); f.click('#guide-skip');
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'completed', 'late repeated clicks cannot rewrite completion');
    assert.deepEqual(f.state(), oracle.state());
  } finally { f.dispose(); oracle.dispose(); }
});

test('TC-3D-024 skip, finish and interrupted refresh never automatically repeat first-entry guidance', () => {
  for (const action of ['skip', 'finish', 'interrupt']) {
    const f = fixture({ initial: null });
    let fresh;
    try {
      if (action === 'skip') visibleClick(f, '#guide-skip');
      if (action === 'finish') for (let i = 0; i < 4; i++) visibleClick(f, '#guide-next');
      fresh = fixture({ initial: null, onboardingFlag: f.memory.getItem(ONBOARDING_KEY) });
      assert.equal(isVisible(fresh, '#welcome-guide'), false, `${action}: refresh before first autosave does not repeat`);
      assert.equal(fresh.renderer.focusCalls.length, 0);
      assert.equal(fresh.memory.getItem(SAVE_KEY), null);
    } finally { f.dispose(); fresh?.dispose(); }
  }
});

test('TC-3D-024 existing pristine, developed, paused and legacy saves are never mistaken for newcomers', async () => {
  const developed = createEngine(); developed.advance(50);
  const paused = createInitialState(); paused.paused = true;
  const legacy = createInitialState(); delete legacy.coffeeLevels; delete legacy.layout; legacy.customerRouteVersion = 2; legacy.economyVersion = 1;
  for (const initial of [createInitialState(), developed.snapshot(), paused, legacy]) {
    const f = fixture({ initial });
    try {
      await f.flushOffline();
      assert.equal(isVisible(f, '#welcome-guide'), false);
      assert.equal(f.memory.getItem(ONBOARDING_KEY), null);
      assert.equal(f.renderer.focusCalls.length, 0);
    } finally { f.dispose(); }
  }
});

test('TC-3D-024 guide preference failures never interfere with game persistence or recovery', () => {
  for (const failure of ['read', 'write', 'all-storage', 'webgl']) {
    const f = fixture({ initial: null, onboardingReadUnavailable: failure === 'read', onboardingWriteUnavailable: failure === 'write', storageUnavailable: failure === 'all-storage', renderUnavailable: failure === 'webgl' });
    try {
      assert.equal(isVisible(f, '#welcome-guide'), false);
      if (failure === 'read' || failure === 'write') {
        f.tick(9);
        assert.ok(f.memory.getItem(SAVE_KEY), 'preference storage errors never turn off autosave');
        assert.equal(f.state().paused, false);
      } else if (failure === 'all-storage') {
        visibleClick(f, '#settings'); visibleClick(f, '#save-files');
        assert.equal(isVisible(f, '#save-recovery'), true);
        assertProtected(f);
      }
    } finally { f.dispose(); }
  }
});

test('TC-3D-024 modal interruption hides then resumes the same guide step and restores visible focus', () => {
  const f = fixture({ initial: null, deferDialogClose: true });
  try {
    visibleClick(f, '#guide-next'); f.element('#guide-next').focus();
    visibleClick(f, '#settings');
    assert.equal(isVisible(f, '#welcome-guide'), false);
    f.click('#guide-next');
    visibleClick(f, '#dialog-close'); f.flushCloseEvents();
    assert.equal(isVisible(f, '#welcome-guide'), true);
    assert.match(f.element('#guide-progress').textContent, /2 \/ 4/);
    assert.equal(f.document.activeElement?.id, 'guide-next');
    f.element('#guide-next').emit('keydown', { key: 'ArrowRight' });
    assert.equal(f.renderer.focusCalls.at(-1), 'counter-a-upgrade', 'guide buttons do not capture canvas keyboard routes');
    f.click('#dock-background');
    assert.equal(isVisible(f, '#welcome-guide'), false);
    visibleClick(f, '#dialog-close'); f.flushCloseEvents();
    assert.match(f.element('#guide-progress').textContent, /2 \/ 4/);
    visibleClick(f, '#guide-skip');
    visibleClick(f, '#settings'); visibleClick(f, '#dialog-close'); f.flushCloseEvents();
    assert.equal(isVisible(f, '#welcome-guide'), false);
  } finally { f.dispose(); }
});

test('TC-3D-024 first-visit guide gives way to offline settlement and resumes without changing credited state', async () => {
  const f = fixture({ initial: null }), oracle = fixture({ initial: null, onboardingFlag: 'completed' });
  try {
    for (const app of [f, oracle]) {
      app.tick(1); app.document.hidden = true; app.document.emit('visibilitychange');
      assert.equal(isVisible(app, '#welcome-guide'), false);
      app.clock.now += 35000; app.clock.performance += 35000;
      app.document.hidden = false; app.document.emit('visibilitychange');
      await app.flushOffline({ dismissResult: false });
      assert.equal(isVisible(app, '#offline-result'), true);
      assert.equal(isVisible(app, '#welcome-guide'), false);
      assert.equal(app.state().offlineClaimIds.length, 1);
      assert.equal(app.state().offlineClaimIds[0], app.state().lastOfflineClaimId);
      assert.deepEqual(JSON.parse(app.memory.getItem(SAVE_KEY)).state, app.state());
    }
    assert.deepEqual({ ...f.state(), lastOfflineClaimId: null, offlineClaimIds: [] }, { ...oracle.state(), lastOfflineClaimId: null, offlineClaimIds: [] });
    assert.equal(f.state().paused, false);
    visibleClick(f, '#offline-done'); visibleClick(oracle, '#offline-done');
    assert.equal(isVisible(f, '#welcome-guide'), true);
    assert.match(f.element('#guide-progress').textContent, /1 \/ 4/);
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'shown');
    assert.deepEqual({ ...f.state(), lastOfflineClaimId: null, offlineClaimIds: [] }, { ...oracle.state(), lastOfflineClaimId: null, offlineClaimIds: [] });
    visibleClick(f, '#guide-skip');
    f.window.emit('pagehide', { persisted: true });
    f.window.emit('pageshow', { persisted: true });
    await f.flushOffline();
    assert.equal(isVisible(f, '#welcome-guide'), false, 'BFCache return does not restart dismissed guidance');
  } finally { f.dispose(); oracle.dispose(); }
});

test('TC-3D-024 import cancellation retains guidance, confirmed import retires it and never recreates it on reload', async () => {
  const incoming = await portableFixture();
  const f = fixture({ initial: null, now: 130000 });
  try {
    f.element('#guide-next').focus();
    openFilePanel(f); f.chooseFile({ text: incoming.text }); await f.flushFiles();
    visibleClick(f, '#file-cancel'); visibleClick(f, '#dialog-close');
    assert.equal(isVisible(f, '#welcome-guide'), true);
    openFilePanel(f); f.chooseFile({ text: incoming.text }); await f.flushFiles();
    confirmPortable(f);
    visibleClick(f, '#dialog-close');
    assert.equal(isVisible(f, '#welcome-guide'), false);
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'skipped');
    assert.equal(f.document.activeElement?.id, 'coffee-canvas', 'focus never returns to a retired guide button');
    assert.deepEqual(f.state(), incoming.payload.state);
    const reload = fixture({ raw: f.memory.getItem(SAVE_KEY), now: 130000 });
    try { assert.equal(isVisible(reload, '#welcome-guide'), false, 'a portable import is an existing shop even without the browser flag'); }
    finally { reload.dispose(); }
  } finally { f.dispose(); }
});

test('TC-3D-024 adopting another window progress retires an interrupted newcomer guide', async () => {
  const now = 130000, f = fixture({ initial: null, now });
  const developed = createEngine(); developed.advance(45);
  const storage = createMemoryStorage(), repo = new LocalSaveRepository(storage);
  repo.load(now); assert.equal(repo.save(developed.snapshot(), now).ok, true);
  try {
    visibleClick(f, '#guide-next');
    const incoming = storage.getItem(SAVE_KEY);
    f.memory.setItem(SAVE_KEY, incoming);
    f.window.emit('storage', { key: SAVE_KEY, newValue: incoming });
    assert.equal(isVisible(f, '#welcome-guide'), false);
    visibleClick(f, '#settings'); visibleClick(f, '#save-files');
    visibleClick(f, '#reload'); await f.flushOffline();
    visibleClick(f, '#dialog-close');
    assert.deepEqual(f.state(), developed.snapshot());
    assert.equal(isVisible(f, '#welcome-guide'), false);
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'skipped');
  } finally { f.dispose(); }
});

test('TC-3D-024 stable guide steps never repeatedly mutate the polite live region during play', () => {
  const f = fixture({ initial: null });
  try {
    const title = f.element('#guide-title'), copy = f.element('#guide-copy');
    const titleWrites = title.textWrites, copyWrites = copy.textWrites;
    for (let n = 0; n < 12; n++) f.tick(.25);
    assert.equal(title.textWrites, titleWrites);
    assert.equal(copy.textWrites, copyWrites);
    visibleClick(f, '#guide-next');
    assert.equal(title.textWrites, titleWrites + 1);
    assert.equal(copy.textWrites, copyWrites + 1);
    visibleClick(f, '#settings'); visibleClick(f, '#dialog-close');
    assert.equal(title.textWrites, titleWrites + 1);
    assert.equal(copy.textWrites, copyWrites + 1);
  } finally { f.dispose(); }
});

test('TC-3D-024 files already open reflect a new conflict without leaving current export apparently available', () => {
  const f = fixture();
  try {
    visibleClick(f, '#settings'); visibleClick(f, '#save-files');
    assert.equal(f.element('#file-prepare').disabled, false);
    f.window.emit('storage', { key: SAVE_KEY, newValue: 'foreign revision' });
    assert.equal(isVisible(f, '#save-recovery'), true);
    assert.equal(f.element('#file-prepare').disabled, true);
    assert.equal(f.element('#save').disabled, true);
    assert.equal(isVisible(f, '#reload'), true);
  } finally { f.dispose(); }
});

test('TC-3D-024 hidden first entry and disposal never force a modal, keyboard capture or replayed tutorial', async () => {
  const f = fixture({ initial: null, initiallyHidden: true });
  try {
    assert.equal(isVisible(f, '#welcome-guide'), false);
    assert.equal(f.element('#operation-dialog').open, false);
    assert.equal(f.window.listeners.has('keydown'), false);
    assert.equal(f.document.listeners.has('keydown'), false);
    f.clock.now += 1000; f.clock.performance += 1000;
    f.document.hidden = false; f.document.emit('visibilitychange'); await f.flushOffline();
    assert.equal(isVisible(f, '#welcome-guide'), true);
    assert.equal(f.state().paused, false);
    f.dispose();
    assert.equal(isVisible(f, '#welcome-guide'), false);
    const focusCalls = f.renderer.focusCalls.length;
    f.click('#guide-next'); f.click('#guide-skip');
    assert.equal(f.renderer.focusCalls.length, focusCalls);
    assert.equal(f.memory.getItem(ONBOARDING_KEY), 'shown');
  } finally { f.dispose(); }
});

function openRenovation(f) {
  if (!f.state().paused) f.click('#business-toggle');
  f.click('#dock-furniture');
  assert.equal(f.element('#renovation-panel').hidden, false);
  for (let i = 0; i < 2500 && f.element('#renovation-tools').hidden; i++) f.tick(.25);
  assert.equal(f.element('#renovation-tools').hidden, false, 'safe draining reaches editable state');
}

test('TC-3D-025 REQ-3D-035 renovation draft does not mutate wallet, saved pause or committed furniture; invalid placement is blocked', () => {
  const f = fixture();
  try {
    openRenovation(f);
    const before = f.state();
    f.click('#buy-table');
    assert.deepEqual(f.state(), before, 'buy is a detached draft until apply');
    assert.equal(f.renderer.renovation.layout.furniture.length, 3);
    f.action({ type: 'layout-cell', x: -7, z: 5 });
    assert.equal(f.element('#renovation-apply').disabled, true);
    assert.equal(f.renderer.renovation.valid, false);
    f.tick(9);
    assert.deepEqual(f.state(), before, 'editing time is frozen without changing saved paused');
    assert.equal(f.renderer.updates.at(-1).state.paused, true, 'the player-owned business pause remains set while editing');
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, before, 'auto-save contains only committed furniture');
    f.click('#renovation-cancel');
    assert.equal(f.element('#renovation-panel').hidden, true);
    assert.equal(f.renderer.renovation, null);
    assert.deepEqual(f.state(), before);
    f.tick(.2); assert.deepEqual(f.state(), before, 'cancel leaves the business paused');
    f.click('#business-toggle'); f.tick(.2); assert.ok(f.state().elapsed > before.elapsed);
  } finally { f.dispose(); }
});

test('TC-3D-025 renovation commit charges table once and remains paused; repeated apply cannot charge again', () => {
  const f = fixture();
  try {
    openRenovation(f);
    const before = f.state();
    f.click('#buy-table');
    assert.equal(f.element('#renovation-apply').disabled, false);
    f.click('#renovation-apply');
    const committed = f.state();
    assert.equal(committed.layout.active, true);
    assert.equal(committed.layout.furniture.filter(item => item.kind === 'table').length, 1);
    assert.equal(committed.wallet, before.wallet - LAYOUT_PRICES.table);
    assert.equal(committed.spend, before.spend + LAYOUT_PRICES.table);
    assert.equal(committed.paused, before.paused);
    assert.equal(f.element('#renovation-panel').hidden, true);
    f.click('#renovation-apply');
    assert.deepEqual(f.state(), committed);
    assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state, committed);
  } finally { f.dispose(); }
});

test('TC-3D-025 hiding or losing storage authority cancels uncommitted renovation safely', () => {
  for (const boundary of ['hidden', 'conflict']) {
    const f = fixture();
    try {
      openRenovation(f); const before = f.state(); f.click('#buy-table');
      if (boundary === 'hidden') { f.document.hidden = true; f.document.emit('visibilitychange'); }
      else f.window.emit('storage', { key: SAVE_KEY, newValue: 'different-tab' });
      assert.equal(f.element('#renovation-panel').hidden, true);
      assert.deepEqual(f.state().layout, before.layout);
      assert.equal(f.state().wallet, before.wallet);
      assert.equal(f.state().paused, true, 'interruption preserves the user pause');
      if (boundary === 'hidden') assert.deepEqual(JSON.parse(f.memory.getItem(SAVE_KEY)).state.layout, before.layout);
    } finally { f.dispose(); }
  }
});

test('TC-3D-025 rotate, store, restore and Escape remain draft-only and last counter cannot be stored', () => {
  const f = fixture();
  try {
    openRenovation(f); const before = f.state();
    f.click('#rotate-furniture');
    assert.equal(f.renderer.renovation.layout.furniture[0].rotation, 1);
    f.click('#store-furniture');
    assert.equal(f.renderer.renovation.layout.furniture[0].stored, true);
    f.action({ type: 'layout-select', id: 'counter-b' });
    f.click('#store-furniture');
    assert.equal(f.renderer.renovation.layout.furniture[1].stored, false);
    f.action({ type: 'layout-select', id: 'counter-a' });
    f.click('#store-furniture');
    assert.equal(f.renderer.renovation.layout.furniture[0].stored, false);
    f.window.emit('keydown', { key: 'Escape' });
    assert.equal(f.element('#renovation-panel').hidden, true);
    assert.deepEqual(f.state(), before);
  } finally { f.dispose(); }
});

test('TC-3D-025 Escape discards renovation even after focus leaves its workbench', () => {
  const f = fixture();
  try {
    openRenovation(f); const before = f.state(); f.click('#buy-table');
    f.element('#settings').focus();
    f.window.emit('keydown', { key: 'Escape' });
    assert.equal(f.element('#renovation-panel').hidden, true);
    assert.deepEqual(f.state(), before);
    assert.equal(f.document.activeElement, f.element('#coffee-canvas'));
  } finally { f.dispose(); }
});

function catalogButton(f, key) { return f.nodes.find(node => node.dataset.catalogKey === key); }
function dragPointer(f, type, x, y, extra = {}) {
  return f.window.emit(type, { pointerId: 71, isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
}
function armCatalog(f, key) {
  const button = catalogButton(f, key); assert.ok(button, key);
  f.root.emit('pointerdown', { target: button, pointerId: 71, isPrimary: true, button: 0, clientX: 200, clientY: 600 });
  return button;
}
function catalogTabClick(f, tab) {
  const button = f.nodes.find(node => node.dataset.catalogTab === tab); assert.ok(button);
  f.root.emit('click', { target: button });
}

test('TC-3D-026 REQ-3D-036 compact pictured furniture catalogue separates owned and purchasable items from coffee', () => {
  const f = fixture();
  try {
    openRenovation(f);
    assert.deepEqual(f.nodes.filter(n => n.dataset.catalogKey).map(n => n.dataset.catalogKey), ['counter-a', 'counter-b', 'new-counter', 'new-table']);
    assert.equal(declarations('.renovation-panel', 'width')[0], 'min(880px, calc(100vw - 32px))');
    assert.equal(declarations('.renovation-panel', 'left')[0], '50%');
    assert.ok(declarations('.renovation-panel', 'bottom')[0].includes('safe-area-inset-bottom'));
    assert.equal(f.nodes.some(n => n.dataset.catalogTab === 'coffee'), false);
    for (const card of f.nodes.filter(n => n.dataset.catalogKey)) {
      const art = card.children.find(node => node.tagName === 'IMG'); assert.ok(art);
      const path = art.getAttribute('src'); assert.match(path, /catalog-(?:counter|table)\.svg$/);
      assert.match(readFileSync(new URL(`../public/${path.replace(/^\.\//, '')}`, import.meta.url), 'utf8'), /<svg\b/);
      assert.ok(art.getAttribute('alt')); assert.equal(art.getAttribute('draggable'), 'false');
    }
    catalogTabClick(f, 'counter');
    assert.deepEqual(f.nodes.filter(n => n.dataset.catalogKey).map(n => n.dataset.catalogKey), ['counter-a', 'counter-b', 'new-counter']);
    f.root.emit('click', { target: catalogButton(f, 'counter-b') }); f.click('#store-furniture');
    catalogTabClick(f, 'stored');
    assert.deepEqual(f.nodes.filter(n => n.dataset.catalogKey).map(n => n.dataset.catalogKey), ['counter-b']);
    assert.equal(f.element('#rotate-furniture').disabled, true);
  } finally { f.dispose(); }
});

test('TC-3D-026 actual palette pointer handlers drag one new table, defer charge and suppress synthetic click duplication', () => {
  const f = fixture();
  try {
    openRenovation(f); const before = f.state();
    f.renderer.placementPicker = () => ({ x: 0, z: 5 });
    const button = armCatalog(f, 'new-table');
    assert.equal(f.root.hasPointerCapture(71), true);
    dragPointer(f, 'pointermove', 700, 80);
    assert.equal(f.renderer.renovation.layout.furniture.length, 3);
    assert.equal(f.renderer.renovation.valid, true);
    assert.equal(f.element('#renovation-apply').disabled, true, 'cannot commit mid-gesture');
    assert.deepEqual(f.state(), before);
    dragPointer(f, 'pointerup', 700, 80);
    assert.equal(f.root.hasPointerCapture(71), false);
    assert.equal(f.element('#catalog-drag-label').hidden, true);
    f.root.emit('click', { target: button, detail: 1 });
    assert.equal(f.renderer.renovation.layout.furniture.filter(item => item.kind === 'table').length, 1);
    assert.deepEqual(f.state(), before);
    f.click('#renovation-apply');
    assert.equal(f.state().wallet, before.wallet - LAYOUT_PRICES.table);
    assert.equal(f.state().layout.furniture.length, 3);
    const committed = f.state(); f.click('#renovation-apply'); assert.deepEqual(f.state(), committed);
  } finally { f.dispose(); }
});

test('TC-3D-026 captured non-drag palette tap selects once and keyboard activation remains usable', () => {
  const f = fixture();
  try {
    openRenovation(f);
    const button = armCatalog(f, 'new-table');
    dragPointer(f, 'pointerup', 202, 601);
    f.root.emit('click', { target: button, detail: 1 });
    assert.equal(f.renderer.renovation.layout.furniture.length, 3);
    f.root.emit('click', { target: catalogButton(f, 'new-table'), detail: 0 });
    assert.equal(f.renderer.renovation.layout.furniture.length, 4);
    assert.equal(f.root.hasPointerCapture(71), false);
  } finally { f.dispose(); }
});

for (const placement of [null, { x: 0, z: 0 }, { x: -7, z: 5 }, { x: 11, z: 7 }]) test(`TC-3D-026 invalid palette drop rolls back candidate ${JSON.stringify(placement)}`, () => {
  const f = fixture();
  try {
    openRenovation(f); const before = f.state(), original = structuredClone(f.renderer.renovation.layout);
    f.renderer.placementPicker = () => placement;
    armCatalog(f, 'new-table'); dragPointer(f, 'pointermove', 700, 80);
    assert.equal(f.renderer.renovation.valid, false);
    assert.equal(f.element('#renovation-status').classList.contains('invalid'), true);
    dragPointer(f, 'pointerup', 700, 80);
    assert.deepEqual(f.renderer.renovation.layout, original);
    assert.deepEqual(f.state(), before);
  } finally { f.dispose(); }
});

for (const boundary of ['pointercancel', 'lostpointercapture', 'blur', 'Escape']) test(`TC-3D-026 ${boundary} discards active drag, releases capture and retains prior draft`, () => {
  const f = fixture();
  try {
    openRenovation(f); f.click('#buy-table'); const original = structuredClone(f.renderer.renovation.layout);
    f.renderer.placementPicker = () => ({ x: 5, z: 5 });
    armCatalog(f, 'new-table'); dragPointer(f, 'pointermove', 700, 80);
    assert.equal(f.renderer.renovation.layout.furniture.length, 4);
    if (boundary === 'lostpointercapture') f.root.emit(boundary, { pointerId: 71 });
    else if (boundary === 'Escape') f.window.emit('keydown', { key: 'Escape' });
    else f.window.emit(boundary, { pointerId: 71 });
    assert.equal(f.element('#renovation-panel').hidden, false);
    assert.deepEqual(f.renderer.renovation.layout, original);
    assert.equal(f.root.hasPointerCapture(71), false);
    assert.equal(f.element('#catalog-drag-label').hidden, true);
    dragPointer(f, 'pointerup', 700, 80);
    assert.deepEqual(f.renderer.renovation.layout, original);
    if (boundary === 'Escape') { f.window.emit('keydown', { key: 'Escape' }); assert.equal(f.element('#renovation-panel').hidden, true); }
  } finally { f.dispose(); }
});

test('TC-3D-026 secondary pointers, drops over catalogue and repeated releases cannot place objects', () => {
  const f = fixture();
  try {
    openRenovation(f); const original = structuredClone(f.renderer.renovation.layout);
    f.renderer.placementPicker = () => ({ x: 0, z: 5 });
    const button = catalogButton(f, 'new-table');
    f.root.emit('pointerdown', { target: button, pointerId: 71, isPrimary: false, button: 0, clientX: 200, clientY: 600 });
    dragPointer(f, 'pointermove', 700, 80); assert.deepEqual(f.renderer.renovation.layout, original);
    armCatalog(f, 'new-table');
    dragPointer(f, 'pointermove', 700, 80, { pointerId: 72 }); assert.deepEqual(f.renderer.renovation.layout, original);
    dragPointer(f, 'pointermove', 700, 80);
    dragPointer(f, 'pointerup', 200, 500);
    assert.deepEqual(f.renderer.renovation.layout, original);
    dragPointer(f, 'pointerup', 700, 80); assert.deepEqual(f.renderer.renovation.layout, original);
  } finally { f.dispose(); }
});

test('TC-3D-026 scene-origin drag uses shared detached transaction and preserves grab offset', () => {
  const f = fixture();
  try {
    openRenovation(f); const before = f.state();
    f.renderer.placementPicker = x => x === 20 ? ({ x: 1, z: 0 }) : ({ x: -3, z: 3 });
    f.action({ type: 'layout-drag', phase: 'start', id: 'counter-a', clientX: 20, clientY: 50 });
    f.action({ type: 'layout-drag', phase: 'move', id: 'counter-a', clientX: 700, clientY: 50 });
    assert.equal(f.renderer.renovation.layout.furniture[0].x, -4);
    assert.equal(f.renderer.renovation.valid, true);
    f.action({ type: 'layout-drag', phase: 'end', id: 'counter-a', clientX: 700, clientY: 50 });
    assert.deepEqual(f.state(), before);
    f.click('#renovation-apply'); assert.equal(f.state().layout.furniture[0].x, -4); assert.equal(f.state().wallet, before.wallet);
  } finally { f.dispose(); }
});

test('TC-3D-026 stored furniture restores the same upgraded counter and rejects overlap', () => {
  const initial = createInitialState(); initial.coffeeLevels.latte = 4; initial.counters[1].level = 3;
  const f = fixture({ initial });
  try {
    openRenovation(f); const before = f.state();
    f.root.emit('click', { target: catalogButton(f, 'counter-b') }); f.click('#store-furniture');
    f.renderer.placementPicker = () => ({ x: 0, z: 0 });
    armCatalog(f, 'counter-b'); dragPointer(f, 'pointermove', 700, 50);
    assert.equal(f.renderer.renovation.valid, false); dragPointer(f, 'pointerup', 700, 50);
    assert.equal(f.renderer.renovation.layout.furniture[1].stored, true);
    f.renderer.placementPicker = () => ({ x: 5, z: 4 });
    armCatalog(f, 'counter-b'); dragPointer(f, 'pointermove', 700, 50); dragPointer(f, 'pointerup', 700, 50);
    assert.equal(f.renderer.renovation.layout.furniture.length, 2);
    assert.equal(f.renderer.renovation.layout.furniture[1].z, 4);
    assert.equal(f.renderer.renovation.layout.furniture[1].stored, false);
    f.click('#renovation-apply');
    assert.equal(f.state().coffeeLevels.latte, 4); assert.equal(f.state().wallet, before.wallet);
    assert.equal(f.state().counters[1].recipe, 'latte'); assert.equal(f.state().counters[1].level, 3);
    assert.equal(f.state().paused, true);
  } finally { f.dispose(); }
});

test('TC-3D-026 touch cards preserve horizontal catalogue browsing and start placement on vertical pull', () => {
  const f = fixture();
  try {
    openRenovation(f); const original = structuredClone(f.renderer.renovation.layout), button = catalogButton(f, 'new-table');
    f.root.emit('pointerdown', { target: button, pointerId: 71, pointerType: 'touch', isPrimary: true, button: 0, clientX: 200, clientY: 600 });
    dragPointer(f, 'pointermove', 300, 601, { pointerType: 'touch' });
    assert.deepEqual(f.renderer.renovation.layout, original);
    assert.equal(f.element('#catalog-drag-label').hidden, true);
    dragPointer(f, 'pointercancel', 300, 601, { pointerType: 'touch' });
    assert.equal(f.root.hasPointerCapture(71), false);
    assert.deepEqual(declarations('.catalog-card', 'touch-action'), ['pan-x']);
    f.renderer.placementPicker = () => ({ x: 0, z: 5 });
    f.root.emit('pointerdown', { target: button, pointerId: 71, pointerType: 'touch', isPrimary: true, button: 0, clientX: 200, clientY: 600 });
    dragPointer(f, 'pointermove', 205, 50, { pointerType: 'touch' });
    assert.equal(f.renderer.renovation.layout.furniture.length, 3);
    dragPointer(f, 'pointerup', 205, 50, { pointerType: 'touch' });
    assert.equal(f.renderer.renovation.layout.furniture.length, 3);
  } finally { f.dispose(); }
});

test('TC-3D-026 horizontal touch browsing without pointercancel cannot become a purchase on release', () => {
  const f = fixture();
  try {
    openRenovation(f); const original = structuredClone(f.renderer.renovation.layout), button = catalogButton(f, 'new-table');
    f.root.emit('pointerdown', { target: button, pointerId: 71, pointerType: 'touch', isPrimary: true, button: 0, clientX: 200, clientY: 600 });
    dragPointer(f, 'pointermove', 300, 601, { pointerType: 'touch' });
    dragPointer(f, 'pointermove', 200, 450, { pointerType: 'touch' });
    dragPointer(f, 'pointerup', 200, 600, { pointerType: 'touch' });
    f.root.emit('click', { target: button, detail: 1 });
    assert.deepEqual(f.renderer.renovation.layout, original);
    assert.equal(f.root.hasPointerCapture(71), false);
  } finally { f.dispose(); }
});


test('TC-3D-027 player pause drains existing guests, persists closure and gates decoration until explicit resume', () => {
  const initial = createEngine(); initial.invite(); initial.advance(8);
  assert.ok(initial.state.customers.length);
  const f = fixture({ initial: initial.snapshot() });
  try {
    const initialState = f.state(), bytes = f.memory.getItem(SAVE_KEY);
    f.click('#dock-furniture');
    assert.equal(f.element('#renovation-panel').hidden, true);
    assert.match(f.element('#toast').textContent, /暂停营业/);
    assert.deepEqual(f.state(), initialState); assert.equal(f.memory.getItem(SAVE_KEY), bytes);
    f.click('#business-toggle'); const paused = f.state();
    assert.equal(paused.paused, true); assert.equal(f.element('#dock-invite').disabled, true);
    f.click('#dock-invite'); f.element('#dock-invite').emit('click'); f.action({ type: 'invite' });
    assert.deepEqual(f.state(), paused);
    for (let i = 0; i < 4000 && f.state().customers.length; i++) f.tick(.1);
    const drained = f.state();
    assert.equal(drained.customers.length, 0); assert.equal(drained.nextCustomerId, paused.nextCustomerId);
    assert.ok(drained.totalServed > paused.totalServed, 'guests already inside finish their purchases');
    assert.ok(drained.wallet > paused.wallet); assert.equal(drained.paused, true);
    f.tick(.2); assert.equal(f.element('#business-status').textContent, '已暂停营业');
    f.click('#dock-furniture'); assert.equal(f.element('#renovation-panel').hidden, false);
    const draft = f.state(); f.click('#business-toggle');
    assert.deepEqual(f.state(), draft); assert.equal(f.element('#renovation-panel').hidden, false);
    assert.match(f.element('#toast').textContent, /完成布置.*取消/);
    f.click('#renovation-cancel'); assert.equal(f.state().paused, true);
    f.click('#business-toggle'); assert.equal(f.state().paused, false);
    f.tick(5); assert.ok(f.state().nextCustomerId > drained.nextCustomerId);
  } finally { f.dispose(); }
});

test('TC-3D-027 drops over HUD and dialog controls roll back despite a valid scene ray', () => {
  for (const overlay of ['#business-toggle', '#settings', '#action-dock', '#operation-dialog']) {
    const f = fixture();
    try {
      openRenovation(f); const before = f.state(), original = structuredClone(f.renderer.renovation.layout);
      f.renderer.placementPicker = () => ({ x: 0, z: 5 });
      armCatalog(f, 'new-table'); dragPointer(f, 'pointermove', 700, 80);
      assert.equal(f.renderer.renovation.valid, true);
      f.document.elementFromPoint = () => f.element(overlay);
      dragPointer(f, 'pointerup', 700, 80);
      assert.deepEqual(f.renderer.renovation.layout, original, overlay);
      assert.deepEqual(f.state(), before); assert.equal(f.root.hasPointerCapture(71), false);
      assert.equal(f.element('#catalog-drag-label').hidden, true);
    } finally { f.dispose(); }
  }
});

test('TC-3D-027 coffee panel counter shortcuts open the correct active counter without changing money or recipes', () => {
  const f = fixture({ initial: fundedInitial(50000) });
  try {
    for (const id of ['counter-a', 'counter-b']) for (const mode of ['Recipe', 'Upgrade']) {
      openCoffee(f, 'latte'); const before = f.state(), bytes = f.memory.getItem(SAVE_KEY), calls = f.element('#operation-dialog').showModalCalls;
      const shortcut = f.nodes.find(node => node.dataset[`counter${mode}`] === id); assert.ok(shortcut);
      assert.match(shortcut.getAttribute('aria-label'), new RegExp(`柜台 ${id === 'counter-a' ? 'A' : 'B'}`));
      f.root.emit('click', { target: shortcut });
      assert.equal(f.element(mode === 'Recipe' ? '#recipe-panel' : '#counter-panel').hidden, false);
      assert.match(f.element('#dialog-eyebrow').textContent, new RegExp(`柜台 ${id === 'counter-a' ? 'A' : 'B'}`));
      assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), bytes);
      assert.equal(f.element('#operation-dialog').showModalCalls, calls, 'counter navigation reuses the current native modal');
      f.click('#dialog-close');
      f.root.emit('click', { target: shortcut }); assert.equal(f.element('#operation-dialog').open, false, 'stale closed-panel shortcuts cannot open a dialog');
    }
    openRenovation(f);
    f.root.emit('click', { target: catalogButton(f, 'counter-b') }); f.click('#store-furniture'); f.click('#renovation-apply');
    openCoffee(f);
    assert.deepEqual(f.nodes.filter(node => node.dataset.counterRecipe).map(node => node.dataset.counterRecipe), ['counter-a']);
    assert.deepEqual(f.nodes.filter(node => node.dataset.counterUpgrade).map(node => node.dataset.counterUpgrade), ['counter-a']);
    assert.ok(declarations('.counter-shortcut button', 'min-height').some(value => Number.parseFloat(value) >= 44));
  } finally { f.dispose(); }
});

test('TC-3D-027 pause and resume surface durable write failure or conflict instead of reporting success', () => {
  for (const paused of [false, true]) for (const failure of ['write', 'conflict']) {
    const initial = createInitialState(); initial.paused = paused;
    const f = fixture({ initial });
    try {
      if (failure === 'write') f.storageControl.writeUnavailable = true;
      else {
        const foreign = JSON.parse(f.memory.getItem(SAVE_KEY)); foreign.recordChangeTag = 'newer-before-pause-write';
        f.memory.setItem(SAVE_KEY, JSON.stringify(foreign));
      }
      const before = f.state(), durable = f.memory.getItem(SAVE_KEY), expected = createEngine(before); expected.togglePause();
      f.click('#business-toggle');
      assert.deepEqual(f.state(), expected.snapshot(), 'the selected business state changes only in current memory');
      assert.equal(f.memory.getItem(SAVE_KEY), durable, 'failed pause save never overwrites durable or foreign bytes');
      assert.equal(f.element('#toast').classList.contains('visible'), true);
      assert.doesNotMatch(f.element('#toast').textContent, /开门啦|已停止接待新客/);
      if (failure === 'conflict') {
        assert.match(f.element('#toast').textContent, /冲突.*营业状态尚未保存/);
        assertProtected(f, !paused);
        const frozen = f.state(); f.tick(5); assert.deepEqual(f.state(), frozen);
      } else {
        assert.match(f.element('#toast').textContent, /保存失败.*刷新可能恢复旧状态/);
        f.storageControl.writeUnavailable = false;
        openFilePanel(f); f.click('#save');
        assert.equal(JSON.parse(f.memory.getItem(SAVE_KEY)).state.paused, !paused, 'explicit retry persists the selected business state');
      }
    } finally { f.dispose(); }
  }
});

test('TC-3D-027 furniture arrow buttons follow the projected screen direction without committing the draft', () => {
  const f = fixture();
  try {
    openRenovation(f);
    const state = f.state(), raw = f.memory.getItem(SAVE_KEY), start = structuredClone(f.renderer.renovation.layout.furniture[0]);
    for (const [direction, x, z] of [['left', start.x + 1, start.z], ['right', start.x, start.z], ['up', start.x, start.z - 1], ['down', start.x, start.z]]) {
      const button = f.nodes.find(node => node.dataset.layoutMove === direction); assert.ok(button);
      f.root.emit('click', { target: button });
      const current = f.renderer.renovation.layout.furniture[0];
      assert.equal(current.x, x, direction); assert.equal(current.z, z, direction);
      assert.deepEqual(f.state(), state); assert.equal(f.memory.getItem(SAVE_KEY), raw);
    }
    f.click('#renovation-cancel'); assert.deepEqual(f.state(), state);
  } finally { f.dispose(); }
});

test('TC-3D-027 coffee tabs switch within one read-only modal and keep independent upgrade selection', () => {
  const initial = fundedInitial(50000); initial.coffeeLevels = { espresso: 2, latte: 4 };
  const f = fixture({ initial });
  try {
    const before = f.state(), raw = f.memory.getItem(SAVE_KEY);
    f.click('#dock-coffee'); const dialog = f.element('#operation-dialog');
    assert.equal(dialog.showModalCalls, 1);
    for (const recipe of ['latte', 'espresso', 'latte']) {
      const tab = f.nodes.find(node => node.dataset.viewCoffee === recipe);
      f.root.emit('click', { target: tab });
      assert.equal(dialog.showModalCalls, 1); assert.equal(f.element('#coffee-panel').hidden, false);
      assert.equal(f.element('#dialog-title').textContent, recipeById[recipe].name);
      assert.equal(f.element('#coffee-image').getAttribute('src'), `./assets/catalog-${recipe}.svg`);
      for (const other of f.nodes.filter(node => node.dataset.viewCoffee)) assert.equal(other.getAttribute('aria-pressed'), String(other === tab));
      assert.equal(f.element('#coffee-level').textContent, `Lv. ${before.coffeeLevels[recipe]} → ${before.coffeeLevels[recipe] + 1}`);
      assert.deepEqual(f.state(), before); assert.equal(f.memory.getItem(SAVE_KEY), raw);
    }
    const expected = createEngine(before); expected.upgradeCoffee('latte'); f.click('#coffee-upgrade');
    assert.deepEqual(f.state(), expected.snapshot());
    assert.equal(f.state().coffeeLevels.espresso, before.coffeeLevels.espresso);
  } finally { f.dispose(); }
});
