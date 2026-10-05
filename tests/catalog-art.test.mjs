import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const main = readFileSync(new URL('../src/slice/main.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/slice/style.css', import.meta.url), 'utf8');
const names = ['counter', 'table', 'espresso', 'latte', 'invite', 'garden', 'terrace', 'sunset'];

test('TC-3D-027 every catalogue kind and supported dock action has original self-contained SVG artwork', () => {
  for (const name of names) {
    const path = new URL(`../public/assets/catalog-${name}.svg`, import.meta.url);
    assert.ok(existsSync(path), name);
    const svg = readFileSync(path, 'utf8');
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /viewBox="0 0 120 100"/);
    assert.match(svg, /<path\b/);
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|href=|url\(|onload=|<text\b/i);
    assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:|data:/i);
  }
  for (const name of ['espresso', 'garden', 'table', 'invite']) assert.match(main, new RegExp(`src="\\./assets/catalog-${name}\\.svg"`));
  assert.match(main, /image\.setAttribute\("src", `\.\/assets\/catalog-\$\{art\}\.svg`\)/);
  assert.doesNotMatch(main, /data-catalog-tab="coffee"|id="vault-panel"|id="manager-upgrade"|墙上.*咖啡/);
});

test('TC-3D-027 floating dock and pictured workbench leave viewport margins with accessible controls', () => {
  assert.match(css, /width: min\(880px, calc\(100vw - 32px\)\)/);
  assert.match(css, /\.action-dock span \{[^}]*opacity: 0;/);
  assert.match(css, /\.action-dock button:focus-visible span \{ opacity: 1; \}/);
  assert.match(css, /\.counter-shortcut button \{[^}]*min-height: 44px;/);
  assert.match(main, /id="business-toggle"[^>]*aria-pressed="false"/);
  assert.match(main, /aria-label="升级咖啡"/);
  assert.match(main, /aria-label="切换背景"/);
  assert.match(main, /aria-label="布置家具"/);
  assert.match(main, /aria-label="招呼客人"/);
});
