/** Isolated synthetic-file probe. No game imports, browser storage, or network. */
export const MAX_BYTES = 16 * 1024;
export const MAX_REVISION = 1_000_000;
export const SYNTHETIC_PAYLOAD = 'Mellow Bean synthetic file probe. No game or personal data.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface ProbeDocument {
  schemaVersion: 1;
  probeId: string;
  revision: number;
  createdAt: string;
  payload: typeof SYNTHETIC_PAYLOAD;
}
export interface FileLike { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
export interface ProbeRead { document: ProbeDocument; text: string; bytes: Uint8Array; hash: string | null; name: string }
export interface FileHandle {
  name: string;
  getFile(): Promise<FileLike>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}
export type PickerOptions = { types: { description: string; accept: { 'application/json': string[] } }[]; excludeAcceptAllOption: boolean; multiple?: boolean; suggestedName?: string };
export interface PickerHost {
  isSecureContext: boolean;
  showOpenFilePicker?: (options: PickerOptions) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: PickerOptions) => Promise<FileHandle>;
}
export class ProbeError extends Error {}
const fail = (message: string): never => { throw new ProbeError(message); };

export function validateDocument(value: unknown): ProbeDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('文件不是测试 JSON 对象。');
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort().join(',');
  if (keys !== 'createdAt,payload,probeId,revision,schemaVersion') return fail('仅接受本工具生成的五字段测试文件，不接受游戏存档或额外字段。');
  if (object.schemaVersion !== 1) return fail('不支持的测试文件版本；需要 schemaVersion 1。');
  if (typeof object.probeId !== 'string' || !UUID.test(object.probeId)) return fail('测试文件 probeId 无效。');
  if (!Number.isSafeInteger(object.revision) || (object.revision as number) < 1 || (object.revision as number) > MAX_REVISION) return fail('revision 必须是 1–1000000 的整数。');
  if (typeof object.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(object.createdAt) || !Number.isFinite(Date.parse(object.createdAt)) || new Date(object.createdAt).toISOString() !== object.createdAt) return fail('createdAt 不是有效的 UTC 时间。');
  if (object.payload !== SYNTHETIC_PAYLOAD) return fail('payload 不是固定的合成测试内容；不会导入真实数据。');
  return { schemaVersion: 1, probeId: object.probeId, revision: object.revision as number, createdAt: object.createdAt, payload: SYNTHETIC_PAYLOAD };
}
export function randomId(cryptoApi: Pick<Crypto, 'getRandomValues'>): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function createProbe(id: string, createdAt: string): ProbeDocument {
  return validateDocument({ schemaVersion: 1, probeId: id, revision: 1, createdAt, payload: SYNTHETIC_PAYLOAD });
}
export function nextRevision(document: ProbeDocument): ProbeDocument {
  return validateDocument({ ...validateDocument(document), revision: document.revision + 1 });
}
export function serialize(document: ProbeDocument): string { return JSON.stringify(validateDocument(document), null, 2) + '\n'; }
export function validateName(name: string): void {
  if (name.length > 180 || !/^mellow-bean-probe-[a-zA-Z0-9() _-]+\.json$/.test(name)) fail('请选择 mellow-bean-probe- 开头的 .json 测试文件（文件名不超过 180 字符，不含路径）。');
}
export function filename(document: ProbeDocument, copyId: string): string {
  validateDocument(document);
  if (!UUID.test(copyId)) return fail('副本 ID 无效。');
  return `mellow-bean-probe-${document.probeId}-r${document.revision}-copy-${copyId}.json`;
}
export async function checksum(data: string | Uint8Array, cryptoApi?: Pick<Crypto, 'subtle'>): Promise<string | null> {
  if (!cryptoApi?.subtle) return null;
  const hash = await cryptoApi.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function readProbe(file: FileLike, cryptoApi?: Pick<Crypto, 'subtle'>): Promise<ProbeRead> {
  validateName(file.name);
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_BYTES) return fail('测试文件必须为 1–16384 字节。未读取超限文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail('读取内容超过 16384 字节。');
  if (bytes.byteLength !== file.size) return fail('文件大小与读取结果不一致。');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('文件不是有效 UTF-8。'); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('文件不是有效 JSON。'); }
  return { document: validateDocument(value), text, bytes, hash: await checksum(bytes, cryptoApi), name: file.name };
}
export function capabilities(host: PickerHost, navigatorApi?: Pick<Navigator, 'share' | 'canShare'>, file?: File) {
  let shareFile = false;
  try { shareFile = !!(host.isSecureContext && file && typeof navigatorApi?.share === 'function' && typeof navigatorApi.canShare === 'function' && navigatorApi.canShare({ files: [file] })); } catch { /* An unsupported file type is a normal fallback. */ }
  return { secure: host.isSecureContext, open: host.isSecureContext && typeof host.showOpenFilePicker === 'function', save: host.isSecureContext && typeof host.showSaveFilePicker === 'function', shareFile };
}
const pickerOptions = (): PickerOptions => ({ types: [{ description: 'Mellow Bean 合成测试 JSON', accept: { 'application/json': ['.json'] } }], excludeAcceptAllOption: true });
export async function openSelected(host: PickerHost, cryptoApi?: Pick<Crypto, 'subtle'>): Promise<ProbeRead> {
  if (!capabilities(host).open) return fail('当前浏览器没有文件读取选择器；请使用“选择测试文件”。');
  // Invoke before the first await so transient user activation reaches the picker.
  const handles = await host.showOpenFilePicker!({ ...pickerOptions(), multiple: false });
  if (handles.length !== 1) return fail('请选择一个测试文件。');
  return readProbe(await handles[0].getFile(), cryptoApi);
}
export async function saveNewCopy(host: PickerHost, document: ProbeDocument, name: string, cryptoApi?: Pick<Crypto, 'subtle'>): Promise<ProbeRead> {
  if (!capabilities(host).save) return fail('当前浏览器没有文件保存选择器；请使用下载副本。');
  validateName(name);
  const text = serialize(document);
  const handle = await host.showSaveFilePicker!({ ...pickerOptions(), suggestedName: name });
  // Save-As can select an existing file. Refuse a changed name or any nonempty file.
  // A random per-action name avoids selecting the imported/source probe in normal use.
  if (handle.name !== name) return fail('为保护原文件，请保留随机生成的新副本文件名。没有写入内容。');
  const before = await handle.getFile();
  if (before.name !== name || before.size !== 0) return fail('所选文件已有内容。已拒绝覆盖，请保存为新文件。');
  const writable = await handle.createWritable();
  try { await writable.write(text); await writable.close(); }
  catch (error) { try { await writable.abort?.(); } catch { /* Preserve original failure. */ } throw error; }
  const result = await readProbe(await handle.getFile(), cryptoApi);
  const expectedBytes = new TextEncoder().encode(text);
  if (result.bytes.length !== expectedBytes.length || !result.bytes.every((byte, index) => byte === expectedBytes[index])) return fail('写入后读回的字节不一致，文件结果不确定。请重新导出新副本。');
  return result;
}
export type Receipt = { probeId: string; revision: number; hash: string | null };
export function compareReadback(read: ProbeRead, receipts: readonly Receipt[]): 'match' | 'mismatch' | 'unknown' | 'unavailable' {
  if (!read.hash) return 'unavailable';
  const candidates = receipts.filter(item => item.probeId === read.document.probeId && item.revision === read.document.revision);
  if (!candidates.length) return 'unknown';
  return candidates.some(item => item.hash === read.hash) ? 'match' : 'mismatch';
}
export function errorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'AbortError') return '已取消。当前测试内容未变更。';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '浏览器拒绝访问或当前上下文不允许该操作。未绕过权限；可改用文件选择/下载。';
  if (error instanceof ProbeError) return error.message;
  return '文件操作失败。若发生在写入后，目标文件状态不确定；请检查文件并重新导出新副本。';
}
