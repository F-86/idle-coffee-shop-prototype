# 轻量 3D slice 执行计划

2026-10-03，UTC。基线：light-3d-slice v0.1，精确调参仍为 draft。

覆盖 TC-3D-001 经营资金闭环、TC-3D-002 配方/升级快照、TC-3D-003 确定性/重复输入、TC-3D-004 恢复/坏档/离线、TC-3D-005 双客户端 CAS/幂等、TC-3D-006 3D场景/触控/销毁。

核心与持久化可用独立时间模拟完成；不能把它们标作浏览器路径通过。浏览器须通过真实 UI 检查，若平台路由阻塞记录 BLOCKED，再提供 Mac 独立测试 origin 的最小 QA 提示。不得操作用户 Mac。

不包含：原生 App 打包、真实 CloudKit 账户/容器、广告、八柜台扩展、付费服务、发布或修改部署配置。旧版仅保留在 Git 历史，不纳入此次回归。

运行产物在 docs/testing/runs/2026-10-03-light-3d-slice/。报告分开 PASS/FAIL/BLOCKED/NOT_RUN，不凭静态检查宣称完整浏览器验收。
