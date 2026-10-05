# Mellow Bean · 轻量 3D 咖啡店

原创低多边形放置咖啡店的简易方向预览。双门剖面小店、浓缩/拿铁、共享原料与手动采购，先闭合可见经营链，正式平衡仍在调参。

## 运行

Node 24 推荐。npm install 后 npm run dev，打开输出的本地地址。遇到环境禁止枚举网卡时可用 npm run dev -- --host 127.0.0.1。

提交前：node --check app.js、npm run typecheck、npm test、npm run build。npm run preview 检查生产包。默认 index.html 已是新版；旧版仅保留在 Git 历史，不承担旧存档兼容。

## 玩法

客人从右门进入，等候出杯后外带或堂食，从左门离开。交杯时货款直接进入可支配余额。全店共用豆/奶，制作开始扣料；缺料后停止新制作，需要玩家打开底部「原料」主动购买。

- 底部有图小栏提供咖啡、原料、背景、家具和招客；实体柜台仍可选配方/升级。
- 浓缩用一份豆，拿铁用一份豆和一份奶，水免费。原料可单份、一批或补满购买；不自动补货、不透支。
- 浓缩速度快、拿铁售价高；柜台有不同擅长。在制杯不因升级、换配方或刷新改变，不重复扣料。
- HUD显示余额与暂停营业。暂停后已有客人完成或空手离店，清场后才能装修；完成/取消装修仍保持暂停，恢复营业需主动点击。
- 独立版本化本地档自动保存；离线按80%经营速度推进且无时间上限，但有限库存用完就停止新制作。旧未结区间按旧规则安全结算一次。
- 手动文件导出/导入保留库存。坏档/冲突保护、长离线可取消批处理不变；实际备份和用户存档需单独保管。
- 数值暂定：若花光余额且原料耗尽，可能无法继续生产；本轮没有未经确认的自动救济或强制留款。

iCloud/CloudKit 只预留 AuthProvider / SaveRepository 边界，真实容器/账户尚未配置。当前只在本浏览器保存，不声称跨设备同步或已具备原生 App/PWA。

## 项目说明

- [文档导航](docs/README.md)
- [行为规格与调参边界](docs/product/specs/light-3d-slice.md)
- [实现与 CloudKit 目标边界](docs/development/light-3d-preview.md)
- [测试计划](docs/testing/plans/light-3d-slice.md)

使用 @babylonjs/core 9.29.0（Apache-2.0）。几何、材质、角色由代码原创生成，无外部贴图或游戏原作素材。既有 GitHub Pages 工作流与发布目标保持不变；本轮先推任务分支评审，不修改默认分支或部署设置。

全屏反馈修订的规格见REQ-3D-009–012，[测试计划](docs/testing/plans/fullscreen-world.md)。实际新版本视觉验收需独立Mac截图。

实体嵌入操作见REQ-3D-013–015，[新计划](docs/testing/plans/embedded-scene-controls.md)。所有操作只拾取真实可见几何，支持canvas键盘访问；新像素尚待Mac独立验证。

最新布局按REQ-3D-016–018执行：[金库与柜台前脸计划](docs/testing/plans/vault-front-layout.md)。技术暂停只保留给核心/存档冲突，不提供玩家热键。

最新房间/路线按REQ-3D-019–021执行：[计划](docs/testing/plans/room-route-refinement.md)。删除吊灯与排队装饰圈，墙地规则纹路、金库牌在图标上方；真实core与画面统一B→A→金库，当前两柜台档进行一次性路线转换，剩余旧轮安全收完后改顺序。

清晰度/连续运动按REQ-3D-024执行：[计划](docs/testing/plans/smooth-clarity.md)。默认清晰流畅随屏幕刷新、DPR≤2/800万像素，20Hz核心通过相邻步插值连续呈现；设置可选同等清晰度的“清晰 60 帧”、平衡或省电。保留缓存家具阴影与按值更新字牌；默认比上一版低画质30fps需要更多绘制，实际帧时/温度仍待设备验收。

离店边界按REQ-3D-025执行：[计划](docs/testing/plans/customer-boundary-exit.md)。持杯顾客走侧道，再沿独立平行返程横道走到入口侧边界外才消失；有限交叉口让行，不共用进店道路、不穿过人群。地毯端和旧出口箭头已删除；v2在途档原位延长，新旧档资金/冲突保护继续回归。

可用 `?qa=1` 展开Performance QA记录前台帧提交节奏，详见[真机测量计划](docs/testing/plans/performance-measurement.md)。默认不采样；须用独立测试存储。FPS/帧间隔不代表GPU完成时间、上屏帧或温度。

新增独立清晰60帧选项见REQ-3D-026：[计划](docs/testing/plans/clear-60.md)。保留默认与已有选择；同等清晰度只限渲染提交率，不改变经营/存档。新选项真机对比结果独立记录，不推断温度收益。

离线80%/无上限见REQ-3D-030：[实施与验证计划](docs/testing/plans/offline-unlimited.md)。不使用平均收入直发金库；完成前不写投机结果，取消或保存失败可重试。长离开可能需要等待计算，进度会显示；真实设备速度另行验收。

底部装修目录与真实拖拽按REQ-3D-036执行：[规格](docs/product/specs/renovation-drag-catalog.md)、[验证计划](docs/testing/plans/renovation-drag-catalog.md)。装修时从底栏拖出柜台、桌椅和咖啡墙牌，直接拖动已有物件；绿色可放，红色说明原因，完成时才结算。取消不扣款，咖啡牌收纳不丢配方/等级；初始及装修后的地毯/路线箭头已移除。布局1安全迁移至布局2。

手动原料按REQ-3D-040–042执行：[规格](docs/product/specs/manual-ingredient-stock.md)、[计划](docs/testing/plans/manual-ingredient-stock.md)。经济5/文件5/离线策略4，布局仍3。此前版本记录以下历史交互已被最新规格替代。
