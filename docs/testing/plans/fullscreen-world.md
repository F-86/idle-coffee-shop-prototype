# 全屏店面方向修订计划

2026-10-03，UTC；基线cb87787。依据用户看桌面、竖屏、横屏真实截图的反馈，新增REQ-3D-009–012和TC-3D-007。

覆盖：默认满viewport房间镜头、受限拖动、墙面咖啡/金库、柜台操作worldanchor、少量HUD、按需弹窗、44px触控与safe-area/dvh、DPR投影一致、暂停/销毁与缓存恢复回归；15个现有核心/保存/CAS测试必须仍过。

排除：经济/存档schema变化、更多咖啡/柜台、研发价格、iCloud接通、原生App、发布或部署配置变化。

CPU测试可以验证投影、命中、拖动边界和资源清理；HTML/CSS契约只验证结构。云浏览器localhost上一轮被ERR_BLOCKED_BY_CLIENT阻塞，不绕过；新像素和UI路径由Mac独立origin按focused QA执行。不得把旧截图当新版本证据。

报告：runs/2026-10-03-fullscreen-world/，记录PASS/FAIL/BLOCKED/NOT_RUN；记录开发中旧fit-plinth用例不适用与新的独立预期，不能为迎合实现降低用户“满场景”的标准。
