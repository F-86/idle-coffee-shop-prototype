export type CounterKey = "counter1" | "counter2" | "counter3";
export type DrinkKey = "americano" | "latte" | "mocha" | "coldbrew" | "macchiato";
export type LocationKey = "street" | "station" | "seaside";
export type UpgradeKey = "machine" | "recipe" | "seats" | "marketing";
export type CustomerPhase = "waiting" | "serving" | "ready";
export type ManualOrderPhase = "waiting" | "brewing" | "ready" | "leaving";
export type ManagerPhase = "moving" | "collecting" | "depositing";

export interface DrinkConfig {
  name: string;
  shortName: string;
  mood: string;
  basePrice: number;
  tip: number;
  brewSeconds: number;
  unlockAt: number;
  recipeBaseCost: number;
}

export interface CounterConfig {
  name: string;
  shortName: string;
  unlockCost: number;
  requiredLevel: number;
  baseUpgradeCost: number;
  costScale: number;
}

export interface LocationConfig {
  name: string;
  shortName: string;
  mood: string;
  detail: string;
  requiredLevel: number;
  unlockCost: number;
  incomeMultiplier: number;
}

export interface UpgradeConfig {
  name: string;
  effect: string;
  baseCost: number;
  costScale: number;
}

export interface Activity {
  icon: string;
  iconClass: string;
  message: string;
  time: number;
}

export interface Customer {
  id: string;
  status: CustomerPhase;
  arrivedAt: number;
}

export interface ReadyCup {
  id: string;
  drink: string;
  price: number;
}

export interface BrewState {
  id: string;
  drink: string;
  durationSeconds: number;
  elapsedSeconds: number;
  price: number;
}

export interface CounterState {
  unlocked: boolean;
  level: number;
  drink: DrinkKey;
  pendingCash: number;
  baristas: number;
  queue: Customer[];
  readyCups: ReadyCup[];
  brew: BrewState | null;
}

export interface ManagerState {
  routeKey: string;
  segmentIndex: number;
  segmentElapsed: number;
  carrying: number;
}

export interface ManualOrderState {
  counterKey: CounterKey;
  customer: string;
  avatar: string;
  drink: DrinkKey;
  mood: string;
  phase: ManualOrderPhase;
  isBrewing: boolean;
  progress: number;
  startedAt: number;
  waitedSeconds: number;
  arrivedAt: number;
  patienceSeconds: number;
}

export interface RecipeLevels {
  [key: string]: number;
  americano: number;
  latte: number;
  mocha: number;
  coldbrew: number;
  macchiato: number;
}

export interface UpgradeLevels {
  [key: string]: number;
  machine: number;
  recipe: number;
  seats: number;
  marketing: number;
}

export interface GameState {
  version: number;
  coins: number;
  totalEarned: number;
  todayEarned: number;
  totalServed: number;
  todayServed: number;
  tipJar: number;
  totalCollected: number;
  todayCollected: number;
  satisfaction: number;
  selectedDrink: DrinkKey;
  manualOrdersServed: number;
  manualOrdersMissed: number;
  orderStreak: number;
  bestOrderStreak: number;
  staff: number;
  recipeLevels: RecipeLevels;
  counters: Record<string, CounterState>;
  activeLocation: LocationKey;
  unlockedLocations: LocationKey[];
  isOpen: boolean;
  boostUntil: number;
  lastSeen: number;
  goalClaimed: boolean;
  goalReachedNotified: boolean;
  dayKey: string;
  lastShopLevel: number;
  lastLoggedTen: number;
  customerSequence: number;
  orderCursor: number;
  manager: ManagerState;
  upgrades: UpgradeLevels;
  order: ManualOrderState;
  activities: Activity[];
}

/** Persisted state shape. Kept explicit so save compatibility is visible at the boundary. */
export interface SaveData extends GameState {}

export interface EconomyCounterStat {
  key: CounterKey;
  drink: DrinkKey;
  baristas: number;
  price: number;
  priceMultiplier: number;
  nextPrice: number;
  nextPriceMultiplier: number;
  brewSeconds: number;
  nextBrewSeconds: number;
  cupsPerMinute: number;
  incomePerMinute: number;
  incomePerSecond: number;
  servedPerSecond?: number;
  brewProgress: number;
  queueSize: number;
  readyCups: number;
}

export interface EconomyView {
  cupsPerMinute: number;
  pricePerCup: number;
  incomePerMinute: number;
  incomePerSecond: number;
  servedPerSecond: number;
  capacity: number;
  locationMultiplier: number;
  multiplier: number;
  boostActive: boolean;
  counterStats: EconomyCounterStat[];
}

export interface ManagerMotion {
  route: string[];
  lane: "back";
  segmentIndex: number;
  segmentProgress: number;
  from: string;
  to: string;
  position: number;
  fromPosition: number;
  toPosition: number;
  routeProgress: number;
}

export interface CashLedger {
  balance: number;
  pendingCash: number;
  carrying: number;
  total: number;
}

export interface GameView extends GameState {
  economy: EconomyView;
  managerMotion: ManagerMotion;
  pendingCash: number;
  cashLedger: CashLedger;
  activeLocationConfig: LocationConfig;
  queueCapacity: Record<string, number>;
  config: {
    drinks: Record<string, DrinkConfig>;
    counters: Record<string, CounterConfig>;
    locations: Record<string, LocationConfig>;
    upgrades: Record<string, UpgradeConfig>;
  };
}

export type GameEventType =
  | "toast"
  | "customer-arrived"
  | "customer-overflow"
  | "cup-delivered"
  | "brew-completed"
  | "counter-rushed"
  | "cash-collected"
  | "cash-deposited"
  | "business-toggled"
  | "boost-activated"
  | "tips-collected"
  | "upgrade-purchased"
  | "recipe-purchased"
  | "counter-purchased"
  | "counter-drink-changed"
  | "staff-hired"
  | "goal-claimed"
  | "location-changed"
  | "selected-drink-changed"
  | "offline-settled"
  | "state-reset";

export interface GameEvent {
  id: number;
  type: GameEventType;
  at: number;
  [key: string]: unknown;
}

export type GameListener = (event: GameEvent) => void;

export interface AdvanceOptions {
  source?: "online" | "offline";
  silent?: boolean;
}

export interface StorageLoadResult {
  state: SaveData | null;
  issue: "corrupt" | "future-version" | "storage-unavailable" | null;
  protectedRaw: boolean;
}

export interface StorageResult {
  ok: boolean;
  error?: unknown;
}
