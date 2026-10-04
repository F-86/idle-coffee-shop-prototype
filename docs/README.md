# 文档导航

- [轻量3D规格](product/specs/light-3d-slice.md)：确认的行为与可调整数值分开。
- [实现说明](development/light-3d-preview.md)：默认入口、共享核心、渲染、保存与CloudKit边界。
- [测试计划](testing/plans/light-3d-slice.md)：核心、持久化、场景与真实UI验证分别记录。
- [覆盖矩阵](testing/coverage.md)

本轮用户允许重新开始，旧版实现和报告仅保留在 Git 历史。产品规则用稳定需求ID，用例独立维护；核心/NullEngine测试不冒充真实浏览器验收。


上一轮方向修订：[实体嵌入操作计划](testing/plans/embedded-scene-controls.md)，[TC-3D-008](testing/cases/slice/TC-3D-008.md)。常驻HUD仅¥金额，所有经营/设置入口是场景实物。

最新用户布局：[金库与柜台前脸计划](testing/plans/vault-front-layout.md)、[TC-3D-009](testing/cases/slice/TC-3D-009.md)。HUD为¥与设置，无暂停入口；金库管理经理。

最新房间/路线修订：[计划](testing/plans/room-route-refinement.md)、[TC-3D-010](testing/cases/slice/TC-3D-010.md)。删除吊灯/排队装饰圈、表面规则纹路、金库牌上移；真实收款改为近B→远A，替代旧渲染路线映射。
