import { createGameEngine } from "./engine";
import type { AdvanceOptions, CounterKey, DrinkKey, GameState, LocationKey, UpgradeKey } from "./types";

export type GameEngine = ReturnType<typeof createGameEngine>;

export type GameAction =
  | { type: "advance"; seconds: number; options?: AdvanceOptions }
  | { type: "settle-elapsed"; now: number }
  | { type: "toggle-business" }
  | { type: "activate-boost" }
  | { type: "collect-tips" }
  | { type: "purchase-upgrade"; key: UpgradeKey }
  | { type: "purchase-recipe"; key: DrinkKey }
  | { type: "purchase-counter"; key: CounterKey }
  | { type: "change-counter-drink"; key: CounterKey; drink: DrinkKey }
  | { type: "hire-staff" }
  | { type: "claim-goal" }
  | { type: "switch-location"; key: LocationKey }
  | { type: "rush-counter"; key: CounterKey }
  | { type: "reset"; now?: number };

export interface GameStore extends GameEngine {
  dispatch(action: GameAction): unknown;
}

/**
 * A deliberately small action/event boundary. It owns no parallel state: all
 * reads and writes still go through the single pure engine instance.
 */
export function createGameStore({ initialState, now = Date.now() }: { initialState: GameState; now?: number }): GameStore {
  const engine = createGameEngine({ initialState, now });

  function dispatch(action: GameAction): unknown {
    switch (action.type) {
      case "advance":
        return engine.advance(action.seconds, action.options);
      case "settle-elapsed":
        return engine.settleElapsed(action.now);
      case "toggle-business":
        return engine.toggleBusiness();
      case "activate-boost":
        return engine.activateBoost();
      case "collect-tips":
        return engine.collectTips();
      case "purchase-upgrade":
        return engine.purchaseUpgrade(action.key);
      case "purchase-recipe":
        return engine.purchaseRecipe(action.key);
      case "purchase-counter":
        return engine.purchaseCounter(action.key);
      case "change-counter-drink":
        return engine.changeCounterDrink(action.key, action.drink);
      case "hire-staff":
        return engine.hireStaff();
      case "claim-goal":
        return engine.claimGoal();
      case "switch-location":
        return engine.switchLocation(action.key);
      case "rush-counter":
        return engine.rushCounter(action.key);
      case "reset":
        return engine.reset(action.now);
    }
  }

  return Object.assign(engine, { dispatch });
}
