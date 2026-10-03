# 实体嵌入操作反馈修订：云端验证

2026-10-03 UTC。基线fce3e7cc92438b51da57538480a39376d298cd48，codex/light-3d-coffee-slice任务分支。最终云端聚合通过；CPU检查不代表视觉通过。

## 输入与修改

已通过Library在本云端实际materialize并查看最新Mac三张截图像素：desktop1280×900、portrait390×844、landscape844×390。输入文件名为1280x900-desktop(1).png、390x844-portrait(1).png、844x390-landscape(1).png。旧三图显示全屏店铺方向有改善，但墙上菜单与柜台牌仍被屏幕朝向DOM标签覆盖，暂停/设置也仍是HUD。这些图只用作本轮问题证据，不冒充新版本截图。

本轮取消全部常驻worldanchor DOM按钮，钱包独立显示¥两位小数；全部操作由墙面、柜台、入口、金库和推车实物承担。文字是实体表面的DynamicTexture漫反射材质，正常depth与light，无billboard或alwaysOnTop。悬浮制杯条/台面金额改为机器和柜台显示。详细管理仍仅按需native dialog。

实体输入统一canvas捕获，最近前方实物阻挡拾取；按下与抬起必须相同实体，有drag/hold/cancel/secondary/capture-loss保护。窗口打开时显式禁用renderer交互并取消活动捕获，关闭恢复canvas。针对原生dialog.close()异步派发close事件，代码在open移除后立即恢复交互，保障菜单分配/设置跳转后的focusAnchor有效；旧close事件不能清掉已经重新打开的新窗口。这个时序依据[HTML Standard的dialog关闭步骤](https://html.spec.whatwg.org/multipage/interactive-elements.html#close-the-dialog)，用延迟close事件的独立应用用例复现和回归。键盘通过可聚焦canvas选真实物件/平移/激活，没有常驻网页工具栏；初始focus ring内嵌避免满屏裁掉。临时物件名称只在键盘操作需要时出现。

所有共享core、经济参数、存档schema、离线及CloudKit边界保持基线不变。¥是虚拟咖啡金额展示，没有真实支付功能。

## 最终云端检查

最终源代码冻结后聚合执行，Node24.19.0 / TypeScript7.0.2 / Vite8.3.0 / Babylon9.29.0。

- node --check app.js：PASS
- npm run typecheck：PASS
- npm test：65/65 PASS（15核心/保存/CAS，31Babylon NullEngine，19独立UI源码/真实main应用handler）
- npm run build：PASS；主JS993.57KB / 243.10KB gzip。500KB chunk警告保留，没有人为压掉警告。
- 既有Pages路径的本地base构建：PASS（本地输出检查，不是部署）；最终归档dist为默认本地路径构建。
- git diff --check：PASS
- core、package/lock及.github与fce3e7c diff为空；经济/schema/部署未变。
- [源码SHA256](tested-source.sha256)、[测试日志](test-output.txt)、[构建日志](build-output.txt)保留。

31场景检查包括十一实体入口在三viewport/DPR1/1.75下的真实face边间距，聚焦后各实体内能放44px圆形目标，landscape最小44.50 CSSpx；这不是扩大透明hitbox的bbox。正常opaque/lit/depth写入、真实前方遮挡、同对象按下/抬起、移动又返回仍作废、popup暂停捕获与销毁；固定相机房间fill和受限pan仍覆盖各边角。升级牌移到侧前方避免排队顾客完全挡住；wall菜单避开灯具。制杯进度成为机器前面板，台面金额成为固定收银显示，第一小笔纸钞可见。

经理推车为固定世界方向的真实宽托盘，跟随经理平移、经理独立转身，不绕进墙/柜台/咖啡师。全服务路线x−8…5检查每个推车后代与所有可见opaque房间几何不相交；现金区有支撑，后部clipboard不盖住运送现金。两个收款停靠点和金库纸钞前方可见；途中短暂被真实人物/机器遮挡是正常深度，不强行总在最上层。为了真实44px目标车体有增大，最终比例/文字观感须Mac检查。

19应用检查执行真实main.ts handler+真实core/repository（fakeDOM/scene只替代宿主环境），覆盖唯一¥HUD、钱包阻断背后拾取、全部sceneAction、keyboard/repeat/modifier、dialog切换/关闭/异步close/reopen、配方/升级/导航、保存/export精确字节、坏档/不可存储、外部冲突阻断、暂停、BFCache一次性与一个RAF、销毁和晚action。按需popup是否原生inert及hit-testing仍要真实浏览器验证。

独立审查发现并复现：canvas外侧focus outline被满屏裁掉；异步close事件导致关窗后物件导航被禁用；旧close事件可能拆掉新窗口；经理初版宽clipboard遮现金/随人物转身扫入家具。各项均修复并回归；没有用透明点击箱或取消正常遮挡来绕过。


## 新像素与用户验收

此云端浏览器上一轮localhost报ERR_BLOCKED_BY_CLIENT，遵守限制未使用替代browser或shellrender绕过。本轮新场景pixel/原生Safari触控、depth观感、字体可读性、真实dialog、地址栏/旋转/safe-area以及90秒玩家完整资金链，仍需Mac独立origin4185执行[focused QA](local-qa-prompt.md)。没有新视觉PASS声明。

CPU/NullEngine验证投影几何尺寸、depth ray命中与生命周期，mockDOM应用harness验证真实main handler与真实core/save行为；这些不能证明最终像素或触控手感已经通过。
