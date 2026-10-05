import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { capabilities, checksum, compareReadback, createProbe, errorMessage, filename, MAX_BYTES, nextRevision, openSelected, readProbe, saveNewCopy, serialize, validateDocument, validateName, randomId } from './probe.ts';
const id = '00000000-0000-4000-8000-000000000001';
const copy = '00000000-0000-4000-8000-000000000002';
const document = createProbe(id, '2026-10-05T11:00:00.000Z');
const text = serialize(document), name = filename(document, copy);
const file = (content = text, selectedName = name, size = Buffer.byteLength(content)) => ({ name: selectedName, size, arrayBuffer: async () => new TextEncoder().encode(content).buffer });
const host = extras => ({ isSecureContext: true, ...extras });

test('TC-FILE-001 synthetic generation has fixed payload and exact five fields; revision does not mutate source', () => {
  assert.deepEqual(Object.keys(document).sort(), ['createdAt', 'payload', 'probeId', 'revision', 'schemaVersion']);
  assert.equal(nextRevision(document).revision, 2); assert.equal(document.revision, 1);
  assert.throws(() => nextRevision({ ...document, revision: 1_000_000 }));
  assert.match(randomId(webcrypto), /^[a-f0-9-]{36}$/);
  assert.equal(validateDocument(createProbe(randomId(webcrypto), document.createdAt)).schemaVersion, 1);
});
test('TC-FILE-002 absent APIs, insecure contexts, unsupported sharing and throwing canShare fall back safely', () => {
  assert.deepEqual(capabilities(host()), { secure: true, open: false, save: false, shareFile: false });
  const all = { showOpenFilePicker() {}, showSaveFilePicker() {} };
  assert.deepEqual(capabilities({ isSecureContext: false, ...all }), { secure: false, open: false, save: false, shareFile: false });
  assert.equal(capabilities(host(all)).save, true);
  const share = { share() {}, canShare({ files }) { return files[0].type === 'application/json'; } };
  assert.equal(capabilities(host(), share, new File([text], name, { type: 'application/json' })).shareFile, true);
  assert.equal(capabilities(host(), { ...share, canShare() { throw new Error('unsupported'); } }, new File([], name)).shareFile, false);
  assert.equal(capabilities(host(), share, new File([], name, { type: 'text/plain' })).shareFile, false);
});
test('TC-FILE-003 safe valid JSON reads exact bytes and independently verified SHA-256', async () => {
  const result = await readProbe(file(), webcrypto);
  assert.deepEqual(result.document, document); assert.equal(result.text, text);
  assert.equal(result.hash, createHash('sha256').update(text).digest('hex'));
  assert.equal(await checksum(text), null);
  assert.equal((await readProbe(file())).hash, null);
});
test('TC-FILE-004 malformed, wrong version, unsupported fields/payload, bad IDs/dates/revisions are rejected', async () => {
  await assert.rejects(readProbe(file('{bad')));
  for (const value of [null, [], 3, { ...document, schemaVersion: 2 }, { ...document, payload: '<script>bad()</script>' }, { ...document, state: {} }, { ...document, probeId: '../test' }, { ...document, createdAt: '2026-02-30T11:00:00.000Z' }, { ...document, createdAt: '2026-10-05' }, ...[0, -1, 1.5, 1_000_001, Infinity, '2'].map(revision => ({ ...document, revision }))]) {
    await assert.rejects(readProbe(file(JSON.stringify(value))));
  }
  await assert.rejects(readProbe(file(text.replace('"schemaVersion": 1', '"__proto__": {}, "schemaVersion": 1'))));
});
test('TC-FILE-005 bounded file name and size reject before reading; actual UTF-8 length checked too', async () => {
  for (const bad of ['../'+name, '/tmp/'+name, 'C:\\'+name, name+'\n', 'game-save.json', 'mellow-bean-probe-<img>.json', 'mellow-bean-probe-'+ 'a'.repeat(180)+'.json', 'mellow-bean-probe-..json']) assert.throws(() => validateName(bad));
  validateName('mellow-bean-probe-test (1).json');
  for (const size of [-1, 0, NaN, 1.5, MAX_BYTES+1]) {
    let read = false;
    await assert.rejects(readProbe({ name, size, arrayBuffer: async () => { read = true; return new TextEncoder().encode(text).buffer; } }));
    assert.equal(read, false);
  }
  await assert.rejects(readProbe(file(' '.repeat(MAX_BYTES) + text, name, 1)));
  await assert.rejects(readProbe(file('你'.repeat(MAX_BYTES/2), name, 1)));
});
test('TC-FILE-006 open is selected-file-only and picker invoked synchronously; no createWritable call', async () => {
  let called = false, writes = 0;
  const result = openSelected(host({ showOpenFilePicker(options) { called = true; assert.equal(options.multiple, false); return Promise.resolve([{ getFile: async () => file(), createWritable() { writes++; } }]); } }), webcrypto);
  assert.equal(called, true); assert.equal((await result).hash.length, 64); assert.equal(writes, 0);
  await assert.rejects(openSelected(host()));
  await assert.rejects(openSelected(host({ showOpenFilePicker: async () => [] })));
});
test('TC-FILE-007 cancel and denial remain errors with honest user messages; no fallback permission request', async () => {
  for (const errorName of ['AbortError', 'NotAllowedError', 'SecurityError']) {
    const error = new DOMException('private detail', errorName);
    await assert.rejects(openSelected(host({ showOpenFilePicker: async () => { throw error; } })), candidate => candidate === error);
    assert.ok(errorMessage(error).length > 5); assert.ok(!errorMessage(error).includes('private detail'));
  }
});
test('TC-FILE-008 save-as uses a fresh name, rejects renamed or nonempty targets before createWritable', async () => {
  for (const selected of [{ name: 'mellow-bean-probe-original.json', size: 0 }, { name, size: text.length }]) {
    let writes = 0;
    await assert.rejects(saveNewCopy(host({ showSaveFilePicker: async options => { assert.equal(options.suggestedName, name); return { name: selected.name, getFile: async () => file('', selected.name, selected.size), createWritable() { writes++; } }; } }), document, name));
    assert.equal(writes, 0);
  }
});
test('TC-FILE-009 a fresh synthetic copy closes and verifies exact readback; no handle persistence', async () => {
  let contents = '', closed = false, called = false;
  const handle = { name, getFile: async () => file(contents), createWritable: async () => ({ write: async data => { contents = data; }, close: async () => { closed = true; } }) };
  const pending = saveNewCopy(host({ showSaveFilePicker: options => { called = true; return Promise.resolve(handle); } }), document, name, webcrypto);
  assert.equal(called, true);
  const result = await pending;
  assert.equal(closed, true); assert.equal(result.text, text); assert.equal(result.hash, createHash('sha256').update(text).digest('hex'));
  assert.equal(Object.hasOwn(result, 'handle'), false);
});
test('TC-FILE-010 failed writes attempt abort, close/readback failures never report success', async () => {
  let aborted = false;
  await assert.rejects(saveNewCopy(host({ showSaveFilePicker: async () => ({ name, getFile: async () => file(''), createWritable: async () => ({ write: async () => { throw new Error('disk'); }, close: async () => {}, abort: async () => { aborted = true; } }) }) }), document, name));
  assert.equal(aborted, true);
  let reads = 0;
  await assert.rejects(saveNewCopy(host({ showSaveFilePicker: async () => ({ name, getFile: async () => file(reads++ ? text+' ' : ''), createWritable: async () => ({ write: async () => {}, close: async () => {} }) }) }), document, name), /字节不一致/);
});
test('TC-FILE-011 compare ID, revision AND exact hash; a valid file from another device has no local baseline', async () => {
  const read = await readProbe(file(), webcrypto), receipt = { probeId: id, revision: 1, hash: read.hash };
  assert.equal(compareReadback(read, [receipt]), 'match');
  assert.equal(compareReadback(read, []), 'unknown');
  assert.equal(compareReadback(read, [{ ...receipt, revision: 2 }]), 'unknown');
  assert.equal(compareReadback(read, [{ ...receipt, probeId: copy }]), 'unknown');
  assert.equal(compareReadback(read, [{ ...receipt, hash: 'bad' }]), 'mismatch');
  assert.equal(compareReadback({ ...read, hash: null }, [receipt]), 'unavailable');
});
test('TC-FILE-012 standalone source has no game imports, stored handles, directory picker, network or permission requests', async () => {
  const source = await Promise.all(['main.ts', 'probe.ts'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const text of source) assert.doesNotMatch(text, /(?:localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|requestPermission|showDirectoryPicker|eval\(|innerHTML|src\/slice)/);
  assert.match(source[0], /input\.value = ''/);
});

test('TC-FILE-013 raw-byte checksum distinguishes UTF-8 BOM and strict decoder rejects invalid encoding', async () => {
  const exported = await readProbe(new File([text], name), webcrypto);
  const withBOM = await readProbe(new File([new Uint8Array([0xef, 0xbb, 0xbf]), text], name), webcrypto);
  assert.deepEqual(withBOM.document, exported.document);
  assert.notEqual(withBOM.hash, exported.hash);
  assert.equal(withBOM.hash, createHash('sha256').update(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])).digest('hex'));
  assert.equal(compareReadback(withBOM, [{ probeId: id, revision: 1, hash: exported.hash }]), 'mismatch');
  await assert.rejects(readProbe(new File([new Uint8Array([0xff]), text], name), webcrypto), /UTF-8/);
  let reads = 0;
  await assert.rejects(saveNewCopy(host({ showSaveFilePicker: async () => ({ name, getFile: async () => reads++ ? new File([new Uint8Array([0xef, 0xbb, 0xbf]), text], name) : new File([], name), createWritable: async () => ({ write: async () => {}, close: async () => {} }) }) }), document, name), /字节不一致/);
});

test('TC-FILE-014 fresh phone-like UI imports revision 1, exports revision 2, and preserves valid content on cancel/error', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const probe = await import('./probe.ts');
  const nodes = new Map(), downloads = [], urls = new Map();
  const element = tag => ({ tagName: tag, textContent: '', disabled: false, value: '', files: [], children: [], handlers: new Map(),
    addEventListener(name, handler) { this.handlers.set(name, handler); },
    replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); }, remove() {},
    click() { if (this.tagName === 'a') downloads.push({ name: this.download, file: urls.get(this.href) }); else this.handlers.get('click')?.(); },
  });
  const dom = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); }, createElement: element, body: element('body') };
  let source = await readFile(new URL('./main.ts', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '');
  const context = { ...probe, document: dom, window: { isSecureContext: true }, navigator: {}, crypto: webcrypto, File,
    URL: { createObjectURL(file) { const url = `blob:test-${urls.size}`; urls.set(url, file); return url; }, revokeObjectURL() {} }, setTimeout() {} };
  runInNewContext(stripTypeScriptTypes(source), context, { timeout: 1000 });
  const node = id => dom.getElementById(id);
  const settle = async () => { for (let i = 0; i < 500 && node('file-input').disabled; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(node('file-input').disabled, false); };
  const contents = () => JSON.parse(node('preview').textContent);
  assert.equal(node('revise').disabled, true);
  assert.equal(node('open-picker').disabled, true);
  assert.equal(node('save-picker').disabled, true);
  assert.equal(node('share').disabled, true);
  // Import an existing other-device file without ever clicking Generate.
  node('file-input').value = 'C:\\fakepath\\' + name;
  node('file-input').files = [new File([text], name, { type: 'application/json' })];
  node('file-input').handlers.get('change')(); await settle();
  assert.equal(node('file-input').value, '');
  assert.deepEqual(contents(), document);
  assert.equal(node('revise').disabled, false);
  node('revise').click(); await settle();
  const revised = contents();
  assert.equal(revised.probeId, document.probeId); assert.equal(revised.createdAt, document.createdAt); assert.equal(revised.revision, 2);
  assert.equal(node('download').disabled, false);
  node('download').click(); await settle();
  assert.equal(downloads.length, 1); assert.match(downloads[0].name, /-r2-copy-/);
  assert.deepEqual(JSON.parse(await downloads[0].file.text()), revised);
  node('file-input').handlers.get('cancel')(); assert.deepEqual(contents(), revised);
  node('file-input').files = [new File(['{bad'], name)];
  node('file-input').handlers.get('change')(); await settle();
  assert.match(node('status').textContent, /JSON/); assert.deepEqual(contents(), revised);
  // Reading the same original again is allowed and restores revision 1.
  node('file-input').files = [new File([text], name)];
  node('file-input').handlers.get('change')(); await settle();
  assert.deepEqual(contents(), document); assert.equal(document.revision, 1);
});
