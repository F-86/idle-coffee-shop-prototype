import type { GameCommand } from '../cloud/commands';
import { cloudStorage, getAuthority, getManualSync } from '../cloud/bridge';
import { createEngine, recipeById, counterPrice, counterBrewSeconds } from "./core/engine";
import { warehouseLevel, seatLevel } from "./core/upgrades";
import { INGREDIENT_CONFIG, ingredientCapacity } from "./core/ingredients";
import { LocalSaveRepository, SAVE_KEY, type LoadResult, type OfflineSettlement } from "./core/persistence";
import type {
  CounterId,
  RecipeId,
  SliceEngine,
  SliceState,
} from "./core/types";
import {
  CoffeeScene,
  type CoffeeSceneAction,
  type CoffeeSceneAnchor,
} from "./render/CoffeeScene";
import { RenderBudget, readRenderMode, isRenderMode, RENDER_MODE_KEY, type RenderMode } from "./render/RenderBudget";
import { FrameInterpolator } from "./render/FrameInterpolator";
import { RouteDiagnostics, isRouteQA } from "./qa/RouteDiagnostics";
import { RouteQAPanel } from "./qa/RouteQAPanel";
import { PerformanceQAPanel } from "./qa/PerformanceQAPanel";
import { createPortableSave, parsePortableSave, overviewOf, portableFilename, MAX_PORTABLE_BYTES, type PortableFile } from "./core/portableSave";
import { addFurniture, getLayout, GRID, LAYOUT_PRICES, layoutCost, MAX_COUNTERS, MAX_TABLES, layoutBounds, expansionSteps, expandLayout, MAX_EXPANSION_STEPS, moveFurnitureGroup, moveFurniture, rotateFurniture, storeFurniture, validateLayout } from "./core/layout";
import { furnitureInventory, type FurnitureKind } from "./core/furnitureCatalog";
import type { FurniturePlacement, ShopLayout, LayoutResult } from "./core/types";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#slice-root")!;
root.innerHTML = `
<main class="coffee-world" aria-label="Mellow Bean 全屏咖啡店">
  <canvas id="coffee-canvas" tabindex="0" aria-label="Mellow Bean 店铺场景" aria-describedby="scene-instructions"></canvas>
  <p id="scene-instructions" class="sr-only">拖动逛店，滚轮或双指缩放；键盘加减号缩放、0 恢复大小。点击柜台前脸的配方牌和升级牌。底部图标可查看咖啡、手动购买原料、换背景、布置家具和招客。客人右门进、左门出，柜台交杯时直接到账。装修前点击右上角暂停营业，布置后再点击恢复营业。键盘左右箭头选择店内物件，上下箭头平移，Enter 或空格操作，Home 返回第一个柜台。</p>
  <header class="hud" aria-label="金额、营业与设置"><div class="wallet-chip"><strong id="wallet">¥0.00</strong><span id="business-status">营业中</span></div><div class="hud-actions"><button id="business-toggle" class="business-toggle" aria-pressed="false">暂停营业</button><button id="settings" class="settings-button" aria-label="打开店铺设置">⚙</button></div></header>
  <section id="migration-notice" class="migration-notice" role="status" hidden><p>小店已换成双门动线。为留出新出口，部分旧家具已移入收纳或调整位置，资产与等级都保留了。暂停营业后可重新布置。</p><button id="migration-dismiss" aria-label="确认动线调整提示">知道了</button></section>
  <div id="render-error" class="render-error" hidden></div>
  <dialog id="operation-dialog" class="operation-dialog" aria-labelledby="dialog-title">
    <button id="dialog-close" class="dialog-close" aria-label="关闭操作窗口">×</button>
    <div class="dialog-heading"><span class="dialog-eyebrow" id="dialog-eyebrow">MELLOW BEAN</span><h1 id="dialog-title"></h1><p id="dialog-description"></p></div>
    <div id="recipe-panel" class="operation-panel" hidden>
      <div class="recipe-picker" role="group" aria-label="柜台咖啡">
        <button data-select-recipe="espresso"><span class="cup-art espresso-cup" aria-hidden="true"></span><strong>浓缩咖啡</strong><small id="recipe-espresso-stats"></small></button>
        <button data-select-recipe="latte"><span class="cup-art latte-cup" aria-hidden="true"></span><strong>拿铁</strong><small id="recipe-latte-stats"></small></button>
      </div>
      <p class="detail-note">下一杯生效</p><p id="recipe-stock-note" class="supply-note" role="status"></p>
    </div>
    <div id="counter-panel" class="operation-panel" hidden>
      <div class="upgrade-card">
        <div class="section-heading"><h2 id="counter-coffee"></h2><span id="counter-level" class="level-badge"></span></div>
        <div class="detail-grid upgrade-stats"><span>每杯售价<strong id="counter-price"></strong><small id="counter-next-price"></small></span><span>制作时长<strong id="counter-seconds"></strong><small id="counter-next-seconds"></small></span></div>
        <p id="counter-current-brew" class="detail-note" hidden></p>
        <button id="counter-upgrade" class="primary-button"></button><p id="counter-funds" class="action-note"></p><p id="counter-stock-note" class="supply-note"></p>
      </div>
    </div>
    <div id="coffee-panel" class="operation-panel" hidden>
      <div class="coffee-tabs" role="group" aria-label="选择咖啡配方"><button data-view-coffee="espresso"><img src="./assets/catalog-espresso.svg" alt="" draggable="false"><span>浓缩咖啡</span></button><button data-view-coffee="latte"><img src="./assets/catalog-latte.svg" alt="" draggable="false"><span>拿铁</span></button></div>
      <div class="upgrade-card">
        <div class="section-heading"><h2>配方资料</h2></div>
        <div class="detail-grid upgrade-stats"><span>基础杯价<strong id="coffee-price"></strong></span><span>基础制作时长<strong id="coffee-seconds"></strong></span></div>
        <p id="coffee-stock-note" class="supply-note"></p>
      </div>
    </div>
    <div id="ingredients-panel" class="operation-panel" hidden>
      <p class="ingredient-rules">所有柜台共用原料，需要时手动补货。</p>
      <section class="warehouse-upgrade"><div class="section-heading"><h2>仓库 <span id="warehouse-level"></span></h2><span id="warehouse-capacity"></span></div><p id="warehouse-next" class="detail-note"></p><button id="warehouse-upgrade" class="secondary-button"></button></section>
      <p id="ingredient-supply-note" class="supply-note" role="status"></p>
      <section class="ingredient-card" aria-labelledby="ingredient-beans-name">
        <div class="ingredient-heading"><img src="./assets/catalog-beans.svg" alt="" draggable="false"><div><h2 id="ingredient-beans-name">咖啡豆</h2><p id="ingredient-beans-unit" class="detail-note"></p></div><strong id="ingredient-beans-stock" class="ingredient-stock"></strong></div>
        <meter id="ingredient-beans-meter" class="ingredient-meter" min="0" max="1" value="0" aria-label="咖啡豆库存"></meter><p class="ingredient-use">每杯浓缩或拿铁消耗 1 份</p>
        <div class="ingredient-options" role="group" aria-label="咖啡豆购买数量"><button id="ingredient-beans-one" data-ingredient-id="beans" data-ingredient-mode="one"><span>买 1 份</span><strong id="ingredient-beans-one-quantity"></strong><small id="ingredient-beans-one-cost"></small></button><button id="ingredient-beans-batch" data-ingredient-id="beans" data-ingredient-mode="batch"><span>买一批</span><strong id="ingredient-beans-batch-quantity"></strong><small id="ingredient-beans-batch-cost"></small></button><button id="ingredient-beans-fill" data-ingredient-id="beans" data-ingredient-mode="fill"><span>补满</span><strong id="ingredient-beans-fill-quantity"></strong><small id="ingredient-beans-fill-cost"></small></button></div>
        <button id="ingredient-beans-buy" class="primary-button" data-buy-ingredient="beans"></button><p id="ingredient-beans-note" class="action-note" role="status"></p>
      </section>
      <section class="ingredient-card" aria-labelledby="ingredient-milk-name">
        <div class="ingredient-heading"><img src="./assets/catalog-milk.svg" alt="" draggable="false"><div><h2 id="ingredient-milk-name">牛奶</h2><p id="ingredient-milk-unit" class="detail-note"></p></div><strong id="ingredient-milk-stock" class="ingredient-stock"></strong></div>
        <meter id="ingredient-milk-meter" class="ingredient-meter" min="0" max="1" value="0" aria-label="牛奶库存"></meter><p class="ingredient-use">每杯拿铁消耗 1 份</p>
        <div class="ingredient-options" role="group" aria-label="牛奶购买数量"><button id="ingredient-milk-one" data-ingredient-id="milk" data-ingredient-mode="one"><span>买 1 份</span><strong id="ingredient-milk-one-quantity"></strong><small id="ingredient-milk-one-cost"></small></button><button id="ingredient-milk-batch" data-ingredient-id="milk" data-ingredient-mode="batch"><span>买一批</span><strong id="ingredient-milk-batch-quantity"></strong><small id="ingredient-milk-batch-cost"></small></button><button id="ingredient-milk-fill" data-ingredient-id="milk" data-ingredient-mode="fill"><span>补满</span><strong id="ingredient-milk-fill-quantity"></strong><small id="ingredient-milk-fill-cost"></small></button></div>
        <button id="ingredient-milk-buy" class="primary-button" data-buy-ingredient="milk"></button><p id="ingredient-milk-note" class="action-note" role="status"></p>
      </section>
    </div>
    <div id="seat-panel" class="operation-panel" hidden><div class="section-heading"><h2 id="seat-name">凳子</h2><span id="seat-level" class="level-badge"></span></div><div class="detail-grid"><span>喝完后的小费<strong id="seat-tip"></strong></span><span>升级后<strong id="seat-next-tip"></strong></span></div><button id="seat-upgrade" class="primary-button"></button><p id="seat-funds" class="detail-note"></p></div>
    <div id="background-panel" class="operation-panel" hidden>
      <div class="background-picker" role="group" aria-label="店外背景">
        <button data-backdrop="garden"><img src="./assets/catalog-garden.svg" alt="树木、花径与花园街坊" draggable="false"><strong>花园小店</strong></button>
        <button data-backdrop="terrace"><img src="./assets/catalog-terrace.svg" alt="沿街橱窗、遮阳棚与石铺露台" draggable="false"><strong>暖石露台</strong></button>
        <button data-backdrop="sunset"><img src="./assets/catalog-sunset.svg" alt="落日水岸、远景与滨水步道" draggable="false"><strong>落日时分</strong></button>
      </div><p class="detail-note">免费换个景色，保存在这台设备。</p>
    </div>
    <div id="settings-panel" class="operation-panel" hidden>
      <details id="display-settings" class="settings-disclosure">
        <summary><span class="menu-icon" aria-hidden="true">◐</span><span><strong id="render-mode-label">画面</strong><small id="render-mode-current"></small></span><span class="menu-chevron" aria-hidden="true">⌄</span></summary>
        <div class="settings-disclosure-body"><div class="render-mode-picker" role="group" aria-labelledby="render-mode-label" aria-describedby="render-mode-note"><button data-render-mode="smooth">清晰流畅<small>跟随屏幕刷新</small></button><button data-render-mode="clear-60">清晰 60 帧<small>同等清晰度</small></button><button data-render-mode="balanced">平衡<small>适中清晰度 · 最高 60 帧</small></button><button data-render-mode="low-power">省电<small>较低清晰度 · 最高 30 帧</small></button></div><p class="detail-note" id="render-mode-note"></p></div>
      </details>
      <button id="save-files" class="menu-card"><span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H6V3h1Zm7 0v5h4M9 12h6M9 16h6"/></svg></span><span><strong>小店存档</strong><small id="save-entry-summary">自动保存 · 导入与导出</small></span><span class="menu-chevron" aria-hidden="true">›</span></button>
    </div>
    <div id="files-panel" class="operation-panel" hidden>
      <section class="local-save-card"><div><span class="stat-label">这台设备的小店</span><p id="save-status" class="save-status" role="status">本地自动保存</p></div><button id="save" class="compact-button">保存进度</button></section>
      <p class="detail-note">经营进度自动保存在本机。只有点击右上角「同步」才上传到云端；换设备前记得手动同步。也可随时导出文件备份。</p>
      <section id="save-recovery" class="recovery-card" hidden aria-labelledby="recovery-title"><h2 id="recovery-title">保护这间小店</h2><p id="recovery-note" class="detail-note"></p><div class="settings-grid"><button id="export">导出当前副本</button><button id="export-current" hidden>导出当前副本</button><button id="reload" hidden>读取最新档</button><button id="new-shop" hidden>备份并开始新店</button></div><p class="detail-note">恢复副本保留原有内容，不一定能直接导入。重要进度请先下载保管。</p></section>
      <section class="file-card export-card"><div class="section-heading"><h2><span class="step-badge" aria-hidden="true">↑</span>带走这间小店</h2><span class="section-kicker">导出</span></div><p class="detail-note">生成文件，把此刻的进度装进口袋。</p><button id="file-prepare" class="primary-button">生成存档</button><div id="file-output" hidden><p id="file-export-summary" class="file-summary"></p><div class="settings-grid"><button id="file-download" disabled>下载文件</button><button id="file-share" disabled>分享文件</button></div></div></section>
      <section class="file-card import-card"><div class="section-heading"><h2><span class="step-badge" aria-hidden="true">↓</span>继续另一份进度</h2><span class="section-kicker">导入</span></div><label class="file-picker" for="file-input"><span>选择存档文件</span><input id="file-input" type="file" accept="application/json,.json" aria-describedby="file-picker-note file-selection"></label><p id="file-picker-note" class="detail-note">JSON · 最多 256 KiB · 先预览，再确认</p><p id="file-selection" class="file-selection" hidden></p></section>
      <p id="file-status" class="file-status" role="status" aria-live="polite">选择文件不会立即替换小店。</p>
      <div id="file-review" tabindex="-1" role="region" aria-label="导入存档预览" hidden>
        <div class="section-heading"><h2>要继续这份进度吗？</h2><span class="level-badge">已暂停营业</span></div>
        <div class="save-comparison"><section class="save-snapshot"><h3>现在的小店</h3><p id="file-current-summary" class="file-summary"></p></section><section class="save-snapshot incoming-snapshot"><h3>文件里的小店</h3><p id="file-incoming-summary" class="file-summary"></p></section></div>
        <p id="file-older-warning" class="warning-note" hidden>这是较早的存档，导入会回退到文件中的进度。</p>
        <p id="file-repeat-warning" class="warning-note" hidden>这份文件已导入过。再次导入会回退到该快照，不会重复获得离线收益。</p>
        <div class="confirmation-note"><strong>当前小店将被完整替换</strong><p>较早进度会回退，金币不合并；文件导出至本次导入之间不补离线收益。替换前会先校验本地备份，备份失败就停止。</p></div>
        <details class="quiet-details"><summary>备份与文件详情</summary><p>本地备份保留当前进度和原始档，不自动删除。空间不足时拒绝导入；清除浏览器数据会丢失备份，请先下载重要副本。</p><p>导入创建新的本地存档身份。营业中的小店按 80% 速度继续离线经营；暂停状态不会自动开门。</p><p class="technical-label">当前小店</p><p id="file-current-details" class="file-summary technical-summary"></p><p class="technical-label">导入文件</p><p id="file-incoming-details" class="file-summary technical-summary"></p></details>
        <label class="file-confirm-label"><input id="file-other-tabs" type="checkbox"><span>我确认用此文件替换本机小店<small>会保留导入前备份，不合并余额或补发文件期间收益。</small></span></label>
        <div class="import-actions"><button id="file-confirm" class="primary-button" disabled>备份并替换小店</button><button id="file-cancel" class="secondary-button">保留当前小店</button></div>
      </div>
      <details id="file-backups" class="quiet-details" hidden><summary>找回导入前的小店</summary><div class="settings-grid"><button id="backup-live">导出原进度</button><button id="backup-original">导出原始档</button></div></details>
      <details class="quiet-details"><summary>如何换设备继续？</summary><p>先在当前设备点「同步」，再在另一台设备打开同一地址，点「下载云存档」并确认。不会自动合并两台设备的进度。</p><p>可在系统面板选择 iCloud Drive。iCloud 文件需手动保存，无法确认 iCloud 上传结果；云端只在你手动同步时更新。</p><p>校验码只检查完整性，不证明来源可信。请选择自己保留的文件。</p></details>
      <button id="file-back" class="text-button">‹ 返回设置</button>
    </div>
    <div id="offline-panel" class="operation-panel" hidden>
      <div id="offline-working"><div class="earnings-art" aria-hidden="true"><span></span><i></i></div><p id="offline-progress-text" role="status" aria-live="polite">正在整理小店收益…</p><progress id="offline-progress" max="1" value="0" aria-label="离线收益整理进度"></progress><p class="detail-note">完成后安全到账，取消可稍后重试。</p><button id="offline-cancel" class="secondary-button">稍后再算</button></div>
      <div id="offline-result" hidden><div class="earnings-art" aria-hidden="true"><span></span><i></i></div><p id="offline-duration"></p><div class="earnings-reward"><span>本次净收入</span><strong id="offline-deposited"></strong><small>余额变化 · 已计入当前金额</small></div><p id="offline-stockout" class="supply-note" hidden>离开期间原料用完，部分咖啡已停做。回到小店后可手动补货。</p><button id="offline-done" class="primary-button">回到小店</button></div>
    </div>
  </dialog>
  <nav id="action-dock" class="action-dock" aria-label="小店操作">
    <button id="dock-coffee" title="咖啡配方" aria-label="咖啡配方"><img src="./assets/catalog-espresso.svg" alt="" draggable="false"><span>咖啡</span></button>
    <button id="dock-ingredients" title="购买原料" aria-label="购买原料"><img src="./assets/catalog-ingredients.svg" alt="" draggable="false"><span>原料</span></button>
    <button id="dock-background" title="切换背景" aria-label="切换背景"><img src="./assets/catalog-garden.svg" alt="" draggable="false"><span>背景</span></button>
    <button id="dock-furniture" title="布置家具" aria-label="布置家具"><img src="./assets/catalog-table.svg" alt="" draggable="false"><span>家具</span></button>
    <button id="dock-invite" title="招呼客人" aria-label="招呼客人"><img src="./assets/catalog-invite.svg" alt="" draggable="false"><span>招客</span></button>
  </nav>
  <aside id="renovation-panel" class="renovation-panel" aria-labelledby="renovation-title" hidden>
    <div class="renovation-heading"><div class="renovation-title"><span aria-hidden="true">▦</span><h2 id="renovation-title">布置小店</h2><span id="renovation-cost"></span></div><div class="renovation-finish"><button id="renovation-cancel" class="text-button">取消</button><button id="renovation-apply" class="primary-button" disabled>完成布置</button></div></div>
    <p id="renovation-status" class="renovation-status" role="status" aria-live="polite"></p>
    <div id="renovation-tools" hidden>
      <div class="catalog-toolbar"><div class="catalog-tabs" role="group" aria-label="家具分类"><button data-catalog-tab="all" aria-pressed="true">全部</button><button data-catalog-tab="counter" aria-pressed="false">柜台</button><button data-catalog-tab="table" aria-pressed="false">桌椅</button><button data-catalog-tab="stored" aria-pressed="false">收纳</button></div><div class="expansion-controls"><span id="shop-dimensions"></span><button id="expand-shop" class="expand-shop">加宽店面</button><button id="expand-depth" class="expand-shop">加深店面</button></div></div>
      <div class="group-move-controls" role="group" aria-label="整体移动家具"><button id="multi-select" aria-pressed="false">多选</button><button id="select-all-furniture">全选</button><button id="clear-furniture-selection">清空选择</button><span id="selection-count" role="status"></span></div>
      <div id="furniture-list" class="furniture-list" role="group" aria-label="拖出家具，或点击选择"><p id="catalog-empty" hidden>这里暂时没有收起的物件</p></div>
      <div id="furniture-instance-chooser" class="furniture-instance-chooser" role="group" aria-label="选择要放回的家具" hidden></div>
      <div class="furniture-controls"><span id="furniture-selected"></span><div role="group" aria-label="移动与旋转家具"><button data-layout-move="left" aria-label="向左移动一格">←</button><button data-layout-move="up" aria-label="向后移动一格">↑</button><button data-layout-move="down" aria-label="向前移动一格">↓</button><button data-layout-move="right" aria-label="向右移动一格">→</button><button id="rotate-furniture">旋转 ↻</button><button id="store-furniture">收起</button></div><p id="renovation-hint">拖出库存放进店里，也能直接移动店内物件。需要添置时点购买，完成布置时结算。多选后拖动其中一件可整体移动。</p></div>
    </div>
  </aside>
  <div id="catalog-drag-label" class="catalog-drag-label" aria-hidden="true" hidden></div>
  <aside id="welcome-guide" class="welcome-guide" aria-labelledby="guide-title" hidden>
    <div class="guide-topline"><span id="guide-progress" class="guide-progress"></span><button id="guide-skip" class="text-button">跳过引导</button></div>
    <div aria-live="polite" aria-atomic="true"><h2 id="guide-title"></h2><p id="guide-copy"></p></div>
    <button id="guide-next" class="primary-button">下一步</button>
  </aside>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const dialog = $<HTMLDialogElement>("#operation-dialog");
const sceneAnchors: CoffeeSceneAnchor[] = [
  "counter-a-recipe", "counter-a-upgrade", "counter-b-recipe", "counter-b-upgrade",
];
const anchorNames: Partial<Record<CoffeeSceneAnchor, string>> = {
  "counter-a-recipe": "柜台咖啡图标", "counter-a-upgrade": "柜台等级牌",
  "counter-b-recipe": "柜台咖啡图标", "counter-b-upgrade": "柜台等级牌",
};
let browserStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
try {
  browserStorage = cloudStorage();
} catch {
  browserStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    },
    removeItem() {
      throw new Error("storage unavailable");
    },
  };
}
const authority = getAuthority();
const manual = getManualSync();
const repository = new LocalSaveRepository(browserStorage);
const loadPerformance = performance.now();
const loaded = repository.load(authority?.envelope.savedAt ?? Date.now(), { deferOffline: true });
if (authority?.isNew) loaded.status = "new";
const routeDiagnostics = isRouteQA(location.search) ? new RouteDiagnostics() : null;
let engine: SliceEngine = createEngine(loaded.state, routeDiagnostics?.observe);
const routePanel = routeDiagnostics ? new RouteQAPanel(root, routeDiagnostics, () => engine.state) : null;
let stopped = false,
  frame = 0,
  lastSave = Date.now(),
  hiddenAt: number | null = document.hidden ? Date.now() : null;
type Backdrop = "garden" | "terrace" | "sunset";
const BACKDROP_KEY = "mellow-bean:backdrop:v1";
let backdrop: Backdrop = "garden";
try { const saved = browserStorage.getItem(BACKDROP_KEY); if (saved === "garden" || saved === "terrace" || saved === "sunset") backdrop = saved; } catch { /* Cosmetic preference has a safe default. */ }
let renderMode: RenderMode = readRenderMode(browserStorage);
const renderBudget = new RenderBudget(loadPerformance, renderMode);
let visualEngine = createEngine(engine.snapshot());
const presentation = new FrameInterpolator(authority ? visualEngine.state : engine.state);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new AbortController();
const on = (
  target: EventTarget,
  name: string,
  callback: EventListener,
  options: AddEventListenerOptions = {},
) =>
  target.addEventListener(name, callback, {
    ...options,
    signal: listeners.signal,
  });
let saveBlocked = loaded.protectedRaw || (loaded.status !== "new" && loaded.status !== "loaded");
// All unresolved reads freeze play, not only CAS/settlement failures. A fallback
// initial state is a display placeholder, never authority to replace a save.
let conflictBlocked = saveBlocked;
let saveFailed = false;
let hasUsableState = ["new", "loaded", "settling", "conflict", "offline-save-failed"].includes(loaded.status);
// Business pause is player-owned and durable. Recovery uses a separate UI freeze.
$("#reload").hidden = !saveBlocked;
$("#new-shop").hidden = !loaded.protectedRaw && loaded.status !== "missing";
let selected: CounterId = "counter-a";
let panel: "recipe" | "counter" | "coffee" | "seat" | "ingredients" | "background" | "settings" | "files" | "offline" | null =
    null,
  viewedRecipe: RecipeId = "espresso";
type IngredientId = keyof typeof INGREDIENT_CONFIG;
type IngredientMode = "one" | "batch" | "fill";
const ingredientModes: Record<IngredientId, IngredientMode> = { beans: "batch", milk: "batch" };
const ingredientQuotes: Partial<Record<IngredientId, { quantity: number; cost: number }>> = {};
let scene: CoffeeScene | null = null;
let renovating = false;
let layoutDraft: ShopLayout | null = null;
let selectedFurniture: string | null = null;
let multiSelect=false;const selectedFurnitureIds=new Set<string>();
let furnitureListKey = "";
let selectedSeat = "";
let catalogTab = "all";
let catalogChooser: FurnitureKind | null = null;
let layoutDrag: { source:ShopLayout; ids:string[]; draft: ShopLayout; id: string; valid: boolean; reason: string; offsetX: number; offsetZ: number; lastPoint?:string; checked?:LayoutResult; offer?:LayoutResult; offerWallet?:number; offerServed?:number; offerLayout?:ShopLayout } | null = null;
let catalogPointer: { id: number; x: number; y: number; key: string; dragging: boolean; browsing: boolean; pointerType: string } | null = null;
let suppressCatalogClick = false;
// This device-only preference never enters the portable or economic save.
// Mark the first exposure before showing it: refresh is not a request to repeat.
const ONBOARDING_KEY = "mellow-bean:welcome-guide:v1";
const guideSteps: { anchor?: CoffeeSceneAnchor; control?: string; title: string; copy: string }[] = [
  { anchor: "counter-a-recipe", title: "柜台左边，选杯咖啡", copy: "点左侧配方牌，选浓缩或拿铁。客人会自己进店。" },
  { anchor: "counter-a-upgrade", title: "柜台右边，让出杯更快", copy: "点右侧升级牌，提升这座柜台。金币够了就能升级。" },
  { control: "#dock-coffee", title: "两款咖啡，两种味道", copy: "点底部咖啡图标查看固定配方。提升杯价和制作速度，请升级柜台。" },
  { control: "#business-toggle", title: "歇一会儿，布置小店", copy: "先点暂停营业，等店内客人离开后布置家具。完成后再点恢复营业；关店时没有离线收益。" },
];
let guideStep = -1;
let renderedGuideStep = -1;
function focusGuideStep() {
  const step = guideSteps[guideStep];
  if (step.anchor) scene?.focusAnchor(step.anchor);
  else if (step.control) $(step.control).focus({ preventScroll: true });
}
function updateGuide() {
  const guide = $("#welcome-guide");
  guide.hidden = guideStep < 0 || dialog.open || renovating || document.hidden || saveBlocked || stopped;
  if (guideStep < 0 || guideStep === renderedGuideStep) return;
  renderedGuideStep = guideStep;
  const step = guideSteps[guideStep];
  $("#guide-progress").textContent = `初见小店 · ${guideStep + 1} / ${guideSteps.length}`;
  $("#guide-title").textContent = step.title;
  $("#guide-copy").textContent = step.copy;
  $("#guide-next").textContent = guideStep === guideSteps.length - 1 ? "开始营业" : "下一步";
}
function finishGuide(outcome: "completed" | "skipped", restoreFocus = true) {
  if (guideStep < 0) return;
  guideStep = -1;
  try { browserStorage.setItem(ONBOARDING_KEY, outcome); } catch { /* The exposure was already recorded; keep game persistence independent. */ }
  updateGuide();
  if (restoreFocus && !dialog.open && !document.hidden) $("#coffee-canvas").focus({ preventScroll: true });
}
function startGuide() {
  if (loaded.status !== "new" || !scene) return;
  try {
    if (browserStorage.getItem(ONBOARDING_KEY) !== null) return;
    browserStorage.setItem(ONBOARDING_KEY, "shown");
    // A blocked preference store must not cause an auto-repeating tutorial.
    if (browserStorage.getItem(ONBOARDING_KEY) !== "shown") return;
  } catch { return; }
  guideStep = 0;
  focusGuideStep();
  updateGuide();
}
let qaContextLost = false;
let sceneInteractive = true;
let returnFocus: HTMLElement | null = null;
type OfflineRetry = { kind: "load" } | { kind: "hidden"; state: SliceState; hiddenAt: number };
let offlineJob: { pending: OfflineSettlement; controller: AbortController; started: number; lastObserved: number } | null = null;
let offlineRetry: OfflineRetry | null = null;
let resumeOfflineAfterHide = false;
let offlineReturnPanel: "recipe" | "counter" | "coffee" | "seat" | "ingredients" | "background" | "settings" | "files" | null = null;
// Only a completed visible computation proves a long unrendered interval was
// foreground work. Other long clock gaps need explicit recovery, not guessing.
let verifiedForegroundSeconds = 0;
let fileGeneration = 0;
let fileBusy = false;
let preparedFile: PortableFile | null = null;
let fileReview: { file: PortableFile; expectedRaw: string | null; currentState: SliceState | null } | null = null;
const LONG_FOREGROUND_GAP_SECONDS = 60;
const UNCLASSIFIED_TIME_MESSAGE = "页面长时间未更新，无法确认这段时间的营业状态；已保护当前进度，请先导出当前副本或读取最新存档。";
function toast(message: string) {
  if (stopped) return;
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function save(manual = false, saveAt = Date.now()) {
  if (authority) { lastSave = Date.now(); if (manual) { void authority.execute({ type: "sync" }, true); toast("正在读取服务器已确认进度"); } return { ok: true, status: "saved" as const, message: "服务器进度已确认" }; }
  if (fileReview) return;
  if (saveBlocked) {
    if (manual)
      toast(
        conflictBlocked
          ? "存档发生变化，请先导出当前副本或读取最新档。"
          : "已有存档无法安全读取，已保留原始内容；请先导出备份。",
      );
    return;
  }
  settleVisibleTail();
  if (saveBlocked) return;
  try {
    const result = repository.save(engine.snapshot(), saveAt);
    $("#save-status").textContent = result.ok
      ? "本地已保存"
      : "保存失败，请导出备份";
    lastSave = Date.now();
    saveFailed = !result.ok;
    updateBackupControls();
    if (result.status === "conflict") blockConflict(result.message);
    if (manual)
      toast(
        result.ok
          ? "本机进度已保存，云端状态见右上角"
          : result.message || "保存失败，请导出备份",
      );
    return result;
  } catch {
    $("#save-status").textContent = "保存失败，请导出备份";
    saveFailed = true;
    updateBackupControls();
    if (manual) toast("浏览器未允许保存，请导出存档备份");
  }
}
async function submit(command: GameCommand, after?: () => void) {
  if (!authority?.canMutate) { toast(authority?.online ? "正在同步，请稍后再试" : "连接服务器后再继续操作"); return; }
  const pending = authority.execute(command);
  updateUI();
  const result = await pending;
  if (result) { toast(result.message); if (result.commandApplied) after?.(); }
  else toast("操作尚未确认，已暂停经营操作；重新连接会核对结果");
  updateUI();
}
function setSceneInteractive(enabled: boolean) {
  if (sceneInteractive === enabled) return;
  sceneInteractive = enabled;
  scene?.setInteractionEnabled(enabled);
}
function closePanel() {
  if (!dialog.open) return;
  cancelFileReview();
  if (offlineJob) cancelOfflineWork("离线结算已取消，原有进度已保留。请在设置中重试。");
  dialog.close();
  // Native close is queued after open is removed. Navigation immediately after
  // dismissal must not be dropped by the renderer's still-suspended input guard.
  if (!dialog.open) setSceneInteractive(true);
  updateGuide();
}
function showPanel(
  next: NonNullable<typeof panel>,
  id?: CounterId,
  recipe?: RecipeId,
) {
  if (renovating) { toast("请先完成布置或取消，再打开其他操作"); return; }
  if (id) {
    selected = id;
    scene?.selectedCounter(id);
  }
  if (recipe) viewedRecipe = recipe;
  panel = next;
  dialog.dataset.panel = next;
  dialog.scrollTop = 0;
  setSceneInteractive(false);
  root
    .querySelectorAll<HTMLElement>(".operation-panel")
    .forEach((el) => (el.hidden = el.id !== `${next}-panel`));
  updateUI();
  if (dialog.open) {
    $("#dialog-close").focus({ preventScroll: true });
  } else {
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
  }
  updateGuide();
}
function furnitureName(item: FurniturePlacement): string {
  return item.kind === "counter" ? "柜台" : `桌椅 ${item.id.split("-").at(-1)}`;
}
function renovationKey(event: Event) {
  if (renovating && !dialog.open && (event as KeyboardEvent).key === "Escape") {
    event.preventDefault();
    if (layoutDrag || catalogPointer) cancelLayoutDrag(); else cancelRenovation();
  }
}
function startRenovation() {
  if (renovating || saveBlocked || document.hidden || !settleVisibleTail()) return;
  if (!engine.state.paused) { toast("先点击右上角「暂停营业」，再布置小店"); $("#business-toggle").focus({ preventScroll: true }); return; }
  if (!engine.beginLayoutEdit()) { toast("请稍后再试，当前还不能开始布置"); return; }
  renovating = true;
  window.addEventListener("keydown", renovationKey, { signal: listeners.signal });
  layoutDraft = null;
  selectedFurniture = null;multiSelect=false;selectedFurnitureIds.clear();
  furnitureListKey = "";
  catalogTab = "all";
  catalogChooser = null;
  $("#renovation-panel").hidden = false;
  $("#action-dock").hidden = true;
  $<HTMLButtonElement>("#renovation-apply").disabled = true;
  $("#renovation-cancel").focus({ preventScroll: true });
  scene?.selectedCounter(null);
  updateRenovation();
  updateGuide();
}
function cancelRenovation(restoreFocus = true) {
  if (!renovating) return;
  cancelLayoutDrag(false);
  // Flush while the editor is still frozen. Its visible wall time is never replayed.
  const unrendered = renderBudget.flush(performance.now());
  if (!authority && engine.layoutEditStatus() === "draining") engine.advance(unrendered);
  engine.cancelLayoutEdit();
  renovating = false;
  window.removeEventListener("keydown", renovationKey);
  layoutDraft = null;
  selectedFurniture = null;multiSelect=false;selectedFurnitureIds.clear();
  $("#renovation-panel").hidden = true;
  $("#action-dock").hidden = false;
  scene?.setRenovationPreview(null);
  presentation.reset(engine.state);
  if (restoreFocus && !document.hidden && !dialog.open) $("#coffee-canvas").focus({ preventScroll: true });
  updateGuide();
}
function catalogCard(key: string, name: string, art: string, detail: string, tag: string, disabled = false) {
  const button = document.createElement("button");
  button.className = "catalog-card";
  button.setAttribute("data-catalog-key", key);
  button.setAttribute("aria-label", `${name}，${detail}，${disabled ? "没有可放置库存" : "拖到店里或点击放置"}`);
  button.setAttribute("aria-pressed", String(key === selectedFurniture));
  button.disabled = disabled;

  const image = document.createElement("img");
  image.className = "catalog-art";
  image.setAttribute("src", `./assets/catalog-${art}.svg`);
  image.setAttribute("alt", name);
  image.setAttribute("draggable", "false");
  button.append(image);
  for (const [className, text] of [["catalog-name", name], ["catalog-detail", detail], ["catalog-tag", tag]]) {
    const span = document.createElement("span"); span.className = className; span.textContent = text; button.append(span);
  }
  return button;
}
function renderCatalog() {
  if (!layoutDraft) return;
  const listKey = JSON.stringify([catalogTab, engine.state.wallet, layoutDraft.furniture.map(item => [item.id, item.stored, item.level]), engine.state.counters.map(counter => [counter.id, counter.level, counter.recipe]), catalogChooser]);
  if (listKey !== furnitureListKey) {
    const active = document.activeElement;
    const focused = active instanceof HTMLButtonElement && active.isConnected && active.matches(":focus-visible") && (active.closest("#furniture-list") || active.closest("#furniture-instance-chooser")) ? active : null;
    const focusedKey = focused?.dataset.catalogKey;
    const focusedKind = focused?.dataset.catalogPurchase ?? (focusedKey === "group-counter" ? "counter" : focusedKey === "group-table" ? "table" : layoutDraft.furniture.find(item => item.id === focusedKey)?.kind);
    furnitureListKey = listKey;
    const list = $("#furniture-list");
    for (const child of Array.from(list.children)) child.remove();
    for (const kind of ["counter", "table"] as const) {
      const inventory = furnitureInventory(engine.state, layoutDraft, kind);
      if (catalogTab !== "all" && catalogTab !== kind && !(catalogTab === "stored" && inventory.available.length)) continue;
      const name = kind === "counter" ? "咖啡柜台" : "桌椅";
      const entry = document.createElement("div"); entry.className = "catalog-entry";
      const card = catalogCard(`group-${kind}`, name, kind, `可放置 ×${inventory.available.length}`, "", !inventory.available.length);
      const count = document.createElement("span"); count.className = "catalog-count";
      count.textContent = `已购 ${inventory.owned} · 已放置 ${inventory.placed}${inventory.pending ? ` · 待购 ${inventory.pending}` : ""}`;
      card.append(count); entry.append(card);
      const buy=document.createElement("button");buy.className="catalog-purchase";buy.setAttribute("id",`buy-${kind}`);buy.setAttribute("data-catalog-purchase",kind);buy.setAttribute("aria-label",`购买${name} ${money(LAYOUT_PRICES[kind])}，完成布置时结算`);buy.textContent=`购买 ${money(LAYOUT_PRICES[kind])}`;entry.append(buy);
      list.append(entry);
    }
    if (!list.children.length) { const empty = document.createElement("p"); empty.className = "catalog-empty"; empty.textContent = "这里暂时没有收起的物件"; list.append(empty); }
    const chooser = $("#furniture-instance-chooser");
    for (const child of Array.from(chooser.children)) child.remove();
    const inventory = catalogChooser && furnitureInventory(engine.state, layoutDraft, catalogChooser);
    chooser.hidden = !inventory || !inventory.needsChoice;
    if (inventory && inventory.needsChoice) {
      const hint = document.createElement("span"); hint.textContent = "选择要放回的家具："; chooser.append(hint);
      for (const {item,count} of inventory.choices) {
        const counter = engine.state.counters.find(counter => counter.id === item.counterId);
        const button = document.createElement("button"); button.setAttribute("data-catalog-key", item.id);
        button.textContent = item.kind === "table" ? `${furnitureName(item)} · Lv.${seatLevel(item)}` : `${furnitureName(item)} · Lv.${counter?.level ?? 1} · ${recipeById[counter?.recipe ?? "espresso"].name}`;
        if(count>1)button.textContent+=` ×${count}`;button.setAttribute("aria-label", `${button.textContent}，点击或拖出放置`); chooser.append(button);
      }
    }
    // A keyboard action can replace its own button. Keep focus within the same
    // operation, but never interfere with pointer capture or unrelated controls.
    if (focused && !catalogPointer && !layoutDrag) {
      const choices = Array.from(chooser.children).filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement && !!child.dataset.catalogKey);
      const cards = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-catalog-key]"));
      const target = !chooser.hidden && focusedKey === `group-${catalogChooser}` ? choices[0]
        : !chooser.hidden && choices.find(button => button.dataset.catalogKey === focusedKey)
          || cards.find(button => button.dataset.catalogKey === `group-${focusedKind}` && !button.disabled)
          || Array.from(root.querySelectorAll<HTMLButtonElement>("[data-catalog-purchase]")).find(button => button.dataset.catalogPurchase === focusedKind)
          || $<HTMLButtonElement>("#store-furniture");
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }
  const selectedKind = layoutDraft.furniture.find(item => item.id === selectedFurniture)?.kind;
  root.querySelectorAll<HTMLButtonElement>("[data-catalog-key]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.catalogKey === `group-${selectedKind}` || button.dataset.catalogKey === selectedFurniture)));
  root.querySelectorAll<HTMLButtonElement>("[data-catalog-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.catalogTab === catalogTab)));
}
/** Resolve owned stock at action time. Group gestures can never create an asset. */
function availableCatalogItem(key: string): FurniturePlacement | null {
  if (!layoutDraft) return null;
  const kind = key === "group-counter" ? "counter" : key === "group-table" ? "table" : null;
  if (!kind) return layoutDraft.furniture.find(item => item.id === key) ?? null;
  const inventory = furnitureInventory(engine.state, layoutDraft, kind);
  if (inventory.needsChoice) { catalogChooser = kind; renderCatalog(); return null; }
  catalogChooser = null;
  return inventory.candidates[0] ?? null;
}
function selectedGroup():string[]{if(!layoutDraft)return [];if(layoutDrag)return layoutDrag.ids.filter(id=>layoutDrag!.draft.furniture.some(item=>item.id===id&&!item.stored));for(const id of selectedFurnitureIds)if(!layoutDraft.furniture.some(item=>item.id===id&&!item.stored))selectedFurnitureIds.delete(id);return multiSelect?[...selectedFurnitureIds]:selectedFurniture&&layoutDraft.furniture.some(item=>item.id===selectedFurniture&&!item.stored)?[selectedFurniture]:[];}
function selectPlaced(id:string){const item=layoutDraft?.furniture.find(item=>item.id===id);if(!item)return;if(item.stored){selectedFurniture=id;selectedFurnitureIds.clear();renderLayoutDraft();return;}if(multiSelect){if(selectedFurnitureIds.has(id))selectedFurnitureIds.delete(id);else selectedFurnitureIds.add(id);selectedFurniture=selectedFurnitureIds.has(id)?id:[...selectedFurnitureIds][0]??null;}else{selectedFurniture=id;selectedFurnitureIds.clear();selectedFurnitureIds.add(id);}renderLayoutDraft();}
function translateSelection(dx:number,dz:number){if(!layoutDraft)return;const ids=selectedGroup();if(ids.length<2){if(selectedFurniture){const item=layoutDraft.furniture.find(item=>item.id===selectedFurniture)!;moveFurniture(layoutDraft,item.id,item.x+dx,item.z+dz);selectedFurnitureIds.clear();selectedFurnitureIds.add(item.id);}}else{const result=moveFurnitureGroup(layoutDraft,ids,dx,dz);if(result.ok)layoutDraft=result.layout;else toast(result.message);}renderLayoutDraft();}
function renderLayoutDraft() {
  const draft = layoutDrag?.draft ?? layoutDraft;
  if (!draft) return;
  const checked = layoutDrag?.checked ?? validateLayout(draft);
  const offer = layoutDrag?.offer && layoutDrag.offerWallet === engine.state.wallet && layoutDrag.offerServed === engine.state.totalServed && layoutDrag.offerLayout === engine.state.layout ? layoutDrag.offer : layoutCost(engine.state, draft);
  if(layoutDrag){layoutDrag.checked=checked;layoutDrag.offer=offer;layoutDrag.offerWallet=engine.state.wallet;layoutDrag.offerServed=engine.state.totalServed;layoutDrag.offerLayout=engine.state.layout;}
  const valid = layoutDrag ? layoutDrag.valid : checked.ok && offer.ok;
  const message = layoutDrag ? layoutDrag.reason : !checked.ok ? checked.message : !offer.ok ? offer.message : "拖出物件开始布置 · 完成时统一结算，取消不花金币";
  if ($("#renovation-status").textContent !== message) $("#renovation-status").textContent = message;
  $("#renovation-status").classList.toggle("invalid", !valid);
  $<HTMLButtonElement>("#renovation-apply").disabled = !!layoutDrag || !checked.ok || !offer.ok || saveBlocked;
  $("#renovation-cost").textContent = offer.cost ? `添置 ${money(offer.cost)} · 余额 ${money(engine.state.wallet)}` : "免费重新摆放";
  const item = draft.furniture.find(item => item.id === selectedFurniture);
  const group=selectedGroup();$("#selection-count").textContent=`已选 ${group.length} 件`;$("#multi-select").setAttribute("aria-pressed",String(multiSelect));for(const id of ["#multi-select","#select-all-furniture","#clear-furniture-selection"])$(id).toggleAttribute("disabled",!!layoutDrag);
  $("#furniture-selected").textContent = item ? `${furnitureName(item)} · ${item.stored ? "已收起" : `${item.rotation * 90}°`}` : "选择一件物品";
  const owned = item && getLayout(engine.state).furniture.some(owned => owned.id === item.id);
  $("#store-furniture").textContent = !owned ? "取消添置" : item?.stored ? "放回店内" : "收起";
  $<HTMLButtonElement>("#store-furniture").disabled = !!layoutDrag || !item || group.length>1;
  $<HTMLButtonElement>("#rotate-furniture").disabled = !!layoutDrag || !item || !!item.stored || group.length>1;
  root.querySelectorAll<HTMLButtonElement>("[data-layout-move]").forEach(button => { button.disabled = !!layoutDrag || !item; });
  const steps=expansionSteps(draft),bounds=layoutBounds(draft);$("#shop-dimensions").textContent=`${bounds.width} × ${bounds.depth} 格${engine.state.totalServed<LAYOUT_PRICES.expansionServed?` · ${engine.state.totalServed}/${LAYOUT_PRICES.expansionServed} 杯解锁`:""}`;
  for(const [axis,selector,name]of [["width","#expand-shop","加宽"],["depth","#expand-depth","加深"]]as const){const capped=steps[axis]>=MAX_EXPANSION_STEPS;$(selector).hidden=capped;$(selector).textContent=capped?`${name}已满`:`${name} ${steps[axis]}/${MAX_EXPANSION_STEPS} · ${money(LAYOUT_PRICES.expansion)}`;$<HTMLButtonElement>(selector).disabled=!!layoutDrag||capped||engine.state.totalServed<LAYOUT_PRICES.expansionServed;}
  if (!layoutDrag) renderCatalog();
  scene?.setRenovationPreview(draft, selectedFurniture, valid, group);
}
function releaseCatalogPointer() {
  const pointer = catalogPointer; catalogPointer = null;
  if (pointer && root.hasPointerCapture?.(pointer.id)) root.releasePointerCapture(pointer.id);
}
function cancelLayoutDrag(render = true) {
  layoutDrag = null;
  // Cancellation invalidates the whole press, even before it becomes a drag.
  // Ignore its later synthesized click, while new pointerdown/keyboard input
  // remains available for an intentional placement.
  if (catalogPointer) suppressCatalogClick = true;
  releaseCatalogPointer();
  scene?.cancelLayoutDrag();
  $("#catalog-drag-label").hidden = true;
  root.classList.remove("placing-furniture");
  if (render && layoutDraft) renderLayoutDraft();
}
function beginLayoutDrag(key: string, clientX?: number, clientY?: number): boolean {
  if (!layoutDraft || layoutDrag || saveBlocked) return false;
  const draft: ShopLayout = JSON.parse(JSON.stringify(layoutDraft));
  const source = availableCatalogItem(key);
  const item = source && draft.furniture.find(item => item.id === source.id);
  if (!item) return false;
  const current=selectedGroup();const ids=!item.stored&&multiSelect&&current.includes(item.id)&&current.length>1?current:[item.id];selectedFurniture=item.id;selectedFurnitureIds.clear();for(const id of ids)selectedFurnitureIds.add(id);
  const origin = clientX !== undefined && clientY !== undefined ? scene?.pickLayoutPlacement(clientX, clientY, selectedFurniture) : null;
  layoutDrag = { source:structuredClone(layoutDraft),ids, draft, id: selectedFurniture, valid: false, reason: "拖到空地，松开放置", offsetX: origin ? item.x - origin.x : 0, offsetZ: origin && item ? item.z - origin.z : 0 };
  root.classList.add("placing-furniture");
  renderLayoutDraft();
  return true;
}
function moveLayoutDrag(clientX: number, clientY: number) {
  if (!layoutDrag) return;
  const label = $("#catalog-drag-label"), bounds = $("#renovation-panel").getBoundingClientRect();
  label.hidden = false; label.style.left = `${clientX + 14}px`; label.style.top = `${clientY - 36}px`;
  const overCatalog = clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  const target = document.elementFromPoint?.(clientX, clientY);
  const overControls = !!target?.closest(".hud, .action-dock, .migration-notice, .welcome-guide, .operation-dialog");
  const point = overCatalog || overControls ? null : scene?.pickLayoutPlacement(clientX, clientY, layoutDrag.id);
  const key=point?`${point.x},${point.z}`:'blocked';
  if(layoutDrag.lastPoint===key&&layoutDrag.offerWallet===engine.state.wallet&&layoutDrag.offerServed===engine.state.totalServed&&layoutDrag.offerLayout===engine.state.layout)return;
  layoutDrag.lastPoint=key;
  if (!point) {
    layoutDrag.valid = false;
    layoutDrag.reason = "请拖到店内地板；松开将取消这次移动";
  } else {
    const anchor=layoutDrag.source.furniture.find(item=>item.id===layoutDrag!.id)!;
    let checked:LayoutResult;
    if(layoutDrag.ids.length>1){const result=moveFurnitureGroup(layoutDrag.source,layoutDrag.ids,point.x+layoutDrag.offsetX-anchor.x,point.z+layoutDrag.offsetZ-anchor.z);layoutDrag.draft=result.layout;checked=result;}
    else{layoutDrag.draft=structuredClone(layoutDrag.source);moveFurniture(layoutDrag.draft,layoutDrag.id,point.x+layoutDrag.offsetX,point.z+layoutDrag.offsetZ);checked=validateLayout(layoutDrag.draft);}
    const offer = layoutCost(engine.state, layoutDrag.draft);
    layoutDrag.checked=checked;layoutDrag.offer=offer;layoutDrag.offerWallet=engine.state.wallet;layoutDrag.offerServed=engine.state.totalServed;layoutDrag.offerLayout=engine.state.layout;
    layoutDrag.valid = checked.ok && offer.ok;
    layoutDrag.reason = !checked.ok ? checked.message : !offer.ok ? offer.message : "可以摆放 · 松开确认位置";
  }
  label.textContent = layoutDrag.valid ? "✓ 松开放置" : "× 暂不能放";
  label.classList.toggle("invalid", !layoutDrag.valid);
  renderLayoutDraft();
}
function finishLayoutDrag() {
  if (!layoutDrag) return;
  const drag = layoutDrag;
  if (drag.valid){layoutDraft = drag.draft;selectedFurnitureIds.clear();for(const id of drag.ids)selectedFurnitureIds.add(id);}
  else toast(drag.reason);
  cancelLayoutDrag();
}
function updateRenovation() {
  if (!renovating) return;
  if (!layoutDraft && engine.layoutEditStatus() === "ready") {
    layoutDraft = engine.createLayoutDraft();
    selectedFurniture = layoutDraft?.furniture.find(item => !item.stored)?.id ?? null;
    $("#renovation-tools").hidden = !layoutDraft;
    presentation.reset(engine.state);
    renderLayoutDraft();
  } else if (!layoutDraft) {
    const message = `正在打烊：等店内 ${engine.state.customers.length} 位客人喝完离开后开始布置。新客已停止入店。`;
    if ($("#renovation-status").textContent !== message) $("#renovation-status").textContent = message;
    $("#renovation-status").classList.remove("invalid");
    $("#renovation-tools").hidden = true;
  }
}
function chooseCatalogItem(key: string) {
  const item = availableCatalogItem(key);
  if (!item || !layoutDraft) return;
  selectedFurniture = item.id;selectedFurnitureIds.clear();selectedFurnitureIds.add(item.id);
  if (item.stored) {
    // Suggest a legal placement for a tap. Dragging uses the chosen floor point.
    const original = { x: item.x, z: item.z };
    const candidates = [original, { x: -4, z: 3 }, { x: 0, z: 5 }, { x: 5, z: 5 }];
    for (let z = GRID.minZ; z <= layoutBounds(layoutDraft).maxZ; z++) for (let x = GRID.minX; x <= layoutBounds(layoutDraft).maxX; x++) candidates.push({ x, z });
    let placed = false;
    for (const point of candidates) { moveFurniture(layoutDraft, item.id, point.x, point.z); if (validateLayout(layoutDraft).ok) { placed = true; break; } }
    if (!placed) { Object.assign(item, original, { stored: true }); toast("没有合适的空位，请拖到店内空地调整"); }
  }
  catalogChooser = null;
  renderLayoutDraft();
}
function purchaseCatalogFurniture(kind: FurnitureKind) {
  if (!layoutDraft || layoutDrag || catalogPointer || saveBlocked) return;
  const inventory = furnitureInventory(engine.state, layoutDraft, kind);

  const draft: ShopLayout = JSON.parse(JSON.stringify(layoutDraft));
  const item = addFurniture(draft, kind, -4, 3);
  if (!item) return;
  item.stored = true;
  const offer = layoutCost(engine.state, draft);
  if (!offer.ok) { toast(offer.message); return; }
  // Purchase is an explicit, unpaid addition to this transaction. Stock appears
  // immediately; every later explicit purchase remains a separate draft addition.
  layoutDraft = draft; selectedFurniture = item.id;selectedFurnitureIds.clear();catalogChooser = null;
  renderLayoutDraft();
}
function sceneAction(action: CoffeeSceneAction) {
  if (stopped || dialog.open || offlineJob || fileReview) return;
  if (renovating) {
    if (!layoutDraft) return;
    if (action.type === "layout-drag") {
      if (action.phase === "start") beginLayoutDrag(action.id, action.clientX, action.clientY);
      else if (action.phase === "cancel") cancelLayoutDrag();
      else { moveLayoutDrag(action.clientX, action.clientY); if (action.phase === "end") finishLayoutDrag(); }
    }
    else if (action.type === "layout-select" && !layoutDrag) { selectPlaced(action.id); }
    else if (action.type === "layout-cell" && selectedFurniture && !layoutDrag) { const item=layoutDraft.furniture.find(item=>item.id===selectedFurniture)!;translateSelection(action.x-item.x,action.z-item.z); }
    return;
  }
  if (action.type === "renovate") startRenovation();
  else if (action.type === "invite") invite();
  else if (action.type === "seat") { selectedSeat=action.id; showPanel("seat"); }
  else if (action.type === "counter") showPanel("counter", action.id);
  else if (action.type === "recipe") showPanel("recipe", action.id);

}

try {
  scene = new CoffeeScene($("#coffee-canvas"), sceneAction, { renderMode });
  scene.setBackdrop(backdrop);
} catch (err) {
  $("#render-error").hidden = false;
  $("#render-error").textContent =
    "此浏览器无法开启 3D。请用支持 WebGL 的 Safari、Chrome 或 Edge 打开。";
  console.error(err);
}
const performancePanel = routeDiagnostics ? new PerformanceQAPanel(root, () => {
  const stats = scene?.readRenderStats();
  const rect = canvas.getBoundingClientRect();
  const counts: Record<string, number> = { entering: 0, queue: 0, serving: 0, receiving: 0, leaving: 0 };
  for (const customer of engine.state.customers) counts[customer.phase] = (counts[customer.phase] ?? 0) + 1;
  return [
    `mode ${renderMode} · target ${stats ? stats.targetFps ?? "display RAF" : "unavailable"} · visible=${!document.hidden} · focus=${document.hasFocus()}`,
    `viewport ${rect.width}×${rect.height} CSS · device DPR ${window.devicePixelRatio || 1} · buffer ${stats?.renderWidth ?? 0}×${stats?.renderHeight ?? 0} · effective DPR ${stats && rect.width ? (stats.renderWidth / rect.width).toFixed(2) : "—"}`,
    `customers ${engine.state.customers.length} ${JSON.stringify(counts)} · ${engine.state.counters.map(c => `${c.id} Lv${c.level}/${c.recipe}`).join(" · ")} · ${engine.state.paused ? "closed" : "open"}`,
    `scene meshes ${stats?.meshCount ?? 0} · submissions ${stats?.renderedFrames ?? 0} · core ${engine.state.elapsed.toFixed(2)}s · paused=${engine.state.paused} · dialog=${panel ?? "none"} · routePanel=${routePanel?.active}`,
  ].join("\n");
}) : null;
function invite() {
  if (authority) { void submit({ type: "invite" }); return; }
  if (fileReview || !settleVisibleTail()) return;
  if (conflictBlocked) { toast("请先完成存档恢复或离线结算，再继续营业"); return; }
  if (engine.invite()) toast("欢迎光临！客人正走进小店");
  else
    toast(
      engine.state.paused
        ? "小店已暂停，点击右上角恢复营业后再招客"
        : "先让队伍往前走，再招呼下一位客人",
    );
  updateUI();
}
function upgrade(id: CounterId) {
  if (authority) { void submit({ type: "upgrade-counter", counterId: id }); return; }
  if (fileReview || !settleVisibleTail()) return;
  if (conflictBlocked) {
    toast("先读取最新存档，再购买升级");
    return;
  }
  const quote = engine.quote(id);
  if (engine.upgrade(id)) {
    toast("柜台升级：出杯更快，咖啡也更值钱");
    save();
  } else
    toast(
      quote.capped
        ? "这个柜台已达到预览等级上限"
        : "余额还不够，再卖几杯咖啡吧",
    );
  updateUI();
}
function changeRecipe(id: CounterId, recipe: RecipeId) {
  if (authority) { void submit({ type: "set-recipe", counterId: id, recipe }); return; }
  if (fileReview || !settleVisibleTail()) return;
  if (conflictBlocked) {
    toast("先读取最新存档，再切换配方");
    return;
  }
  if (engine.setRecipe(id, recipe)) {
    toast(`换成${recipeById[recipe].name}，下一杯开始生效`);
    save();
  }
  updateUI();
}
on(root, "click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button || button.disabled || !button.isConnected) return;
  if (button.dataset.catalogKey && suppressCatalogClick && (event as MouseEvent).detail !== 0) { event.preventDefault(); suppressCatalogClick = false; return; }
  if (isRenderMode(button.dataset.renderMode)) {
    const mode = button.dataset.renderMode;
    if (mode === renderMode) return;
    renderMode = mode;
    renderBudget.setMode(mode, performance.now());
    scene?.setRenderMode(mode);
    performancePanel?.reset("render mode changed");
    try { browserStorage.setItem(RENDER_MODE_KEY, mode); }
    catch { toast("本次画面设置已生效，但浏览器未允许保存偏好"); }
    updateRenderModeUI();
    updateUI();
  } else if (button.dataset.catalogTab && renovating && layoutDraft && !layoutDrag) {
    catalogTab = button.dataset.catalogTab; catalogChooser = null; renderLayoutDraft();
  } else if (button.dataset.catalogPurchase && renovating && layoutDraft && !layoutDrag) {
    if (button.dataset.catalogPurchase === "counter" || button.dataset.catalogPurchase === "table") purchaseCatalogFurniture(button.dataset.catalogPurchase);
  } else if (button.dataset.catalogKey && renovating && layoutDraft && !layoutDrag) {
    chooseCatalogItem(button.dataset.catalogKey);
  } else if (button.dataset.layoutMove && renovating && layoutDraft && selectedFurniture && !layoutDrag) {
    const item = layoutDraft.furniture.find(item => item.id === selectedFurniture);
    const delta = ({ left: [1, 0], right: [-1, 0], up: [0, -1], down: [0, 1] } as Record<string, number[]>)[button.dataset.layoutMove];
    if(delta&&item)translateSelection(delta[0],delta[1]);
  } else if (button.dataset.counterRecipe && panel === "coffee" && dialog.open) {
    showPanel("recipe", button.dataset.counterRecipe as CounterId);
  } else if (button.dataset.counterUpgrade && panel === "coffee" && dialog.open) {
    showPanel("counter", button.dataset.counterUpgrade as CounterId);
  } else if (button.dataset.viewCoffee && panel === "coffee" && dialog.open) {
    viewedRecipe = button.dataset.viewCoffee as RecipeId; updateUI();
  } else if (button.dataset.backdrop && panel === "background" && dialog.open) {
    const next = button.dataset.backdrop;
    if (next === "garden" || next === "terrace" || next === "sunset") {
      backdrop = next; scene?.setBackdrop(backdrop);
      try { browserStorage.setItem(BACKDROP_KEY, backdrop); } catch { toast("景色已更换，但这台设备未允许保存偏好"); }
      updateUI();
    }
  } else if (button.dataset.selectRecipe && panel === "recipe" && dialog.open)
    changeRecipe(selected, button.dataset.selectRecipe as RecipeId);

});
on($("#multi-select"),"click",()=>{if(!layoutDraft||layoutDrag)return;multiSelect=!multiSelect;if(!multiSelect){selectedFurniture=[...selectedFurnitureIds][0]??selectedFurniture;selectedFurnitureIds.clear();if(selectedFurniture)selectedFurnitureIds.add(selectedFurniture);}else if(selectedFurniture&&layoutDraft.furniture.some(item=>item.id===selectedFurniture&&!item.stored))selectedFurnitureIds.add(selectedFurniture);renderLayoutDraft();});
on($("#select-all-furniture"),"click",()=>{if(!layoutDraft||layoutDrag)return;multiSelect=true;selectedFurnitureIds.clear();for(const item of layoutDraft.furniture)if(!item.stored)selectedFurnitureIds.add(item.id);selectedFurniture=[...selectedFurnitureIds][0]??null;renderLayoutDraft();});
on($("#clear-furniture-selection"),"click",()=>{if(!layoutDraft||layoutDrag)return;selectedFurnitureIds.clear();selectedFurniture=null;renderLayoutDraft();});
on($("#renovation-cancel"), "click", () => cancelRenovation());
on(root, "pointerdown", event => {
  const e = event as PointerEvent, button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-catalog-key]");
  if (!renovating || !layoutDraft || !button || button.disabled || e.button !== 0 || !e.isPrimary || catalogPointer || layoutDrag) return;
  suppressCatalogClick = false;
  catalogPointer = { id: e.pointerId, x: e.clientX, y: e.clientY, key: button.dataset.catalogKey!, dragging: false, browsing: false, pointerType: e.pointerType || "mouse" };
  try { root.setPointerCapture(e.pointerId); } catch { catalogPointer = null; }
});
on(window, "pointermove", event => {
  const e = event as PointerEvent, pointer = catalogPointer;
  if (!pointer || pointer.id !== e.pointerId) return;
  // Touch keeps horizontal browsing native; a vertical pull picks up the card.
  if (!pointer.dragging && pointer.pointerType === "touch" && Math.abs(e.clientX - pointer.x) > Math.abs(e.clientY - pointer.y) && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) >= 6) pointer.browsing = true;
  if (pointer.browsing) return;
  if (!pointer.dragging && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) >= 6) pointer.dragging = beginLayoutDrag(pointer.key);
  if (pointer.dragging) { e.preventDefault(); moveLayoutDrag(e.clientX, e.clientY); }
});
on(window, "pointerup", event => {
  const e = event as PointerEvent, pointer = catalogPointer;
  if (!pointer || pointer.id !== e.pointerId) return;
  if (pointer.dragging) { e.preventDefault(); suppressCatalogClick = true; moveLayoutDrag(e.clientX, e.clientY); finishLayoutDrag(); }
  else { suppressCatalogClick = true; releaseCatalogPointer(); if (!pointer.browsing && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 6) chooseCatalogItem(pointer.key); }
});
const cancelCatalogPointer = (event: Event) => { if (catalogPointer?.id === (event as PointerEvent).pointerId) cancelLayoutDrag(); };
on(window, "pointercancel", cancelCatalogPointer);
on(root, "lostpointercapture", cancelCatalogPointer);
on(window, "blur", () => { if (layoutDrag || catalogPointer) cancelLayoutDrag(); });
for(const [id,axis]of [["#expand-shop","width"],["#expand-depth","depth"]]as const)on($(id),"click",()=>{if(!layoutDraft||layoutDrag||engine.state.totalServed<LAYOUT_PRICES.expansionServed)return;expandLayout(layoutDraft,axis);renderLayoutDraft();});
on($("#rotate-furniture"), "click", () => { if (layoutDraft && selectedFurniture && !layoutDrag && selectedGroup().length<=1) { rotateFurniture(layoutDraft, selectedFurniture); renderLayoutDraft(); } });
on($("#store-furniture"), "click", () => {
  if (!layoutDraft || !selectedFurniture || layoutDrag || selectedGroup().length>1) return;
  const item = layoutDraft.furniture.find(item => item.id === selectedFurniture);
  if (!item) return;
  if (!getLayout(engine.state).furniture.some(owned => owned.id === item.id)) { layoutDraft.furniture = layoutDraft.furniture.filter(other => other.id !== item.id); selectedFurniture = layoutDraft.furniture.find(item=>!item.stored)?.id ?? null;selectedFurnitureIds.clear();if(selectedFurniture)selectedFurnitureIds.add(selectedFurniture); }
  else if (item.stored){moveFurniture(layoutDraft,item.id,item.x,item.z);selectedFurnitureIds.clear();selectedFurnitureIds.add(item.id);}
  else if (!storeFurniture(layoutDraft, item.id)) { toast("至少保留一个营业柜台"); return; }
  renderLayoutDraft();
});
on($("#renovation-apply"), "click", () => {
  if (!renovating || !layoutDraft || layoutDrag || saveBlocked || engine.layoutEditStatus() !== "ready") return;
  renderBudget.flush(performance.now());
  if (authority) { const draft = structuredClone(layoutDraft); void submit({ type: "commit-layout", layout: draft }, () => { cancelRenovation(); updateUI(); }); return; }
  const result = engine.commitLayout(layoutDraft);
  if (!result.ok) { toast(result.message); renderLayoutDraft(); return; }
  cancelRenovation();
  routeDiagnostics?.reset("layout committed");
  performancePanel?.reset("layout committed");
  save();
  updateUI();
  toast(saveFailed || saveBlocked ? "布置已应用，但保存未成功，请先导出备份" : "布置好了！点击右上角「恢复营业」开门迎客");
});
on($("#migration-dismiss"), "click", () => {
  if (!engine.state.doorMigrationNotice || saveBlocked || offlineJob || fileReview) return;
  if (authority) { void submit({ type: "dismiss-migration" }); return; }
  delete engine.state.doorMigrationNotice; save(); updateUI();
});
on($("#business-toggle"), "click", () => {
  if (stopped || saveBlocked || offlineJob || fileReview || document.hidden) return;
  if (renovating) { toast("请先「完成布置」或「取消」，再恢复营业"); $("#renovation-apply").focus({ preventScroll: true }); return; }
  if (!settleVisibleTail()) return;
  if (authority) { void submit({ type: "set-pause", paused: !engine.state.paused }); return; }
  engine.togglePause();
  presentation.reset(engine.state);
  save();
  updateUI();
  toast(saveBlocked ? "存档发生冲突，进度已保护；请到设置恢复，营业状态尚未保存" : saveFailed ? "营业状态已在当前页面更改，但保存失败；刷新可能恢复旧状态，请到设置导出备份" : engine.state.paused ? "已停止接待新客，店内客人会喝完后离开" : "开门啦，欢迎光临！");
});
on($("#dock-coffee"), "click", () => { if (!stopped && !dialog.open && !renovating) showPanel("coffee"); });
on($("#dock-ingredients"), "click", () => { if (!stopped && !document.hidden && !dialog.open && !renovating) showPanel("ingredients"); });
on($("#dock-background"), "click", () => { if (!stopped && !dialog.open && !renovating) showPanel("background"); });
on($("#dock-furniture"), "click", () => { if (!stopped && !dialog.open) startRenovation(); });
on($("#dock-invite"), "click", () => { if (!stopped && !dialog.open && !renovating) invite(); });
on($("#settings"), "click", () => {
  if (stopped || dialog.open || renovating) return;
  showPanel("settings");
});
on($("#guide-skip"), "click", () => finishGuide("skipped"));
on($("#guide-next"), "click", () => {
  if (guideStep < 0 || dialog.open || renovating || document.hidden || saveBlocked || stopped) return;
  if (guideStep === guideSteps.length - 1) { finishGuide("completed"); return; }
  guideStep++;
  focusGuideStep();
  updateGuide();
});
const canvas = $<HTMLCanvasElement>("#coffee-canvas");
on(canvas, "pointerdown", () => {
  if (!dialog.open) canvas.focus({ preventScroll: true });
});
on(canvas, "keydown", (event) => {
  const e = event as KeyboardEvent;
  if (renovating && e.key === "Escape") return; // Window handler owns gesture/editor cancellation.
  if (stopped || dialog.open || renovating || !scene || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "+" || e.key === "=") { e.preventDefault(); scene.zoomBy(1.15); return; }
  if (e.key === "-" || e.key === "_") { e.preventDefault(); scene.zoomBy(1 / 1.15); return; }
  if (e.key === "0") { e.preventDefault(); scene.resetZoom(); return; }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const key = scene.focusNext(e.key === "ArrowLeft" ? -1 : 1);
    if (key) toast(anchorNames[key] ?? "柜台操作牌");
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    scene.panBy(0, e.key === "ArrowUp" ? 80 : -80);
  } else if (e.key === "Home") {
    e.preventDefault();
    scene.focusAnchor("counter-a-recipe");
    toast(anchorNames["counter-a-recipe"]!);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (e.repeat) return;
    if (!scene.getFocus()) scene.focusAnchor("counter-a-recipe");
    if (!scene.activateFocused())
      toast("这个物件暂时无法操作，换个位置再试");
  }
});
on($("#dialog-close"), "click", closePanel);
on(dialog, "cancel", () => cancelFileReview());
on(dialog, "close", () => {
  // Ignore an older queued close when another scene action has reopened it.
  if (dialog.open) return;
  cancelFileReview();
  if (offlineJob) cancelOfflineWork("离线结算已取消，原有进度已保留。请在设置中重试。");
  panel = null;
  setSceneInteractive(true);
  scene?.selectedCounter(null);
  updateGuide();
  if (returnFocus?.isConnected && !returnFocus.closest("[hidden]") &&
      returnFocus.matches("button,a,[tabindex]"))
    returnFocus.focus({ preventScroll: true });
  else canvas.focus({ preventScroll: true });
  returnFocus = null;
  updateGuide();
});
on(dialog, "click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    const e = event as MouseEvent;
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closePanel();
  }
});
on($("#counter-upgrade"), "click", () => {
  if (panel === "counter" && dialog.open) upgrade(selected);
});
function ingredientPurchaseBlocked(): boolean {
  if (authority && !authority.canMutate) return true;
  return stopped || document.hidden || renovating || saveBlocked || !!offlineJob || fileBusy || !!fileReview;
}
on($("#warehouse-upgrade"),"click",()=>{if(authority||panel!=="ingredients"||!dialog.open||ingredientPurchaseBlocked()||!settleVisibleTail())return;if(engine.upgradeWarehouse()){save();updateUI();toast(saveBlocked||saveFailed?"仓库已升级，请到存档确认保存状态":"仓库容量已升级");}});
on($("#seat-upgrade"),"click",()=>{if(authority||panel!=="seat"||!dialog.open||ingredientPurchaseBlocked()||!settleVisibleTail())return;if(engine.upgradeSeat(selectedSeat)){save();updateUI();toast(saveBlocked||saveFailed?"凳子已升级，请到存档确认保存状态":"凳子已升级，后续入座的小费增加");}});
root.querySelectorAll<HTMLButtonElement>("[data-ingredient-mode]").forEach(button => on(button, "click", () => {
  if (panel !== "ingredients" || !dialog.open || ingredientPurchaseBlocked()) return;
  ingredientModes[button.dataset.ingredientId as IngredientId] = button.dataset.ingredientMode as IngredientMode;
  updateUI();
}));
root.querySelectorAll<HTMLButtonElement>("[data-buy-ingredient]").forEach(button => on(button, "click", () => {
  if (panel !== "ingredients" || !dialog.open || ingredientPurchaseBlocked() || !settleVisibleTail()) return;
  const id = button.dataset.buyIngredient as IngredientId, mode = ingredientModes[id];
  const quote = engine.ingredientQuote(id, mode), shown = ingredientQuotes[id];
  // A brew can consume stock since the last painted frame. Never replace the
  // displayed fill price with a larger purchase behind the player's click.
  if (!shown || quote.quantity !== shown.quantity || quote.cost !== shown.cost) {
    updateUI(); toast("库存刚有变化，数量与价格已更新，请再确认购买"); return;
  }
  if (authority) { void submit({ type: "buy-ingredient", ingredient: id, mode, expectedCost: quote.cost, expectedQuantity: quote.quantity }); return; }
  if (!quote.quantity || !quote.affordable || !engine.buyIngredient(id, mode)) { updateUI(); return; }
  save();
  updateUI();
  toast(saveBlocked ? "原料已加入当前库存，但存档冲突，进度已保护；请到设置恢复" : saveFailed ? "原料已加入当前库存，但保存失败；请到设置导出备份" : `已购买 ${quote.quantity} 份${INGREDIENT_CONFIG[id].name} · ${money(quote.cost)}`);
}));
on($("#save"), "click", () => save(true));
function fileMessage(message: string) { $("#file-status").textContent = message; }
function ingredientSummary(state: SliceState): string {
  return `咖啡豆 ${state.ingredients.beans} / ${ingredientCapacity("beans",warehouseLevel(state))} · 牛奶 ${state.ingredients.milk} / ${ingredientCapacity("milk",warehouseLevel(state))}`;
}
function summaryDetails(state: SliceState, savedAt?: number): string {
  const o = overviewOf(state);
  return `${savedAt === undefined ? "当前未存盘进度" : `时间 ${new Date(savedAt).toLocaleString()}`}\n余额 ${money(o.wallet)} · 营业额 ${money(o.totalEarned)} · 已售 ${o.totalServed} 杯\n柜台 ${o.counterLevels.join(" / ")} 级\n${ingredientSummary(state)}\n营业柜台 ${o.placedCounters} · 座位 ${o.placedSeats} · ${layoutBounds(getLayout(state)).width} × ${layoutBounds(getLayout(state)).depth} 格\n${state.paused ? "已暂停营业" : "营业中"} · 经营 ${duration(o.elapsed)}`;
}
function summary(state: SliceState, savedAt?: number): string {
  const o = overviewOf(state);
  return `余额 ${money(o.wallet)}\n已售 ${o.totalServed} 杯\n柜台 ${o.counterLevels.join(" / ")} 级\n${ingredientSummary(state)}\n${o.placedCounters} 个营业柜台 · ${o.placedSeats} 个座位 · ${layoutBounds(getLayout(state)).width} × ${layoutBounds(getLayout(state)).depth} 格${savedAt === undefined ? "" : `\n${new Date(savedAt).toLocaleString()}`}`;
}
function updateFileControls() {
  const review = fileReview !== null;
  $("#file-output").hidden = !preparedFile;
  $("#file-prepare").toggleAttribute("disabled", fileBusy || review || saveBlocked && !authority || !hasUsableState);
  $("#file-download").toggleAttribute("disabled", !preparedFile || fileBusy || review);
  $("#file-share").toggleAttribute("disabled", !preparedFile || fileBusy || review);
  $("#file-input").toggleAttribute("disabled", !!offlineJob);
  $("#file-confirm").toggleAttribute("disabled", !review || fileBusy || !$<HTMLInputElement>("#file-other-tabs").checked);
  $("#file-review").hidden = !review;
  $("#file-backups").hidden = !repository.inspect().importBackupKey;
  $("#backup-live").toggleAttribute("disabled", fileBusy || review);
  $("#backup-original").toggleAttribute("disabled", fileBusy || review);
  $("#save").toggleAttribute("disabled", saveBlocked || fileBusy || review);
}
function cancelFileReview() {
  if (authority) authority.holdForReview = false;
  const reviewing = !!fileReview;
  fileGeneration++; fileBusy = false; fileReview = null;
  $("#file-review").hidden = true;
  $("#file-selection").hidden = true;
  $<HTMLInputElement>("#file-other-tabs").checked = false;
  if (reviewing) {
    // Preview is an explicitly paused interval, not online/offline earnings.
    renderBudget.reset(performance.now());
    presentation.reset(engine.state);
    verifiedForegroundSeconds = 0;
  }
  updateFileControls();
}
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadPrepared() {
  if (!preparedFile || fileBusy || fileReview) return;
  try { downloadText(preparedFile.text, portableFilename(preparedFile)); fileMessage("下载已发起，请确认保存位置。无法验证 iCloud 是否收到。"); }
  catch { fileMessage("无法发起下载，请检查浏览器下载权限。"); }
}
on($("#save-files"), "click", () => { if (!offlineJob) { showPanel("files"); updateFileControls(); } });
on($("#file-back"), "click", () => { cancelFileReview(); showPanel("settings"); });
on($("#file-cancel"), "click", () => { cancelFileReview(); fileMessage("已保留当前小店，未替换存档。"); $("#file-input").focus(); });
on($("#file-other-tabs"), "change", updateFileControls);
on($("#file-input"), "change", () => {
  const input = $<HTMLInputElement>("#file-input");
  const file = input.files?.[0]; input.value = "";
  cancelFileReview();
  if (!file || stopped || document.hidden || offlineJob) return;
  if (file.size > MAX_PORTABLE_BYTES) { fileMessage("文件超过 256 KiB，未读取其内容。"); return; }
  const generation = fileGeneration;
  fileBusy = true; updateFileControls(); fileMessage("正在读取并校验文件，只会预览…");
  void (async () => {
    try {
      const parsed = await parsePortableSave(await file.text());
      if (generation !== fileGeneration || stopped || document.hidden || panel !== "files" || !dialog.open) return;
      fileBusy = false;
      if (!parsed.ok) { fileMessage(parsed.message); updateFileControls(); return; }
      if (!settleVisibleTail()) { fileMessage("当前进度需要先恢复，请导出备份或读取最新档。"); return; }
      if (authority) authority.holdForReview = true;
      fileReview = { file: parsed.file, expectedRaw: repository.inspect().rawText, currentState: hasUsableState ? engine.snapshot() : null };
      const durable = repository.durableSnapshot();
      $("#file-current-summary").textContent = fileReview.currentState ? summary(fileReview.currentState) : "存档暂时无法读取\n原始内容将先备份";
      $("#file-current-details").textContent = fileReview.currentState ? `${summaryDetails(fileReview.currentState)}\n最近本地保存 ${durable ? new Date(durable.savedAt).toLocaleString() : "无"}\n${durable?.saveId ?? "尚无身份"} · r${durable?.revision ?? 0}` : "当前原始存档无法读取。确认前将按原始字节备份；不会把占位新店当作当前进度。";
      const incoming = parsed.file.payload;
      $("#file-incoming-summary").textContent = summary(incoming.state, incoming.savedAt);
      $("#file-incoming-details").textContent = `${summaryDetails(incoming.state, incoming.savedAt)}\n导出 ${new Date(incoming.exportedAt).toLocaleString()}\n${incoming.saveId} · r${incoming.revision}\nSHA-256 ${parsed.file.fingerprint}`;
      $("#file-older-warning").hidden = !durable || incoming.savedAt >= durable.savedAt;
      $("#file-repeat-warning").hidden = !durable?.importedFileHashes?.includes(parsed.file.fingerprint);
      $("#file-selection").textContent = `正在预览：${file.name}`;
      $("#file-selection").hidden = false;
      fileMessage("校验通过，请核对进度。");
      updateFileControls();
      $("#file-review").focus({ preventScroll: false });
    } catch { if (generation === fileGeneration && !stopped) { fileBusy = false; fileMessage("无法读取文件，当前小店未改变。"); updateFileControls(); } }
  })();
});
on($("#file-confirm"), "click", () => {
  const review = fileReview;
  if (!review || fileBusy || !$<HTMLInputElement>("#file-other-tabs").checked || stopped || document.hidden) return;
  if (authority) {
    if (review.expectedRaw !== authority.raw) { cancelFileReview(); fileMessage("服务器进度已变化，请重新选择文件并核对后再确认"); return; }
    try { authority.backup(authority.raw, "服务器导入前的小店"); } catch { fileMessage("本机备份失败，未导入"); return; }
    void submit({ type: "import", fileText: review.file.text, confirm: true }, () => { cancelFileReview(); preparedFile = null; fileMessage("已备份并导入服务器小店，文件期间不补收益"); });
    return;
  }
  fileBusy = true; updateFileControls();
  const result = repository.importSnapshot(review.file.payload.state, { expectedRaw: review.expectedRaw, currentState: review.currentState, fingerprint: review.file.fingerprint, otherTabsClosed: true }, Date.now());
  if (!result.ok || !result.state) {
    fileBusy = false;
    if (result.status === "conflict" || result.uncertain) { cancelFileReview(); blockConflict(result.message); }
    fileMessage(result.message); updateFileControls(); return;
  }
  cancelFileReview();
  // The repository commit is verified before replacing the live engine. Start
  // the new local branch at confirmation, with zero file-era offline reward.
  acceptLoaded({ state: result.state, status: "loaded", message: result.message, protectedRaw: false, settledAt: result.settledAt }, performance.now(), "save reload");
  finishGuide("skipped", false);
  preparedFile = null;
  $("#file-export-summary").textContent = "";
  fileMessage("已备份并导入，小店可以继续营业了。导入前的文件间隔不补收益。");
  updateFileControls();
  $("#file-input").focus();
});
on($("#file-prepare"), "click", () => {
  if (fileBusy || fileReview || saveBlocked && !authority || !hasUsableState || stopped || document.hidden) return;
  const written = save();
  const durable = repository.durableSnapshot();
  // A failed save must not export an older revision as the current progress.
  if (!written?.ok || saveBlocked && !authority || !durable || JSON.stringify(durable.state) !== JSON.stringify(engine.snapshot()) || !durable.saveId || !durable.revision) { fileMessage("当前进度尚未安全保存。请在上方重试保存，或导出当前副本。"); return; }
  const generation = ++fileGeneration;
  fileBusy = true; preparedFile = null; updateFileControls();
  void createPortableSave({ gameSchemaVersion: 1, economyVersion: durable.state.economyVersion, offlinePolicyVersion: 4, saveId: durable.saveId, revision: durable.revision, savedAt: durable.savedAt, exportedAt: Date.now(), overview: overviewOf(durable.state), state: durable.state }).then(file => {
    if (generation !== fileGeneration || stopped || document.hidden || panel !== "files" || !dialog.open) return;
    preparedFile = file; fileBusy = false;
    $("#file-export-summary").textContent = summary(file.payload.state, file.payload.savedAt);
    fileMessage("文件已准备好。请选择下载或分享；后续进度需重新生成。"); updateFileControls();
  }).catch(error => { if (generation === fileGeneration && !stopped) { fileBusy = false; fileMessage(error instanceof Error ? error.message : "无法生成存档文件。"); updateFileControls(); } });
});
on($("#file-download"), "click", downloadPrepared);
on($("#file-share"), "click", () => {
  if (!preparedFile || fileBusy || fileReview) return;
  try {
    const file = new File([preparedFile.text], portableFilename(preparedFile), { type: "application/json" });
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) { downloadPrepared(); return; }
    // Called directly from this button gesture; no prior asynchronous work.
    const generation = fileGeneration;
    void navigator.share({ files: [file], title: "Mellow Bean 手动存档" }).then(() => { if (generation === fileGeneration && !stopped) fileMessage("系统分享流程已结束，请自行确认保存位置与跨设备到达。"); }).catch(error => { if (generation === fileGeneration && !stopped) fileMessage(error?.name === "AbortError" ? "已取消分享，未下载文件。" : "分享未完成，请选择下载文件。"); });
  } catch { downloadPrepared(); }
});
on($("#backup-original"), "click", () => {
  const backup = repository.readImportBackup();
  if (!backup || backup.originalRaw === null) { fileMessage("没有可读取的导入前原始档。"); return; }
  try { downloadText(backup.originalRaw, `mellow-bean-before-import-original-${crypto.randomUUID()}.json`); fileMessage("已发起原始档下载，内容保持原始字节；此恢复档不一定可直接导入。"); }
  catch { fileMessage("备份下载失败，本地备份仍保留。"); }
});
on($("#backup-live"), "click", () => {
  const backup = repository.readImportBackup();
  if (!backup?.liveState || fileBusy || fileReview) { fileMessage("没有可读取的导入前有效进度；请导出原始档。"); return; }
  const generation = ++fileGeneration;
  fileBusy = true; updateFileControls();
  void createPortableSave({ gameSchemaVersion: 1, economyVersion: backup.liveState.economyVersion, offlinePolicyVersion: 4, saveId: crypto.randomUUID(), revision: 1, savedAt: backup.createdAt, exportedAt: Date.now(), overview: overviewOf(backup.liveState), state: backup.liveState }).then(file => {
    if (generation !== fileGeneration || stopped || document.hidden || panel !== "files") return;
    preparedFile = file; fileBusy = false;
    $("#file-export-summary").textContent = `导入前进度\n${summary(file.payload.state, file.payload.savedAt)}`;
    fileMessage("导入前进度文件已准备好，请下载或分享。恢复时选择该文件并再次核对确认。"); updateFileControls();
  }).catch(() => { if (generation === fileGeneration && !stopped) { fileBusy = false; fileMessage("无法读取有效的导入前进度，原始备份仍保留。"); updateFileControls(); } });
});
function updateBackupControls() {
  const sourceProtected = repository.inspect().protectedRaw;
  const needsRecovery = sourceProtected || saveBlocked || saveFailed;
  $("#save-recovery").hidden = !needsRecovery;
  $("#save-entry-summary").textContent = needsRecovery ? "进度需要处理 · 查看存档" : "自动保存 · 导入与导出";
  $("#save-files").classList.toggle("needs-attention", needsRecovery);
  $("#export").textContent = sourceProtected ? "导出原始档" : "导出当前副本";
  $("#export").toggleAttribute("disabled", !sourceProtected && !hasUsableState);
  $("#export-current").hidden = !sourceProtected || !hasUsableState;
  $("#save").toggleAttribute("disabled", saveBlocked || fileBusy || !!fileReview);
  $("#recovery-note").textContent = saveBlocked
    ? "已保护原有存档。先保留副本，再读取最新进度；暂时不会覆盖保存。"
    : "这次未能保存。请重试，或先导出当前副本，避免丢失这段进度。";
}
function exportBackup(original: boolean) {
  // An unreadable startup has no current shop to export; never label its
  // placeholder as a recovery backup. A previously valid shop remains exportable.
  if (!original && !hasUsableState) return;
  try {
    const bytes =
      original
        ? repository.inspect().rawText
        : JSON.stringify(
            {
              schemaVersion: 1,
              exportedAt: new Date().toISOString(),
              state: engine.snapshot(),
            },
            null,
            2,
          );
    const blob = new Blob([bytes ?? ""], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = original ? "mellow-bean-original-save.json" : "mellow-bean-local-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(original ? "原始存档已导出" : "当前进度备份已导出");
  } catch {
    toast("备份无法导出，请检查浏览器下载权限");
  }
}
on($("#export"), "click", () => exportBackup(repository.inspect().protectedRaw));
on($("#export-current"), "click", () => exportBackup(false));
function blockConflict(message: string) {
  cancelRenovation(false);
  cancelFileReview();
  cancelOfflineWork();
  saveBlocked = true;
  conflictBlocked = true;
  $("#reload").hidden = false;
  $("#save-status").textContent = message;
  toast(message);
  updateUI();
}
on(window, "coffee-cloud-conflict", () => {
  closePanel();
  cancelOfflineWork();
  blockConflict("云端存档已变化。请选择云端或本机进度后继续。");
});
on(window, "storage", (event) => {
  const e = event as StorageEvent;
  if (e.key === SAVE_KEY && e.newValue !== repository.inspect().rawText) {
    offlineRetry = null;
    resumeOfflineAfterHide = false;
    blockConflict("另一个窗口更新了小店。已暂停，避免覆盖它的进度。");
    if (panel === "offline") showPanel("settings");
  }
});
function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100) / 100);
  const days = Math.floor(total / 86400), hours = Math.floor(total % 86400 / 3600);
  const minutes = Math.floor(total % 3600 / 60), remaining = Math.round(total % 60 * 100) / 100;
  return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : "", remaining || !total ? `${remaining} 秒` : ""].filter(Boolean).join(" ");
}
function cancelOfflineWork(message?: string) {
  const job = offlineJob;
  offlineJob = null;
  if (job) {
    job.controller.abort();
    repository.cancelOffline(job.pending);
  }
  if (message) {
    resumeOfflineAfterHide = false;
    saveBlocked = conflictBlocked = true;
    $("#reload").hidden = false;
    $("#reload").textContent = offlineRetry?.kind === "hidden" ? "重试离线结算" : "读取最新档";
    $("#save-status").textContent = message;
    toast(message);
    updateUI();
  }
}
function showOfflineResult(result: LoadResult) {
  const offline = result.offline;
  if (!offline?.accepted || offline.awaySeconds === undefined || offline.awaySeconds < 30 ||
      offline.effectiveSeconds === undefined || offline.effectiveSeconds === 0 ||
      offline.generatedAmount === undefined || offline.pendingCash === undefined || offline.carrying === undefined) return false;
  $("#offline-working").hidden = true;
  $("#offline-result").hidden = false;
  // Player reward is the committed wallet delta, never generated/pending cash.
  $("#offline-deposited").textContent = money(offline.amount);
  $("#offline-stockout").hidden = !offline.stockout;
  $("#offline-duration").textContent = `离开了 ${duration(Math.floor(offline.awaySeconds))}`;
  showPanel("offline");
  return true;
}
function acceptLoaded(result: LoadResult, started: number, reason: "save reload" | "visibility / offline discontinuity" | "startup", verifiedUntil = performance.now()) {
  if (result.status !== "loaded" && result.status !== "new") {
    if (result.status === "conflict") { offlineRetry = null; resumeOfflineAfterHide = false; }
    blockConflict(result.message);
    if (panel === "offline") showPanel("settings");
    return;
  }
  if (reason === "save reload") finishGuide("skipped", false);
  routeDiagnostics?.reset(reason);
  performancePanel?.reset(reason);
  engine = createEngine(result.state, routeDiagnostics?.observe);
  hasUsableState = true;
  saveBlocked = conflictBlocked = false;
  saveFailed = false;
  hiddenAt = null;
  offlineRetry = null;
  resumeOfflineAfterHide = false;
  $("#reload").hidden = true;
  $("#reload").textContent = "读取最新档";
  $("#new-shop").hidden = true;
  $("#save-status").textContent = "本地存档已恢复";
  lastSave = result.settledAt ?? Date.now();
  // Work after the captured settlement endpoint is visible online time. Preserve
  // it in the ordinary clock, including a manual save before the next RAF.
  verifiedForegroundSeconds = Math.max(0, (verifiedUntil - started) / 1000);
  renderBudget.reset(started);
  presentation.reset(engine.state);
  updateBackupControls();
  updateUI();
  if ((performance.now() - verifiedUntil) / 1000 > LONG_FOREGROUND_GAP_SECONDS) {
    blockConflict(UNCLASSIFIED_TIME_MESSAGE);
    if (panel === "offline") showPanel("settings");
    cancelAnimationFrame(frame);
    if (!document.hidden && !stopped) frame = requestAnimationFrame(tick);
    return;
  }
  if (!showOfflineResult(result) && panel === "offline") {
    if (offlineReturnPanel) showPanel(offlineReturnPanel);
    else closePanel();
  }
  if (!result.offline && reason === "save reload") toast(result.message);
  cancelAnimationFrame(frame);
  if (document.hidden) suspendVisible();
  else if (!stopped) frame = requestAnimationFrame(tick);
}
function handleLoad(result: LoadResult, retry: OfflineRetry, started: number, reason: "save reload" | "visibility / offline discontinuity" | "startup") {
  updateBackupControls();
  $("#new-shop").hidden = !result.protectedRaw && result.status !== "missing";
  $("#new-shop").textContent = result.status === "missing" ? "确认开始新店" : "备份并开始新店";
  offlineRetry = retry;
  if (result.status !== "settling" || !result.pending) {
    acceptLoaded(result, started, reason);
    return;
  }
  if (panel !== "offline") offlineReturnPanel = panel;
  offlineRetry = retry;
  saveBlocked = conflictBlocked = true;
  const job = { pending: result.pending, controller: new AbortController(), started, lastObserved: started };
  offlineJob = job;
  $("#reload").hidden = false;
  $("#save-status").textContent = "正在结算离线经营，原有进度已保留";
  $("#offline-working").hidden = false;
  $("#offline-result").hidden = true;
  $("#offline-progress").setAttribute("value", "0");
  $("#offline-progress-text").textContent = "正在整理小店收益…";
  showPanel("offline");
  if (document.hidden) {
    resumeOfflineAfterHide = true;
    cancelOfflineWork();
    return;
  }
  const observeForegroundTurn = () => {
    if (offlineJob !== job) return false;
    const now = performance.now();
    if ((now - job.lastObserved) / 1000 > LONG_FOREGROUND_GAP_SECONDS) {
      resumeOfflineAfterHide = false;
      blockConflict(UNCLASSIFIED_TIME_MESSAGE);
      if (panel === "offline") showPanel("settings");
      return false;
    }
    job.lastObserved = now;
    return true;
  };
  void repository.finishOffline(job.pending, {
    signal: job.controller.signal,
    yieldControl: () => new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timer);
        job.controller.signal.removeEventListener("abort", finish);
        // Visibility can change before its event is delivered. Stop before the
        // next computation slice, while retaining the original unpaid interval.
        if (document.hidden && offlineJob === job) {
          resumeOfflineAfterHide = true;
          cancelOfflineWork();
        } else observeForegroundTurn();
        resolve();
      };
      const timer = setTimeout(finish, 0);
      job.controller.signal.addEventListener("abort", finish, { once: true });
      if (job.controller.signal.aborted) finish();
    }),
    onProgress: progress => {
      if (offlineJob !== job || stopped || !observeForegroundTurn()) return;
      $("#offline-progress").setAttribute("value", String(progress.fraction));
      $("#offline-progress-text").textContent = `正在整理收益 · ${Math.floor(progress.fraction * 100)}%`;
    },
  }).then(result => {
    if (offlineJob !== job || job.controller.signal.aborted || stopped) return;
    offlineJob = null;
    acceptLoaded(result, job.started, reason, job.lastObserved);
  }).catch(() => {
    if (offlineJob !== job || stopped) return;
    cancelOfflineWork("离线结算未完成，原有进度已保留。请在设置中重试。");
    showPanel("settings");
  });
}
function retryOffline() {
  const retry = offlineRetry;
  cancelOfflineWork();
  const started = performance.now(), now = Date.now();
  const result = retry?.kind === "hidden"
    ? repository.settleOffline(retry.state, retry.hiddenAt, now, { deferOffline: true })
    : repository.load(now, { allowNew: false, deferOffline: true });
  handleLoad(result, retry ?? { kind: "load" }, started, "save reload");
}
on($("#offline-cancel"), "click", closePanel);
on($("#offline-done"), "click", closePanel);
on($("#reload"), "click", () => {
  if (authority) { void authority.reconnect(); return; }
  cancelFileReview();
  if (!window.confirm("读取最新存档或重试结算会放弃本窗口未保存的后续修改。可以先导出当前副本。继续吗？")) return;
  retryOffline();
});
on($("#new-shop"), "click", () => {
  cancelFileReview();
  if (
    !window.confirm(
      "会放弃本窗口进度；若存在旧存档，会先保留完整本地备份，再开始新店。建议先导出备份。继续吗？",
    )
  )
    return;
  if (authority) { try { authority.backup(authority.raw, "服务器重开前的小店"); } catch { toast("备份失败，未重开小店"); return; } void submit({ type: "reset", confirm: true }); return; }
  cancelOfflineWork();
  const result = repository.reset({ confirmProtected: true });
  if (!result.ok) {
    toast(result.message);
    return;
  }
  finishGuide("skipped", false);
  offlineRetry = null;
  resumeOfflineAfterHide = false;
  verifiedForegroundSeconds = 0;
  routeDiagnostics?.reset("new shop");
  performancePanel?.reset("new shop");
  engine = createEngine(undefined, routeDiagnostics?.observe);
  hasUsableState = true;
  updateBackupControls();
  saveBlocked = false;
  conflictBlocked = false;
  saveFailed = false;
  $("#new-shop").hidden = true;
  $("#reload").hidden = true;
  hiddenAt = document.hidden ? Date.now() : null;
  renderBudget.reset(performance.now());
  presentation.reset(engine.state);
  save();
  updateUI();
  toast(result.backupKey ? "旧存档已本地备份，新店开始营业" : "已确认开始新店");
});
function updateRenderModeUI() {
  root.querySelectorAll<HTMLButtonElement>("[data-render-mode]").forEach(button => {
    const active = button.dataset.renderMode === renderMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#render-mode-current").textContent = ({ smooth: "清晰流畅", "clear-60": "清晰 60 帧", balanced: "平衡", "low-power": "省电" })[renderMode];
  $("#render-mode-note").textContent = renderMode === "smooth"
    ? "高清画面，跟随屏幕刷新。"
    : renderMode === "clear-60"
      ? "相同清晰度，最高 60 帧，经营速度不变。"
    : renderMode === "balanced"
      ? "画面与耗电之间的平衡。"
      : "减少绘制，画面与动作会更简约。";
}
function setSupplyText(selector: string, message: string) {
  const element = $(selector);
  if (element.textContent !== message) element.textContent = message;
}
function recipeSupplyNote(recipe: RecipeId): string {
  const { beans, milk } = engine.state.ingredients;
  if (!beans) return "咖啡豆用完了，暂停制作新杯；已开做的咖啡会完成。";
  if (recipe === "latte" && !milk) return "牛奶用完了，拿铁暂停制作；可把柜台切换为浓缩，无需购买牛奶。";
  return recipe === "latte" ? "每杯用 1 份咖啡豆 + 1 份牛奶" : "每杯用 1 份咖啡豆";
}
function updateIngredientPanel() {
  const blocked = ingredientPurchaseBlocked();
  const warehouse=engine.warehouseQuote();$("#warehouse-level").textContent=`Lv.${warehouse.level}`;$("#warehouse-capacity").textContent=`${ingredientCapacity("beans",warehouse.level)} / ${ingredientCapacity("milk",warehouse.level)}`;$("#warehouse-next").textContent=warehouse.capped?"容量已达上限":`咖啡豆 ${ingredientCapacity("beans",warehouse.level)} → ${ingredientCapacity("beans",warehouse.nextLevel)} · 牛奶 ${ingredientCapacity("milk",warehouse.level)} → ${ingredientCapacity("milk",warehouse.nextLevel)}`;$("#warehouse-upgrade").textContent=warehouse.capped?"已满级":`升级仓库 · ${money(warehouse.cost)}`;$("#warehouse-upgrade").toggleAttribute("disabled",blocked||warehouse.capped||engine.state.wallet<warehouse.cost);

  const { beans, milk } = engine.state.ingredients;
  setSupplyText("#ingredient-supply-note", !beans && engine.state.wallet < INGREDIENT_CONFIG.beans.unitCost && !engine.state.counters.some(counter => counter.brew) ? "原料不足，余额也不够购买咖啡豆；没有自动补货。" : !beans ? "咖啡豆用完了，补货后才能制作新杯。已开做的咖啡会完成。" : !milk ? "牛奶用完了，拿铁暂停制作；可把柜台切换为浓缩，无需购买牛奶。" : "原料充足，所有柜台共用这份库存。");
  for (const id of ["beans", "milk"] as const) {
    const config = INGREDIENT_CONFIG[id], stock = engine.state.ingredients[id], capacity=ingredientCapacity(id,warehouseLevel(engine.state));
    $(`#ingredient-${id}-stock`).textContent = `${stock} / ${capacity} 份`;
    $(`#ingredient-${id}-unit`).textContent = `${money(config.unitCost)} / 份`;
    $(`#ingredient-${id}-meter`).setAttribute("max", String(capacity));
    $(`#ingredient-${id}-meter`).setAttribute("value", String(stock));
    $(`#ingredient-${id}-meter`).setAttribute("aria-valuetext", `${stock} 份，上限 ${capacity} 份`);
    for (const mode of ["one", "batch", "fill"] as const) {
      const q = engine.ingredientQuote(id, mode), button = $<HTMLButtonElement>(`#ingredient-${id}-${mode}`);
      button.setAttribute("aria-pressed", String(ingredientModes[id] === mode));
      button.setAttribute("aria-label", `${config.name}${mode === "one" ? "单份" : mode === "batch" ? "一批" : "补满"}：${q.quantity} 份，${money(q.cost)}`);
      button.disabled = blocked || q.quantity === 0;
      $(`#ingredient-${id}-${mode}-quantity`).textContent = `${q.quantity} 份`;
      $(`#ingredient-${id}-${mode}-cost`).textContent = money(q.cost);
    }
    const q = engine.ingredientQuote(id, ingredientModes[id]);
    ingredientQuotes[id] = { quantity: q.quantity, cost: q.cost };
    $(`#ingredient-${id}-buy`).textContent = q.quantity ? `购买 ${q.quantity} 份 · ${money(q.cost)}` : "库存已满";
    $<HTMLButtonElement>(`#ingredient-${id}-buy`).disabled = blocked || !q.quantity || !q.affordable;
    setSupplyText(`#ingredient-${id}-note`, saveBlocked ? "请先到设置恢复存档，再购买原料" : blocked ? "当前正在处理进度，暂时不能购买" : !q.quantity ? "仓库已装满，不会扣款" : !q.affordable ? `余额不足，还差 ${money(q.cost - engine.state.wallet)}；可选择更少数量` : engine.state.paused ? "已暂停营业，仍可手动补货" : "点击购买后扣款并加入库存");
  }
}
function updateUI() {
  updateRenovation();
  updateBackupControls();
  if (panel === "files") updateFileControls();
  updateGuide();
  const s = engine.state;
  const walletText = money(s.wallet);
  if ($("#wallet").textContent !== walletText) $("#wallet").textContent = walletText;
  const frozen = saveBlocked || !!offlineJob || !!fileReview || !!authority && !authority.canMutate;
  $("#migration-notice").hidden = !s.doorMigrationNotice || frozen || dialog.open || renovating;
  $<HTMLButtonElement>("#migration-dismiss").disabled = frozen;
  $("#business-toggle").textContent = s.paused ? "恢复营业" : "暂停营业";
  $("#business-toggle").setAttribute("aria-pressed", String(s.paused));
  $<HTMLButtonElement>("#business-toggle").disabled = frozen;
  $<HTMLButtonElement>("#settings").disabled = renovating;
  $("#business-status").textContent = frozen ? "进度已保护" : s.paused ? s.customers.length ? `打烊中 · ${s.customers.length} 位客人` : "已暂停营业" : "营业中";
  $("#business-status").classList.toggle("closed", s.paused);
  $<HTMLButtonElement>("#dock-invite").disabled = frozen || s.paused || s.inviteCooldown > 0;
  $<HTMLButtonElement>("#dock-furniture").disabled = frozen;
  $("#dock-ingredients").classList.toggle("needs-stock", !s.ingredients.beans || !s.ingredients.milk);
  $("#dock-ingredients").setAttribute("aria-label", `购买原料：咖啡豆 ${s.ingredients.beans} 份，牛奶 ${s.ingredients.milk} 份${!s.ingredients.beans || !s.ingredients.milk ? "，需要补货" : ""}`);
  $("#dock-furniture").setAttribute("title", s.paused ? "布置家具" : "先暂停营业，再布置家具");
  if (panel === "recipe") {
    const c = s.counters.find((c) => c.id === selected)!;
    $("#dialog-eyebrow").textContent = `柜台 · Lv. ${c.level}`;
    $("#dialog-title").textContent = "选择咖啡";
    $("#dialog-description").textContent = "";
    setSupplyText("#recipe-stock-note", recipeSupplyNote(c.recipe));
    root.querySelectorAll<HTMLButtonElement>("[data-select-recipe]").forEach((b) => {
      const recipe = b.dataset.selectRecipe as RecipeId;
      b.classList.toggle("active", recipe === c.recipe);
      b.setAttribute("aria-pressed", String(recipe === c.recipe));
      b.disabled = conflictBlocked;
      $(`#recipe-${recipe}-stats`).textContent = `${money(counterPrice(recipe, c.level, c.id, s.coffeeLevels[recipe]))} · ${counterBrewSeconds(recipe, c.level, c.id, s.coffeeLevels[recipe]).toFixed(2)} 秒`;
    });
  } else if (panel === "counter") {
    const c = s.counters.find((c) => c.id === selected)!, q = engine.quote(selected);
    $("#dialog-eyebrow").textContent = "柜台";
    $("#dialog-title").textContent = "升级柜台";
    $("#dialog-description").textContent = "";
    $("#counter-stock-note").textContent = recipeSupplyNote(c.recipe);
    $("#counter-coffee").textContent = recipeById[c.recipe].name;
    $("#counter-level").textContent = `Lv. ${c.level}${q.capped ? " · MAX" : ` → ${c.level + 1}`}`;
    $("#counter-next-price").textContent = q.capped ? "已达上限" : `→ ${money(q.afterPrice)}`;
    $("#counter-next-seconds").textContent = q.capped ? "已达上限" : `→ ${q.afterSeconds.toFixed(2)} 秒`;
    $("#counter-funds").textContent = conflictBlocked ? "请先恢复存档" : q.capped ? "" : s.wallet < q.cost ? `还差 ${money(q.cost - s.wallet)}` : "";
    $("#counter-price").textContent = money(q.beforePrice);
    $("#counter-seconds").textContent = `${q.beforeSeconds.toFixed(2)} 秒`;
    const currentBrew = c.brew && c.brew.elapsed < c.brew.duration && (c.brew.recipe !== c.recipe || Math.abs(c.brew.duration - q.beforeSeconds) > 1e-9) ? c.brew : null;
    $("#counter-current-brew").hidden = !currentBrew;
    $("#counter-current-brew").textContent = currentBrew ? `当前这杯：${recipeById[currentBrew.recipe].name} · ${currentBrew.duration.toFixed(2)} 秒` : "";
    $("#counter-upgrade").textContent = q.capped ? "已满级" : `升级柜台 · ${money(q.cost)}`;
    $("#counter-upgrade").toggleAttribute("disabled", q.capped || s.wallet < q.cost || conflictBlocked);
  } else if (panel === "coffee") {
    const r = recipeById[viewedRecipe];
    $("#dialog-eyebrow").textContent = "咖啡";
    $("#dialog-title").textContent = r.name;
    $("#dialog-description").textContent = "";
    $("#coffee-stock-note").textContent = recipeSupplyNote(viewedRecipe);
    $("#coffee-price").textContent = money(r.price);
    $("#coffee-seconds").textContent = `${r.brewSeconds.toFixed(2)} 秒`;
    root.querySelectorAll<HTMLButtonElement>("[data-view-coffee]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.viewCoffee === viewedRecipe)));
  } else if(panel==="seat"){
    const q=engine.seatQuote(selectedSeat);$("#dialog-eyebrow").textContent="堂食座位";$("#dialog-title").textContent="升级凳子";$("#dialog-description").textContent="";$("#seat-name").textContent="凳子";$("#seat-level").textContent=q?`Lv.${q.level}`:"";$("#seat-tip").textContent=q?money(q.tip):"";$("#seat-next-tip").textContent=q?money(q.nextTip):"";$("#seat-upgrade").textContent=!q?"座位不可用":q.capped?"已满级":`升级凳子 · ${money(q.cost)}`;$("#seat-upgrade").toggleAttribute("disabled",!q||q.capped||s.wallet<q.cost||ingredientPurchaseBlocked());$("#seat-funds").textContent=q&&!q.capped&&s.wallet<q.cost?`还差 ${money(q.cost-s.wallet)}`:"";
  } else if (panel === "ingredients") {
    $("#dialog-eyebrow").textContent = "SHOP PANTRY";
    $("#dialog-title").textContent = "原料小仓库";
    $("#dialog-description").textContent = `可用余额 ${money(s.wallet)}`;
    updateIngredientPanel();
  } else if (panel === "background") {
    $("#dialog-eyebrow").textContent = "AROUND THE SHOP";
    $("#dialog-title").textContent = "换个店外景色";
    $("#dialog-description").textContent = "";
    root.querySelectorAll<HTMLButtonElement>("[data-backdrop]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.backdrop === backdrop)));
  } else if (panel === "offline") {
    $("#dialog-eyebrow").textContent = "WELCOME BACK";
    $("#dialog-title").textContent = offlineJob ? "小店忙碌了一会儿" : "欢迎回来";
    $("#dialog-description").textContent = offlineJob ? "正在整理离开期间的经营进度" : "离开期间的经营进度已保存";
  } else if (panel === "files") {
    $("#dialog-eyebrow").textContent = "COFFEE TO GO";
    $("#dialog-title").textContent = "小店存档";
    $("#dialog-description").textContent = "把喜欢的小店，带在身边";
  } else if (panel === "settings") {
    $("#dialog-eyebrow").textContent = "MELLOW BEAN";
    $("#dialog-title").textContent = "小店设置";
    $("#dialog-description").textContent = "给小店调个舒服的节奏";
  }
}
let hudElapsed = 0;
function tick(now: number) {
  if (stopped || document.hidden) return;
  const elapsed = renderBudget.take(now);
  frame = requestAnimationFrame(tick);
  if (elapsed === null) return;
  const dt = elapsed;
  if (!allowVisibleTime(dt)) return;
  const view = presentation.advance(authority ? visualEngine : engine, saveBlocked || offlineJob || fileReview || authority && (!authority.online || !authority.isFresh || authority.remainingMs > 0) ? 0 : authority ? Math.min(.25, Math.max(0, dt)) : Math.max(0, dt));
  scene?.update(layoutDraft ? { ...view, paused: true } : view, dt);
  if (performancePanel?.active) performancePanel.update(now, !!scene && !qaContextLost, document.hasFocus());
  if (routeDiagnostics && routePanel?.active) {
    // Choose a loaded customer before asking the scene for its same-ID mesh.
    if (routeDiagnostics.trackedId === null) routeDiagnostics.selectNext(engine.state);
    routePanel.update(engine.state, view, !!scene, scene?.readCustomerPose(routeDiagnostics.trackedId) ?? null, dt);
  }
  hudElapsed += dt;
  if (hudElapsed >= 0.15) {
    hudElapsed = 0;
    updateUI();
  }
  engine.drainEvents();
  if (Date.now() - lastSave > 8000) save();
}
function resumeVisible() {
  if (authority) { hiddenAt = null; renderBudget.reset(performance.now()); cancelAnimationFrame(frame); frame = requestAnimationFrame(tick); void authority.execute({ type: "sync" }, true); return; }
  if (stopped || document.hidden || offlineJob) return;
  cancelAnimationFrame(frame);
  if (resumeOfflineAfterHide && offlineRetry) {
    retryOffline();
    return;
  }
  if (hiddenAt !== null && !saveBlocked) {
    const start = hiddenAt, started = performance.now();
    const original = engine.snapshot();
    const result = repository.settleOffline(original, start, Date.now(), { deferOffline: true });
    handleLoad(result, { kind: "hidden", state: original, hiddenAt: start }, started, "visibility / offline discontinuity");
    scene?.resize();
    return;
  }
  settleVisibleTail();
  renderBudget.reset(performance.now());
  presentation.reset(engine.state);
  routeDiagnostics?.reset("visibility / offline discontinuity");
  performancePanel?.reset("visible / offline discontinuity");
  scene?.resize();
  frame = requestAnimationFrame(tick);
}
function allowVisibleTime(seconds: number): boolean {
  if (authority) return true;
  if (saveBlocked || offlineJob || fileReview || renovating) return true;
  if (Math.max(0, seconds - verifiedForegroundSeconds) > LONG_FOREGROUND_GAP_SECONDS + 1e-6) {
    blockConflict(UNCLASSIFIED_TIME_MESSAGE);
    return false;
  }
  verifiedForegroundSeconds = Math.max(0, verifiedForegroundSeconds - seconds);
  return true;
}
function settleVisibleTail(): boolean {
  if (authority) return true;
  if (hiddenAt !== null || saveBlocked || offlineJob || fileReview) return true;
  const seconds = renderBudget.flush(performance.now());
  if (!allowVisibleTime(seconds)) return false;
  engine.advance(seconds);
  return true;
}
function suspendVisible() {
  if (authority) { if (renovating) cancelRenovation(false); cancelFileReview(); cancelAnimationFrame(frame); hiddenAt = Date.now(); void authority.execute({ type: "sync" }, true); return; }
  if (renovating) { settleVisibleTail(); cancelRenovation(false); }
  cancelFileReview();
  cancelAnimationFrame(frame);
  if (offlineJob) {
    resumeOfflineAfterHide = true;
    cancelOfflineWork();
    return;
  }
  settleVisibleTail();
  hiddenAt ??= Date.now();
  save(false, hiddenAt);
}
function onVisibility() {
  updateGuide();
  if (document.hidden) {
    performancePanel?.reset("hidden; sampling stopped");
    suspendVisible();
  } else resumeVisible();
}
function onPageHide(event: Event) {
  performancePanel?.reset("pagehide; sampling stopped");
  suspendVisible();
  if (!(event as PageTransitionEvent).persisted) cleanup(false);
}
const sizeObserver =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => {
        scene?.resize();
        performancePanel?.reset("canvas resized");
      })
    : null;
sizeObserver?.observe($("#coffee-canvas"));
on(window, "resize", () => {
  scene?.resize();
  performancePanel?.reset("window resized");
});
const visualViewport = window.visualViewport;
if (visualViewport)
  on(visualViewport, "resize", () => {
    scene?.resize();
    performancePanel?.reset("visual viewport resized");
  });
function cleanup(persist = true) {
  if (stopped) return;
  if (renovating) { settleVisibleTail(); cancelRenovation(false); }
  cancelFileReview();
  cancelOfflineWork();
  if (persist) { settleVisibleTail(); save(false, hiddenAt ?? Date.now()); }
  stopped = true;
  authority?.stop();
  updateGuide();
  cancelAnimationFrame(frame);
  if (toastTimer) clearTimeout(toastTimer);
  listeners.abort();
  sizeObserver?.disconnect();
  routePanel?.dispose();
  performancePanel?.dispose();
  if (routeDiagnostics) Reflect.deleteProperty(window, "__coffeeSliceDebug");
  scene?.dispose();
}
on(document, "visibilitychange", onVisibility);
if (performancePanel) {
  on(window, "blur", () => performancePanel.reset("page unfocused; sampling stopped"));
  on(window, "focus", () => performancePanel.reset("page focused"));
  on(canvas, "webglcontextlost", () => { qaContextLost = true; performancePanel.reset("WebGL context lost"); });
  on(canvas, "webglcontextrestored", () => { qaContextLost = false; performancePanel.reset("WebGL context restored"); });
}
on(window, "pagehide", onPageHide);
on(window, "pageshow", (event) => {
  if ((event as PageTransitionEvent).persisted) resumeVisible();
});
if (routeDiagnostics)
  Object.defineProperty(window, "__coffeeSliceDebug", {
    value: {
      readState: (): SliceState => engine.snapshot(),
      readRoutes: () => routeDiagnostics.read(),
      selected: () => selected,
      focusedObject: () => scene?.getFocus(),
      readRenderStats: () => scene?.readRenderStats(),
      readCameraZoom: () => scene?.getZoom(),
      readPerformance: () => performancePanel?.read(),
      readLayoutCell: (x: number, z: number) => scene?.projectLayoutCell(x, z),
      readLayoutItem: (id: string) => scene?.projectLayoutItem(id),
      readRenovation: () => ({ status: engine.layoutEditStatus(), selectedId: selectedFurniture, selectedIds:selectedGroup(), multiSelect, draft: layoutDraft ? structuredClone(layoutDraft) : null, drag: layoutDrag ? structuredClone({ id: layoutDrag.id, ids:layoutDrag.ids, valid: layoutDrag.valid, reason: layoutDrag.reason, draft: layoutDrag.draft }) : null }),
      readFootprints: () => Object.fromEntries(sceneAnchors.map((key) => [key, scene?.getAnchorFootprint(key)])),
      readAnchors: () =>
        Object.fromEntries(
          sceneAnchors.map((key) => [key, scene?.projectAnchor(key)]),
        ),
    },
    configurable: true,
  });
if (manual) {
  manual.onAdopt = () => {
    const raw = manual.branch.raw; if (!raw) return;
    const result = repository.load(JSON.parse(raw).savedAt, { allowNew: false, deferOffline: true });
    if (result.status !== "loaded") throw Error(result.message);
    engine = createEngine(result.state, routeDiagnostics?.observe); hasUsableState = true;
    presentation.reset(engine.state); renderBudget.reset(performance.now()); preparedFile = null;
  };
  on(window, "coffee-manual-message", event => { toast((event as CustomEvent<string>).detail); });
  on(window, "coffee-manual-sync", async event => {
    if (manual.busy || stopped || document.hidden || saveBlocked || offlineJob || fileReview || fileBusy || renovating) { toast("请先完成当前操作或恢复本机存档，再同步"); return; }
    closePanel(); const saved = save(); if (!saved?.ok) { toast("本机保存未成功，请先导出备份"); return; }
    saveBlocked = conflictBlocked = true; updateUI();
    const button = document.querySelector<HTMLButtonElement>(".cloud-status"); if (button) { button.disabled = true; button.textContent = "同步中…"; }
    try { await manual.sync((event as CustomEvent<{mode?:"sync"|"download"}>).detail?.mode ?? "sync"); }
    finally {
      saveBlocked = conflictBlocked = false; verifiedForegroundSeconds = 0; lastSave = Date.now(); hiddenAt = document.hidden ? lastSave : null;
      renderBudget.reset(performance.now()); presentation.reset(engine.state); save(); updateUI();
      if (button) { button.disabled = false; button.textContent = "☁ 同步"; }
    }
  });
}

if (authority) {
  authority.onSnapshot = () => {
    const current = repository.load(authority.envelope.savedAt, { deferOffline: true });
    if (current.status !== "loaded" && current.status !== "new") { blockConflict(current.message); return; }
    engine = createEngine(current.state, routeDiagnostics?.observe);
    if (renovating) engine.beginLayoutEdit();
    visualEngine = createEngine(current.state);
    presentation.reset(visualEngine.state);
    renderBudget.reset(performance.now());
    saveBlocked = conflictBlocked = !authority.online || authority.remainingMs > 0;
    lastSave = Date.now();
    updateUI();
  };
  on(window, "coffee-authority-connecting", () => { closePanel(); cancelFileReview(); });
  on(window, "coffee-authority-lost", () => {
    closePanel();
    saveBlocked = conflictBlocked = true;
    $("#save-status").textContent = "服务器连接中断，经营操作已暂停";
    updateUI();
  });
  on(window, "coffee-authority-restored", () => { authority.onSnapshot(); updateUI(); });
}
updateRenderModeUI();
updateBackupControls();
updateUI();
frame = requestAnimationFrame(tick);
startGuide();
if (loaded.status === "settling") handleLoad(loaded, { kind: "load" }, loadPerformance, "startup");
else if (loaded.status === "loaded") showOfflineResult(loaded);
if (loaded.message && loaded.status !== "new" && loaded.status !== "loaded" && loaded.status !== "settling")
  toast(loaded.message);
if (saveBlocked) $("#save-status").textContent = loaded.message;
if (import.meta.hot) import.meta.hot.dispose(() => cleanup());
