# 金库与柜台前脸布局计划

2026-10-03 UTC，基线0b60acc。用户已看Mac版后要求HUD加设置、移除暂停、金库在咖啡墙视觉左侧并管理经理，柜台前脸配方选择，金额与现金同位置。新增REQ-3D-016–018/TC-3D-009。

范围：八个经营实体入口，¥与设置HUD，无pause/settings/manager场景Action；金库经理单入口；前脸控件、现金区金额、可视经理路线映射；有效暂停档恢复当前营业，失败/冲突保护保持。core/经济/保存schema/CloudKit及部署不动。

验证：核心原15测试；NullEngine三尺寸/DPR、面板左排序、44px实际物理面、正常遮挡、manager route连续性/停靠、现金与金额绑定、资源清理；真实main+core/repository的应用harness回归。Syntax/typecheck/test/build及最终staged diff检查。

本云端已有ERR_BLOCKED_BY_CLIENT限制，不绕过；实际新像素、Safari/触控/弹窗/字体/构图交Mac独立origin4186，不能将输入旧截图充作新版本证据。
