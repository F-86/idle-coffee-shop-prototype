# Mac focused QA：左金库、前脸选择器与现金金额

只测试咖啡项目，正常fetch同一codex/light-3d-coffee-slice任务分支，核验父提供最终SHA。不改代码/main/部署，沿用现任务目录或干净worktree，不猜路径。

1. npm ci；node --check app.js；npm run typecheck；npm test；npm run build。独立origin：npm run dev -- --host 127.0.0.1 --port 4186，打开 http://127.0.0.1:4186/?qa=1。
2. 先拍新完整viewport实像：1280×900 desktop、390×844 portrait、844×390 landscape，100%缩放，记录browser/DPR/canvasrect，区别模拟触控和真机。HUD¥金额+设置，没有暂停入口或墙面设置/暂停大牌。
3. 金库必须位于所有咖啡牌画面左侧；竖屏可拖过去看，不能因worldX负数就误称左侧。金库实体显示经理等级，点开同一金库窗口看金额/经理并升一级，等级和实体同步。点经理/推车不另开管理窗；纸钞运输依然可见，没有大clipboard屋顶。
4. 两柜台配方贴前脸，不立台面牌。用近景拍它与升级牌，中文可读、实际点击面积够大，正常深度/光照/透视；服务顾客不能永久挡住唯一选择入口。配方切换/升级后一杯快照规则和money成本正常。
5. 台面金额在纸钞真实位置，非高收银牌或HUD。等第一小笔钱和较大待收金额，拍金额/现金同区并检查文字可读；长完整金额会缩字号适配，CPU的约11px名义字高只覆盖短样本，并不保证所有长金额；经理收走金额和纸钞同时消失。平移后位置仍绑定，点击实物不得穿透人物/物件。经理实际抵达左金库才存入wallet，90秒链观察。
6. 设置HUD点击/键盘Enter可用；打开popup时背景不能pan/交易，×/Escape/背景关闭，内部空白不关。菜单分配→关窗→相机到柜台，设置jump→关窗→物件焦点；异步close/reopen不失效。金额区域无动作、不能穿透触发背后实体。
7. 画布拖动、>800ms长按、拖出回来、取消/二指、捕获丢失不误触；keyboard左右选八个实体、上下pan、Home回A、Enter/空格，只一次。无暂停/继续热键。dvh/旋转safearea仍满屏可达。
8. 刷新、后台/回前台、Back/Forward和local-save回归；当前iCloud未配置。旧有效暂停档恢复路径已CPU覆盖，不改日常档制造暂停，也不要将fakeDOM结果写成浏览器通过。

返回最终SHA、逐项PASS/FAIL/BLOCKED，三张新scene-fill、金库经理、柜台前脸+纸钞金额的近景，以及popup/关闭后证据。若牌仍太小、被长期挡住、金库不在画面左侧、现金UI仍悬上方，直接FAIL附最短复现。
