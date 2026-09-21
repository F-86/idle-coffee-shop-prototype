import { createGameStore } from "./src/core/store.ts";
import { createStorage } from "./src/core/storage.ts";
import { createDefaultState } from "./src/core/state.ts";
import { createReactRenderer } from "./src/ui/react-app.tsx";
import { mountShopScene } from "./src/game/ShopScene.ts";

const storage = createStorage();
const bootNow = Date.now();
const loaded = storage.load(bootNow);
const engine = createGameStore({
  initialState: loaded.state || createDefaultState(bootNow),
  now: bootNow
});

// Read-only test adapter. It exposes the same snapshot used by the renderers
// without offering a shortcut to mutate or settle business state.
if (new URLSearchParams(window.location.search).has("test")) {
  window.__mellowBeanDebug = {
    readView: () => engine.getView()
  };
}

let protectSave = Boolean(loaded.protectedRaw);
let warnedSaveFailure = false;
let lastFrameAt = performance.now();
let lastUiAt = 0;

function persist() {
  if (protectSave) {
    return false;
  }
  const now = Date.now();
  const result = storage.save(engine.getState(), now);
  if (!result.ok) {
    engine.setNow(now);
    if (!warnedSaveFailure && renderer) {
      warnedSaveFailure = true;
      renderer.handleEvent({ type: "toast", message: "当前经营仍在继续，但本地存档尚未保存。", icon: "!" });
    }
    return false;
  }
  engine.markSeen(now);
  return true;
}

let renderer;
let phaser;

function resetGame() {
  const removed = storage.reset();
  if (!removed.ok) {
    renderer.handleEvent({ type: "toast", message: "本地存档无法清除，请检查浏览器存储权限。", icon: "↺" });
    return;
  }
  protectSave = false;
  engine.reset(Date.now());
  persist();
  renderer.handleEvent({ type: "toast", message: "进度已重置，欢迎回到 Mellow Bean。", icon: "↺" });
  renderer.render(engine.getView());
  phaser.syncView(engine.getView());
}

renderer = createReactRenderer({ engine, onReset: resetGame });
phaser = mountShopScene({ engine });

const persistentEvents = new Set([
  "cup-delivered",
  "cash-collected",
  "cash-deposited",
  "counter-rushed",
  "business-toggled",
  "boost-activated",
  "tips-collected",
  "upgrade-purchased",
  "recipe-purchased",
  "counter-purchased",
  "counter-drink-changed",
  "staff-hired",
  "goal-claimed",
  "location-changed",
  "offline-settled",
  "state-reset"
]);

engine.subscribe((event) => {
  phaser.handleEvent(event);
  renderer.handleEvent(event);
  if (persistentEvents.has(event.type)) {
    persist();
  }
});

if (loaded.issue === "corrupt") {
  renderer.handleEvent({ type: "toast", message: "存档无法读取，原始数据已保留；可用右上角重置后重新开始。", icon: "!" });
} else if (loaded.issue === "future-version") {
  renderer.handleEvent({ type: "toast", message: "发现更新版本存档，当前页面保持只读保护；请先确认版本或重置。", icon: "!" });
} else if (loaded.issue === "storage-unavailable") {
  renderer.handleEvent({ type: "toast", message: "浏览器存储不可用，本页仍可经营但尚未保存。", icon: "!" });
}

const offlineResult = engine.settleElapsed(bootNow);
if (!protectSave) {
  persist();
}
if (offlineResult.earnings > 0) {
  renderer.showOfflineNotice(offlineResult.earnings);
}

function gameLoop(frameNow) {
  const now = Date.now();
  engine.setNow(now);
  if (!document.hidden) {
    const seconds = Math.max(0, Math.min(0.5, (frameNow - lastFrameAt) / 1000));
    if (seconds > 0) {
      engine.advance(seconds, {
        source: "online"
      });
    }
  }
  lastFrameAt = frameNow;
  if (frameNow - lastUiAt >= 120) {
    const view = engine.getView();
    renderer.render(view, now);
    phaser.syncView(view);
    lastUiAt = frameNow;
  }
  window.requestAnimationFrame(gameLoop);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    persist();
    lastFrameAt = performance.now();
    return;
  }
  const result = engine.settleElapsed(Date.now());
  if (result.earnings > 0) {
    renderer.showOfflineNotice(result.earnings);
  }
  persist();
  lastFrameAt = performance.now();
  const view = engine.getView();
  renderer.render(view);
  phaser.syncView(view);
});

window.addEventListener("beforeunload", persist);

const initialView = engine.getView();
renderer.render(initialView);
phaser.syncView(initialView);
window.requestAnimationFrame(gameLoop);
