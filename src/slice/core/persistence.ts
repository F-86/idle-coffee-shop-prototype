import { createEngine, createInitialState, CUSTOMER_ROUTE_VERSION, INITIAL_WALLET, INVITE_COOLDOWN_SECONDS, MANAGER_ROUTE_VERSION, MAX_LEVEL, migrateCustomerRoutes, migrateManagerRoute, QUEUE_CAPACITY, STEP_SECONDS, WORLD } from './engine';
import type { SliceState } from './types';

export const SAVE_KEY = 'mellow-bean-3d-v1';
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type SaveStatus = 'new' | 'loaded' | 'saved' | 'corrupt' | 'future' | 'unavailable' | 'conflict' | 'invalid-state' | 'offline-save-failed';
export interface OfflineResult { accepted: boolean; amount: number; seconds: number }
export interface LoadResult { state: SliceState; status: SaveStatus; message: string; offline?: OfflineResult; protectedRaw: boolean }
export interface SaveResult { ok: boolean; status: SaveStatus; message: string; recordChangeTag?: string; backupKey?: string }
interface Envelope { schemaVersion: 1; savedAt: number; recordChangeTag: string; state: SliceState }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min = 0, max = 1e12): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min = 0, max = 1e12): value is number => number(value, min, max) && Number.isSafeInteger(value);
const recipe = (value: unknown) => value === 'espresso' || value === 'latte';
const counterId = (value: unknown) => value === 'counter-a' || value === 'counter-b';
let sequence = 0;
function tag(): string { return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now().toString(36)}-${(++sequence).toString(36)}`; }

/** Fail closed: do not silently repair corrupted assets, enums or relationships. */
export function validateState(value: unknown): { ok: true; state: SliceState } | { ok: false; message: string } {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (!object(value) || value.schemaVersion !== 1 || value.economyVersion !== 1) return fail('存档版本不受支持。');
  if (value.managerRouteVersion !== undefined && value.managerRouteVersion !== 1 && value.managerRouteVersion !== MANAGER_ROUTE_VERSION) return fail('经理路线版本不受支持。');
  if (value.customerRouteVersion !== undefined && value.customerRouteVersion !== 1 && value.customerRouteVersion !== 2 && value.customerRouteVersion !== CUSTOMER_ROUTE_VERSION) return fail('顾客路线版本不受支持。');
  const legacyCustomerRoute = value.customerRouteVersion === undefined || value.customerRouteVersion === 1;
  const localExitRoute = value.customerRouteVersion === 2;
  const legacyRoute = value.managerRouteVersion === undefined || value.managerRouteVersion === 1;
  for (const key of ['wallet', 'totalEarned', 'totalServed', 'spend', 'nextCustomerId']) if (!integer(value[key], key === 'nextCustomerId' ? 1 : 0)) return fail(`存档数值 ${key} 无效。`);
  if (!number(value.elapsed, 0, 4e9) || Math.abs(value.elapsed / STEP_SECONDS - Math.round(value.elapsed / STEP_SECONDS)) > .0001) return fail('模拟时钟无效。');
  if (!number(value.arrivalTimer, 0, 3) || !number(value.inviteCooldown, 0, INVITE_COOLDOWN_SECONDS) || typeof value.paused !== 'boolean') return fail('客流或暂停状态无效。');
  if (value.stepCarry !== undefined && (!number(value.stepCarry, 0, STEP_SECONDS) || value.stepCarry >= STEP_SECONDS)) return fail('模拟时间余数无效。');
  if (value.eventSequence !== undefined && !integer(value.eventSequence)) return fail('事件序列无效。');
  if (!(value.lastOfflineClaimId === null || typeof value.lastOfflineClaimId === 'string' && value.lastOfflineClaimId.length > 0 && value.lastOfflineClaimId.length <= 256)) return fail('离线结算标识无效。');
  if (value.offlineClaimIds !== undefined && (!Array.isArray(value.offlineClaimIds) || value.offlineClaimIds.length > 256 || value.offlineClaimIds.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(value.offlineClaimIds).size !== value.offlineClaimIds.length)) return fail('离线重试记录无效。');
  if (!Array.isArray(value.counters) || value.counters.length !== 2) return fail('柜台数量无效。');
  if (!Array.isArray(value.customers) || value.customers.length > 32) return fail('顾客数量无效。');
  if (!object(value.manager)) return fail('经理状态缺失。');
  const manager = value.manager;
  if (!number(manager.x, legacyRoute ? -8 : 0, legacyRoute ? 5 : WORLD.vaultX) || manager.z !== WORLD.backZ || !integer(manager.carrying) || !integer(manager.level, 1, MAX_LEVEL) || !integer(manager.target, 0, 2) || !number(manager.timer, 0, .6) || !['moving', 'collecting', 'depositing'].includes(String(manager.phase))) return fail('经理坐标、等级或动作无效。');
  if (manager.finishLegacySweep !== undefined && (legacyRoute || manager.finishLegacySweep !== true)) return fail('经理迁移路线标识无效。');
  if (manager.phase === 'collecting' && manager.target === 2 || manager.phase === 'depositing' && manager.target !== 2) return fail('经理路线关系无效。');
  if (!legacyRoute) {
    const targetX = manager.target === 2 ? WORLD.vaultX : manager.target === 0 ? 0 : 5;
    if (manager.phase !== 'moving' && manager.x !== targetX) return fail('经理未抵达收款或存款位置。');
    if (manager.phase === 'moving') {
      const legacySweep = manager.finishLegacySweep === true;
      const minX = (manager.target === 1 && !legacySweep) || (manager.target === 2 && legacySweep) ? 5 : 0;
      const maxX = (manager.target === 0 && !legacySweep) || (manager.target === 1 && legacySweep) ? 5 : WORLD.vaultX;
      if (!number(manager.x, minX, maxX) || !legacySweep && manager.timer !== 0) return fail('经理移动路线或计时无效。');
    }
  }
  const ids = new Set<number>();
  for (const entry of value.customers) {
    if (!object(entry) || !integer(entry.id, 1) || ids.has(entry.id) || !counterId(entry.counterId) || !number(entry.x, legacyCustomerRoute ? -9 : WORLD.entryX - QUEUE_CAPACITY * WORLD.queueGap, 7) || !number(entry.z, 1.3, legacyCustomerRoute ? 7 : WORLD.inboundZ) || !['entering', 'queue', 'serving', 'receiving', 'leaving'].includes(String(entry.phase)) || !number(entry.timer, 0, 2) || typeof entry.hasCup !== 'boolean' || !integer(entry.skin, 0, 5)) return fail('顾客状态无效。');
    if (entry.id >= (value.nextCustomerId as number)) return fail('顾客标识顺序无效。');
    if (entry.hasCup !== (entry.phase === 'receiving' || entry.phase === 'leaving')) return fail('顾客杯子状态无效。');
    if (entry.phase === 'leaving' && !integer(entry.timer, 0, 2) || entry.phase === 'receiving' && !number(entry.timer, 0, .7)) return fail('顾客动作计时无效。');
    if (entry.phase !== 'receiving' && entry.phase !== 'leaving' && entry.timer !== 0) return fail('顾客非交杯计时无效。');
    if (entry.finishLegacyRoute !== undefined && (legacyCustomerRoute || entry.finishLegacyRoute !== true || entry.phase !== 'entering' && entry.phase !== 'leaving')) return fail('顾客迁移路线标识无效。');
    if (entry.routeLeg !== undefined && (legacyCustomerRoute || entry.finishLegacyRoute || !integer(entry.routeLeg, 0, 3) || entry.phase !== 'entering' && entry.phase !== 'leaving')) return fail('顾客路段标识无效。');
    if (entry.finishLegacyRoute && (!number(entry.x, -9, 7) || !number(entry.z, 1.3, 7))) return fail('顾客旧路线坐标无效。');
    if (!legacyCustomerRoute && !entry.finishLegacyRoute) {
      const x = entry.counterId === 'counter-a' ? 0 : 5;
      if (entry.phase !== 'receiving' && entry.timer !== 0) return fail('顾客路线计时无效。');
      if (entry.phase === 'entering') {
        if (entry.routeLeg === 0) {
          if (entry.z !== WORLD.entryZ || !number(entry.x, WORLD.entryX - QUEUE_CAPACITY * WORLD.queueGap, WORLD.inboundX)) return fail('顾客入口路段无效。');
        } else if (entry.routeLeg === 1) {
          if (entry.x !== WORLD.inboundX || !number(entry.z, WORLD.entryZ, WORLD.inboundZ)) return fail('顾客入口转弯无效。');
        } else if (entry.routeLeg === 2) {
          if (entry.z !== WORLD.inboundZ || !number(entry.x, WORLD.inboundX, x)) return fail('顾客入店横道无效。');
        } else if (entry.routeLeg === 3) {
          if (entry.x !== x || !number(entry.z, WORLD.serviceZ, WORLD.inboundZ)) return fail('顾客入队路段无效。');
        } else return fail('顾客入店路段缺失。');
      } else if (entry.phase === 'leaving') {
        if (entry.routeLeg === 0) {
          if (entry.z !== WORLD.serviceZ || !number(entry.x, x, x + WORLD.departureOffsetX)) return fail('顾客离柜路段无效。');
        } else if (entry.routeLeg === 1) {
          if (entry.x !== x + WORLD.departureOffsetX || !number(entry.z, WORLD.serviceZ, localExitRoute ? 7.1 : WORLD.exitZ)) return fail('顾客离店路段无效。');
        } else if (!localExitRoute && entry.routeLeg === 2) {
          if (entry.z !== WORLD.exitZ || !number(entry.x, WORLD.exitX, x + WORLD.departureOffsetX)) return fail('顾客返程路段无效。');
        } else return fail('顾客离店路段缺失。');
      } else if (entry.x !== x || !number(entry.z, WORLD.serviceZ, entry.phase === 'queue' ? WORLD.inboundZ : WORLD.serviceZ)) return fail('顾客排队或服务位置无效。');
    }
    ids.add(entry.id);
  }
  const counters = value.counters;
  let pending = 0, brewed = 0, receiving = 0;
  for (let i = 0; i < counters.length; i++) {
    const entry = counters[i];
    if (!object(entry) || entry.id !== (i === 0 ? 'counter-a' : 'counter-b') || entry.x !== (i === 0 ? 0 : 5) || !integer(entry.level, 1, MAX_LEVEL) || !recipe(entry.recipe) || !integer(entry.pendingCash) || !integer(entry.brewed)) return fail('柜台坐标、配方或资产无效。');
    pending += entry.pendingCash; brewed += entry.brewed;
    const active = value.customers.filter(customer => object(customer) && customer.counterId === entry.id && customer.phase !== 'leaving');
    if (active.length > QUEUE_CAPACITY) return fail('队列超出容量。');
    const service = active.filter(customer => object(customer) && (customer.phase === 'serving' || customer.phase === 'receiving'));
    if (service.length > 1) return fail('同一柜台存在重复服务。');
    if (entry.brew === null) { if (service.length) return fail('服务顾客缺少制作快照。'); continue; }
    const brew = entry.brew;
    if (!object(brew) || !recipe(brew.recipe) || !integer(brew.price, 1, 100_000) || !number(brew.duration, .1, 30) || !number(brew.elapsed, 0, brew.duration) || !integer(brew.customerId, 1)) return fail('制作快照无效。');
    const customer = service[0];
    if (!object(customer) || customer.id !== brew.customerId) return fail('制作与顾客关系无效。');
    if (customer.phase === 'receiving') { receiving++; if (brew.elapsed !== brew.duration) return fail('交杯制作尚未完成。'); }
  }
  if (brewed !== (value.totalServed as number) + receiving) return fail('出杯计数不守恒。');
  if ((value.wallet as number) + (value.spend as number) + manager.carrying + pending !== INITIAL_WALLET + (value.totalEarned as number)) return fail('资金账本不守恒。');
  const state = clone(value) as unknown as SliceState;
  state.stepCarry ??= 0; state.eventSequence ??= 0; state.offlineClaimIds ??= state.lastOfflineClaimId ? [state.lastOfflineClaimId] : [];
  migrateManagerRoute(state);
  migrateCustomerRoutes(state);
  // An accepted old archive must also be valid after its one-time migration.
  // Impossible old stationary positions fail closed instead of becoming an
  // un-saveable live game; do not teleport guests to silently repair it.
  if (legacyCustomerRoute || localExitRoute) return validateState(state);
  return { ok: true, state };
}

function decode(raw: string): { ok: true; envelope: Envelope } | { ok: false; status: 'corrupt' | 'future'; message: string } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, status: 'corrupt', message: '存档无法读取，原始内容已保留。请先备份或明确重置。' }; }
  if (object(value) && (number(value.schemaVersion, 2) || object(value.state) && (number(value.state.schemaVersion, 2) || number(value.state.economyVersion, 2) || number(value.state.managerRouteVersion, MANAGER_ROUTE_VERSION + 1) || number(value.state.customerRouteVersion, CUSTOMER_ROUTE_VERSION + 1)))) return { ok: false, status: 'future', message: '这是较新版本的存档，当前版本不会覆盖它。请使用兼容的新版本。' };
  if (!object(value) || value.schemaVersion !== 1 || !number(value.savedAt, 0, 8.64e15) || typeof value.recordChangeTag !== 'string' || !value.recordChangeTag || value.recordChangeTag.length > 256) return { ok: false, status: 'corrupt', message: '存档格式或结算时间无效，原始内容已保留。' };
  const checked = validateState(value.state);
  if (!checked.ok) return { ok: false, status: 'corrupt', message: `${checked.message} 原始内容已保留。` };
  return { ok: true, envelope: { schemaVersion: 1, savedAt: value.savedAt, recordChangeTag: value.recordChangeTag, state: checked.state } };
}

export function createMemoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); }, removeItem(key) { data.delete(key); } };
}

/** Local storage uses optimistic byte comparison. A server adapter must offer atomic CAS. */
export class LocalSaveRepository {
  private storage: StorageLike | null;
  private baseRaw: string | null = null;
  private initialized = false;
  private protectedRaw = false;
  private protectedStatus: SaveStatus = 'corrupt';
  private lastMessage = '';
  constructor(storage?: StorageLike | null) {
    if (storage !== undefined) this.storage = storage;
    else { try { this.storage = globalThis.localStorage ?? null; } catch { this.storage = null; } }
  }
  private write(state: SliceState, now: number): SaveResult {
    if (!this.storage) return { ok: false, status: 'unavailable', message: '本地存储不可用，本轮进度仅保留在页面内。' };
    if (this.protectedRaw) return { ok: false, status: this.protectedStatus, message: this.lastMessage };
    const checked = validateState(state);
    if (!checked.ok || !number(now, 0, 8.64e15)) return { ok: false, status: 'invalid-state', message: checked.ok ? '保存时间无效。' : checked.message };
    try {
      const current = this.storage.getItem(SAVE_KEY);
      if (!this.initialized) {
        if (current !== null) return { ok: false, status: 'conflict', message: '请先读取已有存档，以免覆盖其他窗口的进度。' };
        this.initialized = true; this.baseRaw = null;
      }
      if (current !== this.baseRaw) return { ok: false, status: 'conflict', message: '另一个窗口已更新存档。当前进度尚未保存，请重新读取后继续。' };
      const previous = this.baseRaw === null ? null : decode(this.baseRaw);
      const recordChangeTag = tag();
      const envelope: Envelope = { schemaVersion: 1, savedAt: Math.max(now, previous?.ok ? previous.envelope.savedAt : 0), recordChangeTag, state: checked.state };
      const raw = JSON.stringify(envelope);
      this.storage.setItem(SAVE_KEY, raw); this.baseRaw = raw;
      return { ok: true, status: 'saved', message: '本地存档已保存。', recordChangeTag };
    } catch { return { ok: false, status: 'unavailable', message: '浏览器拒绝写入存档，本轮进度尚未保存。' }; }
  }
  load(now = Date.now()): LoadResult {
    const fallback = (status: SaveStatus, message: string): LoadResult => ({ state: createInitialState(), status, message, protectedRaw: this.protectedRaw });
    if (!this.storage || !number(now, 0, 8.64e15)) return fallback('unavailable', '本地存储不可用，本轮进度仅保留在页面内。');
    let raw: string | null;
    try { raw = this.storage.getItem(SAVE_KEY); } catch { return fallback('unavailable', '浏览器拒绝读取存档，本轮进度仅保留在页面内。'); }
    this.baseRaw = raw; this.initialized = true; this.protectedRaw = false; this.lastMessage = '';
    if (raw === null) return fallback('new', '新店已准备好。');
    const parsed = decode(raw);
    if (!parsed.ok) {
      this.protectedRaw = true; this.protectedStatus = parsed.status; this.lastMessage = parsed.message;
      return fallback(parsed.status, parsed.message);
    }
    const { envelope } = parsed;
    const seconds = Math.max(0, (now - envelope.savedAt) / 1000);
    if (seconds < 30) return { state: envelope.state, status: 'loaded', message: '本地存档已恢复。', protectedRaw: false };
    const engine = createEngine(envelope.state);
    const offline = engine.applyOffline(seconds, `local:${envelope.recordChangeTag}:${envelope.savedAt}:${now}`);
    const snapshot = engine.snapshot();
    // The credited state and the once-only anchor are one atomic setItem value.
    const written = this.write(snapshot, now);
    if (!written.ok) return { state: envelope.state, status: written.status === 'conflict' ? 'conflict' : 'offline-save-failed', message: `${written.message} 离线收益尚未领取。`, offline: { accepted: false, amount: 0, seconds: 0 }, protectedRaw: false };
    return { state: snapshot, status: 'loaded', message: envelope.state.paused ? '本地存档已恢复，暂停期间没有离线收益。' : '本地存档已恢复，离线收益已完成一次结算。', offline, protectedRaw: false };
  }
  save(state: SliceState, now = Date.now()): SaveResult { return this.write(state, now); }
  inspect(): { rawText: string | null; protectedRaw: boolean; message: string } { return { rawText: this.baseRaw, protectedRaw: this.protectedRaw, message: this.lastMessage }; }
  reset(options: { confirmProtected?: boolean } = {}): SaveResult {
    if (!this.storage) return { ok: false, status: 'unavailable', message: '本地存储不可用。' };
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (this.initialized && raw !== this.baseRaw) return { ok: false, status: 'conflict', message: '另一个窗口已修改存档，请先重新读取。' };
      const decoded = raw === null ? null : decode(raw);
      if ((this.protectedRaw || decoded && !decoded.ok) && !options.confirmProtected) return { ok: false, status: decoded && !decoded.ok ? decoded.status : this.protectedStatus, message: '原始存档已保护，请先导出，并确认新开一家店。' };
      const backupKey = raw === null ? undefined : `${SAVE_KEY}-backup-${tag()}`;
      if (backupKey) this.storage.setItem(backupKey, raw!);
      this.storage.removeItem(SAVE_KEY); this.baseRaw = null; this.initialized = true; this.protectedRaw = false; this.lastMessage = '';
      return { ok: true, status: 'new', message: backupKey ? '已备份原始字节，新版本本地存档已重置。' : '新版本本地存档已重置。', backupKey };
    }
    catch { return { ok: false, status: 'unavailable', message: '浏览器拒绝重置存档。' }; }
  }
}
