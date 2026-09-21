# 测试运行：柜台直达手作与出杯动画修复

- 日期及时区：2026-09-19；Asia/Shanghai
- 规格与用例：[REQ-ORDER-003](../../../product/specs/engagement.md)、[TC-ORDER-001](../../cases/engagement/orders/complete/TC-ORDER-001.md)
- 产品基线：候选 v0.1；新增规则仍为 draft
- 环境：独立 `:5180` origin；Codex In-app Browser / Chromium；100% 页面缩放；真实 UI 点击与截图
- 初始状态：工作树 dirty，保留 Phaser/React 重构及既有本地改动；未使用脚本注入存档状态
- 报告完成：是；计划执行完成：是（本报告覆盖 TC-ORDER-001 的直达手作与动画回归）

## 结果

| 实例 | 尝试 | 结果 | 证据 |
| --- | --- | --- | --- |
| 直接点击已解锁柜台，不打开订单弹窗 | 1 基线 | FAIL | [基线失败](evidence/baseline.md)：点击层 `pointer-events:none`，订单保持 waiting |
| 直接点击已解锁柜台，不打开订单弹窗 | 2 修复后 | PASS | [修复后证据](evidence/final.md)：dialog `0`，柜台进入“手作中” |
| 手作完成后的杯子尺寸 | 1 基线 | FAIL | [基线失败](evidence/baseline.md)：原始杯子素材放大覆盖场景 |
| 手作完成后的杯子尺寸 | 2 修复后 | PASS | [修复后证据](evidence/final.md)：小尺寸交接，无异常残留 |

## 实现摘要

- `StationCard` 的柜台主区域改为真实按钮，点击传入 `counterKey`；引擎自动带入当前订单配方，并把完成奖励记入被点击柜台待收现金。
- 订单弹窗和左侧快捷入口仍可作为辅助入口，但不再是手作必经路径。
- Phaser 出杯 tween 改为使用实际 display scale 的相对值，阻止原始大图尺寸被直接放大。
- 新增存档兼容的 `order.counterKey`，旧存档缺失时回退到一号柜台。

## 未覆盖项

- 真实手机硬件触控、读屏完整路径和正式 FX-ORDER fixture 尚未执行。
- 仍保留“错误配方”的弹窗辅助路径；柜台直达路径会自动带入当前订单所需配方，这是本次交互规则的明确差异。
