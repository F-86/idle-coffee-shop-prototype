import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const asset = name => readFileSync(new URL(`../public/icons/${name}`, import.meta.url));
const links = [...source.matchAll(/<link\b[^>]*>/g)].map(([tag]) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));

test('TC-WEB-ICON-001: the main entry declares local scalable and legacy tab icons', () => {
  assert.ok(links.some(link => link.rel === 'icon' && link.type === 'image/svg+xml' &&
    link.sizes === 'any' && link.href === '/icons/mellow-bean.svg'));
  assert.ok(links.some(link => link.rel === 'icon' && link.sizes === '16x16 32x32 48x48' &&
    link.href === '/icons/mellow-bean.ico'));
  for (const link of links.filter(link => link.rel.includes('icon'))) {
    assert.match(link.href, /^\/icons\/[\w.-]+$/);
    assert.ok(asset(link.href.split('/').at(-1)).length > 0);
  }
});

test('TC-WEB-ICON-002: home-screen PNGs have the declared dimensions and opaque backgrounds', () => {
  for (const [rel, name, size] of [
    ['apple-touch-icon', 'apple-touch-icon.png', 180],
    ['icon', 'mellow-bean-192.png', 192],
  ]) {
    assert.ok(links.some(link => link.rel === rel && link.href === `/icons/${name}` && link.sizes === `${size}x${size}`));
    const png = asset(name);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[24], 8, '8-bit channels');
    assert.equal(png[25], 2, 'RGB without alpha');
    for (let offset = 8; offset < png.length;) {
      assert.notEqual(png.toString('ascii', offset + 4, offset + 8), 'tRNS', 'no transparent color');
      offset += png.readUInt32BE(offset) + 12;
      assert.ok(offset <= png.length);
    }
  }
});

test('TC-WEB-ICON-003: ICO contains valid 16, 32 and 48 pixel PNG frames', () => {
  const ico = asset('mellow-bean.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset >= 54 && offset + length <= ico.length);
    assert.equal(ico.toString('ascii', offset + 1, offset + 4), 'PNG');
    assert.equal(ico.readUInt32BE(offset + 16), size);
    assert.equal(ico.readUInt32BE(offset + 20), size);
  }
});

test('TC-WEB-ICON-004: original SVG is self-contained and adds no application behavior', () => {
  const svg = asset('mellow-bean.svg').toString('utf8');
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /<title>Mellow Bean coffee cup<\/title>/);
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image|text)\b|\bon\w+=|\bhref=|url\(|@import|<!ENTITY/i);
  assert.equal(links.filter(link => link.rel === 'manifest').length, 0);
  assert.match(source, /<meta name="theme-color" content="#1e524a"/);
  assert.equal((source.match(/<script\b/g) ?? []).length, 1);
});

test('TC-WEB-ICON-001: built root and Pages icon URLs return the exact assets with image MIME types', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outDir = await mkdtemp(join(tmpdir(), 'mellow-bean-icon-'));
  try {
    for (const base of ['/', '/idle-coffee-shop-prototype/']) {
      await build({ root, base, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
      const html = await readFile(join(outDir, 'index.html'), 'utf8');
      const builtLinks = [...html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g)];
      assert.equal(builtLinks.length, 4);
      const server = await preview({ root, base, logLevel: 'silent', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
      try {
        const { port } = server.httpServer.address();
        for (const [tag] of builtLinks) {
          const href = tag.match(/href="([^"]+)"/)[1];
          assert.ok(href.startsWith(`${base}icons/`), `base path preserved: ${href}`);
          const response = await fetch(`http://127.0.0.1:${port}${href}`);
          assert.equal(response.status, 200);
          const ext = href.split('.').at(-1);
          assert.match(response.headers.get('content-type'), {
            svg: /^image\/svg\+xml(?:;|$)/,
            png: /^image\/png(?:;|$)/,
            ico: /^image\/(?:x-icon|vnd\.microsoft\.icon)(?:;|$)/,
          }[ext]);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset(href.split('/').at(-1)));
        }
      } finally {
        await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
      }
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
