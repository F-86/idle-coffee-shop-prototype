import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import postcss from 'postcss';

// Static markup/CSS contracts only. These do not replace browser interaction or pixel QA.
const main = readFileSync(new URL('../src/slice/main.ts', import.meta.url), 'utf8');
const css = postcss.parse(readFileSync(new URL('../src/slice/style.css', import.meta.url), 'utf8'));
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const template = main.match(/root\.innerHTML\s*=\s*(`[\s\S]+?`)\s*;\s*const \$/)?.[1];
assert.ok(template, 'the actual app markup is available to inspect');
const generated = stripTypeScriptTypes(`globalThis.html = ${template};`);
const html = runInNewContext(`${generated}\nhtml;`, {}, { timeout: 1000 });
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

test('TC-3D-007 REQ-3D-009 full-viewport scene has no webpage frame or page scroll (static contract)', () => {
  assert.deepEqual(declarations('.coffee-world', 'position'), ['fixed']);
  assert.deepEqual(declarations('.coffee-world', 'inset'), ['0']);
  assert.deepEqual(declarations('.coffee-world', 'width'), ['100vw']);
  assert.deepEqual(declarations('.coffee-world', 'height'), ['100vh', '100dvh']);
  for (const selector of ['html', 'body', '#slice-root']) {
    assert.deepEqual(declarations(selector, 'margin'), ['0']);
    assert.deepEqual(declarations(selector, 'overflow'), ['hidden']);
  }
  assert.deepEqual(declarations('#coffee-canvas', 'width'), ['100%']);
  assert.deepEqual(declarations('#coffee-canvas', 'height'), ['100%']);
  assert.deepEqual(declarations('#coffee-canvas', 'touch-action'), ['none']);
  assert.equal(declarations('.coffee-world', 'border').length, 0);
  assert.equal(declarations('.coffee-world', 'border-radius').length, 0);
  assert.equal(declarations('#coffee-canvas', 'min-width').length, 0, 'no oversized scrolling canvas surrogate');
  assert.doesNotMatch(outsideModal, /<aside\b|counter-card|station-card|save-panel|经营卡片/);
  assert.equal(openingTags(outsideModal, 'canvas').length, 1);
});

test('TC-3D-007 REQ-3D-009 permanent HUD contains only balance/status and two small actions (static contract)', () => {
  const hud = html.match(/<header\b[^>]*class="hud"[\s\S]*?<\/header>/)?.[0];
  assert.ok(hud);
  const buttons = openingTags(hud, 'button');
  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /id="pause"/);
  assert.match(buttons[1], /id="settings"/);
  assert.doesNotMatch(hud, /<h[1-6]\b|MELLOW BEAN|本地存档|data-counter|data-select-recipe/);
});

test('TC-3D-007 REQ-3D-010 all nine accessible controls are tied to room anchors (static contract)', () => {
  const nav = html.match(/<nav\b[^>]*id="world-controls"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  const buttons = openingTags(nav, 'button');
  const anchors = buttons.map(button => button.match(/data-anchor="([^"]+)"/)?.[1]);
  assert.deepEqual(anchors.sort(), ['counter-a-recipe', 'counter-a-upgrade', 'counter-b-recipe', 'counter-b-upgrade', 'invite', 'manager', 'menu-espresso', 'menu-latte', 'vault'].sort());
  for (const button of buttons) assert.match(button, /aria-label="[^"]+"/);
  assert.match(nav, /data-menu="espresso"/);
  assert.match(nav, /data-menu="latte"/);
  assert.doesNotMatch(nav, /研发|购买配方|未解锁/);
  assert.match(main, /scene\.projectAnchor\(/);
  assert.match(main, /button\.hidden = !anchor\.visible/);
  assert.match(main, /anchor\.x\.toFixed\(2\)[\s\S]*?anchor\.y\.toFixed\(2\)/);
});

test('TC-3D-007 REQ-3D-012 operating panels exist only inside a closed native dialog (static contract)', () => {
  assert.ok(modalStart >= 0);
  assert.doesNotMatch(openingTags(modal, 'dialog')[0], /\bopen(?:\s|=|>)/);
  const panels = openingTags(modal, 'div').filter(tag => tag.includes('class="operation-panel"'));
  assert.equal(panels.length, 5);
  for (const panel of panels) assert.match(panel, /\bhidden(?:\s|>)/);
  assert.doesNotMatch(outsideModal, /class="operation-panel"|id="counter-panel"|id="settings-panel"/);
  assert.deepEqual(declarations('[hidden]', 'display'), ['none']);
  assert.ok(rules('[hidden]')[0].nodes.some(node => node.prop === 'display' && node.important));
  assert.match(main, /dialog\.showModal\(\)/, 'native modal supplies inert background and Escape handling');
  assert.match(main, /on\(dialog, "close"/);
  assert.match(main, /on\(\$\("#dialog-close"\), "click", closePanel\)/);
  assert.match(main, /event\.target === dialog/);
});

test('TC-3D-007 REQ-3D-012 controls maintain 44px targets, safe-area and dynamic viewport hooks (static contract)', () => {
  assert.match(index, /viewport-fit=cover/);
  assert.deepEqual(declarations('.world-button', 'min-height'), ['44px']);
  assert.deepEqual(declarations('.world-button', 'touch-action'), ['none'], 'capturing an overlay-started drag must also disable native panning at the original hit target');
  for (const selector of ['.hud-button', '.dialog-close']) {
    for (const property of ['width', 'height']) {
      for (const value of declarations(selector, property)) assert.ok(Number.parseFloat(value) >= 44, `${selector} ${property}: ${value}`);
    }
  }
  for (const selector of ['.primary-button', '.secondary-button', '.assign-buttons button', '.settings-grid button', '.jump-grid button', '.recipe-picker button', 'summary']) {
    assert.ok(declarations(selector, 'min-height').some(value => Number.parseFloat(value) >= 44), selector);
  }
  for (const [property, inset] of [['left', 'left'], ['right', 'right'], ['top', 'top']]) {
    assert.ok(declarations('.hud', property).every(value => value.includes(`safe-area-inset-${inset}`)));
  }
  assert.ok(declarations('.operation-dialog', 'max-height').every(value => value.includes('dvh') && value.includes('safe-area-inset-bottom')));
  assert.match(main, /sizeObserver\?\.observe\(\$\("#coffee-canvas"\)\)/);
  assert.match(main, /on\(visualViewport, "resize"/);
  assert.match(main, /sizeObserver\?\.disconnect\(\)/);
  assert.match(main, /listeners\.abort\(\)/);
});

test('TC-3D-007 REQ-3D-012 delegated clicks reject pointer activation but preserve keyboard actions (handler seam)', () => {
  // Invoke the actual delegated callback with synthetic events. This is not a browser gesture test.
  const body = main.match(/on\(root,\s*"click",\s*([\s\S]*?)\n\}\);/)?.[1];
  assert.ok(body, 'the delegated app callback is available');
  const calls = [];
  const context = {
    invite: () => calls.push('invite'),
    showPanel: (...args) => calls.push(args),
  };
  const handler = runInNewContext(stripTypeScriptTypes(`(${body}\n})`), context);
  for (const button of [
    { id: 'invite', dataset: { anchor: 'invite' } },
    { id: '', dataset: { anchor: 'counter-a-recipe', selector: 'counter-a' } },
    { id: '', dataset: { anchor: 'menu-latte', menu: 'latte' } },
  ]) {
    const event = { target: { closest: () => button }, detail: 1 };
    handler(event);
  }
  assert.deepEqual(calls, [], 'pointer-generated click cannot duplicate shared scene activation or turn an interrupted gesture into a click');
  handler({ target: { closest: () => ({ id: 'invite', dataset: { anchor: 'invite' } }) }, detail: 0 });
  handler({ target: { closest: () => ({ id: '', dataset: { anchor: 'counter-a-recipe', selector: 'counter-a' } }) }, detail: 0 });
  handler({ target: { closest: () => ({ id: '', dataset: { anchor: 'menu-latte', menu: 'latte' } }) }, detail: 0 });
  assert.deepEqual(calls, ['invite', ['counter', 'counter-a'], ['coffee', undefined, 'latte']]);
  assert.match(main, /on\(button, "pointerdown"/);
  assert.match(main, /scene\?\.beginAnchorPointer\(/);
  assert.match(main, /if \(dialog\.open\)[\s\S]*?#dialog-close[\s\S]*?\.focus\(/, 'switching an open modal puts focus on a visible control');
});
