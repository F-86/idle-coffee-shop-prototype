import {
  SAVE_VERSION,
  MAX_RECIPE_LEVEL,
  counterConfig,
  counterOrder,
  drinkConfig,
  getDayKey,
  locationConfig,
  orderPeople,
  seedActivities
} from "./config";
import type {
  BrewState,
  CounterKey,
  CounterState,
  Customer,
  DrinkKey,
  GameState,
  ManualOrderState,
  ManagerState,
  LocationKey,
  RecipeLevels,
  ReadyCup
} from "./types";

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finite(value, fallback));
}

function clamp(value: unknown, min: number, max: number, fallback = min): number {
  const number = finite(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createDefaultRecipeLevels(): RecipeLevels {
  return {
    americano: 1,
    latte: 0,
    mocha: 0,
    coldbrew: 0,
    macchiato: 0
  };
}

function createDefaultCounters(): Record<CounterKey, CounterState> {
  return {
    counter1: {
      unlocked: true,
      level: 1,
      drink: "americano",
      pendingCash: 0,
      baristas: 1,
      queue: [],
      readyCups: [],
      brew: null
    },
    counter2: {
      unlocked: false,
      level: 0,
      drink: "latte",
      pendingCash: 0,
      baristas: 0,
      queue: [],
      readyCups: [],
      brew: null
    },
    counter3: {
      unlocked: false,
      level: 0,
      drink: "mocha",
      pendingCash: 0,
      baristas: 0,
      queue: [],
      readyCups: [],
      brew: null
    }
  };
}

function createDefaultOrder(now: number): ManualOrderState {
  const person = orderPeople[0];
  return {
    counterKey: "counter1",
    customer: person.name,
    avatar: person.avatar,
    drink: "americano",
    mood: drinkConfig.americano.mood,
    phase: "waiting",
    isBrewing: false,
    progress: 0,
    startedAt: 0,
    waitedSeconds: 0,
    arrivedAt: now,
    patienceSeconds: 18
  };
}

export function createDefaultState(now = Date.now()): GameState {
  return {
    version: SAVE_VERSION,
    coins: 120,
    totalEarned: 120,
    todayEarned: 0,
    totalServed: 18,
    todayServed: 18,
    tipJar: 8,
    totalCollected: 120,
    todayCollected: 0,
    satisfaction: 72,
    selectedDrink: "americano",
    manualOrdersServed: 0,
    manualOrdersMissed: 0,
    orderStreak: 0,
    bestOrderStreak: 0,
    staff: 1,
    recipeLevels: createDefaultRecipeLevels(),
    counters: createDefaultCounters(),
    activeLocation: "street",
    unlockedLocations: ["street"],
    isOpen: true,
    boostUntil: 0,
    lastSeen: now,
    goalClaimed: false,
    goalReachedNotified: false,
    dayKey: getDayKey(now),
    lastShopLevel: 1,
    lastLoggedTen: 1,
    customerSequence: 0,
    orderCursor: 0,
    manager: {
      routeKey: "counter1",
      segmentIndex: 0,
      segmentElapsed: 0,
      carrying: 0
    },
    upgrades: {
      machine: 0,
      recipe: 0,
      seats: 0,
      marketing: 0
    },
    order: createDefaultOrder(now),
    activities: seedActivities(now)
  };
}

function normalizeQueue(queue: unknown, state: GameState): Customer[] {
  if (!Array.isArray(queue)) {
    return [];
  }
  return queue
    .filter((customer) => customer && typeof customer === "object")
    .map((customer) => ({
      id: String(customer.id || `customer-${++state.customerSequence}`),
      status: ["waiting", "serving", "ready"].includes(customer.status)
        ? customer.status
        : "waiting",
      arrivedAt: finite(customer.arrivedAt, state.lastSeen)
    }));
}

function normalizeBrew(brew: any, counter: CounterState, state: GameState): BrewState | null {
  if (!brew || typeof brew !== "object") {
    return null;
  }
  const drink = drinkConfig[brew.drink] && Number(state.recipeLevels[brew.drink]) > 0
    ? brew.drink
    : counter.drink;
  const duration = Math.max(0.1, finite(brew.durationSeconds, drinkConfig[drink].brewSeconds));
  return {
    id: String(brew.id || `brew-${++state.customerSequence}`),
    drink,
    durationSeconds: duration,
    elapsedSeconds: clamp(brew.elapsedSeconds, 0, duration, 0),
    price: Math.max(1, Math.floor(finite(brew.price, drinkConfig[drink].basePrice)))
  };
}

function normalizeCounter(rawCounter: any, fallback: CounterState, state: GameState): CounterState {
  const counter = Object.assign({}, fallback, rawCounter && typeof rawCounter === "object" ? rawCounter : {});
  counter.unlocked = Boolean(counter.unlocked);
  counter.level = counter.unlocked ? Math.max(1, Math.floor(nonNegative(counter.level, 1))) : 0;
  counter.drink = drinkConfig[counter.drink] ? counter.drink : fallback.drink;
  counter.pendingCash = nonNegative(counter.pendingCash);
  counter.baristas = Math.floor(nonNegative(counter.baristas));
  counter.readyCups = Array.isArray(counter.readyCups)
    ? counter.readyCups.filter((cup: any) => cup && typeof cup === "object").map((cup: any) => ({
      id: String(cup.id || `ready-${++state.customerSequence}`),
      drink: drinkConfig[cup.drink] ? cup.drink : counter.drink,
      price: Math.max(1, Math.floor(finite(cup.price, drinkConfig[counter.drink].basePrice)))
    }))
    : Array.from({ length: Math.floor(nonNegative(counter.readyCups)) }, (_, index) => ({
      id: `ready-${++state.customerSequence}-${index}`,
      drink: counter.drink,
      price: Math.max(1, Math.floor(drinkConfig[counter.drink].basePrice))
    }));
  // The 2.5D shop has a hard ten-person visual/business limit per counter;
  // trim legacy saves before the queue is rendered or replenished.
  counter.queue = normalizeQueue(counter.queue, state).slice(0, 10);
  counter.brew = normalizeBrew(counter.brew, counter, state);
  if (!counter.unlocked) {
    counter.baristas = 0;
    counter.queue = [];
    counter.readyCups = [];
    counter.brew = null;
  }
  return counter;
}

function normalizeManager(rawManager: any, fallback: ManagerState): ManagerState {
  const raw = rawManager && typeof rawManager === "object" ? rawManager : {};
  return {
    routeKey: typeof raw.routeKey === "string" ? raw.routeKey : fallback.routeKey,
    segmentIndex: Math.max(0, Math.floor(nonNegative(raw.segmentIndex, fallback.segmentIndex))),
    segmentElapsed: nonNegative(raw.segmentElapsed, fallback.segmentElapsed),
    carrying: nonNegative(raw.carrying, fallback.carrying)
  };
}

function migrateLegacyState(raw: any, state: GameState): GameState {
  if (!raw || typeof raw !== "object") {
    return state;
  }

  // v1 did not persist managerRuntime. Keep this alias for any test fixture or
  // manually repaired save that did include it, while leaving normal v1 saves
  // otherwise untouched.
  if (!raw.manager && raw.managerRuntime) {
    state.manager = normalizeManager(raw.managerRuntime, state.manager);
  }

  if (!raw.recipeLevels && raw.upgrades && Number.isFinite(Number(raw.upgrades.recipe))) {
    const legacyRecipeLevel = Math.max(0, Math.floor(Number(raw.upgrades.recipe)));
    Object.keys(drinkConfig).forEach((key) => {
      if (legacyRecipeLevel >= drinkConfig[key].unlockAt) {
        state.recipeLevels[key] = Math.max(
          1,
          Math.min(MAX_RECIPE_LEVEL, legacyRecipeLevel - drinkConfig[key].unlockAt + 1)
        );
      }
    });
  }

  return state;
}

export function normalizeState(raw: any, now = Date.now()): {
  state: GameState;
  issue: "future-version" | null;
  protectedRaw: boolean;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { state: createDefaultState(now), issue: null, protectedRaw: false };
  }

  const version = finite(raw.version, 1);
  if (version > SAVE_VERSION) {
    return {
      state: createDefaultState(now),
      issue: "future-version",
      protectedRaw: true
    };
  }

  const defaults = createDefaultState(now);
  const defaultCounters = createDefaultCounters();
  const state = Object.assign(defaults, raw);
  state.version = SAVE_VERSION;
  state.upgrades = Object.assign(defaults.upgrades, raw.upgrades || {});
  state.recipeLevels = Object.assign(defaults.recipeLevels, raw.recipeLevels || {});
  state.counters = Object.assign({}, raw.counters || {});
  state.manager = normalizeManager(raw.manager || raw.managerRuntime, defaults.manager);
  state.order = Object.assign(defaults.order, raw.order || {});
  state.activities = Array.isArray(raw.activities) && raw.activities.length
    ? raw.activities.slice(0, 8)
    : seedActivities(now);
  state.unlockedLocations = Array.isArray(raw.unlockedLocations)
    ? raw.unlockedLocations.filter((key: string) => Boolean(locationConfig[key])) as LocationKey[]
    : ["street"];
  if (!state.unlockedLocations.includes("street")) {
    state.unlockedLocations.unshift("street");
  }
  state.activeLocation = locationConfig[state.activeLocation] ? state.activeLocation : "street";
  if (!state.unlockedLocations.includes(state.activeLocation)) {
    state.activeLocation = "street";
  }

  state.customerSequence = Math.max(0, Math.floor(nonNegative(state.customerSequence)));
  state.orderCursor = Math.max(0, Math.floor(nonNegative(state.orderCursor)));
  state.coins = nonNegative(state.coins);
  state.totalEarned = nonNegative(state.totalEarned);
  state.todayEarned = nonNegative(state.todayEarned);
  state.totalServed = nonNegative(state.totalServed);
  state.todayServed = nonNegative(state.todayServed);
  state.tipJar = nonNegative(state.tipJar);
  state.totalCollected = nonNegative(state.totalCollected, state.coins);
  state.todayCollected = nonNegative(state.todayCollected);
  state.satisfaction = clamp(state.satisfaction, 0, 100, 72);
  state.selectedDrink = drinkConfig[state.selectedDrink] ? state.selectedDrink : "americano";
  state.staff = Math.max(1, Math.floor(nonNegative(state.staff, 1)));
  state.boostUntil = nonNegative(state.boostUntil);
  state.lastSeen = finite(state.lastSeen, now);
  state.lastShopLevel = Math.max(1, Math.floor(nonNegative(state.lastShopLevel, 1)));
  state.lastLoggedTen = Math.max(1, Math.floor(nonNegative(state.lastLoggedTen, 1)));
  state.orderStreak = Math.floor(nonNegative(state.orderStreak));
  state.bestOrderStreak = Math.max(state.orderStreak, Math.floor(nonNegative(state.bestOrderStreak)));
  Object.keys(drinkConfig).forEach((key) => {
    state.recipeLevels[key] = Math.max(0, Math.min(MAX_RECIPE_LEVEL, Math.floor(nonNegative(state.recipeLevels[key]))));
  });
  if (state.recipeLevels.americano < 1) {
    state.recipeLevels.americano = 1;
  }
  if (!state.recipeLevels[state.selectedDrink]) {
    state.selectedDrink = "americano";
  }

  counterOrder.forEach((key) => {
    state.counters[key] = normalizeCounter(state.counters[key], defaultCounters[key], state);
  });
  if (!raw.counters) {
    state.counters.counter1.baristas = state.staff;
  }

  state.order = Object.assign(createDefaultOrder(now), state.order || {});
  state.order.counterKey = counterOrder.includes(state.order.counterKey) ? state.order.counterKey : "counter1";
  state.order.drink = drinkConfig[state.order.drink] ? state.order.drink : "americano";
  state.order.customer = typeof state.order.customer === "string" ? state.order.customer : "苏女士";
  state.order.avatar = typeof state.order.avatar === "string" ? state.order.avatar : "苏";
  state.order.phase = ["waiting", "brewing", "ready", "leaving"].includes(state.order.phase)
    ? state.order.phase
    : "waiting";
  state.order.isBrewing = Boolean(state.order.isBrewing) && state.order.phase === "brewing";
  state.order.progress = clamp(state.order.progress, 0, 1);
  state.order.waitedSeconds = nonNegative(state.order.waitedSeconds);
  state.order.startedAt = nonNegative(state.order.startedAt);
  state.order.arrivedAt = finite(state.order.arrivedAt, now);
  state.order.patienceSeconds = Math.max(1, finite(state.order.patienceSeconds, 18));

  state.dayKey = typeof state.dayKey === "string" ? state.dayKey : getDayKey(now);
  const currentDayKey = getDayKey(now);
  if (state.dayKey !== currentDayKey) {
    state.todayEarned = 0;
    state.todayServed = 0;
    state.todayCollected = 0;
    state.goalClaimed = false;
    state.goalReachedNotified = false;
    state.dayKey = currentDayKey;
    state.activities = seedActivities(now);
  }

  migrateLegacyState(raw, state);
  return { state, issue: null, protectedRaw: false };
}

export function cloneState(state: GameState): GameState {
  return clone(state);
}

export function createCustomer(state: GameState, now: number, counterKey: CounterKey): Customer {
  state.customerSequence += 1;
  return {
    id: `${counterKey}-customer-${state.customerSequence}`,
    status: "waiting",
    arrivedAt: now
  };
}
