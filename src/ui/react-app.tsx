import { flushSync } from "react-dom";
import cashPouchAsset from "../../assets/cash-pouch-blocky-v1.png";
import counterAsset from "../../assets/coffee-counter-blocky-v2.png";
import floorAsset from "../../assets/coffee-shop-empty-floor-v3.png";
import streetSceneAsset from "../../assets/coffee-shop-scene-blocky-street-v1.png";
import stationSceneAsset from "../../assets/coffee-shop-scene-blocky-station-v1.png";
import seasideSceneAsset from "../../assets/coffee-shop-scene-blocky-seaside-v1.png";
import figmaWorldAsset from "../../assets/figma/world-2.5d.png";
import figmaAmericanoIconAsset from "../../assets/figma/coffee-icon-americano.png";
import figmaLatteIconAsset from "../../assets/figma/coffee-icon-latte.png";
import figmaColdBrewIconAsset from "../../assets/figma/coffee-icon-coldbrew.png";
import figmaMochaIconAsset from "../../assets/figma/coffee-icon-mocha.png";
import figmaMacchiatoIconAsset from "../../assets/figma/coffee-icon-macchiato.png";
import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
  type ReactNode
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { drinkConfig, counterConfig, locationConfig, counterOrder, upgradeConfig, MAX_RECIPE_LEVEL } from "../core/config";
import type { GameEvent, GameView, CounterKey, DrinkKey, LocationKey, UpgradeKey } from "../core/types";
import type { GameStore } from "../core/store";
import { sceneLayout } from "../game/sceneLayout";
import "./react-app.css";

const drinkKeys: DrinkKey[] = ["americano", "latte", "mocha", "coldbrew", "macchiato"];
const upgradeKeys: UpgradeKey[] = ["machine", "recipe", "seats", "marketing"];
const drinkIconAssets: Record<DrinkKey, string> = {
  americano: figmaAmericanoIconAsset,
  latte: figmaLatteIconAsset,
  mocha: figmaMochaIconAsset,
  coldbrew: figmaColdBrewIconAsset,
  macchiato: figmaMacchiatoIconAsset
};

const sceneBackdropAssets: Record<LocationKey, string> = {
  street: streetSceneAsset,
  station: stationSceneAsset,
  seaside: seasideSceneAsset
};

function money(value: number): string {
  return `¥ ${Math.floor(value).toLocaleString("zh-CN")}`;
}

function formatLevel(value: number): string {
  return `Lv. ${Math.max(0, Math.floor(value))}`;
}

function Modal({
  open,
  title,
  eyebrow,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-layer react-modal-layer">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭弹窗" />
      <section ref={dialogRef} className="modal-window" role="dialog" aria-modal="true" aria-labelledby={`${title}-title`} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <div className="section-kicker">{eyebrow}</div>
            <h2 id={`${title}-title`}>{title}</h2>
          </div>
          <button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label={`关闭${title}弹窗`}>×</button>
        </div>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

function Topbar({
  view,
  onManage,
  onSettings,
  onToggleBusiness,
  onReset
}: {
  view: GameView;
  onManage: () => void;
  onSettings: () => void;
  onToggleBusiness: () => void;
  onReset: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">MB</div>
        <div className="brand-copy">
          <span className="eyebrow">IDLE COFFEE CLUB</span>
          <strong>Mellow Bean</strong>
        </div>
      </div>
      <div className="topbar-meta">
        <span className="topbar-balance" aria-label="金库余额"><span className="tiny-coin" /><strong>{money(view.coins)}</strong></span>
        <button className="topbar-action" type="button" onClick={onManage}><span>⌘</span>经营</button>
        <button className="topbar-action" type="button" onClick={onSettings}><span>⚙</span>设置</button>
        <button className="business-status" type="button" onClick={onToggleBusiness} title="点击切换营业状态">
          <span className="status-dot" />
          <span>{view.isOpen ? "营业中" : "已打烊"}</span>
        </button>
        <button className="icon-button" type="button" onClick={onReset} title="重置本地进度" aria-label="重置本地进度">↺</button>
      </div>
    </header>
  );
}

function WelcomePanel({
  view,
  onBoost,
  onTips,
  offlineAmount,
  onDismissOffline
}: {
  view: GameView;
  onBoost: () => void;
  onTips: () => void;
  offlineAmount: number;
  onDismissOffline: () => void;
}) {
  return (
    <section className="welcome-panel panel">
      <div className="welcome-copy">
        <div className="section-kicker">WEDNESDAY · 08:40 AM</div>
        <h1>让每一杯咖啡，<br /><em>慢慢变成好生意。</em></h1>
        <p>你的第一家店已经开门。照顾好客人的早晨，咖啡馆会自己长大。</p>
        <div className="welcome-actions">
          <button className="primary-button" type="button" onClick={onBoost} disabled={view.boostUntil > Date.now()}>
            <span className="button-icon">✦</span>
            <span><strong>晨间加速</strong><small>{view.boostUntil > Date.now() ? "加速进行中 · 15 秒" : "营业效率 ×2 · 15 秒"}</small></span>
          </button>
          <button className="secondary-button" type="button" onClick={onTips}><span>收取小费</span><span className="arrow">↗</span></button>
        </div>
      </div>
      <div className="welcome-illustration" aria-hidden="true"><div className="illustration-glow" /><div className="illustration-steam steam-one" /><div className="illustration-steam steam-two" /><div className="illustration-cup"><span className="cup-coffee" /><span className="cup-handle" /></div><div className="illustration-saucer" /></div>
      <div className="welcome-metrics">
        <div className="welcome-metric"><span>今日营业额</span><strong>{money(view.todayEarned)}</strong></div>
        <div className="metric-divider" />
        <div className="welcome-metric"><span>今日服务客人</span><strong>{view.todayServed} <small>位</small></strong></div>
        <div className="metric-divider" />
        <div className="welcome-metric"><span>当前倍率</span><strong>{view.economy.multiplier.toFixed(1)}×</strong></div>
      </div>
      {offlineAmount > 0 && <div className="offline-notice"><span className="offline-spark">✦</span><span><strong>{money(offlineAmount)}</strong> 在你离开时产出，等待经理回收</span><button type="button" onClick={onDismissOffline} aria-label="关闭离线收益提示">×</button></div>}
    </section>
  );
}

function recipePreview(view: GameView, key: DrinkKey) {
  const drink = drinkConfig[key];
  const level = Math.max(0, Math.floor(view.recipeLevels[key] || 0));
  const nextLevel = Math.min(MAX_RECIPE_LEVEL, Math.max(1, level + 1));
  const priceAt = (targetLevel: number) => Math.floor(drink.basePrice + Math.max(0, targetLevel - 1) * 2.4);
  const brewAt = (targetLevel: number) => Math.max(1.4, drink.brewSeconds - Math.max(0, targetLevel - 1) * 0.32);
  return {
    drink,
    level,
    nextLevel,
    price: priceAt(Math.max(1, level)),
    nextPrice: priceAt(nextLevel),
    brewSeconds: brewAt(Math.max(1, level)),
    nextBrewSeconds: brewAt(nextLevel),
    cost: Math.round(drink.recipeBaseCost * Math.pow(1.56, level)),
    isMax: level >= MAX_RECIPE_LEVEL,
    requiredCounterLevel: Math.max(1, drink.unlockAt + 1)
  };
}

function RecipeWall({ view, onSelect }: { view: GameView; onSelect: (key: DrinkKey) => void }) {
  return (
    <div className="scene-recipe-wall">
      <div className="scene-recipe-wall-heading"><span className="scene-recipe-wall-light" /><strong>咖啡墙</strong><small>解锁 / 升级 · 售价 ↑ 制作时间 ↓</small></div>
      <div className="scene-recipe-grid">
        {drinkKeys.map((key) => {
          const drink = drinkConfig[key];
          const level = view.recipeLevels[key];
          const unlocked = level > 0;
          const preview = recipePreview(view, key);
          const filledUpgradeDots = Math.max(0, Math.min(5, level - 1));
          return <button key={key} className={`scene-recipe ${unlocked ? "is-unlocked" : "is-locked"} is-level-${Math.min(MAX_RECIPE_LEVEL, Math.max(0, level))} ${view.selectedDrink === key ? "is-selected" : ""}`} type="button" aria-label={`查看${drink.name}详情`} onClick={() => onSelect(key)}>
            <span className={`scene-recipe-icon menu-icon-${key}`}><img className="drink-icon-image" src={drinkIconAssets[key]} alt="" /></span>
            <span className="scene-recipe-copy"><strong>{drink.shortName}</strong><small>{unlocked ? formatLevel(level) : "未解锁"}</small><span className="scene-recipe-level-dots" aria-label={`${filledUpgradeDots}/5 个升级点`}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={`scene-recipe-level-dot ${index < filledUpgradeDots ? "is-filled" : ""}`} aria-hidden="true" />)}</span></span>
            <span className="scene-recipe-cost">{preview.isMax ? "满级" : money(preview.cost)}</span>
          </button>;
        })}
      </div>
    </div>
  );
}

function StationDrinkPicker({ view, dispatch, keyName }: { view: GameView; dispatch: GameStore["dispatch"]; keyName: CounterKey }) {
  const counter = view.counters[keyName];
  const config = counterConfig[keyName];
  const currentDrink = drinkConfig[counter.drink];
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function togglePicker(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (counter.unlocked) {
      setOpen((value) => !value);
    }
  }

  return <div ref={pickerRef} className={`station-drink-picker ${open ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
    <button
      className="station-drink-icon-button"
      type="button"
      disabled={!counter.unlocked}
      aria-label={`选择${config.name}咖啡，当前${currentDrink.name}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={togglePicker}
    >
      <img src={drinkIconAssets[counter.drink]} alt={`${currentDrink.name}图标`} />
      <span className="station-drink-icon-caret" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="station-drink-picker-menu" role="listbox" aria-label={`选择${config.name}咖啡`}>
      {drinkKeys.map((drinkKey) => {
        const drink = drinkConfig[drinkKey];
        const unlocked = view.recipeLevels[drinkKey] > 0;
        const selected = counter.drink === drinkKey;
        return <button
          key={drinkKey}
          className={`station-drink-picker-option ${selected ? "is-selected" : ""}`}
          type="button"
          role="option"
          aria-selected={selected}
          disabled={!unlocked}
          onClick={(event) => {
            event.stopPropagation();
            if (unlocked) {
              dispatch({ type: "change-counter-drink", key: keyName, drink: drinkKey });
              setOpen(false);
            }
          }}
        >
          <img src={drinkIconAssets[drinkKey]} alt="" />
          <span><strong>{drink.name}</strong><small>{unlocked ? "已解锁" : "未解锁"}</small></span>
          {selected && <b aria-hidden="true">✓</b>}
        </button>;
      })}
    </div>}
  </div>;
}

function CustomerLanes({ view, dispatch }: { view: GameView; dispatch: GameStore["dispatch"] }) {
  return <div className="scene-customer-lanes" aria-label="顾客候客区">
    {counterOrder.map((key) => {
      const counter = view.counters[key];
      const capacity = Math.max(0, Math.floor(view.queueCapacity[key] || 0));
      return <div key={key} className={`scene-customer-lane ${counter.unlocked ? "is-open" : "is-locked"}`} data-counter-key={key} data-capacity={capacity}>
        <button className="scene-customer-rug" type="button" disabled={!counter.unlocked} aria-label={counter.unlocked ? `点击${counterConfig[key].name}前方候客地毯催促出杯，当前队列 ${counter.queue.length}/${capacity}` : `${counterConfig[key].name}尚未开放`} onClick={() => dispatch({ type: "rush-counter", key })} />
        <div className="scene-customer-lane-header"><strong>{counterConfig[key].shortName}</strong><small>{counter.unlocked ? `${counter.queue.length}/${capacity}` : "未开放"}</small></div>
        <div className="scene-customer-slots" aria-hidden="true">
          {Array.from({ length: capacity }, (_, index) => <span key={index} className={`scene-customer-slot ${index < counter.queue.length ? "is-filled" : ""}`} />)}
        </div>
      </div>;
    })}
  </div>;
}

function StationCard({ view, dispatch, keyName, onDetails }: { view: GameView; dispatch: GameStore["dispatch"]; keyName: CounterKey; onDetails: (key: CounterKey) => void }) {
  const counter = view.counters[keyName];
  const config = counterConfig[keyName];
  const stat = view.economy.counterStats.find((item) => item.key === keyName);
  const cost = counter.unlocked ? Math.round(config.baseUpgradeCost * Math.pow(config.costScale, Math.max(0, counter.level - 1))) : config.unlockCost;
  const actionType = counter.unlocked ? "升级" : "解锁";
  const drink = drinkConfig[counter.drink];
  const stationStatus = counter.unlocked
    ? `${drink.shortName} · ${money(stat?.price || 0)} · 咖啡师 ${counter.baristas}`
    : "尚未开摊";
  return (
    <article className={`scene-station station-counter ${counter.unlocked ? "" : "is-locked"} ${counter.brew ? "is-producing" : ""}`}>
      <div className="scene-counter-visual" aria-hidden="true"><img className="scene-counter-sprite" src={counterAsset} alt="" /></div>
      <StationDrinkPicker view={view} dispatch={dispatch} keyName={keyName} />
      <button className="scene-station-main scene-counter-detail-trigger station-brew-trigger" type="button" title={`查看${config.name}详情`} aria-label={`查看${config.name}详情`} onClick={() => onDetails(keyName)}>
        <span className="station-copy"><strong>{config.name}</strong><small>{stationStatus}</small></span>
        <span className="station-level">{counter.unlocked ? formatLevel(counter.level) : "未解锁"}</span>
        <span className="station-cost">{actionType} {money(cost)}</span>
      </button>
      <div className="scene-station-actions">
        <button className="station-upgrade-button" type="button" disabled={view.coins < cost} onClick={() => dispatch({ type: "purchase-counter", key: keyName })}>{actionType} · {money(cost)}</button>
      </div>
      <span className="station-cash"><span className="station-cash-visual" aria-hidden="true"><img src={cashPouchAsset} alt="" /></span><span className="station-cash-label">柜台待收 {money(counter.pendingCash)}</span></span>
      <div className="station-brew-track" role="progressbar" aria-label={`${config.name}制作进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((stat?.brewProgress || 0) * 100)}><span style={{ width: `${(stat?.brewProgress || 0) * 100}%` }} /></div>
    </article>
  );
}

function CounterDetails({
  view,
  dispatch,
  keyName,
  onClose
}: {
  view: GameView;
  dispatch: GameStore["dispatch"];
  keyName: CounterKey;
  onClose: () => void;
}) {
  const counter = view.counters[keyName];
  const config = counterConfig[keyName];
  const drink = drinkConfig[counter.drink];
  const stat = view.economy.counterStats.find((item) => item.key === keyName);
  const cost = counter.unlocked ? Math.round(config.baseUpgradeCost * Math.pow(config.costScale, Math.max(0, counter.level - 1))) : config.unlockCost;
  const action = counter.unlocked ? "升级" : "解锁";
  const canBuy = view.coins >= cost;
  const buy = () => {
    if (dispatch({ type: "purchase-counter", key: keyName }) === true) {
      // Keep the detail open so the player can compare the refreshed preview.
    }
  };
  return <div className="scene-detail-panel">
    <div className="scene-detail-hero">
      <div className="scene-detail-icon scene-detail-drink-icon"><img src={drinkIconAssets[counter.drink]} alt={`${drink.name}图标`} /></div>
      <div><strong>{config.name}</strong><span>{counter.unlocked ? `${drink.name} · ${formatLevel(counter.level)} · ${counter.baristas > 0 ? "咖啡师已到岗" : "等待咖啡师"}` : `达到店铺 Lv. ${config.requiredLevel} 后开放`}</span></div>
    </div>
    <dl className="scene-detail-stats">
      <div><dt>当前售价</dt><dd>{counter.unlocked ? money(stat?.price || 0) : "—"}</dd></div>
      <div><dt>当前倍率</dt><dd>{counter.unlocked ? `×${(stat?.priceMultiplier || 1).toFixed(2)}` : "—"}</dd></div>
      <div><dt>升级后售价</dt><dd>{counter.unlocked ? money(stat?.nextPrice || 0) : "解锁后显示"}</dd></div>
      <div><dt>升级后倍率</dt><dd>{counter.unlocked ? `×${(stat?.nextPriceMultiplier || 1).toFixed(2)}` : "—"}</dd></div>
      <div><dt>制作时长</dt><dd>{counter.unlocked ? `${(stat?.brewSeconds || 0).toFixed(1)} 秒` : "—"}</dd></div>
      <div><dt>升级后时长</dt><dd>{counter.unlocked ? `${(stat?.nextBrewSeconds || 0).toFixed(1)} 秒` : "—"}</dd></div>
    </dl>
    <div className="scene-detail-actions">
      <button className="primary-button scene-detail-buy" type="button" disabled={!canBuy} onClick={buy}>{action} · {money(cost)}</button>
      <small>{canBuy ? `金库余额 ${money(view.coins)}` : `还差 ${money(cost - view.coins)}`}</small>
    </div>
  </div>;
}

function RecipeDetails({
  view,
  dispatch,
  keyName
}: {
  view: GameView;
  dispatch: GameStore["dispatch"];
  keyName: DrinkKey;
}) {
  const preview = recipePreview(view, keyName);
  const highestCounterLevel = counterOrder.reduce((highest, counterKey) => {
    return Math.max(highest, view.counters[counterKey].unlocked ? view.counters[counterKey].level : 0);
  }, 0);
  const unlockBlocked = preview.level < 1 && highestCounterLevel < preview.requiredCounterLevel;
  const canBuy = !preview.isMax && view.coins >= preview.cost;
  const label = preview.isMax ? "已满级" : preview.level < 1 ? `解锁 · ${money(preview.cost)}` : `升级 · ${money(preview.cost)}`;
  return <div className="scene-detail-panel">
    <div className="scene-detail-hero">
      <div className="scene-detail-icon scene-detail-drink-icon"><img src={drinkIconAssets[keyName]} alt={`${preview.drink.name}图标`} /></div>
      <div><strong>{preview.drink.name}</strong><span>{preview.level > 0 ? formatLevel(preview.level) : `未解锁 · 柜台 Lv. ${preview.requiredCounterLevel} 解锁`}</span></div>
    </div>
    <dl className="scene-detail-stats">
      <div><dt>当前单价</dt><dd>{money(preview.price)}</dd></div>
      <div><dt>升级后单价</dt><dd>{money(preview.nextPrice)}</dd></div>
      <div><dt>当前制作</dt><dd>{preview.brewSeconds.toFixed(1)} 秒</dd></div>
      <div><dt>升级后制作</dt><dd>{preview.nextBrewSeconds.toFixed(1)} 秒</dd></div>
      <div><dt>升级点</dt><dd>{preview.isMax ? `${MAX_RECIPE_LEVEL}/${MAX_RECIPE_LEVEL}` : `${preview.level}/${MAX_RECIPE_LEVEL}`}</dd></div>
      <div><dt>解锁门槛</dt><dd>柜台 Lv. {preview.requiredCounterLevel}</dd></div>
    </dl>
    <div className="scene-detail-actions">
      <button className="primary-button scene-detail-buy" type="button" disabled={!canBuy} onClick={() => dispatch({ type: "purchase-recipe", key: keyName })}>{label}</button>
      <small>{unlockBlocked ? `还需要任一柜台达到 Lv. ${preview.requiredCounterLevel}` : canBuy ? `金库余额 ${money(view.coins)}` : `还差 ${money(preview.cost - view.coins)}`}</small>
    </div>
  </div>;
}

function ShopFloor({
  view,
  dispatch,
  onManage,
  onSettings,
  onCounterDetails,
  onRecipeDetails
}: {
  view: GameView;
  dispatch: GameStore["dispatch"];
  onManage: () => void;
  onSettings: () => void;
  onCounterDetails: (key: CounterKey) => void;
  onRecipeDetails: (key: DrinkKey) => void;
}) {
  const location = locationConfig[view.activeLocation];
  const boostSeconds = Math.max(0, Math.ceil((view.boostUntil - Date.now()) / 1000));
  const sceneWorldStyle = {
    "--scene-counter-y": `${sceneLayout.counter.centerY * 100}%`,
    "--scene-manager-y": `${sceneLayout.manager.routeY * 100}%`,
    "--scene-rug-top": `${sceneLayout.customer.rugTop * 100}%`,
    "--scene-rug-bottom": `${sceneLayout.customer.rugBottom * 100}%`
  } as CSSProperties;
  return (
    <section className="section-block">
      <div className="section-header"><div><div className="section-kicker">THE SHOP FLOOR</div><h2>店内实况</h2></div><div className="live-note"><span className="live-dot" />LIVE · 每秒更新</div></div>
      <article className="shopfloor panel">
        <div className="shopfloor-topline"><div><strong>{location.name}</strong><span> · </span><span>{location.mood}</span></div><div className="shop-level"><span>店铺等级</span><strong>Lv. {1 + Math.floor(view.totalServed / 50)}</strong></div></div>
        <div className={`shop-scene scene-art-mode scene-figma-baseline ${view.isOpen ? "" : "is-closed"}`} id="shopScene" role="region" aria-label={`Mellow Bean 咖啡店营业场景，可操作设施与快捷按钮；金库 ${money(view.coins)}，待收 ${money(view.pendingCash)}，经理携款 ${money(view.manager.carrying)}`}>
          <div className="scene-hud">
            <span className="scene-hud-chip scene-location-chip">☕ {location.shortName}</span>
            <span className="scene-hud-chip scene-balance-chip" aria-label="金库余额"><span>当前余额</span><strong>{money(view.coins)}</strong></span>
            <button className={`scene-hud-chip scene-boost-chip ${view.economy.boostActive ? "is-active" : ""}`} type="button" disabled={view.economy.boostActive} aria-label={view.economy.boostActive ? `咖啡加速剩余 ${boostSeconds} 秒` : "启动咖啡加速"} onClick={() => dispatch({ type: "activate-boost" })}><strong>✦ 咖啡加速 2×</strong><small>{view.economy.boostActive ? `剩余 00:${String(boostSeconds).padStart(2, "0")}` : "剩余 00:15"}</small></button>
            <button className={`scene-hud-chip scene-business-toggle ${view.isOpen ? "" : "is-closed"}`} type="button" onClick={() => dispatch({ type: "toggle-business" })}><span className="status-dot" />{view.isOpen ? "营业中" : "已打烊"}</button>
            <span className="scene-hud-chip scene-level-chip"><span>LEVEL</span><strong>{1 + Math.floor(view.totalServed / 50)}</strong></span>
            <span className="scene-hud-actions" aria-label="店铺操作"><button className="scene-hud-system-button" type="button" onClick={onManage} aria-label="打开经营管理">⌘<small>经营</small></button><button className="scene-hud-system-button" type="button" onClick={onSettings} aria-label="打开设置">⚙<small>设置</small></button></span>
            <span className="scene-brand-plaque" aria-label={`当前店铺 ${location.shortName}`}><strong>MELLOW BEAN</strong><small>{location.shortName}</small></span>
          </div>
          <div className="scene-world-viewport" id="sceneWorldViewport" tabIndex={0} aria-label="可横向浏览的店内柜台；顾客从左侧入口进店，取杯或满位后从右侧出口离店">
            <div className="scene-world" id="sceneWorld" style={sceneWorldStyle}>
              <img className="scene-figma-world" src={figmaWorldAsset} alt="" aria-hidden="true" />
              <img className="scene-art scene-art-empty" src={floorAsset} alt="" aria-hidden="true" />
              <div className="scene-rear-art-crop" aria-hidden="true">
                <img className="scene-rear-art" src={sceneBackdropAssets[view.activeLocation]} alt="" />
              </div>
              <div className="scene-sky" aria-hidden="true" />
              <div className="scene-entry-marker" aria-hidden="true"><span>入口</span><small>顾客进店</small></div>
              <div className="scene-exit-marker" aria-hidden="true"><span>出口</span><small>顾客离店</small></div>
              <CustomerLanes view={view} dispatch={dispatch} />
              <div className="phaser-scene-layer" id="phaserSceneLayer" aria-hidden="true" />
              <RecipeWall view={view} onSelect={onRecipeDetails} />
              <div className="scene-station-belt" aria-label="店内设施">{counterOrder.map((key) => <StationCard key={key} keyName={key} view={view} dispatch={dispatch} onDetails={onCounterDetails} />)}</div>
              <div className="scene-manager-route"><span className="manager-route-line" /><button className="scene-vault-marker" type="button" onClick={() => dispatch({ type: "purchase-upgrade", key: "machine" })}><span className="vault-icon">▣</span><span className="vault-copy"><strong>金库</strong><small>推车 {formatLevel(view.upgrades.machine + 1)}</small></span><span className="scene-vault-cost">{money(Math.round(upgradeConfig.machine.baseCost * Math.pow(upgradeConfig.machine.costScale, view.upgrades.machine)))}</span></button></div>
            </div>
          </div>
          <div className="scene-collect-bar"><span className="scene-collect-icon">↔</span><span className="scene-collect-copy"><small>经理收钱 · 回金库</small><strong>{view.manager.carrying > 0 ? `经理推车中 · ${money(view.manager.carrying)}` : "经理沿路线巡回"}</strong></span><span className="scene-collect-meter"><span style={{ width: `${view.managerMotion.routeProgress * 100}%` }} /></span><strong className="scene-collect-amount">柜台待收 {money(view.pendingCash)}</strong></div>
        </div>
        <div className="shopfloor-footer"><div className="flow-stat"><span className="flow-icon">☕</span><span><strong>{view.economy.cupsPerMinute.toFixed(1)}</strong> 杯 / 分钟</span></div><div className="queue-stat">排队中 <span>{counterOrder.flatMap((key) => view.counters[key].queue).slice(0, 3).map((customer) => <span key={customer.id} className="queue-avatar">{customer.id.slice(-1)}</span>)}</span><span>升级设备，让香气走得更远。</span></div></div>
      </article>
    </section>
  );
}

function SidePanel({ view, dispatch, onManage }: { view: GameView; dispatch: GameStore["dispatch"]; onManage: () => void }) {
  return <aside className="side-column">
    <section className="side-panel panel"><div className="section-kicker">TODAY AT A GLANCE</div><h2>经营小记</h2><div className="side-stat-grid"><div><span>金库余额</span><strong>{money(view.coins)}</strong></div><div><span>待收现金</span><strong>{money(view.pendingCash)}</strong></div><div><span>顾客满意度</span><strong>{Math.round(view.satisfaction)}%</strong></div><div><span>总服务</span><strong>{view.totalServed}</strong></div></div><button className="secondary-button side-action" type="button" onClick={onManage}>打开经营台 <span className="arrow">↗</span></button></section>
    <section className="side-panel panel"><div className="section-kicker">UPGRADES</div><h2>经营升级</h2>{upgradeKeys.map((key) => { const config = upgradeConfig[key]; const level = view.upgrades[key]; const cost = Math.round(config.baseCost * Math.pow(config.costScale, level)); return <button className="side-upgrade" type="button" key={key} disabled={view.coins < cost} onClick={() => dispatch({ type: "purchase-upgrade", key })}><span><strong>{config.name}</strong><small>{config.effect} · {formatLevel(level + 1)}</small></span><b>{money(cost)}</b></button>; })}</section>
    <div className="side-footer"><span className="bean-stamp">✦</span><span>把平凡的早晨，<br /><strong>煮成喜欢的样子。</strong></span></div>
  </aside>;
}

function ManageContent({ view, dispatch }: { view: GameView; dispatch: GameStore["dispatch"] }) {
  return <div className="manage-grid"><div><h3>员工与目标</h3><p>咖啡师 {view.staff} 名 · 今日服务 {view.todayServed} / 50</p><button className="secondary-button" type="button" onClick={() => dispatch({ type: "hire-staff" })}>招募咖啡师</button><button className="secondary-button" type="button" disabled={view.todayServed < 50 || view.goalClaimed} onClick={() => dispatch({ type: "claim-goal" })}>{view.goalClaimed ? "今日奖励已领取" : "领取今日 ¥ 80"}</button></div><div><h3>经营地点</h3>{(Object.keys(locationConfig) as LocationKey[]).map((key) => <button key={key} className={`location-option ${view.activeLocation === key ? "is-active" : ""}`} type="button" onClick={() => dispatch({ type: "switch-location", key })}><span><strong>{locationConfig[key].shortName}</strong><small>{locationConfig[key].detail}</small></span><b>{view.unlockedLocations.includes(key) ? "前往" : money(locationConfig[key].unlockCost)}</b></button>)}</div></div>;
}

function SettingsContent({ onReset }: { onReset: () => void }) {
  return <div className="settings-content"><h3>本地存档</h3><p>经营数据保存在当前浏览器的本地存储中。旧版存档会在加载时归一化，未来版本存档保持只读保护。</p><button className="secondary-button" type="button" onClick={onReset}>重置本地进度</button></div>;
}

function ReactApp({
  view,
  dispatch,
  onReset,
  offlineAmount,
  onDismissOffline
}: {
  view: GameView;
  dispatch: GameStore["dispatch"];
  onReset: () => void;
  offlineAmount: number;
  onDismissOffline: () => void;
}) {
  const [modal, setModal] = useState<"manage" | "settings" | null>(null);
  const [counterDetail, setCounterDetail] = useState<CounterKey | null>(null);
  const [recipeDetail, setRecipeDetail] = useState<DrinkKey | null>(null);
  return <div className="app-shell react-app-shell">
    <Topbar view={view} onManage={() => setModal("manage")} onSettings={() => setModal("settings")} onToggleBusiness={() => dispatch({ type: "toggle-business" })} onReset={onReset} />
    <div className="landscape-hint" role="note"><span className="landscape-hint-icon" aria-hidden="true">↻</span><span>横屏体验更完整</span><small>旋转手机查看店内循环</small></div>
    <main className="dashboard"><section className="main-column"><WelcomePanel view={view} onBoost={() => dispatch({ type: "activate-boost" })} onTips={() => dispatch({ type: "collect-tips" })} offlineAmount={offlineAmount} onDismissOffline={onDismissOffline} /><ShopFloor view={view} dispatch={dispatch} onManage={() => setModal("manage")} onSettings={() => setModal("settings")} onCounterDetails={setCounterDetail} onRecipeDetails={setRecipeDetail} /></section><SidePanel view={view} dispatch={dispatch} onManage={() => setModal("manage")} /></main>
    <Modal open={counterDetail !== null} title={counterDetail ? `${counterConfig[counterDetail].name}详情` : "柜台详情"} eyebrow="COUNTER DETAILS" onClose={() => setCounterDetail(null)}>{counterDetail && <CounterDetails view={view} dispatch={dispatch} keyName={counterDetail} onClose={() => setCounterDetail(null)} />}</Modal>
    <Modal open={recipeDetail !== null} title={recipeDetail ? `${drinkConfig[recipeDetail].name}详情` : "配方详情"} eyebrow="RECIPE DETAILS" onClose={() => setRecipeDetail(null)}>{recipeDetail && <RecipeDetails view={view} dispatch={dispatch} keyName={recipeDetail} />}</Modal>
    <Modal open={modal === "manage"} title="经营管理" eyebrow="MELLOW BEAN CONTROL ROOM" onClose={() => setModal(null)}><ManageContent view={view} dispatch={dispatch} /></Modal>
    <Modal open={modal === "settings"} title="设置" eyebrow="LOCAL SHOP SETTINGS" onClose={() => setModal(null)}><SettingsContent onReset={onReset} /></Modal>
  </div>;
}

export interface ReactRenderer {
  render(view: GameView): void;
  handleEvent(event: GameEvent): void;
  showOfflineNotice(amount: number): void;
  destroy(): void;
}

export function createReactRenderer({ engine, onReset }: { engine: GameStore; onReset: () => void }): ReactRenderer {
  const rootElement = document.getElementById("react-root");
  if (!rootElement) {
    throw new Error("React root is missing");
  }
  rootElement.hidden = false;
  document.body.classList.add("react-ui-enabled");

  let currentView = engine.getView() as GameView;
  let updateView: ((view: GameView) => void) | null = null;
  let showToast: ((message: string, icon: string) => void) | null = null;
  let setOfflineAmount: ((amount: number) => void) | null = null;
  const root: Root = createRoot(rootElement);

  function RootComponent() {
    const [view, setView] = useState<GameView>(currentView);
    const [offlineAmount, setOffline] = useState(0);
    updateView = setView;
    setOfflineAmount = setOffline;
    showToast = (message, icon) => {
      const node = document.createElement("div");
      node.className = "toast-item";
      node.textContent = `${icon} ${message}`;
      document.querySelector(".react-toast-stack")?.append(node);
      window.setTimeout(() => node.remove(), 2800);
    };
    return <><ReactApp view={view} dispatch={engine.dispatch} onReset={onReset} offlineAmount={offlineAmount} onDismissOffline={() => setOffline(0)} /><div className="react-toast-stack" aria-live="polite" aria-atomic="true" /></>;
  }

  flushSync(() => {
    root.render(<StrictMode><RootComponent /></StrictMode>);
  });

  return {
    render(view: GameView) {
      currentView = view;
      updateView?.(view);
    },
    handleEvent(event: GameEvent) {
      if (event.type === "toast" && typeof event.message === "string") {
        showToast?.(event.message, typeof event.icon === "string" ? event.icon : "✦");
      }
      currentView = engine.getView() as GameView;
      updateView?.(currentView);
    },
    showOfflineNotice(amount: number) {
      setOfflineAmount?.(amount);
    },
    destroy() {
      root.unmount();
      document.body.classList.remove("react-ui-enabled");
    }
  };
}
