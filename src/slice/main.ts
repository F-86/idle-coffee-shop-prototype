import { createEngine, recipeById } from "./core/engine";
import { LocalSaveRepository, SAVE_KEY } from "./core/persistence";
import type {
  CounterId,
  RecipeId,
  SliceEngine,
  SliceState,
} from "./core/types";
import { CoffeeScene } from "./render/CoffeeScene";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#slice-root")!;
root.innerHTML = `
  <main class="coffee-app">
    <header class="topbar">
      <a class="brand" href="./index.html" aria-label="Mellow Bean 小店"><span class="bean-logo">m</span><span>MELLOW BEAN<small>一间慢慢长大的咖啡店</small></span></a>
      <div class="wallet"><span>金库余额</span><strong id="wallet">0.00</strong><small>枚咖啡币</small></div>
      <div class="top-actions"><span class="local-badge" title="此版本只在当前浏览器保存；iCloud 尚未配置">本地存档</span><button id="pause" class="icon-button" aria-label="暂停营业">Ⅱ</button></div>
    </header>
    <section class="shop-shell" aria-label="咖啡店 3D 场景">
      <div class="scene-caption"><span class="open-dot"></span><span id="open-status">小店营业中</span><span class="scene-pan-hint">左右滑动逛逛小店 ↔</span></div>
      <div class="world-scroll" id="world-scroll"><canvas id="coffee-canvas" aria-label="可点击入口招客、菜单换配方、柜台等级牌升级的斜俯视咖啡店"></canvas></div>
      <div class="scene-bottom"><span id="journey">顾客入店 → 咖啡出杯 → 经理收钱 → 金库到账</span><button class="invite-button" id="invite">＋ 招呼客人<span>入口也可以点</span></button></div>
      <div id="render-error" class="render-error" hidden></div>
    </section>
    <section class="store-metrics" aria-label="经营状态"><span>已售 <strong id="served">0</strong> 杯</span><span>台面待收 <strong id="pending">0.00</strong></span><span>经理运送 <strong id="carrying">0.00</strong></span><span class="metric-note" id="bottleneck">收入抵达金库后可升级</span></section>
    <section class="counter-grid" aria-label="柜台经营操作">
      ${(["counter-a", "counter-b"] as const).map((id, i) => `<article class="counter-card" id="card-${id}" data-counter="${id}"><div class="card-heading"><span class="counter-number">0${i + 1}</span><div><h2>${i === 0 ? "街角快饮" : "柔奶时光"}</h2><p id="level-${id}">Lv. 1 · 研磨中</p></div><span class="recipe-symbol" id="symbol-${id}">☕</span></div><div class="recipe-choice" aria-label="${i === 0 ? "街角快饮" : "柔奶时光"}配方">${["espresso", "latte"].map((r) => `<button data-recipe="${r}" data-id="${id}" aria-pressed="false">${r === "espresso" ? "浓缩咖啡" : "拿铁"}</button>`).join("")}</div><p class="affinity" id="affinity-${id}"></p><p class="recipe-detail" id="detail-${id}"></p><div class="upgrade-row"><div><strong id="gain-${id}"></strong><small id="payback-${id}"></small></div><button class="upgrade-button" data-upgrade="${id}">升级 <span id="cost-${id}"></span></button></div></article>`).join("")}
    </section>
    <footer class="store-footer"><div class="manager-upgrade"><span class="manager-icon">♟</span><span><strong>收钱经理</strong><small id="manager-status">沿柜台后方收钱，再送回金库</small></span><button id="manager-upgrade">升级 <span id="manager-cost"></span></button></div><div class="save-controls"><span id="save-status">本地自动保存</span><button id="save">保存</button><button id="export">导出存档</button><button id="reload" hidden>读取最新档</button><button id="new-shop" hidden>开始新店</button><button id="help">玩法</button></div></footer>
    <dialog id="help-dialog"><button class="dialog-close" aria-label="关闭玩法">×</button><p class="eyebrow">MELLOW BEAN · 简易方向预览</p><h2>让小店自己忙起来</h2><p>客人会自动来，也能点入口招呼。柜台制作咖啡、客人取杯后，现金留在台上。经理在后方收运，回到左边金库才到账。</p><p>浓缩出杯快，拿铁杯价高。切换配方和升级都不追改正在制作的那一杯。试着让两条队伍都忙起来。</p><p>这个预览只有两个柜台。本地存档独立保存，离线收益最多结算 2 小时；iCloud 接口已预留，真实同步尚未配置。</p><button class="primary-button dialog-close">继续营业</button></dialog>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </main>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
const money = (cents: number) => (cents / 100).toFixed(2);
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
    if (result.status === "conflict") {
      blockConflict(result.message);
    }
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
function selectCounter(id: CounterId, scroll = true) {
  selected = id;
  scene?.selectedCounter(id);
  root
    .querySelectorAll(".counter-card")
    .forEach((el) =>
      el.classList.toggle("selected", el.getAttribute("data-counter") === id),
    );
  if (scroll)
    $("#card-" + id).scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
}
let scene: CoffeeScene | null = null;
try {
  scene = new CoffeeScene($("#coffee-canvas"), (action) => {
    if (action.type === "invite") {
      invite();
    } else if (action.type === "counter") {
      selectCounter(action.id);
      upgrade(action.id);
    } else {
      selectCounter(action.id);
      const c = engine.state.counters.find((c) => c.id === action.id)!;
      changeRecipe(action.id, c.recipe === "espresso" ? "latte" : "espresso");
    }
  });
} catch (err) {
  $("#render-error").hidden = false;
  $("#render-error").textContent =
    "此浏览器无法开启 3D。请用支持 WebGL 的 Safari、Chrome 或 Edge 打开。";
  console.error(err);
}
function invite() {
  if (engine.invite()) {
    toast("欢迎光临！客人正走进小店");
  } else {
    toast("先让队伍往前走，再招呼下一位客人");
  }
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
on(root, "click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.upgrade) {
    upgrade(button.dataset.upgrade as CounterId);
  }
  if (button.dataset.recipe) {
    changeRecipe(
      button.dataset.id as CounterId,
      button.dataset.recipe as RecipeId,
    );
  }
});
on($("#invite"), "click", invite);
on($("#pause"), "click", () => {
  if (conflictBlocked) {
    toast("先读取最新存档，再继续营业");
    return;
  }
  engine.togglePause();
  last = performance.now();
  save();
  updateUI();
});
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
const dialog = $<HTMLDialogElement>("#help-dialog");
on($("#help"), "click", () => dialog.showModal());
dialog
  .querySelectorAll(".dialog-close")
  .forEach((el) => on(el, "click", () => dialog.close()));
on(dialog, "click", (e) => {
  if (e.target === dialog) dialog.close();
});
function updateUI() {
  const s = engine.state;
  $("#wallet").textContent = money(s.wallet);
  $("#served").textContent = String(s.totalServed);
  $("#pending").textContent = money(
    s.counters.reduce((n, c) => n + c.pendingCash, 0),
  );
  $("#carrying").textContent = money(s.manager.carrying);
  $("#open-status").textContent = s.paused ? "小店休息中" : "小店营业中";
  $("#pause").textContent = s.paused ? "▶" : "Ⅱ";
  $("#pause").setAttribute("aria-label", s.paused ? "继续营业" : "暂停营业");
  $("#invite").toggleAttribute("disabled", s.paused || s.inviteCooldown > 0);
  for (const c of s.counters) {
    const q = engine.quote(c.id),
      r = recipeById[c.recipe];
    $("#affinity-" + c.id).textContent =
      c.id === "counter-a"
        ? "柜台擅长：浓缩制作快 25%"
        : "柜台擅长：拿铁售价高 12%";
    $("#level-" + c.id).textContent =
      `Lv. ${c.level} · ${c.brew ? "咖啡制作中" : "等候下一位"}`;
    $("#symbol-" + c.id).style.background = r.color;
    $("#detail-" + c.id).textContent =
      `${r.description} · 每杯 ${money(q.beforePrice)} 币 · ${q.beforeSeconds.toFixed(1)} 秒`;
    $("#gain-" + c.id).textContent = q.capped
      ? "柜台已满级"
      : `下一等级 ${money(q.afterPrice)} 币 / ${q.afterSeconds.toFixed(1)} 秒`;
    $("#payback-" + c.id).textContent = q.capped
      ? "更多经营内容还在路上"
      : `满负荷增量回本约 ${Math.ceil(q.paybackSeconds)} 秒`;
    $("#cost-" + c.id).textContent = q.capped ? "已满级" : money(q.cost);
    const b = root.querySelector<HTMLButtonElement>(
      `[data-upgrade="${c.id}"]`,
    )!;
    b.disabled = q.capped || s.wallet < q.cost;
    root
      .querySelectorAll<HTMLButtonElement>(`[data-id="${c.id}"]`)
      .forEach((b) => {
        b.classList.toggle("active", b.dataset.recipe === c.recipe);
        b.setAttribute("aria-pressed", String(b.dataset.recipe === c.recipe));
      });
  }
  const mq = engine.managerQuote();
  $("#manager-cost").textContent = mq.capped ? "已满级" : money(mq.cost);
  $("#manager-upgrade").toggleAttribute(
    "disabled",
    mq.capped || s.wallet < mq.cost,
  );
  $("#manager-status").textContent =
    `Lv. ${s.manager.level} · ${s.manager.phase === "depositing" ? "正在金库存入" : s.manager.phase === "collecting" ? "正在柜台收钱" : "沿后方通道收运"}`;
  $("#bottleneck").textContent =
    s.counters.reduce((n, c) => n + c.pendingCash, 0) >
    s.totalEarned * 0.35 + 1000
      ? "台面现金变多了，可以提升经理收运"
      : "收入抵达金库后可升级";
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
  for (const event of engine.drainEvents()) {
    if (event.type === "deposited" && event.amount) {
      $("#journey").textContent =
        `经理存入 ${money(event.amount)} 币 · 小店慢慢长大`;
    }
  }
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
        toast(`欢迎回来！离线经营存入 ${money(result.amount)} 币`);
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
  // Preserve the start of a suspended interval, rather than discarding hidden earnings.
  save(false, hiddenAt);
  if (!(event as PageTransitionEvent).persisted) cleanup(false);
}
const sizeObserver =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => scene?.resize())
    : null;
sizeObserver?.observe($("#coffee-canvas"));
on(window, "resize", () => scene?.resize());
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
if (new URLSearchParams(location.search).has("qa")) {
  Object.defineProperty(window, "__coffeeSliceDebug", {
    value: {
      readState: (): SliceState => engine.snapshot(),
      selected: () => selected,
    },
    configurable: true,
  });
}
updateUI();
selectCounter("counter-a", false);
frame = requestAnimationFrame(tick);
if (loaded.message) toast(loaded.message);
if (saveBlocked)
  $("#save-status").textContent = conflictBlocked
    ? "存档已变化，请读取最新档"
    : "旧存档已保留，自动保存暂停";
else if (loaded.status === "unavailable")
  $("#save-status").textContent = "浏览器保存不可用，请导出备份";
if (import.meta.hot) import.meta.hot.dispose(() => cleanup());
