import { createEngine, recipeById, counterPrice, counterBrewSeconds, managerSpeed } from "./core/engine";
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
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#slice-root")!;
root.innerHTML = `
<main class="coffee-world" aria-label="Mellow Bean 全屏咖啡店">
  <canvas id="coffee-canvas" tabindex="0" aria-label="Mellow Bean 店铺场景" aria-describedby="scene-instructions"></canvas>
  <p id="scene-instructions" class="sr-only">拖动逛店，点击墙上的咖啡菜单和金库，以及柜台前脸的配方牌和升级牌。金库管理收钱经理；右上角打开设置。键盘左右箭头选择店内物件，上下箭头平移，Enter 或空格操作，Home 返回柜台 A。</p>
  <header class="hud" aria-label="金额与设置"><div class="wallet-chip"><strong id="wallet">¥0.00</strong></div><button id="settings" class="settings-button" aria-label="打开店铺设置">⚙</button></header>
  <div id="render-error" class="render-error" hidden></div>
  <dialog id="operation-dialog" class="operation-dialog" aria-labelledby="dialog-title">
    <button id="dialog-close" class="dialog-close" aria-label="关闭操作窗口">×</button>
    <div class="dialog-heading"><span class="dialog-eyebrow" id="dialog-eyebrow">MELLOW BEAN</span><h1 id="dialog-title"></h1><p id="dialog-description"></p></div>
    <div id="recipe-panel" class="operation-panel" hidden>
      <div class="recipe-picker" role="group" aria-label="柜台咖啡">
        <button data-select-recipe="espresso"><span class="cup-art espresso-cup" aria-hidden="true"></span><strong>浓缩咖啡</strong><small id="recipe-espresso-stats"></small></button>
        <button data-select-recipe="latte"><span class="cup-art latte-cup" aria-hidden="true"></span><strong>拿铁</strong><small id="recipe-latte-stats"></small></button>
      </div>
      <p id="counter-affinity" class="affinity-badge"></p>
      <p class="detail-note">下一杯生效</p>
    </div>
    <div id="counter-panel" class="operation-panel" hidden>
      <div class="upgrade-card">
        <div class="section-heading"><h2 id="counter-coffee"></h2><span id="counter-level" class="level-badge"></span></div>
        <div class="detail-grid upgrade-stats"><span>每杯售价<strong id="counter-price"></strong><small id="counter-next-price"></small></span><span>制作时长<strong id="counter-seconds"></strong><small id="counter-next-seconds"></small></span></div>
        <button id="counter-upgrade" class="primary-button"></button><p id="counter-funds" class="action-note"></p>
      </div>
    </div>
    <div id="coffee-panel" class="operation-panel" hidden>
      <div class="coffee-medallion" id="coffee-symbol" aria-hidden="true">☕</div>
      <div class="upgrade-card">
        <div class="section-heading"><h2>咖啡升级</h2><span id="coffee-level" class="level-badge"></span></div>
        <div class="detail-grid upgrade-stats"><span>基础杯价<strong id="coffee-price"></strong><small id="coffee-next-price"></small></span><span>制作时长<strong id="coffee-seconds"></strong><small id="coffee-next-seconds"></small></span></div>
        <button id="coffee-upgrade" class="primary-button"></button><p id="coffee-funds" class="action-note"></p>
      </div>
    </div>
    <div id="vault-panel" class="operation-panel" hidden>
      <div class="vault-total"><span>可用金币</span><strong id="vault-total"></strong><small id="served"></small></div>
      <div class="upgrade-card">
        <div class="section-heading"><h2>收钱经理</h2><span id="manager-rank" class="level-badge"></span></div>
        <div class="manager-card"><span class="manager-art" aria-hidden="true"><i></i></span><div><span class="stat-label">收运效率</span><strong id="manager-speed"></strong><span id="manager-preview"></span></div></div>
        <p id="manager-status" class="action-note"></p><button id="manager-upgrade" class="primary-button"></button><p id="manager-funds" class="action-note"></p>
      </div>
      <details class="quiet-details"><summary>收款详情</summary><div class="detail-grid"><span>台面待收<strong id="pending"></strong></span><span>经理运送<strong id="carrying"></strong></span></div><p>经理把钱送回金库后，就能用来升级小店。</p></details>
    </div>
    <div id="settings-panel" class="operation-panel" hidden>
      <section class="local-save-card"><div><span class="stat-label">这台设备的小店</span><p id="save-status" class="save-status" role="status">本地自动保存</p></div><button id="save" class="compact-button">保存</button></section>
      <button id="save-files" class="menu-card"><span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H6V3h1Zm7 0v5h4M9 12h6M9 16h6"/></svg></span><span><strong>小店存档</strong><small>导出文件 · 在另一台设备继续</small></span><span class="menu-chevron" aria-hidden="true">›</span></button>
      <section class="settings-section"><div class="section-heading"><h2 id="render-mode-label">画面</h2><span class="section-kicker">选你喜欢的节奏</span></div><div class="render-mode-picker" role="group" aria-labelledby="render-mode-label" aria-describedby="render-mode-note"><button data-render-mode="smooth">清晰流畅<small>跟随屏幕刷新</small></button><button data-render-mode="clear-60">清晰 60 帧<small>同等清晰度</small></button><button data-render-mode="balanced">平衡<small>适中清晰度 · 最高 60 帧</small></button><button data-render-mode="low-power">省电<small>较低清晰度 · 最高 30 帧</small></button></div><p class="detail-note" id="render-mode-note"></p></section>
      <details id="save-recovery" class="quiet-details"><summary>备份与恢复</summary><p>自动保存仅在本浏览器。换设备请使用“小店存档”；这里的恢复副本不一定能直接导入。</p><div class="settings-grid"><button id="export">导出备份</button><button id="export-current" hidden>导出当前副本</button><button id="reload" hidden>读取最新档</button><button id="new-shop" hidden>备份并开始新店</button></div></details>
      <details class="quiet-details"><summary>逛逛小店</summary><div class="jump-grid"><button data-focus="counter-a-recipe">柜台 A</button><button data-focus="counter-b-recipe">柜台 B</button><button data-focus="menu-espresso">咖啡墙</button><button data-focus="vault">金库</button><button data-focus="invite">入口</button></div></details>
      <details class="quiet-details"><summary>怎么玩</summary><p>客人自动进店买咖啡。升级咖啡和柜台，让出杯更快、更值钱；升级经理，让金币更快到账。</p><p>点柜台配方牌换咖啡，入口可招呼客人。离线以 80% 经营速度持续营业，无时长上限。</p></details>
    </div>
    <div id="files-panel" class="operation-panel" hidden>
      <section class="file-card export-card"><div class="section-heading"><h2><span class="step-badge" aria-hidden="true">↑</span>带走这间小店</h2><span class="section-kicker">导出</span></div><p class="detail-note">生成文件，把此刻的进度装进口袋。</p><button id="file-prepare" class="primary-button">生成存档</button><div id="file-output" hidden><p id="file-export-summary" class="file-summary"></p><div class="settings-grid"><button id="file-download" disabled>下载文件</button><button id="file-share" disabled>分享文件</button></div></div></section>
      <section class="file-card import-card"><div class="section-heading"><h2><span class="step-badge" aria-hidden="true">↓</span>继续另一份进度</h2><span class="section-kicker">导入</span></div><label class="file-picker" for="file-input"><span>选择存档文件</span><input id="file-input" type="file" accept="application/json,.json" aria-describedby="file-picker-note file-selection"></label><p id="file-picker-note" class="detail-note">JSON · 最多 256 KiB · 先预览，再确认</p><p id="file-selection" class="file-selection" hidden></p></section>
      <p id="file-status" class="file-status" role="status" aria-live="polite">选择文件不会立即替换小店。</p>
      <div id="file-review" tabindex="-1" role="region" aria-label="导入存档预览" hidden>
        <div class="section-heading"><h2>要继续这份进度吗？</h2><span class="level-badge">已暂停营业</span></div>
        <div class="save-comparison"><section class="save-snapshot"><h3>现在的小店</h3><p id="file-current-summary" class="file-summary"></p></section><section class="save-snapshot incoming-snapshot"><h3>文件里的小店</h3><p id="file-incoming-summary" class="file-summary"></p></section></div>
        <p id="file-older-warning" class="warning-note" hidden>这是较早的存档，导入会回退到文件中的进度。</p>
        <p id="file-repeat-warning" class="warning-note" hidden>这份文件已导入过。再次导入会回退到该快照，不会重复获得离线收益。</p>
        <div class="confirmation-note"><strong>当前小店将被完整替换</strong><p>较早进度会回退，金币不合并；文件导出至本次导入之间不补离线收益。替换前会先校验本地备份，备份失败就停止。</p></div>
        <details class="quiet-details"><summary>备份与文件详情</summary><p>本地备份保留当前进度和原始档，不自动删除。空间不足时拒绝导入；清除浏览器数据会丢失备份，请先下载重要副本。</p><p>导入创建新的本地存档身份，此后按 80% 速度继续离线经营。</p><p class="technical-label">当前小店</p><p id="file-current-details" class="file-summary technical-summary"></p><p class="technical-label">导入文件</p><p id="file-incoming-details" class="file-summary technical-summary"></p></details>
        <label class="file-confirm-label"><input id="file-other-tabs" type="checkbox"><span>已关闭其他游戏标签页和窗口<small>多窗口同时写入可能造成冲突，无法保证安全。</small></span></label>
        <div class="import-actions"><button id="file-confirm" class="primary-button" disabled>备份并替换小店</button><button id="file-cancel" class="secondary-button">保留当前小店</button></div>
      </div>
      <details id="file-backups" class="quiet-details" hidden><summary>找回导入前的小店</summary><div class="settings-grid"><button id="backup-live">导出原进度</button><button id="backup-original">导出原始档</button></div></details>
      <details class="quiet-details"><summary>如何换设备继续？</summary><p>生成后下载或分享文件，在另一台设备选择导入。新进度需要重新生成文件。</p><p>可在系统面板选择 iCloud Drive。这是手动文件存档，没有自动云同步，也无法确认云端或另一台设备是否已收到。</p><p>校验码只检查完整性，不证明来源可信。请选择自己保留的文件。</p></details>
      <button id="file-back" class="text-button">‹ 返回设置</button>
    </div>
    <div id="offline-panel" class="operation-panel" hidden>
      <div id="offline-working"><div class="earnings-art" aria-hidden="true"><span></span><i></i></div><p id="offline-progress-text" role="status" aria-live="polite">正在整理小店收益…</p><progress id="offline-progress" max="1" value="0" aria-label="离线收益整理进度"></progress><p class="detail-note">完成后安全到账，取消可稍后重试。</p><button id="offline-cancel" class="secondary-button">稍后再算</button></div>
      <div id="offline-result" hidden><div class="earnings-art" aria-hidden="true"><span></span><i></i></div><p id="offline-duration"></p><div class="earnings-reward"><span>本次到账</span><strong id="offline-deposited"></strong><small>已存入金库</small></div><button id="offline-done" class="primary-button">继续营业</button></div>
    </div>
  </dialog>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const dialog = $<HTMLDialogElement>("#operation-dialog");
const sceneAnchors: CoffeeSceneAnchor[] = [
  "counter-a-recipe", "counter-a-upgrade", "counter-b-recipe", "counter-b-upgrade",
  "menu-espresso", "menu-latte", "vault", "invite",
];
const anchorNames: Record<CoffeeSceneAnchor, string> = {
  "counter-a-recipe": "柜台 A 配方牌", "counter-a-upgrade": "柜台 A 升级牌",
  "counter-b-recipe": "柜台 B 配方牌", "counter-b-upgrade": "柜台 B 升级牌",
  "menu-espresso": "墙上浓缩咖啡菜单", "menu-latte": "墙上拿铁菜单",
  vault: "金库与收钱经理", invite: "入口招客牌",
};
let browserStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
try {
  browserStorage = window.localStorage;
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
const repository = new LocalSaveRepository(browserStorage);
const loadPerformance = performance.now();
const loaded = repository.load(Date.now(), { deferOffline: true });
const routeDiagnostics = isRouteQA(location.search) ? new RouteDiagnostics() : null;
let engine: SliceEngine = createEngine(loaded.state, routeDiagnostics?.observe);
const routePanel = routeDiagnostics ? new RouteQAPanel(root, routeDiagnostics, () => engine.state) : null;
let stopped = false,
  frame = 0,
  lastSave = Date.now(),
  hiddenAt: number | null = document.hidden ? Date.now() : null;
let renderMode: RenderMode = readRenderMode(browserStorage);
const renderBudget = new RenderBudget(loadPerformance, renderMode);
const presentation = new FrameInterpolator(engine.state);
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
let hasUsableState = ["new", "loaded", "settling", "conflict", "offline-save-failed"].includes(loaded.status);
// A valid old manual-pause save stays paused during repository offline settlement.
// This no-pause UI resumes only current play after verified load/new initialization.
if (conflictBlocked && !engine.state.paused) engine.togglePause();
else if (!conflictBlocked && engine.state.paused) engine.togglePause();
$("#reload").hidden = !saveBlocked;
$("#new-shop").hidden = !loaded.protectedRaw && loaded.status !== "missing";
let selected: CounterId = "counter-a";
let panel: "recipe" | "counter" | "coffee" | "vault" | "settings" | "files" | "offline" | null =
    null,
  viewedRecipe: RecipeId = "espresso";
let scene: CoffeeScene | null = null;
let qaContextLost = false;
let sceneInteractive = true;
let returnFocus: HTMLElement | null = null;
type OfflineRetry = { kind: "load" } | { kind: "hidden"; state: SliceState; hiddenAt: number };
let offlineJob: { pending: OfflineSettlement; controller: AbortController; started: number; lastObserved: number } | null = null;
let offlineRetry: OfflineRetry | null = null;
let resumeOfflineAfterHide = false;
let offlineReturnPanel: "recipe" | "counter" | "coffee" | "vault" | "settings" | "files" | null = null;
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
    if (!result.ok) $("#save-recovery").setAttribute("open", "");
    if (result.status === "conflict") blockConflict(result.message);
    if (manual)
      toast(
        result.ok
          ? "小店进度已保存到这个浏览器"
          : result.message || "保存失败，请导出备份",
      );
    return result;
  } catch {
    $("#save-status").textContent = "保存失败，请导出备份";
    $("#save-recovery").setAttribute("open", "");
    if (manual) toast("浏览器未允许保存，请导出存档备份");
  }
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
}
function showPanel(
  next: NonNullable<typeof panel>,
  id?: CounterId,
  recipe?: RecipeId,
) {
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
}
function sceneAction(action: CoffeeSceneAction) {
  if (stopped || dialog.open || offlineJob || fileReview) return;
  if (action.type === "invite") invite();
  else if (action.type === "counter") showPanel("counter", action.id);
  else if (action.type === "recipe") showPanel("recipe", action.id);
  else if (action.type === "menu")
    showPanel("coffee", undefined, action.recipe);
  else if (action.type === "vault") showPanel("vault");

}
try {
  scene = new CoffeeScene($("#coffee-canvas"), sceneAction, { renderMode });
} catch (err) {
  $("#render-error").hidden = false;
  $("#render-error").textContent =
    "此浏览器无法开启 3D。请用支持 WebGL 的 Safari、Chrome 或 Edge 打开。";
  console.error(err);
}
const performancePanel = routeDiagnostics ? new PerformanceQAPanel(root, () => {
  const stats = scene?.readRenderStats();
  const rect = canvas.getBoundingClientRect();
  const counts = { entering: 0, queue: 0, serving: 0, receiving: 0, leaving: 0 };
  for (const customer of engine.state.customers) counts[customer.phase]++;
  return [
    `mode ${renderMode} · target ${stats ? stats.targetFps ?? "display RAF" : "unavailable"} · visible=${!document.hidden} · focus=${document.hasFocus()}`,
    `viewport ${rect.width}×${rect.height} CSS · device DPR ${window.devicePixelRatio || 1} · buffer ${stats?.renderWidth ?? 0}×${stats?.renderHeight ?? 0} · effective DPR ${stats && rect.width ? (stats.renderWidth / rect.width).toFixed(2) : "—"}`,
    `customers ${engine.state.customers.length} ${JSON.stringify(counts)} · ${engine.state.counters.map(c => `${c.id} Lv${c.level}/${c.recipe}`).join(" · ")} · manager Lv${engine.state.manager.level}`,
    `scene meshes ${stats?.meshCount ?? 0} · submissions ${stats?.renderedFrames ?? 0} · core ${engine.state.elapsed.toFixed(2)}s · paused=${engine.state.paused} · dialog=${panel ?? "none"} · routePanel=${routePanel?.active}`,
  ].join("\n");
}) : null;
function invite() {
  if (fileReview || !settleVisibleTail()) return;
  if (conflictBlocked) { toast("请先完成存档恢复或离线结算，再继续营业"); return; }
  if (engine.invite()) toast("欢迎光临！客人正走进小店");
  else
    toast(
      engine.state.paused
        ? "存档冲突已暂停营业，请在设置中读取最新档"
        : "先让队伍往前走，再招呼下一位客人",
    );
  updateUI();
}
function upgrade(id: CounterId) {
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
        : "金库余额还不够，等经理再送一趟",
    );
  updateUI();
}
function changeRecipe(id: CounterId, recipe: RecipeId) {
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
  if (!button) return;
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
  } else if (button.dataset.selectRecipe && panel === "recipe" && dialog.open)
    changeRecipe(selected, button.dataset.selectRecipe as RecipeId);
  else if (button.dataset.focus) {
    closePanel();
    scene?.focusAnchor(button.dataset.focus as CoffeeSceneAnchor);
  }
});
on($("#settings"), "click", () => {
  if (stopped || dialog.open) return;
  showPanel("settings");
});
const canvas = $<HTMLCanvasElement>("#coffee-canvas");
on(canvas, "pointerdown", () => {
  if (!dialog.open) canvas.focus({ preventScroll: true });
});
on(canvas, "keydown", (event) => {
  const e = event as KeyboardEvent;
  if (stopped || dialog.open || !scene || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const key = scene.focusNext(e.key === "ArrowLeft" ? -1 : 1);
    if (key) toast(anchorNames[key]);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    scene.panBy(0, e.key === "ArrowUp" ? 80 : -80);
  } else if (e.key === "Home") {
    e.preventDefault();
    scene.focusAnchor("counter-a-recipe");
    toast(anchorNames["counter-a-recipe"]);
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
  if (returnFocus?.isConnected && !returnFocus.hidden &&
      returnFocus.matches("button,a,[tabindex]"))
    returnFocus.focus({ preventScroll: true });
  else canvas.focus({ preventScroll: true });
  returnFocus = null;
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
on($("#coffee-upgrade"), "click", () => {
  if (panel !== "coffee" || !dialog.open || fileReview || !settleVisibleTail()) return;
  if (conflictBlocked) {
    toast("先读取最新存档，再购买升级");
    return;
  }
  if (engine.upgradeCoffee(viewedRecipe)) {
    toast(`${recipeById[viewedRecipe].name}已升级`);
    save();
  }
  updateUI();
});
on($("#manager-upgrade"), "click", () => {
  if (fileReview || !settleVisibleTail()) return;
  if (conflictBlocked) {
    toast("先读取最新存档，再购买升级");
    return;
  }
  const q = engine.managerQuote();
  toast(
    engine.upgradeManager()
      ? "经理走得更快，下一趟收运更及时"
      : q.capped
        ? "经理已达到预览等级上限"
        : "金库余额还不够",
  );
  save();
  updateUI();
});
on($("#save"), "click", () => save(true));
function fileMessage(message: string) { $("#file-status").textContent = message; }
function coffeeLevelsSummary(state: SliceState): string {
  return `浓缩 Lv. ${state.coffeeLevels?.espresso ?? 1} · 拿铁 Lv. ${state.coffeeLevels?.latte ?? 1}`;
}
function summaryDetails(state: SliceState, savedAt?: number): string {
  const o = overviewOf(state);
  return `${savedAt === undefined ? "当前未存盘进度" : `时间 ${new Date(savedAt).toLocaleString()}`}\n金库 ${money(o.wallet)} · 营业额 ${money(o.totalEarned)} · 已售 ${o.totalServed} 杯\n柜台 A/B ${o.counterLevels.join(" / ")} 级 · 经理 ${o.managerLevel} 级\n${coffeeLevelsSummary(state)}\n待收 ${money(o.pendingCash)} · 运送 ${money(o.carrying)} · 经营 ${duration(o.elapsed)}`;
}
function summary(state: SliceState, savedAt?: number): string {
  const o = overviewOf(state);
  return `金库 ${money(o.wallet)}\n已售 ${o.totalServed} 杯\n柜台 ${o.counterLevels.join(" / ")} 级 · 经理 ${o.managerLevel} 级\n${coffeeLevelsSummary(state)}${savedAt === undefined ? "" : `\n${new Date(savedAt).toLocaleString()}`}`;
}
function updateFileControls() {
  const review = fileReview !== null;
  $("#file-output").hidden = !preparedFile;
  $("#file-prepare").toggleAttribute("disabled", fileBusy || review || saveBlocked || !hasUsableState);
  $("#file-download").toggleAttribute("disabled", !preparedFile || fileBusy || review);
  $("#file-share").toggleAttribute("disabled", !preparedFile || fileBusy || review);
  $("#file-input").toggleAttribute("disabled", !!offlineJob);
  $("#file-confirm").toggleAttribute("disabled", !review || fileBusy || !$<HTMLInputElement>("#file-other-tabs").checked);
  $("#file-review").hidden = !review;
  $("#file-backups").hidden = !repository.inspect().importBackupKey;
  $("#backup-live").toggleAttribute("disabled", fileBusy || review);
  $("#backup-original").toggleAttribute("disabled", fileBusy || review);
}
function cancelFileReview() {
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
  preparedFile = null;
  $("#file-export-summary").textContent = "";
  fileMessage("已备份并导入，小店可以继续营业了。导入前的文件间隔不补收益。");
  updateFileControls();
  $("#file-input").focus();
});
on($("#file-prepare"), "click", () => {
  if (fileBusy || fileReview || saveBlocked || !hasUsableState || stopped || document.hidden) return;
  const written = save();
  const durable = repository.durableSnapshot();
  // A failed save must not export an older revision as the current progress.
  if (!written?.ok || saveBlocked || !durable || JSON.stringify(durable.state) !== JSON.stringify(engine.snapshot()) || !durable.saveId || !durable.revision) { fileMessage("当前进度尚未安全保存。请重试保存，或返回设置导出当前恢复副本。"); return; }
  const generation = ++fileGeneration;
  fileBusy = true; preparedFile = null; updateFileControls();
  void createPortableSave({ gameSchemaVersion: 1, economyVersion: durable.state.economyVersion, offlinePolicyVersion: 3, saveId: durable.saveId, revision: durable.revision, savedAt: durable.savedAt, exportedAt: Date.now(), overview: overviewOf(durable.state), state: durable.state }).then(file => {
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
  void createPortableSave({ gameSchemaVersion: 1, economyVersion: backup.liveState.economyVersion, offlinePolicyVersion: 3, saveId: crypto.randomUUID(), revision: 1, savedAt: backup.createdAt, exportedAt: Date.now(), overview: overviewOf(backup.liveState), state: backup.liveState }).then(file => {
    if (generation !== fileGeneration || stopped || document.hidden || panel !== "files") return;
    preparedFile = file; fileBusy = false;
    $("#file-export-summary").textContent = `导入前进度\n${summary(file.payload.state, file.payload.savedAt)}`;
    fileMessage("导入前进度文件已准备好，请下载或分享。恢复时选择该文件并再次核对确认。"); updateFileControls();
  }).catch(() => { if (generation === fileGeneration && !stopped) { fileBusy = false; fileMessage("无法读取有效的导入前进度，原始备份仍保留。"); updateFileControls(); } });
});
function updateBackupControls() {
  const sourceProtected = repository.inspect().protectedRaw;
  $("#export").textContent = sourceProtected ? "导出原始档" : "导出备份";
  $("#export").toggleAttribute("disabled", !sourceProtected && !hasUsableState);
  $("#export-current").hidden = !sourceProtected || !hasUsableState;
  if (sourceProtected || saveBlocked) $("#save-recovery").setAttribute("open", "");
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
  cancelFileReview();
  cancelOfflineWork();
  saveBlocked = true;
  conflictBlocked = true;
  if (!engine.state.paused) engine.togglePause();
  $("#reload").hidden = false;
  $("#save-status").textContent = message;
  $("#save-recovery").setAttribute("open", "");
  toast(message);
  updateUI();
}
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
  routeDiagnostics?.reset(reason);
  performancePanel?.reset(reason);
  engine = createEngine(result.state, routeDiagnostics?.observe);
  hasUsableState = true;
  saveBlocked = conflictBlocked = false;
  if (engine.state.paused) engine.togglePause();
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
  if (!engine.state.paused) engine.togglePause();
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
  cancelOfflineWork();
  const result = repository.reset({ confirmProtected: true });
  if (!result.ok) {
    toast(result.message);
    return;
  }
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
  $("#render-mode-note").textContent = renderMode === "smooth"
    ? "高清画面，跟随屏幕刷新。"
    : renderMode === "clear-60"
      ? "相同清晰度，最高 60 帧，经营速度不变。"
    : renderMode === "balanced"
      ? "画面与耗电之间的平衡。"
      : "减少绘制，画面与动作会更简约。";
}
function updateUI() {
  const s = engine.state;
  const walletText = money(s.wallet);
  if ($("#wallet").textContent !== walletText) $("#wallet").textContent = walletText;
  if (panel === "recipe") {
    const c = s.counters.find((c) => c.id === selected)!;
    $("#dialog-eyebrow").textContent = `柜台 ${selected === "counter-a" ? "A" : "B"} · Lv. ${c.level}`;
    $("#dialog-title").textContent = "选择咖啡";
    $("#dialog-description").textContent = "";
    $("#counter-affinity").textContent = selected === "counter-a" ? "浓缩时长 −25%" : "拿铁杯价 +12%";
    root.querySelectorAll<HTMLButtonElement>("[data-select-recipe]").forEach((b) => {
      const recipe = b.dataset.selectRecipe as RecipeId;
      b.classList.toggle("active", recipe === c.recipe);
      b.setAttribute("aria-pressed", String(recipe === c.recipe));
      b.disabled = conflictBlocked;
      $(`#recipe-${recipe}-stats`).textContent = `${money(counterPrice(recipe, c.level, c.id, s.coffeeLevels[recipe]))} · ${counterBrewSeconds(recipe, c.level, c.id, s.coffeeLevels[recipe]).toFixed(2)} 秒`;
    });
  } else if (panel === "counter") {
    const c = s.counters.find((c) => c.id === selected)!, q = engine.quote(selected);
    $("#dialog-eyebrow").textContent = `柜台 ${selected === "counter-a" ? "A" : "B"}`;
    $("#dialog-title").textContent = "升级柜台";
    $("#dialog-description").textContent = "";
    $("#counter-coffee").textContent = recipeById[c.recipe].name;
    $("#counter-level").textContent = `Lv. ${c.level}${q.capped ? " · MAX" : ` → ${c.level + 1}`}`;
    $("#counter-next-price").textContent = q.capped ? "已达上限" : `→ ${money(q.afterPrice)}`;
    $("#counter-next-seconds").textContent = q.capped ? "已达上限" : `→ ${q.afterSeconds.toFixed(2)} 秒`;
    $("#counter-funds").textContent = conflictBlocked ? "请先恢复存档" : q.capped ? "" : s.wallet < q.cost ? `还差 ${money(q.cost - s.wallet)}` : "";
    $("#counter-price").textContent = money(q.beforePrice);
    $("#counter-seconds").textContent = `${q.beforeSeconds.toFixed(2)} 秒`;
    $("#counter-upgrade").textContent = q.capped ? "已满级" : `升级柜台 · ${money(q.cost)}`;
    $("#counter-upgrade").toggleAttribute("disabled", q.capped || s.wallet < q.cost || conflictBlocked);
  } else if (panel === "coffee") {
    const r = recipeById[viewedRecipe], q = engine.coffeeQuote(viewedRecipe);
    $("#dialog-eyebrow").textContent = "咖啡";
    $("#dialog-title").textContent = r.name;
    $("#dialog-description").textContent = "";
    $("#coffee-level").textContent = `Lv. ${q.level}${q.capped ? " · MAX" : ` → ${q.nextLevel}`}`;
    $("#coffee-price").textContent = money(q.beforePrice);
    $("#coffee-seconds").textContent = `${q.beforeSeconds.toFixed(2)} 秒`;
    $("#coffee-next-price").textContent = q.capped ? "已达上限" : `→ ${money(q.afterPrice)}`;
    $("#coffee-next-seconds").textContent = q.capped ? "已达上限" : `→ ${q.afterSeconds.toFixed(2)} 秒`;
    $("#coffee-upgrade").textContent = q.capped ? "已满级" : `升级咖啡 · ${money(q.cost)}`;
    $("#coffee-upgrade").toggleAttribute("disabled", q.capped || s.wallet < q.cost || conflictBlocked);
    $("#coffee-funds").textContent = conflictBlocked ? "请先恢复存档" : q.capped ? "" : s.wallet < q.cost ? `还差 ${money(q.cost - s.wallet)}` : "";
    $("#coffee-symbol").style.background = r.color;
  } else if (panel === "vault") {
    $("#dialog-eyebrow").textContent = "WALL VAULT";
    $("#dialog-title").textContent = "小店金库";
    $("#dialog-description").textContent = "经理送回后，现金才正式到账";
    $("#vault-total").textContent = `${money(s.wallet)}`;
    $("#pending").textContent =
      `${money(s.counters.reduce((n, c) => n + c.pendingCash, 0))}`;
    $("#carrying").textContent = `${money(s.manager.carrying)}`;
    $("#served").textContent = `已送出 ${s.totalServed} 杯香气`;
    const q = engine.managerQuote();
    $("#manager-rank").textContent = `Lv. ${s.manager.level}`;
    $("#manager-speed").textContent = `${Math.round(q.speed / managerSpeed(1) * 100)}%`;
    $("#manager-status").textContent =
      s.manager.phase === "depositing"
        ? "正在金库存入现金"
        : s.manager.phase === "collecting"
          ? "正在柜台收钱"
          : "正在后方通道收运";
    $("#manager-preview").textContent = q.capped
      ? "经理已满级"
      : `→ ${Math.round(q.nextSpeed / managerSpeed(1) * 100)}% · 容量提升`;
    $("#manager-funds").textContent = conflictBlocked ? "请先恢复存档" : q.capped ? "" : s.wallet < q.cost ? `还差 ${money(q.cost - s.wallet)}` : "";
    $("#manager-upgrade").textContent = q.capped
      ? "已满级"
      : `升级经理 · ${money(q.cost)}`;
    $("#manager-upgrade").toggleAttribute(
      "disabled",
      q.capped || s.wallet < q.cost || conflictBlocked,
    );
  } else if (panel === "offline") {
    $("#dialog-eyebrow").textContent = "WELCOME BACK";
    $("#dialog-title").textContent = offlineJob ? "小店忙碌了一会儿" : "欢迎回来";
    $("#dialog-description").textContent = offlineJob ? "正在把收益装进口袋" : "你不在的时候，咖啡依然飘香";
  } else if (panel === "files") {
    $("#dialog-eyebrow").textContent = "COFFEE TO GO";
    $("#dialog-title").textContent = "小店存档";
    $("#dialog-description").textContent = "把喜欢的小店，带在身边";
  } else if (panel === "settings") {
    $("#dialog-eyebrow").textContent = "MELLOW BEAN";
    $("#dialog-title").textContent = "小店设置";
    $("#dialog-description").textContent = "给小店调个舒服的节奏";
    if (saveBlocked) $("#save-recovery").setAttribute("open", "");
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
  const view = presentation.advance(engine, fileReview ? 0 : Math.max(0, dt));
  scene?.update(view, dt);
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
  if (saveBlocked || offlineJob || fileReview) return true;
  if (Math.max(0, seconds - verifiedForegroundSeconds) > LONG_FOREGROUND_GAP_SECONDS + 1e-6) {
    blockConflict(UNCLASSIFIED_TIME_MESSAGE);
    return false;
  }
  verifiedForegroundSeconds = Math.max(0, verifiedForegroundSeconds - seconds);
  return true;
}
function settleVisibleTail(): boolean {
  if (hiddenAt !== null || saveBlocked || offlineJob || fileReview) return true;
  const seconds = renderBudget.flush(performance.now());
  if (!allowVisibleTime(seconds)) return false;
  engine.advance(seconds);
  return true;
}
function suspendVisible() {
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
  cancelFileReview();
  cancelOfflineWork();
  if (persist) { settleVisibleTail(); save(false, hiddenAt ?? Date.now()); }
  stopped = true;
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
      readPerformance: () => performancePanel?.read(),
      readFootprints: () => Object.fromEntries(sceneAnchors.map((key) => [key, scene?.getAnchorFootprint(key)])),
      readAnchors: () =>
        Object.fromEntries(
          sceneAnchors.map((key) => [key, scene?.projectAnchor(key)]),
        ),
    },
    configurable: true,
  });
updateRenderModeUI();
updateBackupControls();
updateUI();
frame = requestAnimationFrame(tick);
if (loaded.status === "settling") handleLoad(loaded, { kind: "load" }, loadPerformance, "startup");
else if (loaded.status === "loaded") showOfflineResult(loaded);
if (loaded.message && loaded.status !== "new" && loaded.status !== "loaded" && loaded.status !== "settling")
  toast(loaded.message);
if (saveBlocked) $("#save-status").textContent = loaded.message;
if (import.meta.hot) import.meta.hot.dispose(() => cleanup());
