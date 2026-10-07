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
    if (kind === 'table') return `table:${item.level??1}`;
    const counter = state.counters.find(counter => counter.id === item.counterId);
    return `${counter?.level ?? 1}:${counter?.recipe ?? 'espresso'}`;
  };
  const grouped=new Map<string,{item:FurniturePlacement;count:number}>();for(const item of candidates){const key=signature(item),group=grouped.get(key);if(group)group.count++;else grouped.set(key,{item,count:1});}
  return { items, available, candidates, choices:[...grouped.values()], needsChoice: new Set(candidates.map(signature)).size > 1,
    owned: items.filter(item => ownedIds.has(item.id)).length, pending: items.filter(item => !ownedIds.has(item.id)).length,
    placed: items.filter(item => !item.stored).length, limit: kind === 'counter' ? MAX_COUNTERS : MAX_TABLES };
}
