# M3 长期运行与恢复

范围：持续经营、跨日、存档异常、重置、多标签、离线、时钟和界面适配；普通成长路径由M2覆盖。

本计划 14 条用例，39 个实例；各参数在一套指定环境执行，不隐含额外浏览器乘积。

## 执行清单

| 用例 | 参数实例 | 实例数 |
| --- | --- | --- |
| [TC-LOOP-002](../cases/business/journey/TC-LOOP-002.md) 十分钟经营与反复开关店保持可用 | 600 秒前台 | 1 |
| [TC-GOAL-002](../cases/engagement/goals/TC-GOAL-002.md) 跨日重置不影响永久资产 | 前日已领取；前日未领取 | 2 |
| [TC-SAVE-002](../cases/persistence/corruption/TC-SAVE-002.md) 损坏存档保护和恢复提示 | 非法JSON；负余额；非有限数文本；字段类型错误 | 4 |
| [TC-SAVE-003](../cases/persistence/migration/TC-SAVE-003.md) 旧版本迁移一次及未来版本保护 | 旧版v0；未知v999 | 2 |
| [TC-SAVE-004](../cases/persistence/storage-failure/TC-SAVE-004.md) 存储失败时明确提示且仍可经营 | 写入被拒绝 | 1 |
| [TC-RESET-001](../cases/persistence/reset/TC-RESET-001.md) 重置取消和确认行为 | 取消；确认 | 2 |
| [TC-MULTI-001](../cases/persistence/multiple-tabs/TC-MULTI-001.md) 双标签单写入与安全接管 | 同origin双页 | 1 |
| [TC-IDLE-001](../cases/idle/settlement/TC-IDLE-001.md) 离线收益一次入待收 | T=20秒 | 1 |
| [TC-IDLE-002](../cases/idle/boundaries/TC-IDLE-002.md) 离线阈值上限暂停及回退 | T=-1,0,9,10,60,61；暂停T20 | 7 |
| [TC-TIME-001](../cases/idle/background/TC-TIME-001.md) 隐藏页不与离线收益重复计算 | 隐藏20秒；上下文时钟回退5秒 | 2 |
| [TC-UI-001](../cases/interface/layout/TC-UI-001.md) 四种视口关键控件可达且场景同步 | 844×390；667×375；1280×800；390×844 | 4 |
| [TC-UI-002](../cases/interface/dialogs/TC-UI-002.md) 弹窗焦点键盘关闭及背景隔离 | 订单；经营；员工；目标；分店 | 5 |
| [TC-UI-003](../cases/interface/feedback/TC-UI-003.md) 极值金额与资源失败保持可用 | 余额0；余额999999999；图片加载失败 | 3 |
| [TC-UI-004](../cases/interface/layout/TC-UI-004.md) 横屏优先场景层级与文字可读性 | 844×390；667×375；1280×800；390×844 | 4 |

## 执行条件与方法

基线为候选 v0.1 / Q1，状态为 candidate-ready：清单和断言已明确，可开始能力检查与差距测试，尚非用户确认的发布标准。使用独立 HTTP origin，Chromium、100% 缩放，除用例指定外为 844×390。运行时记录确切版本、commit/dirty 摘要、工具能力和时区。

按 [fixture 手册](../shared/fixtures.md) 独立准备每一实例；Q1、时钟或必要读数能力不可用时记 BLOCKED，不使用当前默认存档代替。所有表列实例必选。普通 UI 观察预算10秒，保存1秒；用例明确时间优先。UI真实动作执行、失败证据和最多一次独立复测遵循 [执行规范](../execution.md)。

## 完成与汇报

每行参数必须展开为单独结果。全部必选实例PASS、无S0/S1及未说明覆盖缺口才判候选通过；任何FAIL/BLOCKED/FLAKY/NOT_RUN均不算通过。报告完成、执行完成、候选符合性、正式版本验收分别填写；候选通过不等于正式发布验收。

在 runs/YYYY-MM-DD-HHMM-plan-name/ 保存 report.md、bugs/、evidence/，使用 [报告模板](../templates/test-run.md)。若中途修改规格或代码，以新版本重跑受影响项。
