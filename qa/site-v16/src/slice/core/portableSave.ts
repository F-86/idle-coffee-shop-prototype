import { OFFLINE_POLICY_VERSION, validateState } from './persistence';
import { ECONOMY_VERSION } from './engine';
import { getLayout } from './layout';
import type { RecipeId, SliceState } from './types';

export const PORTABLE_FORMAT = 'mellow-bean-portable-save';
// File6 uses uniform counter upgrades; file5 retains bounded ingredient inventory. Original file1–4 bytes
// and previews are checked before the one-time economic migration.
export const PORTABLE_VERSION = 9;
export const MAX_PORTABLE_BYTES = 256 * 1024;
export interface SaveLineage { saveId: string; revision: number }
export interface SaveOverview {
  wallet: number; totalEarned: number; totalServed: number; elapsed: number;
  counterLevels: number[]; coffeeLevels: Record<RecipeId, number>; managerLevel: number; pendingCash: number; carrying: number;
  placedCounters: number; placedSeats: number; expanded: boolean; ingredients?: { beans: number; milk: number };
}
export interface PortablePayload extends SaveLineage {
  gameSchemaVersion: 1; economyVersion: 9; offlinePolicyVersion: 4;
  savedAt: number; exportedAt: number; overview: SaveOverview; state: SliceState;
}
export interface PortableFile { text: string; fingerprint: string; payload: PortablePayload }
export type PortableParse = { ok: true; file: PortableFile } | { ok: false; message: string };
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15;
export const validLineage = (v: unknown): v is SaveLineage => object(v) && typeof v.saveId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(v.saveId) && Number.isSafeInteger(v.revision) && (v.revision as number) >= 1 && (v.revision as number) < Number.MAX_SAFE_INTEGER;
export function overviewOf(state: SliceState): SaveOverview {
  const layout = getLayout(state);
  return { wallet: state.wallet, totalEarned: state.totalEarned, totalServed: state.totalServed, elapsed: state.elapsed, counterLevels: state.counters.map(c => c.level), coffeeLevels: { ...state.coffeeLevels }, managerLevel: state.manager.level, pendingCash: state.counters.reduce((n, c) => n + c.pendingCash, 0), carrying: state.manager.carrying, placedCounters: layout.furniture.filter(item => item.kind === 'counter' && !item.stored).length, placedSeats: layout.furniture.filter(item => item.kind === 'table' && !item.stored).length, expanded: layout.expanded, ...(state.economyVersion >= 5 ? { ingredients: { ...state.ingredients } } : {}) };
}
function boundedJson(value: unknown, depth = 0, budget = { remaining: MAX_PORTABLE_BYTES }): boolean {
  if (--budget.remaining < 0 || depth > 20) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(v => boundedJson(v, depth + 1, budget));
  return object(value) && Object.entries(value).every(([k, v]) => !['__proto__', 'constructor', 'prototype'].includes(k) && boundedJson(v, depth + 1, budget));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
async function digest(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw Error('此浏览器无法校验存档文件，请使用安全连接下的新版 Safari 或 Chrome。');
  const bytes = new TextEncoder().encode(text);
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function checkedPayload(value: unknown, formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = PORTABLE_VERSION): PortablePayload | null {
  const economyVersion = formatVersion;
  if (!object(value) || !boundedJson(value) || !validLineage(value) || value.gameSchemaVersion !== 1 || value.economyVersion !== economyVersion || value.offlinePolicyVersion !== (formatVersion < 5 ? 3 : OFFLINE_POLICY_VERSION) || !timestamp(value.savedAt) || !timestamp(value.exportedAt)) return null;
  const expectedKeys = ['saveId', 'revision', 'gameSchemaVersion', 'economyVersion', 'offlinePolicyVersion', 'savedAt', 'exportedAt', 'overview', 'state'];
  if (Object.keys(value).some(key => !expectedKeys.includes(key)) || Object.keys(value).length !== expectedKeys.length) return null;
  // Match both explicit versions before migration. Relabelled modern data must
  // never pass through an older envelope and quietly lose paid progression.
  if (!object(value.state) || value.state.economyVersion !== economyVersion) return null;
  const checked = validateState(value.state);
  if (!checked.ok) return null;
  const overview = overviewOf(checked.state);
  // Verify the file's original preview before the one-time cash transfer.
  const original = value.state as unknown as SliceState;
  const { ingredients: _ingredients, ...preIngredientOverview } = overview;
  const sourceOverview = { ...(formatVersion < 5 ? preIngredientOverview : overview), wallet: original.wallet, pendingCash: original.counters.reduce((sum, counter) => sum + counter.pendingCash, 0), carrying: original.manager.carrying,
    ...(formatVersion >= 3 ? { placedCounters: original.layout!.furniture.filter(item => item.kind === 'counter' && !item.stored).length, placedSeats: original.layout!.furniture.filter(item => item.kind === 'table' && !item.stored).length, expanded: original.layout!.expanded } : {}) };
  const { placedCounters: _counters, placedSeats: _seats, expanded: _expanded, ...coffeeOverview } = sourceOverview;
  const { coffeeLevels: _levels, ...legacyOverview } = coffeeOverview;
  const expectedOverview = formatVersion === 1 ? legacyOverview : formatVersion === 2 ? coffeeOverview : sourceOverview;
  if (JSON.stringify(value.overview) !== JSON.stringify(expectedOverview)) return null;
  return { ...value, economyVersion: ECONOMY_VERSION, offlinePolicyVersion: OFFLINE_POLICY_VERSION, overview, state: checked.state } as unknown as PortablePayload;
}
/** Digest covers the exact UTF-8 payloadText, including metadata. It is not a signature. */
export async function parsePortableSave(text: string): Promise<PortableParse> {
  if (new TextEncoder().encode(text).byteLength > MAX_PORTABLE_BYTES) return { ok: false, message: '文件超过 256 KiB，未读取为存档。' };
  try {
    const value: unknown = JSON.parse(text);
    if (!object(value) || value.format !== PORTABLE_FORMAT || (value.formatVersion !== 1 && value.formatVersion !== 2 && value.formatVersion !== 3 && value.formatVersion !== 4 && value.formatVersion !== 5 && value.formatVersion !== 6 && value.formatVersion !== 7 && value.formatVersion !== 8 && value.formatVersion !== PORTABLE_VERSION) || typeof value.payloadText !== 'string' || !object(value.integrity) || value.integrity.algorithm !== 'SHA-256' || typeof value.integrity.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.integrity.sha256) || Object.keys(value).sort().join() !== ['format', 'formatVersion', 'integrity', 'payloadText'].sort().join() || Object.keys(value.integrity).sort().join() !== 'algorithm,sha256') return { ok: false, message: '这不是受支持的 Mellow Bean 存档文件 v1/v2/v3/v4/v5/v6/v7/v8/v9。原始恢复备份不能直接导入。' };
    const hash = await digest(value.payloadText);
    if (hash !== value.integrity.sha256) return { ok: false, message: '文件完整性校验失败，内容可能已损坏或改变。' };
    const payload = checkedPayload(JSON.parse(value.payloadText), value.formatVersion as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
    if (!payload) return { ok: false, message: '文件版本、数值、经营账本或进度摘要无效，未改变当前小店。' };
    return { ok: true, file: freeze({ text, fingerprint: hash, payload }) };
  } catch (error) { return { ok: false, message: error instanceof Error && error.message.startsWith('此浏览器') ? error.message : '文件无法解析，未改变当前小店。' }; }
}
export async function createPortableSave(payload: PortablePayload): Promise<PortableFile> {
  const checked = checkedPayload(payload);
  if (!checked) throw Error('当前进度无法生成有效存档文件。');
  const payloadText = JSON.stringify(checked);
  const fingerprint = await digest(payloadText);
  const text = JSON.stringify({ format: PORTABLE_FORMAT, formatVersion: PORTABLE_VERSION, payloadText, integrity: { algorithm: 'SHA-256', sha256: fingerprint } }, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_PORTABLE_BYTES) throw Error('当前存档超过文件大小限制。');
  return freeze({ text, fingerprint, payload: checked });
}
export function portableFilename(file: PortableFile): string {
  const time = new Date(file.payload.exportedAt).toISOString().replace(/[:.]/g, '-');
  const unique = crypto.randomUUID();
  return `mellow-bean-${time}-r${file.payload.revision}-${unique}.json`;
}
