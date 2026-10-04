# Mac focused QA：房间纹路与近到远收款

只测试咖啡项目。沿用现任务已确认的repo/worktree，不猜Mac路径；正常fetch既有codex/light-3d-coffee-slice分支，核验父提供精确最终SHA/tree。无代码/main/部署修改。

1. npm ci；node --check app.js；npm run typecheck；npm test；npm run build。独立origin4187：npm run dev -- --host 127.0.0.1 --port 4187，打开http://127.0.0.1:4187/?qa=1。不得覆盖日常存档或把旧4186画面误认为本版。
2. 真实新三尺寸完整viewport截图：1280×900 desktop、390×844 portrait、844×390 landscape。100%zoom，记录browser/DPR/canvasrect与实际/模拟触控。全屏构图仍大店面、¥+设置，无暂停入口/网页卡片；portrait拖动可到全部墙牌。
3. 检查所有可达视角吊灯全部消失、地毯白圈消失；客人仍正常排队前移、出杯、取杯与离开。看墙/地规则纹路和接缝：同一实际表面方向连续，没有漂浮条、双重缝、额外灰线/不一致阴影或纹理跳变。保存近景截图，不只测源码中不存在mesh。
4. 金库经理等级牌完全在金库图标上方，有可见间隔且不会压住图标；和咖啡牌不任意重叠。三个尺寸经pan可达，真实3D表面文字/遮挡/光照，可点进同一vault-manager窗口并升一级，牌/弹窗同步。无推车经理第二入口。
5. fresh4187店观察至少两次完整收运圈，read-only window.__coffeeSliceDebug.readState()辅助记录managerRouteVersion、x/target/phase、两台pendingCash/carrying/wallet。从金库先靠近B（画面左柜台、x5/target1），再A（画面右柜台、x0/target0），回金库x8.8/target2。柜台钱收走才进入carrying，到金库才加wallet；不要仅凭动画朝向判断顺序。拍B→A→金库序列或时间记录。刷新中途运输后位置/钱连续，保存一次后不重复迁移。
6. 柜台前脸selector/升级可读可点；小笔现金与金额纸牌在相同实物区域，收走同消失，normal深度拾取不穿人。维持原配方快照/费用规则。无新增漂浮DOM。
7. settings/popup ×、Escape、背景、asyncclose/reopen、键盘focus，drag/hold/cancel/二指/DPR/dvh/safearea回归；后台/前台、Back/Forward一次性与保存保护。旧当前两柜台迁移/离线失败竞争/坏档核心已有自动覆盖，不修改日常档制造故障。iCloud仍未配置。

若input工具timeout，报告确切阶段/已拍图/未测项，不重复声称通过。返回精确SHA、逐项PASS/FAIL/BLOCKED、新三scene-fill图、金库间隔/地毯/墙地纹路近景与B→A→金库存款证据。CPU/NullEngine不能代替本次实际像素验收。
