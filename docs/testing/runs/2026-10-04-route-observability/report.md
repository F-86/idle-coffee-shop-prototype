# 路线 QA 可观测性执行报告

- 时间：2026-10-04 17:52–17:54 UTC
- 分支：`codex/light-3d-coffee-slice`；基线 `b5df3379dc8c7f6f3d5ba4630fd0ce194049ca8c`；本报告随被测变更提交。最终源代码内容见 [SHA-256清单](source-sha256.txt)。
- 环境：cloud Linux；Node v24.19.0；Babylon 9.29.0；TypeScript 7.0.2；Vite 8.3.0。
- 用例：[TC-3D-014](../../cases/slice/TC-3D-014.md)，辅助REQ-3D-020/025。

## PASS：自动验证

- `node --check app.js`
- `npm run typecheck`
- `npm test`：170/170 PASS，0 FAIL/SKIP；约14.9秒真实执行时间。完整结果见 [automated-tests.txt](automated-tests.txt)。
- `npm run build`，以及现有Pages base路径构建 `npm run build -- --base=/idle-coffee-shop-prototype/`。
- `git diff --check`。
- 独立代码复核：三个相关测试集96/96通过；发现并修复了同tick阶段丢失/转移坐标偏移，再增加直接回归用例。最终全量170项包含后来增加的读档/新店/无WebGL/旧路线标记测试。

轨迹确定性使用90模拟秒整段、20Hz和144Hz推进；有限内存测试600模拟秒。经理使用显式测试资金，验证B200分→A100分→金库300分且中途经过B无二次收款。观察者改写接收对象/抛错、暂停、离线、保存/恢复均不改变完整核心状态或业务事件。

实际mesh位置/ID及投影坐标由NullEngine测试，DOM选择/清理/单RAF/无渲染器文案由fake-DOM应用harness测试。二者不当作GPU或真实像素证据。

## BLOCKED / NOT_RUN：浏览器与路线视觉

尝试在独立测试origin `http://127.0.0.1:5194/?qa=1` 打开新版面板，cloud browser返回 `net::ERR_BLOCKED_BY_CLIENT`，未取得页面渲染证据、未尝试绕过。Vite以127.0.0.1正常启动；0.0.0.0启动时环境枚举接口返回系统错误，非产品错误。

- 新面板真实浏览器像素验收：BLOCKED（上述地址拒绝）。
- 完整同ID顾客/经理真实渲染连续路线验收：NOT_RUN，本提交未关闭此前剩余视觉验收项。
- 用户Mac设备、GPU帧时/温度：NOT_RUN。

可在现有授权部署更新后，用支持WebGL的独立测试浏览器以 `?qa=1` 按TC-3D-014连续跟踪；标签/轨迹仅辅助识别，不构成视觉PASS。默认页面无调试UI，普通HUD仍为¥/设置；QA不隔离原保存逻辑，需独立测试存储。

## 已知边界

- build存在大于500kB chunk提醒，构建成功；本次不更改打包/部署配置。
- 中心线crossing不是碰撞或等待原因判定；投影inViewport不是无遮挡判定。
- 诊断历史有限；切后台恢复/离线跳跃、读档、新店重置会话与选择，不连续拼接旧ID。
- 未改schema、经营参数、正常渲染素材/模型或Pages工作流；无网络遥测。
