import {
  OFFLINE_CAP_SECONDS,
  OFFLINE_EFFICIENCY,
  OFFLINE_MIN_SECONDS,
  MAX_RECIPE_LEVEL,
  counterConfig,
  counterOrder,
  counterWorldPositions,
  drinkConfig,
  locationConfig,
  upgradeConfig
} from "./config";
import { cloneState, createCustomer, createDefaultState } from "./state";
import type {
  AdvanceOptions,
  CashLedger,
  CounterKey,
  EconomyView,
  GameEvent,
  GameEventType,
  GameListener,
  GameState,
  GameView,
  DrinkKey,
  LocationKey,
  LocationConfig,
  ManagerMotion
} from "./types";

const EPSILON = 0.000001;

function clamp(value: unknown, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function money(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createGameEngine({
  initialState,
  now = Date.now()
}: {
  initialState: GameState;
  now?: number;
}) {
  const state = initialState;
  const listeners = new Set<GameListener>();
  const runtime = {
    now,
    eventId: 0,
    customerArrivalElapsed: {} as Record<string, number>,
    overflowSequence: 0
  };

  function emit(
    type: GameEventType,
    payload: Record<string, unknown> = {},
    options: Pick<AdvanceOptions, "silent"> = {}
  ): void {
    if (options.silent) {
      return;
    }
    const event = Object.assign({
      id: ++runtime.eventId,
      type,
      at: runtime.now
    }, payload) as GameEvent;
    listeners.forEach((listener) => listener(event));
  }

  function subscribe(listener: GameListener): () => boolean {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function addActivity(message: string, icon = "✦", iconClass = "icon-bean"): void {
    state.activities.unshift({ icon, iconClass, message, time: runtime.now });
    state.activities = state.activities.slice(0, 8);
  }

  function toast(message: string, icon = "✦"): void {
    emit("toast", { message, icon });
  }

  function isDrinkUnlocked(key: string): boolean {
    return Boolean(drinkConfig[key]) && Math.max(0, Number(state.recipeLevels[key]) || 0) >= 1;
  }

  function getAvailableDrinkKeys(): string[] {
    return Object.keys(drinkConfig).filter(isDrinkUnlocked);
  }

  function getRecipeLevel(key: string): number {
    return Math.max(0, Math.floor(Number(state.recipeLevels[key]) || 0));
  }

  function getDrinkPrice(key: string): number {
    const drink = drinkConfig[key] || drinkConfig.americano;
    return money(drink.basePrice + Math.max(0, getRecipeLevel(key) - 1) * 2.4);
  }

  function getDrinkBrewSeconds(key: string): number {
    const drink = drinkConfig[key] || drinkConfig.americano;
    return Math.max(1.4, drink.brewSeconds - Math.max(0, getRecipeLevel(key) - 1) * 0.32);
  }

  function getRecipeUpgradeCost(key: string): number {
    const drink = drinkConfig[key];
    if (!drink) {
      return 0;
    }
    return Math.round(drink.recipeBaseCost * Math.pow(1.56, getRecipeLevel(key)));
  }

  function getCounterPrice(key: string): number {
    return getCounterPriceAtLevel(key, state.counters[key]?.level || 1);
  }

  function getCounterPriceAtLevel(key: string, level: number, applyLocation = true): number {
    const counter = state.counters[key];
    if (!counter || !counter.unlocked) {
      return applyLocation ? 0 : getDrinkPrice(counter?.drink || "americano");
    }
    const basePrice = getDrinkPrice(counter.drink) + Math.max(0, level - 1) * 2.2;
    return money(basePrice * (applyLocation ? getActiveLocation().incomeMultiplier : 1));
  }

  function getCounterPriceMultiplier(key: string, level: number): number {
    const counter = state.counters[key];
    if (!counter || !counter.unlocked) {
      return 1;
    }
    const basePrice = Math.max(1, getDrinkPrice(counter.drink));
    return getCounterPriceAtLevel(key, level, false) / basePrice;
  }

  function getCounterUpgradeCost(key: string): number {
    const counter = state.counters[key];
    const config = counterConfig[key];
    if (!counter || !config) {
      return 0;
    }
    if (!counter.unlocked) {
      return config.unlockCost;
    }
    return Math.round(config.baseUpgradeCost * Math.pow(config.costScale, Math.max(0, counter.level - 1)));
  }

  function getUpgradeCost(key: string): number {
    const config = upgradeConfig[key];
    if (!config) {
      return 0;
    }
    return Math.round(config.baseCost * Math.pow(config.costScale, Math.max(0, Number(state.upgrades[key]) || 0)));
  }

  function getStaffCost() {
    return Math.round(260 * Math.pow(1.72, Math.max(0, state.staff - 1)));
  }

  function syncCounterBaristas() {
    const unlocked = counterOrder.filter((key) => state.counters[key].unlocked);
    let remaining = Math.max(1, Math.floor(Number(state.staff) || 1));
    counterOrder.forEach((key) => {
      state.counters[key].baristas = 0;
    });
    unlocked.forEach((key) => {
      if (remaining > 0) {
        state.counters[key].baristas = 1;
        remaining -= 1;
      }
    });
    let index = 0;
    while (remaining > 0 && unlocked.length) {
      state.counters[unlocked[index % unlocked.length]].baristas += 1;
      remaining -= 1;
      index += 1;
    }
  }

  function getShopLevel() {
    return 1 + Math.floor((Number(state.totalServed) || 0) / 50);
  }

  function getTipMultiplier() {
    const trainingLevel = Number(state.upgrades.recipe) || 0;
    return 0.82 + state.satisfaction / 100 * 0.38 + Math.min(0.1, trainingLevel * 0.015);
  }

  function getActiveLocation(): LocationConfig {
    return locationConfig[state.activeLocation] || locationConfig.street;
  }

  function getQueueCapacity(key: string): number {
    const counter = state.counters[key];
    if (!counter || !counter.unlocked) {
      return 0;
    }
    // Seats and extra baristas extend the lane, but the side-on shop never
    // accepts more than ten customers at one counter.
    return Math.min(10, 3 + Math.max(0, Number(state.upgrades.seats) || 0) * 2 + Math.max(0, counter.baristas - 1));
  }

  function getCounterSpeedMultiplier(key: string): number {
    const counter = state.counters[key];
    if (!state.isOpen || !counter || !counter.unlocked || counter.baristas < 1 || !isDrinkUnlocked(counter.drink)) {
      return 0;
    }
    const marketing = 1 + Math.max(0, Number(state.upgrades.marketing) || 0) * 0.12;
    const boost = state.boostUntil > runtime.now ? 2 : 1;
    return Math.max(1, counter.baristas) * marketing * boost;
  }

  function ensureCustomerQueue(key: "counter1" | "counter2" | "counter3", options: AdvanceOptions = {}): void {
    const counter = state.counters[key];
    const capacity = getQueueCapacity(key);
    if (!counter || capacity < 1) {
      return;
    }
    if (counter.queue.length > 10) {
      counter.queue = counter.queue.slice(0, 10);
    }
    while (counter.queue.length < capacity) {
      const customer = createCustomer(state, runtime.now, key);
      counter.queue.push(customer);
      emit("customer-arrived", {
        counterKey: key,
        customer: clone(customer)
      }, { silent: options.silent });
    }
    if (counter.queue.length) {
      counter.queue[0].status = "serving";
      counter.queue.slice(1).forEach((customer) => {
        customer.status = "waiting";
      });
    }
  }

  function ensureAllQueues(options: AdvanceOptions = {}): void {
    counterOrder.forEach((key) => ensureCustomerQueue(key, options));
  }

  function getCustomerArrivalSeconds(): number {
    const marketing = Math.max(0, Number(state.upgrades.marketing) || 0);
    return Math.max(0.9, 2.4 - marketing * 0.12);
  }

  function updateCustomerArrivals(seconds: number, options: AdvanceOptions = {}): void {
    if (seconds <= 0) {
      return;
    }
    counterOrder.forEach((key) => {
      const counter = state.counters[key];
      if (!state.isOpen || !counter?.unlocked || getQueueCapacity(key) < 1) {
        return;
      }
      const interval = getCustomerArrivalSeconds();
      const elapsed = (runtime.customerArrivalElapsed[key] || 0) + seconds;
      let remaining = elapsed;
      while (remaining + EPSILON >= interval) {
        remaining -= interval;
        if (counter.queue.length >= getQueueCapacity(key)) {
          runtime.overflowSequence += 1;
          emit("customer-overflow", {
            counterKey: key,
            customer: {
              id: `${key}-overflow-${runtime.overflowSequence}`,
              status: "waiting",
              arrivedAt: runtime.now
            },
            exit: "right"
          }, options);
        } else {
          ensureCustomerQueue(key, options);
        }
      }
      runtime.customerArrivalElapsed[key] = Math.max(0, remaining);
    });
  }

  function createBrew(key: string) {
    const counter = state.counters[key];
    if (!counter || !counter.unlocked || counter.baristas < 1 || !isDrinkUnlocked(counter.drink)) {
      return null;
    }
    const drink = counter.drink;
    return {
      id: `${key}-brew-${++state.customerSequence}`,
      drink,
      durationSeconds: getDrinkBrewSeconds(drink),
      elapsedSeconds: 0,
      price: getCounterPrice(key)
    };
  }

  function ensureBrews() {
    counterOrder.forEach((key) => {
      const counter = state.counters[key];
      if (counter && counter.unlocked && counter.baristas > 0 && isDrinkUnlocked(counter.drink) && !counter.brew) {
        counter.brew = createBrew(key);
      }
    });
  }

  function getManagerRoute(): string[] {
    const unlocked = counterOrder.filter((key) => state.counters[key].unlocked);
    const route = ["vault"].concat(unlocked);
    for (let index = unlocked.length - 2; index >= 0; index -= 1) {
      route.push(unlocked[index]);
    }
    route.push("vault");
    return route;
  }

  function getManagerSegmentSeconds() {
    return Math.max(0.55, 1.35 - (Number(state.upgrades.machine) || 0) * 0.08);
  }

  function normalizeManagerRoute() {
    const route = getManagerRoute();
    const routeKey = route.join("|");
    if (state.manager.routeKey !== routeKey) {
      state.manager.routeKey = routeKey;
      state.manager.segmentIndex = Math.min(state.manager.segmentIndex, Math.max(0, route.length - 2));
      state.manager.segmentElapsed = Math.min(state.manager.segmentElapsed, getManagerSegmentSeconds());
    }
    return route;
  }

  function getManagerMotion(): ManagerMotion {
    const route = normalizeManagerRoute();
    const segmentCount = Math.max(1, route.length - 1);
    const segmentIndex = Math.max(0, Math.min(segmentCount - 1, state.manager.segmentIndex % segmentCount));
    const segmentSeconds = getManagerSegmentSeconds();
    const segmentProgress = clamp(state.manager.segmentElapsed / segmentSeconds, 0, 1);
    const from = route[segmentIndex];
    const to = route[segmentIndex + 1];
    const fromPosition = counterWorldPositions[from] || counterWorldPositions.vault;
    const toPosition = counterWorldPositions[to] || counterWorldPositions.vault;
    const position = fromPosition + (toPosition - fromPosition) * segmentProgress;
    const routeProgress = (segmentIndex + segmentProgress) / segmentCount;
    return {
      route,
      lane: "back",
      segmentIndex,
      segmentProgress,
      from,
      to,
      position,
      fromPosition,
      toPosition,
      routeProgress
    };
  }

  function getPendingCash() {
    return counterOrder.reduce((total, key) => total + Math.max(0, finite(state.counters[key].pendingCash)), 0);
  }

  function getCashLedger() {
    const pendingCash = getPendingCash();
    const carrying = Math.max(0, finite(state.manager.carrying));
    const balance = Math.max(0, finite(state.coins));
    return {
      balance,
      pendingCash,
      carrying,
      total: balance + pendingCash + carrying
    };
  }

  function getEconomy(): EconomyView {
    syncCounterBaristas();
    const location = getActiveLocation();
    const counterStats = counterOrder.map((key) => {
      const counter = state.counters[key];
      const speed = getCounterSpeedMultiplier(key);
      const duration = counter && counter.brew ? counter.brew.durationSeconds : getDrinkBrewSeconds(counter.drink);
      const cupsPerMinute = speed > 0 ? speed * 60 / duration : 0;
      const price = getCounterPrice(key);
      const nextLevel = counter.unlocked ? counter.level + 1 : 1;
      return {
        key,
        drink: counter.drink,
        baristas: counter.baristas,
        price,
        priceMultiplier: getCounterPriceMultiplier(key, counter.unlocked ? counter.level : 1),
        nextPrice: counter.unlocked ? getCounterPriceAtLevel(key, nextLevel) : 0,
        nextPriceMultiplier: getCounterPriceMultiplier(key, nextLevel),
        brewSeconds: duration,
        nextBrewSeconds: getDrinkBrewSeconds(counter.drink),
        cupsPerMinute,
        incomePerMinute: cupsPerMinute * price,
        incomePerSecond: cupsPerMinute * price / 60,
        brewProgress: counter.brew ? clamp(counter.brew.elapsedSeconds / counter.brew.durationSeconds, 0, 1) : 0,
        queueSize: counter.queue.length,
        readyCups: counter.readyCups.length
      };
    });
    const cupsPerMinute = counterStats.reduce((total, stat) => total + stat.cupsPerMinute, 0);
    const incomePerMinute = counterStats.reduce((total, stat) => total + stat.incomePerMinute, 0);
    const unlockedCounterCount = counterOrder.filter((key) => state.counters[key].unlocked).length;
    return {
      cupsPerMinute,
      pricePerCup: cupsPerMinute ? incomePerMinute / cupsPerMinute : 0,
      incomePerMinute,
      incomePerSecond: incomePerMinute / 60,
      servedPerSecond: cupsPerMinute / 60,
      capacity: 3 + (Number(state.upgrades.seats) || 0) * 2 + state.staff + Math.max(0, unlockedCounterCount - 1) * 2,
      locationMultiplier: location.incomeMultiplier,
      multiplier: state.boostUntil > runtime.now ? 2 : 1,
      boostActive: state.boostUntil > runtime.now,
      counterStats
    };
  }

  function deliverReadyCups(key: "counter1" | "counter2" | "counter3", options: AdvanceOptions = {}): number {
    const counter = state.counters[key];
    if (!counter) {
      return 0;
    }
    ensureCustomerQueue(key, options);
    let delivered = 0;
    while (counter.readyCups.length && counter.queue.length) {
      const completed = counter.readyCups.shift();
      const customer = counter.queue.shift();
      if (!completed || !customer) {
        break;
      }
      const amount = Math.max(1, money(completed.price));
      customer.status = "ready";
      counter.pendingCash += amount;
      state.totalEarned += amount;
      state.todayEarned += amount;
      state.totalServed += 1;
      state.todayServed += 1;
      const tip = (drinkConfig[completed.drink] || drinkConfig.americano).tip * getTipMultiplier();
      state.tipJar += tip;
      delivered += 1;
      emit("cup-delivered", {
        counterKey: key,
        brewId: completed.id,
        drink: completed.drink,
        customer: clone(customer),
        amount,
        pendingCash: counter.pendingCash
      }, { silent: options.silent });
      ensureCustomerQueue(key, options);
    }
    return delivered;
  }

  function settleCurrentBrew(key: CounterKey, options: AdvanceOptions = {}) {
    const counter = state.counters[key];
    const brew = counter?.brew;
    if (!counter || !brew) {
      return { completed: false, delivered: 0, amount: 0, drink: "americano" as DrinkKey, brewId: "" };
    }
    counter.readyCups.push({
      id: brew.id,
      drink: brew.drink,
      price: brew.price
    });
    const delivered = deliverReadyCups(key, options);
    if (!options.silent && delivered > 0) {
      // deliverReadyCups emits the customer/cash event. This pulse is only
      // for the renderer and remains tied to the same brew id.
      emit("brew-completed", { counterKey: key, brewId: brew.id, drink: brew.drink });
    }
    counter.brew = createBrew(key);
    return {
      completed: true,
      delivered,
      amount: brew.price,
      drink: brew.drink as DrinkKey,
      brewId: brew.id
    };
  }

  function advanceCounter(key: "counter1" | "counter2" | "counter3", seconds: number, options: AdvanceOptions = {}) {
    const counter = state.counters[key];
    if (!counter || !counter.unlocked || counter.baristas < 1 || !isDrinkUnlocked(counter.drink)) {
      return { cups: 0, amount: 0 };
    }
    ensureCustomerQueue(key, options);
    ensureBrews();
    let brew = counter.brew || createBrew(key);
    if (!brew) {
      return { cups: 0, amount: 0 };
    }
    counter.brew = brew;
    const speed = getCounterSpeedMultiplier(key) * (options.source === "offline" ? OFFLINE_EFFICIENCY : 1);
    if (speed <= 0) {
      return { cups: 0, amount: 0 };
    }
    brew.elapsedSeconds += seconds * speed;
    let completedCount = 0;
    let amount = 0;
    while (brew.elapsedSeconds + EPSILON >= brew.durationSeconds) {
      const overflow = brew.elapsedSeconds - brew.durationSeconds;
      const completed = settleCurrentBrew(key, options);
      completedCount += 1;
      amount += completed.amount;
      brew = counter.brew;
      if (!brew) {
        break;
      }
      brew.elapsedSeconds = overflow;
    }
    counter.brew = brew;
    return { cups: completedCount, amount };
  }

  function rushCounter(key: CounterKey): boolean {
    const counter = state.counters[key];
    if (!state.isOpen) {
      toast("已经打烊，暂时不能催促出杯。", "☾");
      return false;
    }
    if (!counter || !counter.unlocked) {
      toast("先解锁这个柜台，再催促出杯。", "▣");
      return false;
    }
    if (counter.baristas < 1 || !isDrinkUnlocked(counter.drink)) {
      toast(`${counterConfig[key].name}还没有可工作的咖啡师或配方。`, "☕");
      return false;
    }
    ensureCustomerQueue(key, { silent: false });
    ensureBrews();
    if (!counter.brew) {
      toast(`${counterConfig[key].name}正在准备下一杯。`, "☕");
      return false;
    }
    const completed = settleCurrentBrew(key);
    if (!completed.completed) {
      return false;
    }
    addActivity(`你催了催${counterConfig[key].name}，${drinkConfig[completed.drink].shortName}马上出杯。`, "⚡");
    toast(`${counterConfig[key].name}已加急出杯，顾客拿到咖啡了。`, "⚡");
    emit("counter-rushed", {
      counterKey: key,
      brewId: completed.brewId,
      drink: completed.drink,
      amount: completed.amount,
      delivered: completed.delivered
    });
    return true;
  }

  function processManagerStop(stop: string, options: AdvanceOptions = {}): void {
    if (stop === "vault") {
      const deposit = Math.max(0, finite(state.manager.carrying));
      if (deposit > 0) {
        state.manager.carrying = 0;
        state.coins += deposit;
        state.totalCollected += deposit;
        state.todayCollected += deposit;
        emit("cash-deposited", {
          amount: deposit,
          balance: state.coins
        }, { silent: options.silent });
      }
      return;
    }

    const counter = state.counters[stop];
    if (!counter || !counter.unlocked || counter.pendingCash <= 0) {
      return;
    }
    const capacity = Infinity;
    const room = Math.max(0, capacity - state.manager.carrying);
    const collected = Math.min(counter.pendingCash, room);
    if (collected <= 0) {
      return;
    }
    counter.pendingCash -= collected;
    state.manager.carrying += collected;
    emit("cash-collected", {
      counterKey: stop,
      amount: collected,
      pendingCash: counter.pendingCash,
      carrying: state.manager.carrying
    }, { silent: options.silent });
  }

  function updateManager(seconds: number, options: AdvanceOptions = {}): void {
    if (!state.isOpen || seconds <= 0) {
      return;
    }
    const route = normalizeManagerRoute();
    const segmentSeconds = getManagerSegmentSeconds();
    const segmentCount = Math.max(1, route.length - 1);
    state.manager.segmentElapsed += seconds;
    while (state.manager.segmentElapsed + EPSILON >= segmentSeconds) {
      state.manager.segmentElapsed -= segmentSeconds;
      const nextIndex = (state.manager.segmentIndex + 1) % segmentCount;
      processManagerStop(route[nextIndex], options);
      state.manager.segmentIndex = nextIndex;
    }
  }

  function checkMilestones(options: AdvanceOptions = {}): void {
    const loggedTen = Math.floor(state.totalServed / 10);
    const shopLevel = getShopLevel();
    if (shopLevel > state.lastShopLevel) {
      state.lastShopLevel = shopLevel;
      addActivity(`店铺升级到 Lv. ${shopLevel}，新的客流正在赶来。`);
      emit("toast", { message: `恭喜！店铺达到 Lv. ${shopLevel}`, icon: "✦" }, options);
    }
    if (state.todayServed >= 50 && !state.goalReachedNotified) {
      state.goalReachedNotified = true;
      addActivity("今日目标完成了，柜台上多了一束小花。", "✿");
      emit("toast", { message: "今日小目标完成！可以领取 ¥ 80 奖励", icon: "✿" }, options);
    }
    if (loggedTen > state.lastLoggedTen && loggedTen % 2 === 0) {
      state.lastLoggedTen = loggedTen;
      addActivity(`第 ${Math.floor(state.totalServed)} 位客人满意离店。`, "♡", "icon-heart");
    }
  }

  function advance(seconds: number, options: AdvanceOptions = {}) {
    const duration = Math.max(0, Math.min(OFFLINE_CAP_SECONDS, finite(seconds)));
    if (duration <= 0) {
      return { cups: 0, earnings: 0, deposited: 0 };
    }
    syncCounterBaristas();
    ensureAllQueues(options);
    ensureBrews();
    if (!state.isOpen) {
      return { cups: 0, earnings: 0, deposited: 0 };
    }
    const result = { cups: 0, earnings: 0, deposited: 0 };
    // Keep production and transport on one chronological timeline. A single
    // large delta must not let the manager collect a cup before the instant
    // that cup was actually completed. Online frames are small already; the
    // bounded slices also make visibility recovery deterministic. Offline
    // settlement does not move the manager, so its larger slice is safe and
    // keeps a multi-hour recovery responsive.
    const sliceSize = options.source === "offline" ? 0.5 : 0.05;
    let remaining = duration;
    while (remaining > EPSILON) {
      const slice = Math.min(sliceSize, remaining);
      counterOrder.forEach((key) => {
        const counterResult = advanceCounter(key, slice, options);
        result.cups += counterResult.cups;
        result.earnings += counterResult.amount;
      });
      if (options.source !== "offline") {
        updateCustomerArrivals(slice, options);
        updateManager(slice, options);
      }
      remaining -= slice;
    }
    checkMilestones(options);
    if (options.source === "offline") {
      emit("offline-settled", {
        seconds: duration,
        cups: result.cups,
        earnings: result.earnings,
        pendingCash: getPendingCash()
      });
    }
    return result;
  }

  function settleElapsed(now: number) {
    runtime.now = now;
    const elapsed = Math.min(
      OFFLINE_CAP_SECONDS,
      Math.max(0, (now - finite(state.lastSeen, now)) / 1000)
    );
    state.boostUntil = 0;
    let result = { cups: 0, earnings: 0, deposited: 0 };
    if (state.isOpen && elapsed > OFFLINE_MIN_SECONDS) {
      result = advance(elapsed, { source: "offline", silent: true });
    }
    state.lastSeen = now;
    return Object.assign({ seconds: elapsed }, result);
  }

  function markSeen(now = runtime.now): void {
    runtime.now = now;
    state.lastSeen = now;
  }

  function setNow(now: number): void {
    runtime.now = now;
  }

  function toggleBusiness() {
    state.isOpen = !state.isOpen;
    if (state.isOpen) {
      ensureAllQueues({ silent: false });
      ensureBrews();
      addActivity("店门重新打开，第一位客人已经在门口微笑。", "☼", "icon-sun");
      toast("重新开门营业", "☼");
    } else {
      addActivity("今天先打烊一会儿，给自己留一点空白。", "☾", "icon-sun");
      toast("已打烊，自动收益暂停", "☾");
    }
    emit("business-toggled", { isOpen: state.isOpen });
    return state.isOpen;
  }

  function activateBoost() {
    if (state.boostUntil > runtime.now) {
      return false;
    }
    state.boostUntil = runtime.now + 15000;
    addActivity("晨间加速启动，今天的第一缕香气更快了。", "✦");
    toast("晨间加速已启动，效率 ×2 持续 15 秒", "✦");
    emit("boost-activated", { until: state.boostUntil });
    return true;
  }

  function collectTips() {
    const amount = money(state.tipJar);
    if (amount < 1) {
      toast("零钱罐还在慢慢积攒中。", "♡");
      return false;
    }
    state.coins += amount;
    state.totalCollected += amount;
    state.todayCollected += amount;
    state.tipJar -= amount;
    addActivity(`你把客人留下的 ¥ ${amount} 小费放进了金库。`, "♡", "icon-heart");
    toast(`小费已入库：¥ ${amount}`, "♡");
    emit("tips-collected", { amount, balance: state.coins });
    return true;
  }

  function purchaseUpgrade(key: string): boolean {
    const config = upgradeConfig[key];
    const cost = getUpgradeCost(key);
    if (!config) {
      return false;
    }
    if (state.coins < cost) {
      toast(`还差 ¥ ${money(cost - state.coins)}，再营业一会儿吧。`, "☕");
      return false;
    }
    state.coins -= cost;
    state.upgrades[key] = (Number(state.upgrades[key]) || 0) + 1;
    addActivity(`${config.name}升级完成，${config.effect}提高了。`);
    toast(`${config.name}已升级到 Lv. ${state.upgrades[key] + 1}`, "✦");
    emit("upgrade-purchased", { key, cost, level: state.upgrades[key] });
    return true;
  }

  function purchaseRecipe(key: string): boolean {
    const drink = drinkConfig[key];
    const currentLevel = getRecipeLevel(key);
    const cost = getRecipeUpgradeCost(key);
    if (!drink) {
      return false;
    }
    if (currentLevel < 1) {
      const highestCounterLevel = counterOrder.reduce((highest, counterKey) => {
        return Math.max(highest, state.counters[counterKey]?.unlocked ? state.counters[counterKey].level : 0);
      }, 0);
      const requiredCounterLevel = Math.max(1, drink.unlockAt + 1);
      if (highestCounterLevel < requiredCounterLevel) {
        toast(`${drink.name}需要任一柜台达到 Lv. ${requiredCounterLevel}。`, "▣");
        return false;
      }
    } else if (currentLevel >= MAX_RECIPE_LEVEL) {
      toast(`${drink.name}已经满级。`, "✧");
      return false;
    }
    if (state.coins < cost) {
      toast(`金库还差 ¥ ${money(cost - state.coins)}，等经理回来再升级。`, "✧");
      return false;
    }
    state.coins -= cost;
    state.recipeLevels[key] = currentLevel + 1;
    addActivity(currentLevel > 0
      ? `咖啡墙上的 ${drink.name} 升到 Lv. ${state.recipeLevels[key]}，售价提高、制作更快。`
      : `解锁了咖啡墙上的 ${drink.name}，售价提高、制作更快。`, "✧");
    toast(currentLevel > 0
      ? `${drink.name}已升级到 Lv. ${state.recipeLevels[key]}`
      : `${drink.name}已解锁，可以挂到柜台上了`, "✧");
    emit("recipe-purchased", { key, cost, level: state.recipeLevels[key] });
    return true;
  }

  function purchaseCounter(key: string): boolean {
    const counter = state.counters[key];
    const config = counterConfig[key];
    const cost = getCounterUpgradeCost(key);
    if (!counter || !config) {
      return false;
    }
    if (!counter.unlocked && getShopLevel() < config.requiredLevel) {
      toast(`店铺达到 Lv. ${config.requiredLevel} 才能开放 ${config.shortName}`, "▣");
      return false;
    }
    if (state.coins < cost) {
      toast(`金库还差 ¥ ${money(cost - state.coins)}，经理正在收钱。`, "▣");
      return false;
    }
    state.coins -= cost;
    if (!counter.unlocked) {
      counter.unlocked = true;
      counter.level = 1;
      addActivity(`${config.name}已解锁，新的咖啡师会被安排到这里。`, "▣");
      toast(`${config.name}已开摊，经理会把这里赚的钱收回金库`, "▣");
    } else {
      counter.level += 1;
      addActivity(`${config.name}升级完成，当前咖啡售价提高了。`);
      toast(`${config.name}已升级到 Lv. ${counter.level}，当前咖啡售价提高`, "✦");
    }
    syncCounterBaristas();
    ensureAllQueues({ silent: false });
    ensureBrews();
    emit("counter-purchased", { key, cost, level: counter.level, unlocked: counter.unlocked });
    return true;
  }

  function changeCounterDrink(key: string, drinkKey: string): boolean {
    const counter = state.counters[key];
    if (!counter || !counter.unlocked || !drinkConfig[drinkKey]) {
      return false;
    }
    if (!isDrinkUnlocked(drinkKey)) {
      toast(`先在咖啡墙解锁 ${drinkConfig[drinkKey].name}。`, "✧");
      return false;
    }
    if (counter.drink === drinkKey) {
      return true;
    }
    counter.drink = drinkKey as DrinkKey;
    // Existing brew is deliberately left untouched. The next brew picks up
    // the newly selected recipe, so a cup cannot change price mid-cycle.
    addActivity(`${counterConfig[key].name}换上了 ${drinkConfig[drinkKey].name}。`, "☕");
    toast(`${counterConfig[key].name}现在制作 ${drinkConfig[drinkKey].name}`, "☕");
    ensureAllQueues({ silent: false });
    ensureBrews();
    emit("counter-drink-changed", { key, drink: drinkKey });
    return true;
  }

  function hireStaff() {
    const cost = getStaffCost();
    if (state.coins < cost) {
      toast(`还差 ¥ ${money(cost - state.coins)}，暂时还不能招募。`, "☕");
      return false;
    }
    state.coins -= cost;
    state.staff += 1;
    syncCounterBaristas();
    ensureAllQueues({ silent: false });
    ensureBrews();
    addActivity("新的咖啡师加入了 Mellow Bean。", "✦");
    toast("欢迎新伙伴加入！店铺效率提高了。", "✦");
    emit("staff-hired", { cost, staff: state.staff });
    return true;
  }

  function claimGoal() {
    if (state.goalClaimed || state.todayServed < 50) {
      return false;
    }
    state.goalClaimed = true;
    state.coins += 80;
    addActivity("你领取了今日小目标奖励 ¥ 80。", "✿");
    toast("奖励已领取：¥ 80", "✿");
    emit("goal-claimed", { amount: 80, balance: state.coins });
    return true;
  }

  function switchLocation(key: string): boolean {
    const config = locationConfig[key];
    if (!config || state.activeLocation === key) {
      return false;
    }
    const locationKey = key as LocationKey;
    const unlocked = state.unlockedLocations.includes(locationKey);
    if (!unlocked) {
      if (getShopLevel() < config.requiredLevel) {
        toast(`店铺达到 Lv. ${config.requiredLevel} 才能前往 ${config.shortName}`, "⌂");
        return false;
      }
      if (state.coins < config.unlockCost) {
        toast(`还差 ¥ ${money(config.unlockCost - state.coins)} 才能开设 ${config.shortName}`, "⌂");
        return false;
      }
      state.coins -= config.unlockCost;
      state.unlockedLocations.push(locationKey);
      addActivity(`${config.shortName}分店开张，城市里多了一处咖啡香。`);
      toast(`${config.shortName}已解锁！收入提高 ×${config.incomeMultiplier.toFixed(2)}`, "✦");
    } else {
      addActivity(`你把营业地点切换到了 ${config.shortName}。`, "☼", "icon-sun");
      toast(`已前往 ${config.shortName}`, "☼");
    }
    state.activeLocation = locationKey;
    ensureAllQueues({ silent: false });
    ensureBrews();
    emit("location-changed", { key });
    return true;
  }

  function reset(now = Date.now()): void {
    const next = createDefaultState(now);
    Object.assign(state, next);
    syncCounterBaristas();
    ensureAllQueues({ silent: true });
    ensureBrews();
    runtime.customerArrivalElapsed = {};
    runtime.overflowSequence = 0;
    emit("state-reset", {});
  }

  syncCounterBaristas();
  normalizeManagerRoute();
  ensureAllQueues({ silent: true });
  ensureBrews();

  return {
    subscribe,
    setNow,
    markSeen,
    getState: () => cloneState(state),
    getView: () => {
      const economy = clone(getEconomy());
      const managerMotion = clone(getManagerMotion());
      const snapshot = cloneState(state) as unknown as GameView;
      snapshot.economy = economy;
      snapshot.managerMotion = managerMotion;
      snapshot.pendingCash = getPendingCash();
      snapshot.cashLedger = getCashLedger();
      snapshot.activeLocationConfig = clone(getActiveLocation());
      snapshot.queueCapacity = Object.fromEntries(counterOrder.map((key) => [key, getQueueCapacity(key)]));
      snapshot.config = {
        drinks: clone(drinkConfig),
        counters: clone(counterConfig),
        locations: clone(locationConfig),
        upgrades: clone(upgradeConfig)
      };
      return snapshot;
    },
    getConfig: () => ({ drinkConfig, counterConfig, locationConfig, upgradeConfig, counterOrder }),
    advance,
    settleElapsed,
    toggleBusiness,
    activateBoost,
    collectTips,
    purchaseUpgrade,
    purchaseRecipe,
    purchaseCounter,
    changeCounterDrink,
    hireStaff,
    claimGoal,
    switchLocation,
    rushCounter,
    reset,
    getDrinkPrice,
    getDrinkBrewSeconds,
    getRecipeLevel,
    getRecipeUpgradeCost,
    getCounterPrice,
    getCounterUpgradeCost,
    getUpgradeCost,
    getStaffCost,
    getShopLevel,
    isDrinkUnlocked,
    getManagerMotion,
    getEconomy
  };
}
