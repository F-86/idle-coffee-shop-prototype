# 清晰60帧选项实现与验证

2026-10-05 UTC；基线`7d419844fc0f8388784038616f509606d974e2c9`；既有任务分支`codex/light-3d-coffee-slice`。本报告随实现提交；精确被测源码见[SHA-256](source-sha256.txt)。没有main合并或部署。验证环境：Linux x86_64，Node v24.19.0，npm 11.9.0。

## 结果

新增“清晰 60 帧”独立选择（`clear-60`）：与smooth完全相同的DPR≤2/800万像素，只在既有渲染预算设60fps上限。设置四项两列、原生按钮、aria-pressed与可访问分组/说明；明确平衡/省电的清晰度取舍。原默认smooth和所有已有合法偏好不变。

生产改动仅RenderBudget配置/类型、设置文案/按钮、两列CSS。没有core、FrameInterpolator、CoffeeScene、保存/QA采样实现、依赖、工作流或部署修改。QA复用动态模式/目标显示；测试fake场景的目标帧率也补齐新选择。

## PASS：自动化与构建

- 新增6项TC-3D-016在基线实现上均确实失败，见[基线失败输出](baseline-test-failures.txt)；实现后6/6通过。
- `node --check app.js`、`npm run typecheck`、`git diff --check`：PASS。
- `npm test`：194/194 PASS，0 FAIL/SKIP，命令耗时9.93秒，见[全量输出](automated-tests.txt)。包含30–240Hz限帧、同smooth像素预算、所有模式经营快照/事件、插值、生命周期、现有存档/偏好读回、重复选择/关闭重开、写偏好失败和QA新段。
- 120Hz模拟10秒下clear-60正好600次提交，经理直线插值每次2.6/60，核心快照和写出存档与参考`advance(10)`完全一致。旧smooth/balanced/low-power及无偏好加载保持原选择；切换不改现有游戏存档原字节，独立新偏好可以读回。
- 默认生产构建：PASS，主JS`index-ILs_nGtN.js`、CSS`index-BRwwP7sf.css`；见[构建输出](build-output.txt)。
- 既有Pages路径独立outDir构建：PASS，主JS`index-x7QKjU9m.js`、同CSS；见[Pages构建输出](pages-build-output.txt)。这是本地构建检查，不是部署。既有主包>500kB警告仍在。

## 独立审查

只读独立审查未发现阻断。独立运行render-budget、frame-interpolation、fullscreen-ui、coffee-scene、frame-diagnostics相关测试150/150 PASS，typecheck与diff --check通过。额外确定性抽样：100,000次不规则/重复RAF输入与既有balanced 60fps调度逐项一致且时间守恒；10,000组viewport/DPR下clear-60与smooth采样计算完全相同。审查明确只覆盖CPU/DOM-harness/NullEngine，真实浏览器布局、屏幕阅读器、Mac节奏/像素/功耗不包含在这项PASS内。

## 实现提交时的真机状态与后续记录

本实现提交时的证据只有真实命令执行、模拟时钟应用harness和NullEngine，不能当作真实浏览器、字牌清晰度、GPU、上屏帧或温度验收。本轮未重新尝试此前被云浏览器安全限制拒绝的本地origin，也未绕过该限制。当时新的Mac三段对比尚未运行；历史smooth/balanced/low-power/smooth的120/60/30/120fps数据不是clear-60数据。

当时的后续计划是按[清晰60帧计划](../../plans/clear-60.md)在已授权Mac独立origin验证smooth→clear-60→smooth，每段30真实秒预热+≥60秒有效采样；保留精确commit/资源、实际buffer、完整冻结文本与场景上下文。实测buffer应一致，60为提交上限。三段自然经营负载变化不冒充严格同状态A/B。温度/功耗没有传感或系统读数则仍NOT_RUN，不宣称降温。

后续已在固定本实现提交`b1ebbdd8dcd1994d3ac0da6a735e2422be5e13ea`上完成Mac三段观察：[真机记录](../2026-10-05-clear-60-mac/report.md)。三段累计120/60/120fps、buffer均3344×2074，clear-60刷新持久化通过。此后`ba7c6e0`离线边界修复是另一版本，不能由该记录宣称真机验收；像素可读性、功耗/温度仍NOT_RUN。
