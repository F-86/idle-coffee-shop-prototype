# M2 成长经营

范围：配方、员工、柜台、经营升级、柜台互动催制作、顾客动线、加速、小费、目标、分店；基础经营回归引用M1，跨日和异常环境在M3。

本计划 15 条用例，33 个实例；各参数在一套指定环境执行，不隐含额外浏览器乘积。

## 执行清单

| 用例 | 参数实例 | 实例数 |
| --- | --- | --- |
| [TC-RECIPE-001](../cases/progression/recipes/unlock/TC-RECIPE-001.md) 配方门槛解锁与锁定选择保护 | 柜台L1/B100；L2/B99；L2/B100 | 3 |
| [TC-RECIPE-002](../cases/progression/recipes/select/TC-RECIPE-002.md) 切配方在下一杯生效并保存 | 美式→拿铁 | 1 |
| [TC-RECIPE-003](../cases/progression/recipes/upgrade/TC-RECIPE-003.md) 配方升级预览与实际一致 | B100/L1；B99/L1；B1000/L3 | 3 |
| [TC-STAFF-001](../cases/progression/staff/recruit/TC-STAFF-001.md) 招募金额与人数上限 | 1人/B100；1人/B99；3人/B100 | 3 |
| [TC-STAFF-002](../cases/progression/staff/assign/TC-STAFF-002.md) 一名员工不同时服务两柜台 | A柜台→B柜台；柜台→待命 | 2 |
| [TC-COUNTER-001](../cases/progression/counters/unlock/TC-COUNTER-001.md) 柜台解锁一次收费且缺员不生产 | B99；B100 | 2 |
| [TC-MANAGE-001](../cases/progression/management/TC-MANAGE-001.md) 四类经营升级分别作用对应属性 | 经理；培训；座位；传单 | 4 |
| [TC-QUEUE-002](../cases/business/customers/queue/TC-QUEUE-002.md) 顾客从左侧入口进入地毯并从右侧出口离店补位 | 1280×800；844×390 | 2 |
| [TC-QUEUE-003](../cases/business/customers/queue/TC-QUEUE-003.md) 单柜台满十人时新顾客从右侧出口离店 | 队列10人；第11人到店 | 1 |
| [TC-ORDER-001](../cases/engagement/orders/complete/TC-ORDER-001.md) 点击候客地毯催制作并只交付一次 | 生产中点击；重复点击 | 2 |
| [TC-BOOST-001](../cases/engagement/boost/TC-BOOST-001.md) 加速到期冷却与刷新防叠加 | 刷新；不刷新 | 2 |
| [TC-REWARD-001](../cases/engagement/tips/TC-REWARD-001.md) 小费单次领取和刷新防重领 | 罐20；罐0 | 2 |
| [TC-GOAL-001](../cases/engagement/goals/TC-GOAL-001.md) 目标门槛与奖励单次领取 | 进度2；进度3 | 2 |
| [TC-LOC-001](../cases/progression/locations/unlock/TC-LOC-001.md) 分店门槛及一次解锁费用 | 等级1/B100；等级2/B99；等级2/B100 | 3 |
| [TC-LOC-002](../cases/progression/locations/switch/TC-LOC-002.md) 切店保存本地状态且只有当前店经营 | 经理空车；载款20 | 2 |

## 执行条件与方法

基线为候选 v0.1 / Q1，状态为 candidate-ready：清单和断言已明确，可开始能力检查与差距测试，尚非用户确认的发布标准。使用独立 HTTP origin，Chromium、100% 缩放，除用例指定外为 844×390。运行时记录确切版本、commit/dirty 摘要、工具能力和时区。

按 [fixture 手册](../shared/fixtures.md) 独立准备每一实例；Q1、时钟或必要读数能力不可用时记 BLOCKED，不使用当前默认存档代替。所有表列实例必选。普通 UI 观察预算10秒，保存1秒；用例明确时间优先。UI真实动作执行、失败证据和最多一次独立复测遵循 [执行规范](../execution.md)。

## 完成与汇报

每行参数必须展开为单独结果。全部必选实例PASS、无S0/S1及未说明覆盖缺口才判候选通过；任何FAIL/BLOCKED/FLAKY/NOT_RUN均不算通过。报告完成、执行完成、候选符合性、正式版本验收分别填写；候选通过不等于正式发布验收。

在 runs/YYYY-MM-DD-HHMM-plan-name/ 保存 report.md、bugs/、evidence/，使用 [报告模板](../templates/test-run.md)。若中途修改规格或代码，以新版本重跑受影响项。
