# 分阶段迁移清单

状态：代码迁移主线已完成；完整产品回归仍有明确未验证项。日期：2026-09-19。目标运行时：Vite + React + TypeScript strict + Phaser。本次只做本地迁移，不部署到 GitHub。

## 阶段 0：审计基线

- [x] 阅读协作约定、文档导航、产品规格、测试规范和 M1 计划。
- [x] 记录现有 `mellow-bean-idle-v1` 存档键、三段现金位置、逐杯事件和唯一时间入口。
- [x] 运行本地版本，验证单柜台逐杯交付、经理收款、打烊冻结、刷新恢复和四种视口。
- [x] 记录基线报告：[2026-09-19 Phaser / M1 核心经营](../testing/runs/2026-09-19-0925-phaser-m1/test-run.md)。
- [x] 记录未确认的价格、经理容量、Q1 平衡等假设，不把现状当正式产品数值。

## 迁移边界

| 现有职责 | 当前模块 | 迁移策略与结果 |
| --- | --- | --- |
| 业务配置与稳定顺序 | `src/core/config.ts` | 使用稳定的 `CounterKey`、`DrinkKey`、`LocationKey` 和配置记录。 |
| 默认状态与旧存档 | `src/core/state.ts` + `src/core/types.ts` | 由 `GameState`/`SaveData` 表示；保留 `mellow-bean-idle-v1`，归一化旧字段，坏档和未来版本不覆盖原始数据。 |
| 经济、生产、队列、经理运输、订单 | `src/core/engine.ts` | 纯 TypeScript；保留 `advance(deltaTime)` 单时间入口和判别事件。 |
| action/event 边界 | `src/core/store.ts` | 轻量类型化 store；不引入 Redux/Zustand，不复制金币或生产状态。 |
| 存档读写 | `src/core/storage.ts` | 只读加载、保存结果、坏档保护、未来版本保护。 |
| 场景渲染 | `src/game/ShopScene.ts` | Phaser 只订阅快照和 `GameEvent`，不推进时间、不写经济状态。 |
| 网页 UI、控件、弹窗 | `src/ui/react-app.tsx` + `src/ui/react-app.css` | React 接管 HUD、咖啡墙、升级、订单、管理和设置；所有变更通过 core action。 |
| 启动与桥接 | `app.js` | 只创建一个 core store、一个 RAF、一个 React renderer 和一个 Phaser scene。 |
| HTML/CSS/素材 | `index.html`、`styles.css`、`scene-layout.css`、`assets/` | 保留既有视觉和素材；HTML 收缩为 Vite 入口，样式继续承担场景布局与响应式适配。 |

## 阶段 1：工程骨架

- [x] `package.json`、Vite 配置、strict `tsconfig` 和 npm scripts。
- [x] React 入口挂载并完成 Vite 运行，随后成为唯一可见 UI 入口。
- [x] `npm run typecheck`、`npm run build` 在锁定依赖后通过。
- [x] Vite dev/preview 的桌面与移动视口 smoke，以及 Phaser 资源无明显控制台错误。

阶段 1 实际运行记录：[Vite / React / TypeScript 骨架](../testing/runs/2026-09-19-0945-vite-stage1/test-run.md)。该报告是历史阶段记录，不能替代最终报告。

## 阶段 2：核心 TypeScript

- [x] 定义 `GameState`、`SaveData`、`CounterKey`、`DrinkKey`、`CustomerPhase`、`ManagerPhase`、`UpgradeKey` 和 `GameEvent`。
- [x] 把生产、队列、逐杯交付、现金位置、经理路线和交易搬入纯 TS。
- [x] 处理旧存档字段和新 schema 边界；坏档和未来版本保持原始数据。
- [x] 用类型化 store/action 替代散落 DOM 读取；不引入 Redux/Zustand。

## 阶段 3：Phaser 场景

- [x] 建立 `ShopScene`，由 core 快照驱动柜台、角色和顾客显示。
- [x] 角色、柜台、顾客、经理和现金/取杯 tween 由核心事件驱动。
- [x] Scale Manager、世界宽度和移动端层级通过桌面、横屏、竖屏 smoke。

## 阶段 4：React UI

- [x] React 接管 HUD、金币/待收、营业切换、咖啡选择、咖啡墙、升级面板和弹窗。
- [x] React 只发类型化 action；Phaser 不反向修改账务。
- [x] 保留触控目标、Escape 关闭、基本焦点行为和移动端横滑布局。

## 阶段 5：清理与验收

- [x] 删除被 React/Phaser 替代的旧 DOM 渲染、旧 JS 核心和重复入口；保留必要样式和存档兼容。
- [x] 运行 `node --check app.js`、`npm run typecheck`、`npm run build`、`git diff --check`，并完成 Vite dev/preview 浏览器 smoke。
- [ ] 补跑三柜台、经理容量、长时切换、坏档、多标签和正式 Q1 fixture。
- [x] 完成 React 迁移后的手作订单“开始冲泡 → 出杯 → 关闭订单”完整 UI 路径复测。

最终本轮报告：[Vite / React / TypeScript / Phaser 迁移验收](../testing/runs/2026-09-19-1030-vite-react-migration/test-run.md)。未勾选项是后续测试范围，不是产品规则已决定或实现失败的结论；涉及数值、容量和 Q1 平衡的规则继续以 `docs/product/decisions.md` 中的待决策项为准。

## 阶段门槛

阶段结构迁移可以继续，但每个阶段的报告必须单独记录完成项、真实验证、未验证项和仍需产品决策的数值。未实际执行的浏览器用例不得标记通过；测试任务本身不授权修复产品，开发任务才可实现已经明确要求的功能。
