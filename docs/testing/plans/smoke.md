# 冒烟测试

范围：新档进入、生产、收款、升级、保存与玩家闭环。6条用例，按下表选定参数共6个实例，仅用于快速发现核心阻塞，不代替M1或最终验收。

| 用例 | 本轮唯一参数 |
| --- | --- |
| [TC-APP-001](../cases/entry/onboarding/TC-APP-001.md) 新档进入并完成或跳过引导 | 完成引导 |
| [TC-PROD-001](../cases/business/production/TC-PROD-001.md) 有效柜台完成一杯并产生一次待收 | 单柜台 |
| [TC-CASH-001](../cases/business/cash/transfer/TC-CASH-001.md) 现金从柜台到经理再到金库守恒 | P=30,M=0,B=200 |
| [TC-LOOP-001](../cases/business/journey/TC-LOOP-001.md) 新店完成经营升级与刷新闭环 | 新玩家路径 |
| [TC-ECO-001](../cases/economy/upgrades/purchase/TC-ECO-001.md) 足额与恰好足额完成升级 | B=100 |
| [TC-SAVE-001](../cases/persistence/refresh/TC-SAVE-001.md) 交易与经营字段保存恢复 | 已升级 |

## 执行条件与方法

基线为候选 v0.1 / Q1，状态为 candidate-ready：清单和断言已明确，可开始能力检查与差距测试，尚非用户确认的发布标准。使用独立 HTTP origin，Chromium、100% 缩放，除用例指定外为 844×390。运行时记录确切版本、commit/dirty 摘要、工具能力和时区。

按 [fixture 手册](../shared/fixtures.md) 独立准备每一实例；Q1、时钟或必要读数能力不可用时记 BLOCKED，不使用当前默认存档代替。所有表列实例必选。普通 UI 观察预算10秒，保存1秒；用例明确时间优先。UI真实动作执行、失败证据和最多一次独立复测遵循 [执行规范](../execution.md)。

## 完成与汇报

每行参数必须展开为单独结果。全部必选实例PASS、无S0/S1及未说明覆盖缺口才判候选通过；任何FAIL/BLOCKED/FLAKY/NOT_RUN均不算通过。报告完成、执行完成、候选符合性、正式版本验收分别填写；候选通过不等于正式发布验收。

在 runs/YYYY-MM-DD-HHMM-plan-name/ 保存 report.md、bugs/、evidence/，使用 [报告模板](../templates/test-run.md)。若中途修改规格或代码，以新版本重跑受影响项。
