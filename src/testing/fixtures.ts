import { createCustomer, createDefaultState } from "../core/state";
import type { BrewState, CounterState, Customer, GameState } from "../core/types";

export type TestFixtureName = "queue10" | "long-run";

function customer(id: string, now: number, status: Customer["status"] = "waiting"): Customer {
  return { id, status, arrivedAt: now };
}

function brew(id: string, drink: "americano" | "latte", durationSeconds: number, price: number): BrewState {
  return {
    id,
    drink,
    durationSeconds,
    elapsedSeconds: 0,
    price
  };
}

function queueFor(key: string, count: number, now: number): Customer[] {
  return Array.from({ length: count }, (_, index) => customer(`${key}-fixture-customer-${index + 1}`, now, index === 0 ? "serving" : "waiting"));
}

function resetEconomy(state: GameState, now: number): void {
  state.coins = 200;
  state.totalEarned = 0;
  state.todayEarned = 0;
  state.totalServed = 0;
  state.todayServed = 0;
  state.tipJar = 0;
  state.totalCollected = 0;
  state.todayCollected = 0;
  state.satisfaction = 72;
  state.staff = 1;
  state.isOpen = true;
  state.boostUntil = 0;
  state.lastSeen = now;
  state.goalClaimed = false;
  state.goalReachedNotified = false;
  state.lastShopLevel = 1;
  state.lastLoggedTen = 0;
  state.customerSequence = 100;
  state.orderCursor = 0;
  state.manager = {
    routeKey: "counter1",
    segmentIndex: 0,
    segmentElapsed: 0,
    carrying: 0
  };
  state.upgrades = {
    machine: 0,
    recipe: 0,
    seats: 0,
    marketing: 0
  };
  state.activities = [];
}

function emptyCounter(counter: CounterState): CounterState {
  return {
    ...counter,
    pendingCash: 0,
    queue: [],
    readyCups: [],
    brew: null
  };
}

/**
 * Builds only deterministic test preconditions. It is imported by app.js only
 * when the URL has ?test, and the resulting state is never persisted.
 */
export function createTestFixture(name: TestFixtureName, now: number): GameState {
  const state = createDefaultState(now);
  resetEconomy(state, now);

  if (name === "queue10") {
    state.staff = 2;
    state.upgrades.seats = 3;
    state.recipeLevels.americano = 1;
    state.counters.counter1 = {
      ...emptyCounter(state.counters.counter1),
      unlocked: true,
      level: 1,
      drink: "americano",
      baristas: 2,
      queue: queueFor("counter1", 10, now),
      brew: brew("queue10-long-brew", "americano", 600, 10)
    };
    state.counters.counter2 = emptyCounter({ ...state.counters.counter2, unlocked: false, level: 0, baristas: 0 });
    state.counters.counter3 = emptyCounter({ ...state.counters.counter3, unlocked: false, level: 0, baristas: 0 });
    return state;
  }

  // Two staffed counters keep the loop busy while its time is advanced in
  // explicit one-minute slices. The runtime config remains the app's normal
  // config; this fixture is for continuity/overflow evidence, not balance
  // approval.
  state.staff = 3;
  state.upgrades.seats = 3;
  state.recipeLevels.americano = 1;
  state.recipeLevels.latte = 1;
  state.counters.counter1 = {
    ...emptyCounter(state.counters.counter1),
    unlocked: true,
    level: 1,
    drink: "americano",
    baristas: 2,
    queue: queueFor("counter1", 2, now),
    brew: null
  };
  state.counters.counter2 = {
    ...emptyCounter(state.counters.counter2),
    unlocked: true,
    level: 1,
    drink: "latte",
    baristas: 1,
    queue: queueFor("counter2", 2, now),
    brew: null
  };
  state.counters.counter3 = emptyCounter({ ...state.counters.counter3, unlocked: false, level: 0, baristas: 0 });
  return state;
}

export function isTestFixtureName(value: string | null): value is TestFixtureName {
  return value === "queue10" || value === "long-run";
}
