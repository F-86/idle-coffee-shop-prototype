# 开发说明

## 当前结构

截至 2026-09-19，项目已完成阶段 0–5 的代码迁移主线：Vite 是唯一运行入口，TypeScript strict 核心持有唯一业务状态，Phaser 只负责场景，React 负责可见网页 UI。迁移边界、阶段门槛和未验证项见[分阶段迁移清单](migration-plan.md)。

| 文件 | 职责 |
| --- | --- |
| `index.html` | 最小 Vite HTML 入口和 React 挂载点 |
| `app.js` | 应用启动、唯一时间推进器、存档接入、React/Phaser 桥接 |
| `styles.css` | 基础界面与店铺视觉样式 |
| `scene-layout.css` | 场景布局、可读性和移动端适配覆盖 |
| `src/core/config.ts` | 业务配置与稳定 key |
| `src/core/types.ts` | `GameState`、`SaveData`、视图、动作和事件类型 |
| `src/core/state.ts` | 默认状态、旧存档迁移和字段归一化 |
| `src/core/engine.ts` | 无 DOM 的经济、逐杯生产、队列、经理运输、订单与交易 |
| `src/core/store.ts` | 轻量 action/event 边界；不引入 Redux/Zustand |
| `src/core/storage.ts` | 本地存档读写、坏档保护和版本保护 |
| `src/game/ShopScene.ts` | Phaser 场景节点、动画和反馈；不修改业务状态 |
| `src/ui/react-app.tsx` | HUD、经营控制、咖啡墙、升级、订单、管理和设置弹窗 |
| `src/ui/react-app.css` | React UI 的局部样式、触控目标和弹窗样式 |
| `assets/` | 场景、角色、柜台、咖啡杯和现金素材 |
| `package.json` / `vite.config.ts` / `tsconfig.json` | Vite、React、Phaser 和 TypeScript strict 配置 |

开发主入口是 `npm run dev`，构建检查使用 `npm run typecheck` 和 `npm run build`，生产构建可用 `npm run preview` 预览。项目只保留本地浏览器运行范围；不使用 Python 静态回退入口，不部署到 GitHub。浏览器验收固定记录 origin；localhost 与 127.0.0.1、不同端口的存档彼此独立。直接打开文件只用于快速预览，正式测试使用 HTTP。

当前存档键仍为 `mellow-bean-idle-v1`。`SaveData` 在核心边界显式表示持久化结构，`normalizeState` 负责旧字段迁移和归一化；这只是实现兼容信息，不替代产品保存契约。默认数据、离线收益常量和价格公式同样不能自动成为验收标准。

## 修改与验证

从产品需求和失败用例开始开发；保持 UI、状态和数值变化一致。涉及现金转移时检查待收、运输中、余额三个环节；涉及时间时区分真实时间、后台运行和离线区间。核心状态只有一个来源：`app.js` 持有 `createGameStore()`，React 与 Phaser 都从同一份 `GameView` 读取，时间只由应用层的一个 `requestAnimationFrame` 推进。

JavaScript 修改执行 `node --check app.js`；TypeScript 修改执行 `npm run typecheck`；构建执行 `npm run build`；补丁检查使用 `git diff --check`。交互、布局和存档修改按相关测试计划进行浏览器验收。纯文档变更检查文件链接、稳定 ID、状态与覆盖关系。

当前实现提供 `?test=...` 下的只读 `window.__mellowBeanDebug.readView()` 适配器，用于回读状态，不提供结算或变更快捷入口；浏览器业务动作仍通过 UI 完成。测试准备不可通过直接调用被测业务函数来替代 UI 验收。

技术决策如涉及存档格式、模块拆分或测试接口，应在本目录新增决策记录，写明背景、选择、影响与替代方案，并从本文件链接。
