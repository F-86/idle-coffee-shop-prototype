# 测试运行：2026-09-19 Vite / React / TypeScript / Phaser 迁移验收

- 起止时间及时区：2026-09-19；Asia/Shanghai；本地开发时段
- 计划链接及执行清单快照：[分阶段迁移清单](../../../development/migration-plan.md)；本报告只覆盖迁移门槛 smoke，不声称全量产品验收
- 产品/用例规格版本：候选 v0.1；核心行为沿用阶段 0 基线及 D09–D12 实现决策
- commit、dirty 状态及相关文件指纹/补丁：工作树 dirty；本轮涉及 Vite/React/TS/Phaser 迁移文件、文档和 UI 弹窗样式；未提交、未推送
- 浏览器、工具能力、origin、视口、缩放、输入方式：Codex In-app Browser / Chromium；`http://127.0.0.1:4174/?test=final-react` 独立测试 origin；默认桌面视口，另用 CDP 临时覆盖 390×844 与 844×390；真实 UI 点击、键盘 Escape；覆盖清理完成
- 数据准备、时间控制、允许的状态注入：测试 origin 与日常 origin 隔离；本轮标签页共享测试 origin 的测试存档；业务动作全部通过真实 UI，未直接注入业务状态；未修改系统时钟
- 报告完成：是；本报告范围内计划执行完成：是
- 版本验收：无法判定为正式产品验收。迁移门槛通过，但三柜台、经理容量、Q1 数值等正式规格仍未完整执行且部分规则仍为 draft

## 范围与统计

本轮迁移 smoke 纳入 3 个实例：最终 PASS 3、FAIL 0、BLOCKED 0、NOT_RUN 0、FLAKY 0。订单弹窗实例保留首次失败和修复后重试；汇总按最终实例分类，不按尝试次数扩大分母。手作订单完整路径作为计划外迁移回归单列，未纳入正式实例分母。未纳入的产品回归项单列在“问题与缺口”。

## 实际命令

| 检查 | 结果 |
| --- | --- |
| `npm install` | PASS；锁定依赖已安装，`package-lock.json` 已生成 |
| `node --check app.js` | PASS |
| `npm run typecheck` | PASS；strict TypeScript 无错误 |
| `npm run build` | PASS；Vite 8.3.0 生成 `dist/` |
| `git diff --check` | PASS |
| 构建 warning | 仅有 Phaser/应用 bundle 超过 500 kB 的 Vite warning；无构建错误 |

## 逐实例结果

| 用例/参数/环境 | 尝试编号 | 结果 | 实际读数与耗时 | 证据 | 缺陷或阻塞原因 |
| --- | --- | --- | --- | --- | --- |
| `TC-BIZ-001` / React UI 打烊冻结 / preview 4174 | 1 | PASS | 点击营业状态后等待 1.2 秒；余额 `¥ 6,992 → ¥ 6,992`，待收 `¥ 0 → ¥ 0`，状态显示“已打烊”；再次点击恢复营业 | [浏览器观察](evidence/browser-observations.md) | 无 |
| `TC-UI-001` / React + Phaser 四视口 smoke / preview 4174 | 1 | PASS | 390×844：root 390、场景 360、world scroll width 820；844×390：场景 828；两者均有 canvas、图片失败 0；桌面页无旧入口节点 | [浏览器观察](evidence/browser-observations.md) | 无 |
| `TC-UI-002` / React 订单弹窗与 Escape / preview 4174 | 1 | FAIL（首次） | 弹窗节点存在，但继承旧 `.modal-window` 的 `body.modal-is-open` 显隐条件，截图中不可见；未将该次标为通过 | [浏览器观察](evidence/browser-observations.md) | 迁移后的 CSS 显隐边界遗漏 |
| `TC-UI-002` / React 订单弹窗与 Escape / preview 4174 | 2 | PASS（修复后） | 弹窗标题“订单台”可见，opacity `1`，主按钮区域 `728×48`；真实 Escape 后节点移除 | [浏览器观察](evidence/browser-observations.md) | 已在 `src/ui/react-app.css` 增加 React 弹窗独立的 fixed/visible 层规则 |

## 计划外迁移回归

- 手作订单 React 路径：真实打开订单台并点击“开始冲泡”；按钮变为“正在冲泡…”，进度约 `17.664%`，出现“冲泡开始”提示；约 3.2 秒后按钮回到“开始冲泡”、进度为 `0%`，进入下一单。之后用 Escape 关闭弹窗。
- 最终页面结构：React shell 和 Phaser canvas 存在；`legacy-app-shell`、旧 `modalLayer`、旧 `toastStack` 不存在；图片失败 `0`；最终控制台 `error` / `warn` 为空。

## 问题与缺口

- 已修复：React 弹窗未脱离旧 `body.modal-is-open` CSS 规则，造成 DOM 存在但视觉隐藏；修复后已重跑 `TC-UI-002` 和手作订单路径。
- 未执行：三柜台并行、经理容量边界、长时间多次营业切换、坏档/未来版本的完整浏览器路径、多标签一致性、正式 Q1 fixture 和存储故障。
- 构建风险：Phaser 与应用 bundle 较大，Vite 仅给出 chunk warning；不影响当前本地运行，但可在后续阶段单独做分包。
- 规格缺口：价格、经理容量和 Q1 平衡仍按产品决策中的 draft/现状假设处理，不能从本轮 smoke 推导为正式数值。

## 收尾与后续

本轮未部署、未推送、未创建 GitHub 配置；测试只使用本地 Vite dev/preview。临时移动视口覆盖已清除。迁移主线的代码、文档、类型检查、构建和关键 UI smoke 已完成；下一轮应补齐上述产品回归缺口，尤其是三柜台、经理容量、坏档和 Q1 fixture。
