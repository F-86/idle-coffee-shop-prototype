# 基线失败证据

独立 origin：`http://127.0.0.1:5180/?test=ui004-run-1`；Codex In-app Browser / Chromium。

- 直接点击 `.station-brew-trigger` 的实际 DOM 矩形时，计算样式为 `pointer-events: none`；点击后订单仍为 waiting，必须打开订单弹窗才能开始手作。基线违反新增的 REQ-ORDER-003。
- 手作完成触发 Phaser `cup-delivered` 后，出杯杯体短暂按原始素材比例放大，画面可覆盖半个场景再消失。根因是杯子先设置为 `20×22`，随后 tween 把绝对 `scaleX/scaleY` 设为 `0.8`，而不是相对当前缩放。
