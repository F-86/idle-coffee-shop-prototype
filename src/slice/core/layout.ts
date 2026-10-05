import type { CoffeeSignPlacement, CounterId, FurniturePlacement, GridPoint, LayoutResult, ShopLayout, SliceState } from './types';

/** Draft balance only. Furniture ownership survives storage, with no refund. */
export const LAYOUT_PRICES = Object.freeze({ counter: 2400, table: 600, expansion: 6000, expansionServed: 40 });
export const GRID = Object.freeze({ minX: -7, maxX: 10, expandedMaxX: 16, minZ: -3, maxZ: 9, entry: Object.freeze({ x: -7, z: 5 }), exit: Object.freeze({ x: 11, z: 6 }), vault: Object.freeze({ x: 9, z: -2 }) });
export const MAX_COUNTERS = 4;
export const MAX_TABLES = 12;
export const COUNTER_IDS: readonly CounterId[] = ['counter-a', 'counter-b', 'counter-c', 'counter-d'];
export const LAYOUT_VERSION = 3;
export const layoutExitAnchor = (layout: Pick<ShopLayout, 'expanded'>): GridPoint => ({ x: layout.expanded ? GRID.expandedMaxX : GRID.maxX, z: 6 });
export const layoutExit = (layout: Pick<ShopLayout, 'expanded'>): GridPoint => ({ x: layoutExitAnchor(layout).x + 1, z: 6 });
export const layoutEntrySpawn = (): GridPoint => ({ x: GRID.entry.x - 1, z: GRID.entry.z });
/** Fixed height/plane. Anchors clear the renovation plaque, vault and unlocked wall ends. */
export const COFFEE_WALL = Object.freeze({ y: 2.7, z: -3.45, width: 3.52, minGap: .2 });
const BASE_COFFEE_WALL_SLOTS = Object.freeze([-2, -1, 0, 1, 2, 3, 4, 5, 6]);
const EXPANDED_COFFEE_WALL_SLOTS = Object.freeze([...BASE_COFFEE_WALL_SLOTS, 12, 13, 14]);
export function coffeeWallSlots(layout: Pick<ShopLayout, 'expanded'>): readonly number[] { return layout.expanded ? EXPANDED_COFFEE_WALL_SLOTS : BASE_COFFEE_WALL_SLOTS; }
export function initialCoffeeSigns(): CoffeeSignPlacement[] { return [
  { id: 'menu-espresso', recipe: 'espresso', x: 0, stored: true },
  { id: 'menu-latte', recipe: 'latte', x: 5, stored: true }
]; }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const gridKey = (point: GridPoint): string => `${point.x},${point.z}`;
/** Reserve the whole remaining cardinal route and both ends of a moving segment. */
export function actorReservations(actor: GridPoint & { nav?: GridPoint[] }): Set<string> {
  const points = [...(actor.nav ?? [])];
  for (const x of new Set([Math.floor(actor.x + 1e-8), Math.ceil(actor.x - 1e-8)])) for (const z of new Set([Math.floor(actor.z + 1e-8), Math.ceil(actor.z - 1e-8)])) points.push({ x, z });
  return new Set(points.map(gridKey));
}

export function initialLayout(): ShopLayout { return { version: LAYOUT_VERSION, active: true, expanded: false, furniture: [
  { id: 'counter-a', kind: 'counter', counterId: 'counter-a', x: 0, z: 0, rotation: 0, stored: false },
  { id: 'counter-b', kind: 'counter', counterId: 'counter-b', x: 5, z: 0, rotation: 0, stored: false }
], coffeeSigns: initialCoffeeSigns() }; }
export function getLayout(state: Pick<SliceState, 'layout'>): ShopLayout { return state.layout ?? initialLayout(); }
/** The legacy fallback is read-only compatibility, never a repair of malformed v2 data. */
export function getCoffeeSigns(layout: ShopLayout): CoffeeSignPlacement[] { return (layout as { version: number }).version === 1 ? initialCoffeeSigns() : layout.coffeeSigns; }
/** Normalize only a valid v1 layout. Unknown versions and explicit malformed signs fail closed. */
export function normalizeLayout(value: unknown): ShopLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid layout.');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== LAYOUT_VERSION || raw.version === 1 && Object.hasOwn(raw, 'coffeeSigns')) throw new Error('Unsupported layout version.');
  const layout = clone(raw.version === 1 ? { ...raw, version: 2, coffeeSigns: initialCoffeeSigns().map(sign => ({ ...sign, stored: false })) } : raw) as unknown as ShopLayout;
  const checked = validateLayout(layout);
  if (!checked.ok) throw new Error(checked.message);
  return layout;
}
function rotate(x: number, z: number, rotation: number): GridPoint {
  for (let i = 0; i < rotation; i++) [x, z] = [-z, x];
  return { x, z };
}
export function furnitureCells(item: FurniturePlacement): GridPoint[] {
  const points: GridPoint[] = [];
  const width = item.kind === 'counter' ? 2 : 0, depth = item.kind === 'counter' ? 1 : 0;
  for (let x = -width; x <= width; x++) for (let z = -depth; z <= depth; z++) {
    const offset = rotate(x, z, item.rotation); points.push({ x: item.x + offset.x, z: item.z + offset.z });
  }
  return points;
}
export function interactionPoint(item: FurniturePlacement, side: 'service' | 'back' | 'seat'): GridPoint {
  const offset = rotate(0, side === 'back' ? -2 : side === 'service' ? 2 : 1, item.rotation);
  return { x: item.x + offset.x, z: item.z + offset.z };
}
export function inGrid(layout: ShopLayout, point: GridPoint): boolean { return Number.isInteger(point.x) && Number.isInteger(point.z) && point.x >= GRID.minX && point.x <= (layout.expanded ? GRID.expandedMaxX : GRID.maxX) && point.z >= GRID.minZ && point.z <= GRID.maxZ; }
export function occupiedCells(layout: ShopLayout): Set<string> { return new Set(layout.furniture.filter(item => !item.stored).flatMap(furnitureCells).map(gridKey)); }
export function findGridPath(layout: ShopLayout, from: GridPoint, to: GridPoint, extraBlocked: Set<string> = new Set()): GridPoint[] | null {
  const obstacles = occupiedCells(layout);
  for (const item of layout.furniture) if (item.kind === 'table' && !item.stored) { const seat = gridKey(interactionPoint(item, 'seat')); if (seat !== gridKey(from) && seat !== gridKey(to)) obstacles.add(seat); }
  if (!inGrid(layout, from) || !inGrid(layout, to) || obstacles.has(gridKey(from)) || obstacles.has(gridKey(to))) return null;
  const key = gridKey(from), target = gridKey(to), queue = [from], previous = new Map<string, GridPoint | null>([[key, null]]);
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i];
    if (gridKey(point) === target) {
      const path: GridPoint[] = []; let cursor: GridPoint | null = point;
      while (cursor) { path.push(cursor); cursor = previous.get(gridKey(cursor))!; }
      return path.reverse().slice(1);
    }
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = { x: point.x + dx, z: point.z + dz }, id = gridKey(next);
      if (!inGrid(layout, next) || obstacles.has(id) || extraBlocked.has(id) || previous.has(id)) continue;
      previous.set(id, point); queue.push(next);
    }
  }
  return null;
}
export function validateLayout(layout: ShopLayout): LayoutResult {
  const fail = (message: string): LayoutResult => ({ ok: false, message });
  if (!layout || typeof layout !== 'object' || ![2, LAYOUT_VERSION].includes(layout.version) || typeof layout.active !== 'boolean' || typeof layout.expanded !== 'boolean' || !Array.isArray(layout.furniture) || layout.furniture.length > MAX_COUNTERS + MAX_TABLES || layout.trafficTurn !== undefined && !['customer', 'manager'].includes(layout.trafficTurn)) return fail('布局版本或家具清单无效。');
  if (!Array.isArray(layout.coffeeSigns) || layout.coffeeSigns.length !== 2) return fail('咖啡墙牌清单无效。');
  const signIds = new Set<string>(), slots = coffeeWallSlots(layout);
  for (const sign of layout.coffeeSigns) {
    if (!sign || typeof sign !== 'object' || Object.keys(sign).sort().join() !== 'id,recipe,stored,x' || !['espresso', 'latte'].includes(sign.recipe) || sign.id !== `menu-${sign.recipe}` || signIds.has(sign.id) || typeof sign.stored !== 'boolean' || !slots.includes(sign.x)) return fail('咖啡墙牌标识或墙面位置无效。');
    signIds.add(sign.id);
  }
  const placedSigns = layout.coffeeSigns.filter(sign => !sign.stored);
  if (placedSigns.length === 2 && Math.abs(placedSigns[0].x - placedSigns[1].x) < COFFEE_WALL.width + COFFEE_WALL.minGap) return fail('咖啡墙牌重叠了，请沿墙留出空间。');
  if (layout.version === LAYOUT_VERSION && layout.coffeeSigns.some(sign => !sign.stored)) return fail('旧咖啡墙牌必须收起。');
  const ids = new Set<string>(), counters = new Set<string>(), occupied = new Set<string>(), ports: GridPoint[] = layout.version === 2 ? [GRID.entry, GRID.vault, { x: -7, z: 6 }] : [GRID.entry, layoutExitAnchor(layout)];
  let activeCounters = 0, tables = 0;
  for (const item of layout.furniture) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id) || ids.has(item.id) || signIds.has(item.id) || !['counter', 'table'].includes(item.kind) || typeof item.stored !== 'boolean' || !Number.isInteger(item.rotation) || item.rotation < 0 || item.rotation > 3 || !inGrid(layout, item)) return fail('家具标识、方向或格子坐标无效。');
    ids.add(item.id);
    if (item.kind === 'counter') {
      if (!item.counterId || !COUNTER_IDS.includes(item.counterId) || counters.has(item.counterId) || item.id !== item.counterId) return fail('柜台家具与资产对应无效。');
      counters.add(item.counterId);
    } else { if (item.counterId !== undefined || ++tables > MAX_TABLES) return fail('桌椅数量或关联无效。'); }
    if (item.stored) continue;
    if (item.kind === 'counter') { activeCounters++; ports.push(interactionPoint(item, 'service')); if (layout.version === 2) ports.push(interactionPoint(item, 'back')); }
    else ports.push(interactionPoint(item, 'seat'));
    for (const cell of furnitureCells(item)) {
      const key = gridKey(cell);
      if (!inGrid(layout, cell)) return fail('家具超出了已解锁的店面。');
      if (occupied.has(key)) return fail('家具占地重叠了，请留出空间。');
      occupied.add(key);
    }
  }
  if (!activeCounters) return fail('至少保留一个营业柜台。');
  if (new Set(ports.map(gridKey)).size !== ports.length) return fail('入口、出口、服务和座位位置不能重叠。');
  for (const port of ports) if (!inGrid(layout, port) || occupied.has(gridKey(port))) return fail('请留出入口、出口、柜台服务与座位的位置。');
  // Every interaction node must remain reachable with all other stations occupied.
  // Together with disjoint whole-route reservations, this prevents wait cycles.
  for (const port of ports.slice(1)) {
    const reserved = new Set(ports.filter(other => other !== GRID.entry && other !== port).map(gridKey));
    if (!findGridPath(layout, GRID.entry, port, reserved)) return fail('动线被堵住了：入口要能独立通往每个服务位置、座位和出口。');
  }
  return { ok: true, message: '布局可用。' };
}
export function addFurniture(draft: ShopLayout, kind: 'counter' | 'table', x: number, z: number): FurniturePlacement | null {
  let id: string;
  if (kind === 'counter') { const next = COUNTER_IDS.find(key => !draft.furniture.some(item => item.counterId === key)); if (!next) return null; id = next; }
  else { if (draft.furniture.filter(item => item.kind === 'table').length >= MAX_TABLES) return null; let number = 1; while (draft.furniture.some(item => item.id === `table-${number}`)) number++; id = `table-${number}`; }
  const item: FurniturePlacement = { id, kind, x, z, rotation: 0, stored: false, ...(kind === 'counter' ? { counterId: id as CounterId } : {}) };
  draft.furniture.push(item); return item;
}
export function moveFurniture(draft: ShopLayout, id: string, x: number, z: number): boolean { const item = draft.furniture.find(item => item.id === id); if (!item) return false; item.x = x; item.z = z; item.stored = false; return true; }
export function rotateFurniture(draft: ShopLayout, id: string): boolean { const item = draft.furniture.find(item => item.id === id); if (!item) return false; item.rotation = (item.rotation + 1) % 4 as FurniturePlacement['rotation']; return true; }
export function storeFurniture(draft: ShopLayout, id: string): boolean { const item = draft.furniture.find(item => item.id === id); if (!item || item.kind === 'counter' && !item.stored && draft.furniture.filter(other => other.kind === 'counter' && !other.stored).length <= 1) return false; item.stored = true; return true; }
/** Like furniture movement, invalid previews are allowed here and rejected on commit. */
export function moveCoffeeSign(draft: ShopLayout, id: string, x: number): boolean { if (draft.version >= 3) return false; const sign = draft.coffeeSigns.find(sign => sign.id === id); if (!sign) return false; sign.x = x; sign.stored = false; return true; }
export function storeCoffeeSign(draft: ShopLayout, id: string): boolean { const sign = draft.coffeeSigns.find(sign => sign.id === id); if (!sign) return false; sign.stored = true; return true; }
export function layoutCost(state: SliceState, draft: ShopLayout): LayoutResult {
  const previous = getLayout(state);
  if (previous.expanded && !draft.expanded) return { ok: false, message: '已扩建的店面不能缩回。' };
  if (draft.expanded && !previous.expanded && state.totalServed < LAYOUT_PRICES.expansionServed) return { ok: false, message: `服务 ${LAYOUT_PRICES.expansionServed} 位顾客后可扩建。` };
  for (const owned of previous.furniture) { const item = draft.furniture.find(item => item.id === owned.id); if (!item || item.kind !== owned.kind || item.counterId !== owned.counterId) return { ok: false, message: '已购买的家具只能收起，不能删除或替换资产。' }; }
  const cost = (draft.expanded && !previous.expanded ? LAYOUT_PRICES.expansion : 0) + draft.furniture.filter(item => !previous.furniture.some(owned => owned.id === item.id)).reduce((sum, item) => sum + LAYOUT_PRICES[item.kind], 0);
  return cost > state.wallet ? { ok: false, message: '余额不足。', cost } : { ok: true, message: cost ? `本次花费 ¥${(cost / 100).toFixed(2)}` : '免费调整。', cost };
}
export function copyLayout(state: SliceState): ShopLayout { const result = clone(getLayout(state)); result.active = true; return result; }

/** Strict saved-layout/runtime relationships, used after generic economic checks. */
export function validateLayoutState(value: unknown): string | null {
  const state = value as SliceState;
  if (!state || !state.layout) return null;
  const layout = state.layout, checked = validateLayout(layout); if (!checked.ok) return checked.message;
  if (!layout.active) {
    if (state.manager.collectionCursor !== undefined || state.manager.nav !== undefined || state.customers.some(customer => customer.nav !== undefined || customer.seatId !== undefined)) return '旧路线不能带动态移动状态。';
    const expected = { ...initialLayout(), version: 2, active: false, coffeeSigns: initialCoffeeSigns().map(sign => ({ ...sign, stored: state.economyVersion >= 4 })) };
    if (JSON.stringify({ ...layout, trafficTurn: undefined }) !== JSON.stringify(expected)) return '未启用布局必须保持初始家具。';
    return null;
  }
  if (![3, 4, 5].includes(state.economyVersion)) return '动态布局需要新版经济存档。';
  const counters = layout.furniture.filter(item => item.kind === 'counter');
  if (!counters.some(item => item.counterId === 'counter-a') || !counters.some(item => item.counterId === 'counter-b')) return '初始柜台资产不能删除。';
  const minimumSpend = (counters.length - 2) * LAYOUT_PRICES.counter + layout.furniture.filter(item => item.kind === 'table').length * LAYOUT_PRICES.table + (layout.expanded ? LAYOUT_PRICES.expansion : 0);
  if (state.spend < minimumSpend) return '家具与扩建支出缺少账本记录。';
  if (layout.expanded && state.totalServed < LAYOUT_PRICES.expansionServed) return '扩建条件尚未达成。';
  if (state.counters.some((counter, index) => index && counter.id <= state.counters[index - 1].id)) return '柜台资产顺序无效。';
  if (counters.some(item => item.stored && (state.counters.find(counter => counter.id === item.counterId)?.brew || state.customers.some(customer => customer.counterId === item.counterId)))) return '收起柜台不能持有在途订单。';
  if (counters.length !== state.counters.length || state.counters.some(counter => !counters.some(item => item.counterId === counter.id && item.x === counter.x))) return '柜台资产与家具不匹配。';
  const retiredManager = state.economyVersion >= 4;
  const exit = layout.version === 2 ? { x: -8, z: 6 } : layoutExit(layout);
  const occupied = occupiedCells(layout), actors = retiredManager ? [...state.customers] : [...state.customers, state.manager];
  const chairCells = new Map(layout.furniture.filter(item => item.kind === 'table' && !item.stored).map(item => [gridKey(interactionPoint(item, 'seat')), item.id]));
  const pointValid = (point: GridPoint): boolean => !!point && Number.isFinite(point.x) && Number.isFinite(point.z) && point.x >= -8 && point.x <= (layout.expanded ? 16 : 10) + (layout.version === 3 ? 1 : 0) && point.z >= -3 && point.z <= 9;
  for (const actor of actors) {
    if (!pointValid(actor) || occupied.has(gridKey({ x: Math.round(actor.x), z: Math.round(actor.z) }))) return '角色位置落在家具内或店面外。';
    if (actor.nav !== undefined) {
      if (!Array.isArray(actor.nav) || !actor.nav.length || actor.nav.length > 400 || new Set(actor.nav.map(gridKey)).size !== actor.nav.length || actor.nav.some(point => !pointValid(point) || !Number.isInteger(point.x) || !Number.isInteger(point.z) || occupied.has(gridKey(point)))) return '角色移动路径无效。';
      for (let i = 1; i < actor.nav.length; i++) if (Math.abs(actor.nav[i].x - actor.nav[i - 1].x) + Math.abs(actor.nav[i].z - actor.nav[i - 1].z) !== 1) return '角色路径不能穿越格子。';
      if (actor.nav.some(point => chairCells.has(gridKey(point)) && !('seatId' in actor && actor.seatId === chairCells.get(gridKey(point)) && actor.phase === 'seeking-seat'))) return '移动路径穿过了未使用的椅子。';
      const first = actor.nav[0], distance = Math.abs(first.x - actor.x) + Math.abs(first.z - actor.z);
      if (distance > 1.000001 || first.x !== actor.x && first.z !== actor.z && !(actor === state.manager && actor.x >= 8.8 && actor.x <= 9 && actor.z >= -2 && actor.z <= -1.7 && first.x === 9 && first.z === -2)) return '角色未处于当前路径段。';
    }
  }
  for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) {
    if (Math.hypot(actors[a].x - actors[b].x, actors[a].z - actors[b].z) < .72 - 1e-8) return '角色位置重叠。';
    const first = actorReservations(actors[a]), second = actorReservations(actors[b]);
    if ([...first].some(point => second.has(point))) return '移动路径与其他角色的通道相交。';
  }
  const seats = new Set<string>();
  for (const customer of state.customers) {
    const furniture = counters.find(item => item.counterId === customer.counterId);
    if (!furniture || furniture.stored) return '顾客指向了未营业柜台。';
    if (customer.finishLegacyRoute !== undefined || customer.routeLeg !== undefined) return '动态顾客不能带旧路线标识。';
    if (customer.seatId !== undefined) {
      const table = layout.furniture.find(item => item.id === customer.seatId && item.kind === 'table' && !item.stored);
      if (!table || seats.has(customer.seatId) || !['seeking-seat', 'dining'].includes(customer.phase)) return '座位占用关系无效。';
      seats.add(customer.seatId);
      if (customer.phase === 'dining' && gridKey(customer) !== gridKey(interactionPoint(table, 'seat'))) return '顾客没有坐在对应座位。';
    } else if (customer.phase === 'seeking-seat' || customer.phase === 'dining') return '堂食顾客缺少座位。';
    if (['queue', 'serving', 'receiving'].includes(customer.phase) && gridKey(customer) !== gridKey(interactionPoint(furniture, 'service'))) return '服务顾客没有抵达柜台。';
    if (customer.phase === 'entering' && !customer.nav && (customer.x !== -8 || customer.z !== 5)) return '等待顾客未在入口。';
    if (!['entering', 'seeking-seat', 'leaving'].includes(customer.phase) && customer.nav) return '静止顾客不能同时移动。';
    const service = interactionPoint(furniture, 'service');
    const table = layout.furniture.find(item => item.id === customer.seatId);
    const target = customer.phase === 'entering' ? service : customer.phase === 'seeking-seat' && table ? interactionPoint(table, 'seat') : customer.phase === 'leaving' ? exit : null;
    if (customer.nav && (!target || gridKey(customer.nav.at(-1)!) !== gridKey(target))) return '顾客路径未到达对应目的地。';
    if (customer.nav?.some(point => point.x < GRID.minX && (customer.phase !== 'leaving' || gridKey(point) !== gridKey(exit)))) return '顾客路径越过了入口或出口边界。';
    if (customer.nav?.some(point => point.x > (layout.expanded ? GRID.expandedMaxX : GRID.maxX) && (customer.phase !== 'leaving' || gridKey(point) !== gridKey(exit)))) return '顾客路径越过了出口边界。';
    if (customer.x > (layout.expanded ? GRID.expandedMaxX : GRID.maxX) && !(customer.phase === 'leaving' && customer.z === exit.z)) return '顾客位于出口以外。';
    if (customer.x < GRID.minX && !(customer.phase === 'entering' && customer.z === 5 || layout.version === 2 && customer.phase === 'leaving' && customer.z === 6)) return '顾客位于入口或出口以外。';
    if (!customer.nav && customer.phase === 'seeking-seat' && gridKey(customer) !== gridKey(service)) return '寻找座位的顾客未停在柜台。';
    if (!customer.nav && customer.phase === 'leaving' && gridKey(customer) !== gridKey(service) && !layout.furniture.some(item => item.kind === 'table' && !item.stored && gridKey(customer) === gridKey(interactionPoint(item, 'seat')))) return '待离店顾客没有停在柜台或座位。';
  }
  if (retiredManager) return null;
  const manager = state.manager;
  if (manager.carrying > 1200 + 180 * (manager.level - 1)) return '经理现金超过当前容量。';
  if (manager.finishLegacySweep !== undefined || manager.target < 0 || manager.target > state.counters.length) return '动态经理目标无效。';
  if (manager.collectionCursor !== undefined && (!Number.isInteger(manager.collectionCursor) || manager.collectionCursor < 0 || manager.collectionCursor >= state.counters.length)) return '经理收款顺序无效。';
  if (manager.phase === 'moving' && manager.timer !== 0 || manager.phase !== 'moving' && manager.nav) return '经理移动与停留状态无效。';
  if (manager.phase === 'collecting' && manager.target === state.counters.length || manager.phase === 'depositing' && manager.target !== state.counters.length) return '经理收款和金库目标不匹配。';
  const targetItem = counters.find(item => item.counterId === state.counters[manager.target]?.id);
  const managerTarget = manager.target === state.counters.length ? GRID.vault : targetItem && !targetItem.stored ? interactionPoint(targetItem, 'back') : null;
  if (!managerTarget || manager.nav && gridKey(manager.nav.at(-1)!) !== gridKey(managerTarget) || manager.x < GRID.minX || manager.nav?.some(point => point.x < GRID.minX)) return '经理路径未到达对应目的地。';
  if (!manager.nav && manager.phase === 'moving' && gridKey(manager) !== gridKey(GRID.vault) && !(manager.x === 8.8 && manager.z === -1.7) && !counters.some(item => !item.stored && gridKey(manager) === gridKey(interactionPoint(item, 'back')))) return '经理未停在合法收款位置。';
  if (manager.phase !== 'moving') {
    const item = counters.find(item => item.counterId === state.counters[manager.target]?.id);
    const target = manager.target === state.counters.length ? GRID.vault : item && !item.stored ? interactionPoint(item, 'back') : null;
    if (!target || gridKey(manager) !== gridKey(target)) return '经理没有抵达收款位置。';
  }
  return null;
}

/** Finish old routes before switching doors. Preserve every owned item and paid upgrade. */
export function migrateLayoutDoors(state: SliceState): void {
  if (state.customers.length || state.counters.some(counter => counter.brew)) return;
  const next = clone(state.layout ?? initialLayout());
  next.version = LAYOUT_VERSION; next.active = true; next.trafficTurn = 'customer';
  for (const sign of next.coffeeSigns) sign.stored = true;
  if (!validateLayout(next).ok) {
    state.doorMigrationNotice = true;
    const exit = gridKey(layoutExitAnchor(next));
    for (const item of next.furniture) {
      if (item.stored) continue;
      const blocks = furnitureCells(item).some(point => gridKey(point) === exit) || item.kind === 'table' && gridKey(interactionPoint(item, 'seat')) === exit;
      if (blocks) item.stored = true;
    }
    if (!validateLayout(next).ok) {
      for (const item of next.furniture) item.stored = true;
      for (const base of initialLayout().furniture) {
        const item = next.furniture.find(item => item.id === base.id)!;
        Object.assign(item, base);
      }
    }
  }
  for (const counter of state.counters) counter.x = next.furniture.find(item => item.counterId === counter.id)!.x;
  state.layout = next; state.customerRouteVersion = 4;
}
