# Clear-60 Mac comparison

- Date: 2026-10-05 UTC
- Source: `b1ebbdd8dcd1994d3ac0da6a735e2422be5e13ea`, tree `76da1ff5c6ab44f57f852d74f86f85c79d206ded`
- Branch: `codex/light-3d-coffee-slice`
- Environment: unlocked macOS desktop; Chrome extension CUA; Vite 8.3.0 local preview at `http://127.0.0.1:4180/?qa=1` using independent origin storage.
- Source hashes: `PerformanceQAPanel.ts` `95552ba6cf6490d620ca907f990f5d655a7a67c337feff7745a407fb6646a433`; `RenderBudget.ts` `4fe9d392e7cf1ed4875cafa55e45fadca8b1c86476fb8767c5bb1ff1374722b5`.
- Startup: the default sandbox attempt returned `listen EPERM`; the same local-only Vite command succeeded through normal `require_escalated` approval. No alternate route or network tunnel was used.

## Results

| Check | Result | Evidence |
|---|---|---|
| CUA and unlocked desktop | PASS | Chrome showed a live page, accessibility tree, and screenshot before preview startup. |
| Smooth → clear-60 → Smooth | PASS | Three frozen `manual restart` segments, each ≥60 seconds, with `visible=true`, `focus=true`, unchanged viewport, and no reported segment reset during the no-interaction windows. |
| Matching render buffer | PASS | All three frozen panels reported CSS 1672×1037, device DPR 2, effective DPR 2.00, buffer 3344×2074. |
| Clear-60 cap | PASS | `target 60`; observed full-segment 60.00 FPS. |
| Refresh persistence | PASS | Selected Clear 60, reloaded the independent origin, and the settings panel still had Clear 60 selected with its same-clarity/60-FPS description. |
| Original mode restored | PASS | Selected Smooth after persistence check; settings showed Smooth selected, and the final frozen panel reported `mode smooth`. |
| Store/configuration constraints | PASS | No existing origin or user save opened; no upgrades or recipes changed. Route QA stayed collapsed, Performance QA open, settings closed during all valid segments. |
| Visual sign legibility comparison | NOT_RUN | No matched before/after scene screenshots were retained; equal render buffers establish equal configured sampling dimensions, not pixel-level legibility. |
| Temperature/power/GPU | NOT_RUN | No system sensor or energy measurement was collected; RAF submissions do not prove GPU completion, presentation, heat, or power. |

## Frozen Performance QA text

The following is the complete text returned by each final frozen-panel accessibility capture, including the panel's scope and caveats.

### Smooth — initial

```text
FROZEN（最后一次 1Hz 读数）
实际提交绘制的 RAF 时间戳间隔；不是模拟时间、GPU耗时、上屏帧或温度。
仅页面 visible 且 focus 时采样；1Hz 显示。关闭 Route QA 减少额外诊断工作。
LIVE · manual restart
最近 10s 的间隔终点：1200 个 / 覆盖 10.00s
FPS 120.00 · p50 8.30ms · p95 9.30ms · max 9.40ms
长间隔 >50ms 0 · >100ms 0（不是 Long Tasks API）
本段 89.29s / 10715 间隔 · FPS 120.00 · >50ms 0 · >100ms 0
mode smooth · target display RAF · visible=true · focus=true
viewport 1672×1037 CSS · device DPR 2 · buffer 3344×2074 · effective DPR 2.00
customers 11 {"entering":3,"queue":3,"serving":1,"receiving":1,"leaving":3} · counter-a Lv1/espresso · counter-b Lv1/latte · manager Lv1
scene meshes 742 · submissions 17441 · core 149.70s · paused=false · dialog=none · routePanel=false
后台/焦点、尺寸、模式、读档/新店均重开段；隐藏时间不计入。
QA不隔离存档。使用独立测试存储；温度/功耗需要单独设备测量。
```

### Clear 60

```text
FROZEN（最后一次 1Hz 读数）
实际提交绘制的 RAF 时间戳间隔；不是模拟时间、GPU耗时、上屏帧或温度。
仅页面 visible 且 focus 时采样；1Hz 显示。关闭 Route QA 减少额外诊断工作。
LIVE · manual restart
最近 10s 的间隔终点：601 个 / 覆盖 10.02s
FPS 60.00 · p50 16.70ms · p95 17.60ms · max 17.80ms
长间隔 >50ms 0 · >100ms 0（不是 Long Tasks API）
本段 98.55s / 5913 间隔 · FPS 60.00 · >50ms 0 · >100ms 0
mode clear-60 · target 60 · visible=true · focus=true
viewport 1672×1037 CSS · device DPR 2 · buffer 3344×2074 · effective DPR 2.00
customers 13 {"entering":3,"queue":6,"serving":1,"receiving":0,"leaving":3} · counter-a Lv1/espresso · counter-b Lv1/latte · manager Lv1
scene meshes 772 · submissions 10412 · core 354.45s · paused=false · dialog=none · routePanel=false
后台/焦点、尺寸、模式、读档/新店均重开段；隐藏时间不计入。
QA不隔离存档。使用独立测试存储；温度/功耗需要单独设备测量。
```

### Smooth — restored

```text
FROZEN（最后一次 1Hz 读数）
实际提交绘制的 RAF 时间戳间隔；不是模拟时间、GPU耗时、上屏帧或温度。
仅页面 visible 且 focus 时采样；1Hz 显示。关闭 Route QA 减少额外诊断工作。
LIVE · manual restart
最近 10s 的间隔终点：1201 个 / 覆盖 10.01s
FPS 119.99 · p50 8.30ms · p95 9.30ms · max 9.40ms
长间隔 >50ms 0 · >100ms 0（不是 Long Tasks API）
本段 88.31s / 10597 间隔 · FPS 120.00 · >50ms 0 · >100ms 0
mode smooth · target display RAF · visible=true · focus=true
viewport 1672×1037 CSS · device DPR 2 · buffer 3344×2074 · effective DPR 2.00
customers 15 {"entering":3,"queue":8,"serving":0,"receiving":0,"leaving":4} · counter-a Lv1/espresso · counter-b Lv1/latte · manager Lv1
scene meshes 897 · submissions 28604 · core 518.15s · paused=false · dialog=none · routePanel=false
后台/焦点、尺寸、模式、读档/新店均重开段；隐藏时间不计入。
QA不隔离存档。使用独立测试存储；温度/功耗需要单独设备测量。
```

## Method and limits

- Each segment had at least 30 seconds of real warm-up; valid timing began by clicking the panel's restart button and ended by freezing after the panel reported more than 60 seconds.
- The QA panel's `本段` clock and browser RAF interval counts are the measurement data. Wait calls only allowed the real page to run and were not used as FPS or duration substitutes.
- Exact wall-clock start/end markers were not separately written down at each button click. Segment durations above are the panel's recorded durations.
- Viewport remained 1672×1037 CSS; no resize, camera movement, refresh-rate/system setting, recipe, or level change was made. Natural operation changed frozen customer counts 11 → 13 → 15 and mesh counts 742 → 772 → 897, so this is a sequential screen, not same-load causal A/B.
- Initial origin preference was default Smooth. Clear 60 remained selected after refresh; final Smooth selection was restored on the test origin. Local game progress during the test was generated only on the isolated test origin.
- Browser version, model/OS identifiers, physical display refresh rate, temperature, GPU time, and power were not independently recorded. No thermal or power benefit is claimed.

## Cleanup

The test tab was closed and only the Vite process started for port 4180 was stopped. The user's other browser tab and unrelated services were left alone. No source code, main branch, remote branch, deployment configuration, or Pages deployment was changed.
