# 运行记录

每次实际执行创建 `YYYY-MM-DD-HHMM-plan-name/`，包含 `report.md`、`bugs/` 和 `evidence/`。没有问题时无需创建空 bugs 目录。

从 [运行报告模板](../templates/test-run.md) 开始，问题使用 [缺陷模板](../templates/bug-report.md)。证据建议命名 `TC-ECO-001-B-equal-C-attempt-1-step-2.png`，报告通过相对链接关联。

当前运行报告：

- [2026-09-21 2.5D 场景入口分层、升级摘要与视口回归](2026-09-21-1402-ui-entry-routes/report.md)：REQ-UI-001 / REQ-UI-002 / REQ-UI-004 / REQ-UI-008；保留修复前详情与升级牌误触证据，修复后复测柜台详情、咖啡选择器、咖啡墙解锁/切换、候客地毯催单、弹窗焦点和五个视口。
- [2026-09-20 2.5D 顾客左右动线与满位离店](2026-09-20-0132-25d-customer-flow/report.md)：REQ-QUEUE-002 / REQ-QUEUE-003 / REQ-UI-007；定向验证左右入口出口、前景地毯、经理后场路线和当前容量下的满位离店动画，正好10人 fixture 尚未执行。
- [2026-09-20 方块人物清晰度](2026-09-20-0051-character-clarity/report.md)：REQ-UI-006 / TC-UI-006；验证硬边 Phaser 渲染、人物显示尺寸和桌面/横屏融合。
- [2026-09-20 场景 world、顾客候客区与咖啡图标选择](2026-09-20-0045-scene-world-icons/report.md)：REQ-QUEUE-002 / REQ-UI-005；验证左侧入店与容量地毯、共同场景坐标祖先、独立咖啡图标选择器和横屏回归。
- [2026-09-20 柜台点击与自动制作统一](2026-09-20-0017-unified-counter-rush/report.md)：REQ-PROD-002 / TC-ORDER-001；验证点击柜台直接结算当前 brew、交付并产生待收现金，页面移除订单入口与订单弹窗。
- [2026-09-19 柜台直达手作与出杯动画修复](2026-09-19-2342-direct-handcraft/test-run.md)：REQ-ORDER-003 / TC-ORDER-001；保留点击层和杯子放大基线失败，修复后直达路径与动画均通过。
- [2026-09-19 横屏优先场景层级与文字可读性](2026-09-19-1933-horizontal-ui-pass/test-run.md)：TC-UI-004；保留 844×390 基线失败，修复后四个视口实际回归通过。
- [2026-09-19 Vite / React / TypeScript / Phaser 迁移验收](2026-09-19-1030-vite-react-migration/test-run.md)：迁移门槛 smoke；明确列出首次弹窗回归及修复后复测、未执行的正式产品回归。
- [2026-09-19 Phaser / M1 核心经营](2026-09-19-0925-phaser-m1/test-run.md)：阶段 0 基线。
- [阶段 1 Vite / React / TypeScript 工程骨架](2026-09-19-0945-vite-stage1/test-run.md)：历史阶段记录。

文档建立、源码检查或历史报告引用均不能替代本轮实际浏览器测试；每份报告的范围和未执行项以报告正文为准。
