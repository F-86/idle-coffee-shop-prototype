import type { IngredientId, IngredientQuote, IngredientStock, PurchaseMode, RecipeId, SliceState } from './types';

/** Feature-first draft amounts and prices, all purchase prices in integer cents. */
export const INGREDIENT_CONFIG = Object.freeze({
  beans: Object.freeze({ name: '咖啡豆', capacity: 120, initial: 40, unitCost: 20, batch: 20 }),
  milk: Object.freeze({ name: '牛奶', capacity: 80, initial: 20, unitCost: 30, batch: 10 })
});
export const RECIPE_INGREDIENTS = Object.freeze({
  espresso: Object.freeze({ beans: 1, milk: 0 }),
  latte: Object.freeze({ beans: 1, milk: 1 })
});
export function createInitialIngredients(): IngredientStock {
  return { beans: INGREDIENT_CONFIG.beans.initial, milk: INGREDIENT_CONFIG.milk.initial };
}
export function validateIngredients(value: unknown): value is IngredientStock {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'beans,milk') return false;
  const stock = value as IngredientStock;
  return (['beans', 'milk'] as const).every(id => Number.isSafeInteger(stock[id]) && stock[id] >= 0 && stock[id] <= INGREDIENT_CONFIG[id].capacity);
}
export function canBrew(state: Pick<SliceState, 'ingredients'>, recipe: RecipeId): boolean {
  if (!Object.hasOwn(RECIPE_INGREDIENTS, recipe)) return false;
  const dose = RECIPE_INGREDIENTS[recipe];
  return state.ingredients.beans >= dose.beans && state.ingredients.milk >= dose.milk;
}
/** Check the entire recipe before mutating either ingredient. Both simulation paths use this single reservation. */
export function consumeIngredients(state: Pick<SliceState, 'ingredients'>, recipe: RecipeId): boolean {
  if (!canBrew(state, recipe)) return false;
  const dose = RECIPE_INGREDIENTS[recipe];
  state.ingredients.beans -= dose.beans; state.ingredients.milk -= dose.milk;
  return true;
}
export function quoteIngredient(state: Pick<SliceState, 'ingredients' | 'wallet'>, id: IngredientId, mode: PurchaseMode): IngredientQuote {
  if (!Object.hasOwn(INGREDIENT_CONFIG, id) || !['one', 'batch', 'fill'].includes(mode)) return { quantity: 0, cost: 0, stock: 0, capacity: 0, affordable: false };
  const config = INGREDIENT_CONFIG[id], stock = state.ingredients[id], room = config.capacity - stock;
  const quantity = Math.max(0, Math.min(room, mode === 'one' ? 1 : mode === 'batch' ? config.batch : room));
  const cost = quantity * config.unitCost;
  return { quantity, cost, stock, capacity: config.capacity, affordable: quantity > 0 && state.wallet >= cost };
}
/** Recompute at the transaction boundary; repeated clicks cannot overfill or incur debt. */
export function purchaseIngredient(state: SliceState, id: IngredientId, mode: PurchaseMode): IngredientQuote | null {
  const offer = quoteIngredient(state, id, mode);
  if (!offer.affordable) return null;
  state.wallet -= offer.cost; state.spend += offer.cost; state.ingredients[id] += offer.quantity;
  return offer;
}
