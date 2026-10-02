# Mellow Bean · 放置咖啡店浏览器原型

这是一个参考放置经营类咖啡店玩法、但使用原创名称与视觉设计的纯前端原型。

## 文档与协作

- [文档导航](docs/README.md)：产品目标、里程碑、开发说明和测试体系。
- [协作约定](AGENTS.md)：按验收规格开发及文档维护要求。
- [分阶段迁移清单](docs/development/migration-plan.md)：当前迁移边界、阶段门槛和未验证项。
- [测试文档规范](docs/testing/standards.md)：以最终产品行为定义可复用用例，通过里程碑选择本轮范围。

## 运行

当前唯一支持的运行方式是 Vite：

    npm install
    npm run dev

然后访问 Vite 输出的本地地址。提交前执行：

    node --check app.js
    npm run typecheck
    npm run build

也可以使用 `npm run preview` 检查生产构建。项目保持纯前端浏览器原型范围。仓库现有 GitHub Pages 从 `main` 根目录进行 legacy 构建，推送会触发已有的 `pages build and deployment`；该设置不执行本项目的 npm/Vite 构建，Pages 任务成功不等同于 Vite 应用运行验收。本次沿用现有发布设置。

## 当前已实现

- 咖啡师在已解锁柜台自动制作咖啡并产生待收现金。
- 每杯完成后按“同柜台队首取杯 → 一次待收 → 经理收走 → 回金库入账”结算。
- Phaser 场景层承载柜台、咖啡师、顾客、经理和取杯/现金反馈；React 接管 HUD、控制、升级、订单和弹窗。
- 核心状态、经济、生产、队列、经理运输、订单、存档和事件由纯 TypeScript 管理；React 与 Phaser 共享同一份 `GameView`，不各自维护金币或生产循环。
- 单一 `requestAnimationFrame` 时间入口，支持营业暂停、刷新恢复和一次性离线收益。
- 顾客按柜台实际产能进入、等待、取杯、带杯离店，新顾客自动补位。
- 手机横屏优先的场景布局，竖屏支持横向滑动；桌面、横屏和竖屏共用响应式界面。
- 手作订单、咖啡墙、柜台/员工/经营升级、目标、地点、设置、重置和本地存档。
- 关闭页面后的离线收益；旧 `mellow-bean-idle-v1` 存档会在核心边界归一化，坏档与未来版本受保护。

## 文件结构

- `index.html`：最小 Vite HTML 入口，仅提供 React 挂载点和样式入口。
- `app.js`：应用启动、存档接入、唯一时间循环、React/Phaser 桥接和只读测试适配器。
- `src/core/config.ts`：业务配置、稳定 key 和公式所需配置。
- `src/core/types.ts`：`GameState`、`SaveData`、动作、视图和事件类型。
- `src/core/state.ts`：默认状态、旧存档迁移和字段归一化。
- `src/core/engine.ts`：纯经济、逐杯生产、队列、经理运输、订单与交易。
- `src/core/store.ts`：不依赖 Redux/Zustand 的轻量 action/event 边界。
- `src/core/storage.ts`：本地存档读写、坏档保护和版本保护。
- `src/game/ShopScene.ts`：只负责 Phaser 节点、动画和场景绘制，不推进业务时间。
- `src/ui/react-app.tsx` / `src/ui/react-app.css`：React 页面、HUD、控件、弹窗和 UI 样式。
- `styles.css` / `scene-layout.css`：既有视觉语言、场景背景和响应式布局。
- `assets/`：场景、角色、柜台、咖啡杯、现金等视觉素材；Phaser 运行时通过 npm 依赖提供。
- `package.json`、`vite.config.ts`、`tsconfig.json`：Vite、React、TypeScript strict 和 Phaser 工程配置。

迁移顺序、阶段门槛和未决策项见 [分阶段迁移清单](docs/development/migration-plan.md)，迁移验证见 [迁移验收报告](docs/testing/runs/2026-09-19-1030-vite-react-migration/test-run.md)。2026-10-02 的 HUD 对齐与候客层命中修复、实际验证和未覆盖范围见 [目标回归报告](docs/testing/runs/2026-10-02-hud-queue-hit/report.md)。
