# 文档导航

本项目采用验收测试驱动开发（ATDD）：产品规则 → 独立用例 → 里程碑计划 → 实现 → AI 集成验收 → 回归。

| 入口 | 用途 |
| --- | --- |
| [产品目标与功能地图](product/README.md) | 最终形态、功能域及待明确范围 |
| [2.5D 主场景产品设计记录](product/design-record-2.5d.md) | 指定 Figma 会话中的视觉方向、交互入口、取舍和验证边界 |
| [首批行为规格](product/requirements.md) | 带稳定 ID 的产品规则草案 |
| [里程碑](product/milestones.md) | 分阶段交付范围 |
| [开发说明](development/README.md) | 当前架构、运行、验证和实现注意事项 |
| [分阶段迁移清单](development/migration-plan.md) | Vite、TypeScript core、Phaser 场景和 React UI 的阶段边界与门槛 |
| [测试入口](testing/README.md) | 用例库、计划和报告的目录约定 |
| [测试文档规范](testing/standards.md) | 范围、写法、状态、完成标准和缺陷汇报 |
| [AI 执行规范](testing/execution.md) | 浏览器操作、时间控制、证据及重试 |
| [历史记录索引](history/README.md) | 既有设计验收记录 |

## 维护原则

根目录 README 负责快速启动和当前实现摘要；AGENTS.md 负责协作约定；docs 保存长期规格和流程。一个规则只维护一个权威位置，其他文件用链接引用。

规格状态使用 draft / accepted / deprecated。accepted 表示已有明确需求或已确认决策，记录来源与日期；不能因为代码已经实现就自动转为 accepted。当前新建业务规格为草案，文档体系与 ATDD 方式已依据本次讨论建立。草案可继续细化，但不能冒充已确认的最终产品要求。

历史验收报告保持原意和时间边界，不作为新版本已通过测试的证明。
