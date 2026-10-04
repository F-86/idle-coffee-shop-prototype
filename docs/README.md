# 文档导航

- [轻量3D规格](product/specs/light-3d-slice.md)：确认的行为与可调整数值分开。
- [实现说明](development/light-3d-preview.md)：默认入口、共享核心、渲染、保存与CloudKit边界。
- [测试计划](testing/plans/light-3d-slice.md)：核心、持久化、场景与真实UI验证分别记录。
- [覆盖矩阵](testing/coverage.md)

本轮用户允许重新开始，旧版实现和报告仅保留在 Git 历史。产品规则用稳定需求ID，用例独立维护；核心/NullEngine测试不冒充真实浏览器验收。


上一轮方向修订：[实体嵌入操作计划](testing/plans/embedded-scene-controls.md)，[TC-3D-008](testing/cases/slice/TC-3D-008.md)。常驻HUD仅¥金额，所有经营/设置入口是场景实物。

最新用户布局：[金库与柜台前脸计划](testing/plans/vault-front-layout.md)、[TC-3D-009](testing/cases/slice/TC-3D-009.md)。HUD为¥与设置，无暂停入口；金库管理经理。

最新房间/路线修订：[计划](testing/plans/room-route-refinement.md)、[TC-3D-010](testing/cases/slice/TC-3D-010.md)。删除吊灯/排队装饰圈、表面规则纹路、金库牌上移；真实收款改为近B→远A，替代旧渲染路线映射。

最新性能/顾客动线：[计划](testing/plans/performance-exit.md)、[TC-3D-011](testing/cases/slice/TC-3D-011.md)。30fps/像素预算与缓存家具阴影，入店横道和每柜台独立出口；结构证据和实际浏览器/设备功耗验收分开记录。

当前清晰度/流畅度修订：[计划](testing/plans/smooth-clarity.md)、[TC-3D-012](testing/cases/slice/TC-3D-012.md)。默认随显示刷新+DPR2，通过固定步插值消除20Hz位置台阶，另可选平衡/省电；替代上一轮统一30fps/低画质取舍。实际GPU和Mac负载待验证。

当前顾客离店延伸：[计划](testing/plans/customer-boundary-exit.md)、[TC-3D-013](testing/cases/slice/TC-3D-013.md)。独立平行返程路走到入口侧边界，有限路口让行，删除地毯端箭头；连续路线、间距、满队活性与在途档原位迁移分别验证。

路线验收辅助：[计划](testing/plans/route-observability.md)、[TC-3D-014](testing/cases/slice/TC-3D-014.md)。明确 `?qa=1` 开启可折叠诊断与顾客 ID 标记；真实 core 事件/实际 mesh 位置/插值延迟分列。默认HUD及存档不变，诊断不是像素验收。

真实帧节奏诊断：[计划](testing/plans/performance-measurement.md)、[TC-3D-015](testing/cases/slice/TC-3D-015.md)。`?qa=1`可展开Performance QA，记录真实RAF提交节奏和现场负载；默认折叠无采样，FPS不冒充GPU完成帧或温度。
