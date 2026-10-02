# 测试文档入口

这里的集成测试由 AI 使用 Computer-Use / Browser-Use 执行，验证玩家可观察行为。用例先于实现定义，产品尚未实现不妨碍用例进入规划。

```text
testing/
├── standards.md       # 文档规则、状态、完成门槛、缺陷规范
├── execution.md       # AI 执行约束
├── coverage.md        # 需求与用例覆盖关系
├── plans/             # 本轮或里程碑范围：只引用用例
├── cases/             # 功能域/模块/场景/TC-*.md
├── shared/            # 公共准备流程和数据契约
├── templates/         # 用例、计划、缺陷、运行报告
└── runs/              # 每轮结果、问题、证据
```

开始编写时阅读 [文档规范](standards.md)，开始执行时阅读 [执行规范](execution.md)。从 [覆盖矩阵](coverage.md) 找用例，从 [M1 计划](plans/m1-core.md) 查看首批示例引用。

用例的 draft 状态与实际执行结果分开记录，不代表完整产品验收结果。2026-10-02 已执行 HUD 与候客层命中目标回归，见 [运行报告](runs/2026-10-02-hud-queue-hit/report.md)；完整 TC-UI-007 与整场景验收未据此标记通过。
