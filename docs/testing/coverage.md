# 需求覆盖矩阵

规格均为 draft；实现符合性未验证，以下不是测试结果。

| 需求 | 用例 | 建议阶段 | 覆盖缺口 |
| --- | --- | --- | --- |
| REQ-ECO-001 | [TC-ECO-001](cases/economy/upgrades/purchase/TC-ECO-001.md)、[TC-ECO-002](cases/economy/upgrades/purchase/TC-ECO-002.md) | M1 | 快速重复输入、满级、锁定、效果数值待补 |
| REQ-SAVE-001 | [TC-SAVE-001](cases/persistence/refresh/TC-SAVE-001.md) | M1 | 字段清单、异常存档、旧版本迁移待补；本轮新增经理携款/在制杯回归 |
| REQ-PROD-001 | [TC-PROD-001](cases/business/production/TC-PROD-001.md)、[TC-PROD-002](cases/business/production/TC-PROD-002.md)、[TC-PROD-003](cases/business/production/TC-PROD-003.md) | M1 | 受控顾客 fixture、三柜台完整并行仍待独立验证 |
| REQ-CASH-001 | [TC-CASH-001](cases/business/cash/transfer/TC-CASH-001.md)、[TC-CASH-002](cases/business/cash/transfer/TC-CASH-002.md) | M1 | 容量边界沿用未确认实现假设，需 Q1 fixture |
| REQ-BIZ-001 | [TC-BIZ-001](cases/business/state/pause/TC-BIZ-001.md) | M1 | 长时间切换与后台页仍待验证 |
| REQ-IDLE-001 | [TC-IDLE-001](cases/idle/settlement/TC-IDLE-001.md) | M3 | 上限、最小时长、时钟异常、打烊待补 |
| REQ-PROD-002 | [TC-ORDER-001](cases/engagement/orders/complete/TC-ORDER-001.md) | M2 | 点击催制作、即时交付、重复点击和异常条件需实际回归 |
| REQ-UI-004 | [TC-UI-004](cases/interface/layout/TC-UI-004.md) | M3 | 横屏控件层级、字号和主要点击区域需用实际视口回归；不等同于原作逐像素复刻 |
| REQ-QUEUE-002 | [TC-QUEUE-002](cases/business/customers/queue/TC-QUEUE-002.md)、[TC-QUEUE-003](cases/business/customers/queue/TC-QUEUE-003.md) | M2 | 左侧入店、从柜台向前延伸的候客地毯、最多10人和右侧离店动画需浏览器连续采样 |
| REQ-QUEUE-003 | [TC-QUEUE-003](cases/business/customers/queue/TC-QUEUE-003.md) | M2 | 满位第11人右侧出口、无收入和不串柜台需独立 fixture |
| REQ-UI-005 | [TC-UI-005](cases/interface/layout/TC-UI-005.md) | M2 | 同一 world 坐标、咖啡图标资源、选择器键盘/触控关闭和横滑需实际回归 |
| REQ-UI-006 | [TC-UI-006](cases/interface/layout/TC-UI-006.md) | M2 | 不同 DPR、小横屏和素材透明边界下的清晰度仍需真实设备抽样 |
| REQ-UI-007 | [TC-UI-006](cases/interface/layout/TC-UI-006.md)、[TC-UI-005](cases/interface/layout/TC-UI-005.md) | M2 | 侧向2.5D前后层级、入口/出口和经理后场通道需保存桌面与横屏证据 |
| REQ-UI-008 | [TC-UI-007](cases/interface/layout/TC-UI-007.md) | M2 | 柜台详情、咖啡图标选择器、候客地毯催制作和咖啡墙详情购买需实际验证入口隔离与升级预览 |

产品地图中引导、自动生产、顾客、经理收款、柜台互动、员工、配方、目标、分店、适配目前还没有完整规格和用例。最终验收前必须逐域展开；不能只因本表已列用例全部通过就声称最终产品完成。
