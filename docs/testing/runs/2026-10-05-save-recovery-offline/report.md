# 离线策略分支的存档保护移植记录

2026-10-05 UTC；移植基线3c61f6f1adfa35dfaf8fffc40ba022619a7b0395（已有ba7离线策略），分支codex/save-recovery-safety-offline。上游独立场景基线修复：[8a8ea97](https://github.com/F-86/idle-coffee-shop-prototype/commit/8a8ea9767529b7deeeaf45a4aed20978a82284e4)。当前Mac预览应更新上游场景基线提交，不应为获得本修复切入本离线策略分支。

环境：云端隔离工作区、Node v24.19.0、实际核心/仓库/main handler、内存存储和模拟时钟。未访问用户浏览器或日常存档。

## 验证

- PASS：全量224/224，0失败；TC-3D-019共14项新用例，其中8项实际main handler流程和6项仓库直接调用。
- PASS：语法、typecheck、默认build、既有Pages base build、diff检查。
- PASS：保留TC-3D-017已有短时/29.9/30/30.1秒/上限、隐藏/刷新一致性、暂停/时钟回拨/迁移/只结算一次测试。
- PASS：此分支特有的后台结算写失败→读取失败→存储恢复链保留570分店及旧字节；只有成功重新读取才结算原有半速区间，重复读取不重复结算。
- PASS：settleInterval拒绝/写失败和settleOffline无效时间锁住仓库；存储恢复后直接save/settleOffline也不能绕开，需成功load或明确reset。
- PASS：原始档及有效当前副本分开导出；启动占位不可导出；取消/备份失败/移除失败/并发替换保护均保留。
- PASS：独立只读审阅无阻断问题；隔离全量222项和两种构建通过，额外重复claim拒绝/CAS冲突后原字节返回仍保持屏障两项通过并纳入正式套件。
- NOT_RUN：真实Mac、原生确认/下载和像素。假DOM不是浏览器验收。

构建只有既有>500kB块提醒。没有更改经营engine/types、3D场景/render、style、依赖或Pages工作流。保留本分支原有resumeVisible事务式离线流程和policy-v2，不把场景分支的旧离线流程移过来。没有合并main、发布/部署或修改用户预览。
