import { createEngine, recipeById } from "./core/engine";
import { LocalSaveRepository, SAVE_KEY } from "./core/persistence";
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
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#slice-root")!;
root.innerHTML = `
<main class="coffee-world" aria-label="Mellow Bean 全屏咖啡店">
  <canvas id="coffee-canvas" tabindex="0" aria-label="Mellow Bean 店铺场景" aria-describedby="scene-instructions"></canvas>
  <p id="scene-instructions" class="sr-only">拖动逛店，点击墙上的咖啡菜单、金库、营业牌或设置牌，以及柜台配方牌、升级牌和经理推车。键盘左右箭头选择店内物件，上下箭头平移，Enter 或空格操作，Home 返回柜台 A。</p>
  <header class="hud" aria-label="当前金额"><div class="wallet-chip"><strong id="wallet">¥0.00</strong></div></header>
  <div id="render-error" class="render-error" hidden></div>
  <dialog id="operation-dialog" class="operation-dialog" aria-labelledby="dialog-title">
    <button id="dialog-close" class="dialog-close" aria-label="关闭操作窗口">×</button>
    <div class="dialog-heading"><span class="dialog-eyebrow" id="dialog-eyebrow">MELLOW BEAN</span><h1 id="dialog-title"></h1><p id="dialog-description"></p></div>
    <div id="counter-panel" class="operation-panel" hidden>
      <div class="recipe-picker" aria-label="柜台咖啡配方"><button data-select-recipe="espresso">浓缩咖啡<small>出杯快</small></button><button data-select-recipe="latte">拿铁<small>杯价高</small></button></div>
      <p id="counter-affinity" class="detail-note"></p><div class="detail-grid"><span>当前杯价<strong id="counter-price"></strong></span><span>制作时间<strong id="counter-seconds"></strong></span></div>
      <div class="upgrade-preview"><span id="counter-preview"></span><small id="counter-payback"></small></div><button id="counter-upgrade" class="primary-button"></button>
    </div>
    <div id="coffee-panel" class="operation-panel" hidden><div class="coffee-medallion" id="coffee-symbol" aria-hidden="true">☕</div><p id="coffee-detail"></p><p class="detail-note">两款配方已解锁。分配到柜台后，下一杯开始生效。</p><div class="assign-buttons"><button data-assign="counter-a">供给柜台 A</button><button data-assign="counter-b">供给柜台 B</button></div></div>
    <div id="vault-panel" class="operation-panel" hidden><div class="vault-total"><span>已存入金库</span><strong id="vault-total"></strong></div><div class="detail-grid"><span>台面待收<strong id="pending"></strong></span><span>经理运送<strong id="carrying"></strong></span></div><p class="detail-note">钱留在台面，再由经理沿后方通道送回。送到金库才可用于升级。</p><p id="served" class="detail-note"></p><button class="secondary-button" data-open-manager>查看收钱经理</button></div>
    <div id="manager-panel" class="operation-panel" hidden><div class="detail-grid"><span>收运等级<strong id="manager-rank"></strong></span><span>走路速度<strong id="manager-speed"></strong></span></div><p id="manager-status" class="detail-note"></p><p id="manager-preview"></p><button id="manager-upgrade" class="primary-button"></button></div>
    <div id="settings-panel" class="operation-panel" hidden><p id="save-status" class="save-status">本地自动保存</p><p class="detail-note">当前只保存到本浏览器，iCloud 尚未配置。</p><div class="settings-grid"><button id="save">保存进度</button><button id="export">导出备份</button><button id="reload" hidden>读取最新档</button><button id="new-shop" hidden>备份并开始新店</button></div><p class="settings-label">逛逛小店</p><div class="jump-grid"><button data-focus="counter-a-recipe">柜台 A</button><button data-focus="counter-b-recipe">柜台 B</button><button data-focus="menu-espresso">咖啡墙</button><button data-focus="vault">金库</button><button data-focus="invite">入口</button><button data-focus="pause">营业牌</button><button data-focus="settings">设置牌</button></div><details><summary>怎么玩</summary><p>客人会自动进入、排队和取杯，入口也能招呼客人。柜台升级更快更值钱，经理升级提高收运。点柜台上的配方牌换咖啡，墙上菜单能查看配方或分配到柜台。制作中的那一杯不会被追改。</p><p>点击墙上营业牌可以暂停或继续。暂停冻结营业。离线收益最多结算 2 小时，且只结算一次。此版本没有真实跨设备同步。</p></details></div>
  </dialog>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const dialog = $<HTMLDialogElement>("#operation-dialog");
const sceneAnchors: CoffeeSceneAnchor[] = [
  "counter-a-recipe", "counter-a-upgrade", "counter-b-recipe", "counter-b-upgrade",
  "menu-espresso", "menu-latte", "vault", "manager", "invite", "pause", "settings",
];
const anchorNames: Record<CoffeeSceneAnchor, string> = {
  "counter-a-recipe": "柜台 A 配方牌", "counter-a-upgrade": "柜台 A 升级牌",
  "counter-b-recipe": "柜台 B 配方牌", "counter-b-upgrade": "柜台 B 升级牌",
  "menu-espresso": "墙上浓缩咖啡菜单", "menu-latte": "墙上拿铁菜单",
  vault: "墙上金库", manager: "收钱经理推车", invite: "入口招客牌",
  pause: "墙上营业牌", settings: "墙上设置牌",
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
const loaded = repository.load(Date.now());
let engine: SliceEngine = createEngine(loaded.state);
let stopped = false,
  last = performance.now(),
  frame = 0,
  lastSave = Date.now(),
  hiddenAt: number | null = document.hidden ? Date.now() : null;
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
let saveBlocked =
  loaded.protectedRaw ||
  loaded.status === "conflict" ||
  loaded.status === "offline-save-failed";
let conflictBlocked =
  loaded.status === "conflict" || loaded.status === "offline-save-failed";
if (conflictBlocked && !engine.state.paused) engine.togglePause();
$("#reload").hidden = !conflictBlocked;
$("#new-shop").hidden = !loaded.protectedRaw;
let selected: CounterId = "counter-a";
let panel: "counter" | "coffee" | "vault" | "manager" | "settings" | null =
    null,
  viewedRecipe: RecipeId = "espresso";
let scene: CoffeeScene | null = null;
let sceneInteractive = true;
let returnFocus: HTMLElement | null = null;
function toast(message: string) {
  if (stopped) return;
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function save(manual = false, saveAt = Date.now()) {
  if (saveBlocked) {
    if (manual)
      toast(
        conflictBlocked
          ? "存档发生变化，请先导出当前副本或读取最新档。"
          : "已有存档无法安全读取，已保留原始内容；请先导出备份。",
      );
    return;
  }
  try {
    const result = repository.save(engine.snapshot(), saveAt);
    $("#save-status").textContent = result.ok
      ? "本地已保存"
      : "保存失败，请导出备份";
    lastSave = Date.now();
    if (result.status === "conflict") blockConflict(result.message);
    if (manual)
      toast(
        result.ok
          ? "小店进度已保存到这个浏览器"
          : result.message || "保存失败，请导出备份",
      );
  } catch {
    $("#save-status").textContent = "保存失败，请导出备份";
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
  if (stopped || dialog.open) return;
  if (action.type === "invite") invite();
  else if (action.type === "counter" || action.type === "recipe")
    showPanel("counter", action.id);
  else if (action.type === "menu")
    showPanel("coffee", undefined, action.recipe);
  else if (action.type === "vault") showPanel("vault");
  else if (action.type === "manager") showPanel("manager");
  else if (action.type === "settings") showPanel("settings");
  else if (action.type === "pause") togglePause();
}
try {
  scene = new CoffeeScene($("#coffee-canvas"), sceneAction);
} catch (err) {
  $("#render-error").hidden = false;
  $("#render-error").textContent =
    "此浏览器无法开启 3D。请用支持 WebGL 的 Safari、Chrome 或 Edge 打开。";
  console.error(err);
}
function invite() {
  if (engine.invite()) toast("欢迎光临！客人正走进小店");
  else
    toast(
      engine.state.paused
        ? "继续营业后再招呼客人"
        : "先让队伍往前走，再招呼下一位客人",
    );
  updateUI();
}
function upgrade(id: CounterId) {
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
  if (button.dataset.selectRecipe)
    changeRecipe(selected, button.dataset.selectRecipe as RecipeId);
  else if (button.dataset.assign) {
    const id = button.dataset.assign as CounterId;
    changeRecipe(id, viewedRecipe);
    closePanel();
    scene?.focusAnchor(`${id}-recipe`);
    scene?.selectedCounter(id);
  } else if (button.dataset.focus) {
    closePanel();
    scene?.focusAnchor(button.dataset.focus as CoffeeSceneAnchor);
  } else if (button.hasAttribute("data-open-manager")) showPanel("manager");
});
function togglePause() {
  if (conflictBlocked) {
    toast("先读取最新存档，再继续营业");
    return;
  }
  engine.togglePause();
  last = performance.now();
  save();
  updateUI();
  toast(engine.state.paused ? "小店休息中，点击营业牌继续" : "小店继续营业");
}
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
on(dialog, "close", () => {
  // Ignore an older queued close when another scene action has reopened it.
  if (dialog.open) return;
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
on($("#counter-upgrade"), "click", () => upgrade(selected));
on($("#manager-upgrade"), "click", () => {
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
on($("#export"), "click", () => {
  try {
    const bytes =
      saveBlocked && !conflictBlocked
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
    a.download = "mellow-bean-local-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("存档备份已导出");
  } catch {
    toast("备份无法导出，请检查浏览器下载权限");
  }
});
function blockConflict(message: string) {
  saveBlocked = true;
  conflictBlocked = true;
  if (!engine.state.paused) engine.togglePause();
  $("#reload").hidden = false;
  $("#save-status").textContent = "存档已变化，请读取最新档";
  toast(message);
  updateUI();
}
on(window, "storage", (event) => {
  const e = event as StorageEvent;
  if (e.key === SAVE_KEY && e.newValue !== repository.inspect().rawText)
    blockConflict("另一个窗口更新了小店。已暂停，避免覆盖它的进度。");
});
on($("#reload"), "click", () => {
  if (
    !window.confirm(
      "读取最新存档会放弃本窗口未保存的进度。可以先导出当前副本。继续吗？",
    )
  )
    return;
  const recovered = repository.load(Date.now());
  engine = createEngine(recovered.state);
  saveBlocked =
    recovered.protectedRaw ||
    recovered.status === "conflict" ||
    recovered.status === "offline-save-failed";
  conflictBlocked =
    recovered.status === "conflict" ||
    recovered.status === "offline-save-failed";
  if (conflictBlocked && !engine.state.paused) engine.togglePause();
  $("#reload").hidden = !conflictBlocked;
  $("#new-shop").hidden = !recovered.protectedRaw;
  $("#save-status").textContent = saveBlocked
    ? "已有存档已保留，自动保存暂停"
    : "本地存档已恢复";
  last = performance.now();
  toast(recovered.message);
  updateUI();
});
on($("#new-shop"), "click", () => {
  if (
    !window.confirm(
      "会先保留旧存档的完整本地备份，再开始一个新店。建议先导出备份。继续吗？",
    )
  )
    return;
  const result = repository.reset({ confirmProtected: true });
  if (!result.ok) {
    toast(result.message);
    return;
  }
  engine = createEngine();
  saveBlocked = false;
  conflictBlocked = false;
  $("#new-shop").hidden = true;
  $("#reload").hidden = true;
  save();
  updateUI();
  toast("旧存档已本地备份，新店开始营业");
});
function updateUI() {
  const s = engine.state;
  $("#wallet").textContent = money(s.wallet);
  if (panel === "counter") {
    const c = s.counters.find((c) => c.id === selected)!,
      q = engine.quote(selected);
    $("#dialog-eyebrow").textContent =
      `COUNTER ${selected === "counter-a" ? "A" : "B"} · Lv. ${c.level}`;
    $("#dialog-title").textContent =
      selected === "counter-a" ? "街角快饮" : "柔奶时光";
    $("#dialog-description").textContent = c.brew
      ? "当前杯继续制作；选择从下一杯开始生效"
      : "选择咖啡，或者提升这个柜台";
    $("#counter-affinity").textContent =
      selected === "counter-a"
        ? "柜台擅长：浓缩制作快 25%"
        : "柜台擅长：拿铁售价高 12%";
    $("#counter-price").textContent = `${money(q.beforePrice)}`;
    $("#counter-seconds").textContent = `${q.beforeSeconds.toFixed(1)} 秒`;
    $("#counter-preview").textContent = q.capped
      ? "柜台已满级"
      : `下一级 ${money(q.afterPrice)} / ${q.afterSeconds.toFixed(1)} 秒`;
    $("#counter-payback").textContent = q.capped
      ? "更多经营内容还在路上"
      : `满负荷增量回本约 ${Math.ceil(q.paybackSeconds)} 秒`;
    $("#counter-upgrade").textContent = q.capped
      ? "已满级"
      : `升级柜台 · ${money(q.cost)}`;
    $("#counter-upgrade").toggleAttribute(
      "disabled",
      q.capped || s.wallet < q.cost || conflictBlocked,
    );
    root
      .querySelectorAll<HTMLButtonElement>("[data-select-recipe]")
      .forEach((b) => {
        b.classList.toggle("active", b.dataset.selectRecipe === c.recipe);
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.selectRecipe === c.recipe),
        );
        b.disabled = conflictBlocked;
      });
  } else if (panel === "coffee") {
    const r = recipeById[viewedRecipe];
    $("#dialog-eyebrow").textContent = "COFFEE WALL · 已解锁";
    $("#dialog-title").textContent = r.name;
    $("#dialog-description").textContent = "墙上的咖啡菜单";
    $("#coffee-detail").textContent =
      `${r.description} 基础杯价 ${money(r.price)}，制作 ${r.brewSeconds.toFixed(1)} 秒。`;
    $("#coffee-symbol").style.background = r.color;
    root
      .querySelectorAll<HTMLButtonElement>("[data-assign]")
      .forEach((b) => (b.disabled = conflictBlocked));
  } else if (panel === "vault") {
    $("#dialog-eyebrow").textContent = "WALL VAULT";
    $("#dialog-title").textContent = "小店金库";
    $("#dialog-description").textContent = "经理送回后，现金才正式到账";
    $("#vault-total").textContent = `${money(s.wallet)}`;
    $("#pending").textContent =
      `${money(s.counters.reduce((n, c) => n + c.pendingCash, 0))}`;
    $("#carrying").textContent = `${money(s.manager.carrying)}`;
    $("#served").textContent = `这间小店已卖出 ${s.totalServed} 杯咖啡`;
  } else if (panel === "manager") {
    const q = engine.managerQuote();
    $("#dialog-eyebrow").textContent = "CASH MANAGER";
    $("#dialog-title").textContent = "收钱经理";
    $("#dialog-description").textContent = "沿柜台后方收钱，再送回墙上金库";
    $("#manager-rank").textContent = `Lv. ${s.manager.level}`;
    $("#manager-speed").textContent = `${q.speed.toFixed(2)} 米/秒`;
    $("#manager-status").textContent =
      s.manager.phase === "depositing"
        ? "正在金库存入现金"
        : s.manager.phase === "collecting"
          ? "正在柜台收钱"
          : "正在后方通道收运";
    $("#manager-preview").textContent = q.capped
      ? "经理已满级"
      : `下一级走路速度 ${q.nextSpeed.toFixed(2)} 米/秒，收运容量也会提升。`;
    $("#manager-upgrade").textContent = q.capped
      ? "已满级"
      : `升级经理 · ${money(q.cost)}`;
    $("#manager-upgrade").toggleAttribute(
      "disabled",
      q.capped || s.wallet < q.cost || conflictBlocked,
    );
  } else if (panel === "settings") {
    $("#dialog-eyebrow").textContent = "MELLOW BEAN";
    $("#dialog-title").textContent = "小店设置";
    $("#dialog-description").textContent = "本地保存与逛店导航";
  }
}
let hudElapsed = 0;
function tick(now: number) {
  if (stopped || document.hidden) return;
  const dt = Math.min((now - last) / 1000, 7200);
  last = now;
  engine.advance(Math.max(0, dt));
  scene?.update(engine.state, dt);
  hudElapsed += dt;
  if (hudElapsed >= 0.15) {
    hudElapsed = 0;
    updateUI();
  }
  engine.drainEvents();
  if (Date.now() - lastSave > 8000) save();
  frame = requestAnimationFrame(tick);
}
function resumeVisible() {
  if (stopped || document.hidden) return;
  cancelAnimationFrame(frame);
  if (hiddenAt !== null) {
    const start = hiddenAt;
    hiddenAt = null;
    const secs = Math.max(0, (Date.now() - start) / 1000);
    if (secs >= 30) {
      const result = engine.applyOffline(secs, `hidden-${start}`);
      if (result.accepted && result.amount > 0)
        toast(`欢迎回来！离线经营存入 ${money(result.amount)}`);
    } else engine.advance(secs);
    save();
  }
  last = performance.now();
  scene?.resize();
  frame = requestAnimationFrame(tick);
}
function onVisibility() {
  cancelAnimationFrame(frame);
  if (document.hidden) {
    hiddenAt ??= Date.now();
    save(false, hiddenAt);
  } else resumeVisible();
}
function onPageHide(event: Event) {
  cancelAnimationFrame(frame);
  hiddenAt ??= Date.now();
  save(false, hiddenAt);
  if (!(event as PageTransitionEvent).persisted) cleanup(false);
}
const sizeObserver =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => {
        scene?.resize();
      })
    : null;
sizeObserver?.observe($("#coffee-canvas"));
on(window, "resize", () => {
  scene?.resize();
});
const visualViewport = window.visualViewport;
if (visualViewport)
  on(visualViewport, "resize", () => {
    scene?.resize();
  });
function cleanup(persist = true) {
  if (stopped) return;
  if (persist) save(false, hiddenAt ?? Date.now());
  stopped = true;
  cancelAnimationFrame(frame);
  if (toastTimer) clearTimeout(toastTimer);
  listeners.abort();
  sizeObserver?.disconnect();
  scene?.dispose();
}
on(document, "visibilitychange", onVisibility);
on(window, "pagehide", onPageHide);
on(window, "pageshow", (event) => {
  if ((event as PageTransitionEvent).persisted) resumeVisible();
});
if (new URLSearchParams(location.search).has("qa"))
  Object.defineProperty(window, "__coffeeSliceDebug", {
    value: {
      readState: (): SliceState => engine.snapshot(),
      selected: () => selected,
      focusedObject: () => scene?.getFocus(),
      readFootprints: () => Object.fromEntries(sceneAnchors.map((key) => [key, scene?.getAnchorFootprint(key)])),
      readAnchors: () =>
        Object.fromEntries(
          sceneAnchors.map((key) => [key, scene?.projectAnchor(key)]),
        ),
    },
    configurable: true,
  });
updateUI();
frame = requestAnimationFrame(tick);
if (loaded.message && loaded.status !== "new" && loaded.status !== "loaded")
  toast(loaded.message);
if (saveBlocked)
  $("#save-status").textContent = conflictBlocked
    ? "存档已变化，请读取最新档"
    : "旧存档已保留，自动保存暂停";
else if (loaded.status === "unavailable")
  $("#save-status").textContent = "浏览器保存不可用，请导出备份";
if (import.meta.hot) import.meta.hot.dispose(() => cleanup());
