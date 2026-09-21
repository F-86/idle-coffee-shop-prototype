import type {
  CounterConfig,
  CounterKey,
  DrinkConfig,
  LocationConfig,
  LocationKey,
  UpgradeConfig,
  UpgradeKey
} from "./types";

export const SAVE_VERSION = 2;
export const STORAGE_KEY = "mellow-bean-idle-v1";
export const OFFLINE_CAP_SECONDS = 4 * 60 * 60;
export const OFFLINE_MIN_SECONDS = 15;
export const OFFLINE_EFFICIENCY = 0.86;
export const MAX_RECIPE_LEVEL = 6;

export const counterOrder: CounterKey[] = ["counter1", "counter2", "counter3"];

// Counter centers are world coordinates shared by the business route and the
// Phaser scene. The CSS scene mirrors these anchors through sceneLayout.ts.
export const counterWorldPositions: Record<string, number> = {
  vault: 7,
  counter1: 23,
  counter2: 50,
  counter3: 77
};

export const upgradeConfig: Record<string, UpgradeConfig> = {
  machine: {
    name: "经理推车",
    effect: "收钱速度",
    baseCost: 70,
    costScale: 1.46
  },
  recipe: {
    name: "待客培训",
    effect: "顾客耐心",
    baseCost: 95,
    costScale: 1.52
  },
  seats: {
    name: "候客座位",
    effect: "排队容量",
    baseCost: 120,
    costScale: 1.58
  },
  marketing: {
    name: "街角传单",
    effect: "顾客到店",
    baseCost: 145,
    costScale: 1.63
  }
};

export const drinkConfig: Record<string, DrinkConfig> = {
  americano: {
    name: "美式",
    shortName: "美式",
    mood: "今天想喝一杯清爽的美式",
    basePrice: 8,
    tip: 1.2,
    brewSeconds: 2.5,
    unlockAt: 0,
    recipeBaseCost: 70
  },
  latte: {
    name: "蜂蜜拿铁",
    shortName: "拿铁",
    mood: "请给我一杯绵密的蜂蜜拿铁",
    basePrice: 12,
    tip: 2.1,
    brewSeconds: 3.4,
    unlockAt: 1,
    recipeBaseCost: 180
  },
  mocha: {
    name: "燕麦摩卡",
    shortName: "摩卡",
    mood: "今天想奖励自己一杯燕麦摩卡",
    basePrice: 18,
    tip: 3.5,
    brewSeconds: 4.2,
    unlockAt: 2,
    recipeBaseCost: 260
  },
  coldbrew: {
    name: "橙香冷萃",
    shortName: "冷萃",
    mood: "下午想喝一杯带果香的冷萃",
    basePrice: 26,
    tip: 5.2,
    brewSeconds: 5.1,
    unlockAt: 3,
    recipeBaseCost: 420
  },
  macchiato: {
    name: "焦糖玛奇朵",
    shortName: "玛奇朵",
    mood: "请给我一杯甜甜的焦糖玛奇朵",
    basePrice: 36,
    tip: 7.2,
    brewSeconds: 5.8,
    unlockAt: 4,
    recipeBaseCost: 680
  }
};

export const locationConfig: Record<string, LocationConfig> = {
  street: {
    name: "榛果街 17 号",
    shortName: "榛果街",
    mood: "今天的空气很适合咖啡",
    detail: "安静的第一家店",
    requiredLevel: 1,
    unlockCost: 0,
    incomeMultiplier: 1
  },
  station: {
    name: "中央车站 B1",
    shortName: "中央车站",
    mood: "列车进站，人流正好涌来",
    detail: "早高峰客流更旺",
    requiredLevel: 3,
    unlockCost: 1800,
    incomeMultiplier: 1.34
  },
  seaside: {
    name: "海边码头 06 号",
    shortName: "海边码头",
    mood: "海风把咖啡香送到了更远的地方",
    detail: "周末限定的慢时光",
    requiredLevel: 5,
    unlockCost: 6200,
    incomeMultiplier: 1.72
  }
};

export const counterConfig: Record<string, CounterConfig> = {
  counter1: {
    name: "一号柜台",
    shortName: "一号柜台",
    unlockCost: 0,
    requiredLevel: 1,
    baseUpgradeCost: 220,
    costScale: 1.5
  },
  counter2: {
    name: "二号柜台",
    shortName: "二号柜台",
    unlockCost: 650,
    requiredLevel: 2,
    baseUpgradeCost: 360,
    costScale: 1.54
  },
  counter3: {
    name: "三号柜台",
    shortName: "三号柜台",
    unlockCost: 2400,
    requiredLevel: 4,
    baseUpgradeCost: 680,
    costScale: 1.58
  }
};

export const orderPeople = [
  { name: "苏女士", avatar: "苏" },
  { name: "林先生", avatar: "林" },
  { name: "陈同学", avatar: "陈" },
  { name: "乔小姐", avatar: "乔" }
];

export const locationKeys: LocationKey[] = ["street", "station", "seaside"];

export function getDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function seedActivities(now = Date.now()) {
  return [
    { icon: "✦", iconClass: "icon-bean", message: "新的一天，从一杯好咖啡开始。", time: now - 15000 },
    { icon: "♡", iconClass: "icon-heart", message: "苏女士说，今天的拿铁很顺滑。", time: now - 120000 },
    { icon: "☼", iconClass: "icon-sun", message: "阳光照进了靠窗的座位。", time: now - 300000 }
  ];
}
