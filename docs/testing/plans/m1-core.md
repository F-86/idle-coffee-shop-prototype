# M1 核心经营计划草案

状态：draft。目标：展示升级与刷新恢复的首批验收链路。完整 M1 还需补齐生产、交付、收款与经营闭环用例，见 [里程碑](../../product/milestones.md)。

## 范围与实例

| 用例 | 参数 | 必选 |
| --- | --- | --- |
| [TC-ECO-001](../cases/economy/upgrades/purchase/TC-ECO-001.md) | B=C、B=C+u，各独立运行 | 是 |
| [TC-ECO-002](../cases/economy/upgrades/purchase/TC-ECO-002.md) | B=C-u | 是 |
| [TC-SAVE-001](../cases/persistence/refresh/TC-SAVE-001.md) | 已完成的升级；经理携款刷新 | 是 |
| [TC-PROD-001](../cases/business/production/TC-PROD-001.md) | 单柜台逐杯交付 | 是 |
| [TC-CASH-001](../cases/business/cash/transfer/TC-CASH-001.md) | P=30；运输中刷新 | 是 |
| [TC-BIZ-001](../cases/business/state/pause/TC-BIZ-001.md) | 制作中暂停；经理携款暂停 | 是 |

暂不包含 M2/M3 成长、离线精确边界和三柜台并行的正式验收；这些用例仍需独立准备受控 fixture。规格依据为 REQ-PROD-001、REQ-CASH-001、REQ-BIZ-001、REQ-SAVE-001，均为候选 draft。

## 执行条件

建议首轮 Chromium、844×390、100% 缩放、独立 HTTP origin。版本、确切浏览器、价格 C、单位 u、保存字段和保存时限在运行前填写。建议 UI 状态观察预算 10 秒；这是测试预算，不是已确认的产品性能要求。

当前草案不可直接宣布验收通过；先补全规则、fixture 和缺失核心用例，再将计划设为 ready。无需因整理草案而暂停其他独立开发工作。

## 完成与汇报

按 [统一门槛](../standards.md) 判断执行完成与版本通过。每轮在 `runs/` 建目录，使用报告模板，列出每个参数实例结果、问题和未覆盖范围。
