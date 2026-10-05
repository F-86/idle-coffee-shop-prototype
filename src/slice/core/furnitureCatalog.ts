import { getLayout, MAX_COUNTERS, MAX_TABLES } from './layout';
import type { FurniturePlacement, ShopLayout, SliceState } from './types';

export type FurnitureKind = FurniturePlacement['kind'];
/** A view of this transaction, never a second inventory or a persisted quantity. */
export function furnitureInventory(state: SliceState, draft: ShopLayout, kind: FurnitureKind) {
  const ownedIds = new Set(getLayout(state).furniture.map(item => item.id));
  const items = draft.furniture.filter(item => item.kind === kind);
  const available = items.filter(item => item.stored).sort((a, b) => Number(ownedIds.has(b.id)) - Number(ownedIds.has(a.id)) || a.id.localeCompare(b.id));
  const paid = available.filter(item => ownedIds.has(item.id));
  // Use paid inventory before items added to this transaction, even when both exist.
  const candidates = paid.length ? paid : available;
  const signature = (item: FurniturePlacement) => {
    if (kind === 'table') return 'table';
    const counter = state.counters.find(counter => counter.id === item.counterId);
    const affinity = item.counterId === 'counter-a' || item.counterId === 'counter-b' ? item.counterId : 'generic';
    return `${counter?.level ?? 1}:${counter?.recipe ?? 'espresso'}:${affinity}`;
  };
  return { items, available, candidates, needsChoice: new Set(candidates.map(signature)).size > 1,
    owned: items.filter(item => ownedIds.has(item.id)).length, pending: items.filter(item => !ownedIds.has(item.id)).length,
    placed: items.filter(item => !item.stored).length, limit: kind === 'counter' ? MAX_COUNTERS : MAX_TABLES };
}
