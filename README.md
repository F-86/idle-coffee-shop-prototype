# Mellow Bean · 轻量 3D 咖啡店

原创低多边形放置咖啡店的简易方向预览。两个柜台、浓缩/拿铁、一名收钱经理，先闭合可见经营链，正式平衡仍在调参。

## 运行

Node 24 推荐。npm install 后 npm run dev，打开输出的本地地址。遇到环境禁止枚举网卡时可用 npm run dev -- --host 127.0.0.1。

提交前：node --check app.js、npm run typecheck、npm test、npm run build。npm run preview 检查生产包。默认 index.html 已是新版；旧版仅保留在 Git 历史，不承担旧存档兼容。

## 玩法

客人自动进入、排队、等候出杯、取杯离店。钱先留在台面，经理沿柜台后通道收走并送回左侧金库；到账后才能购买升级。

- 点入口招客、柜台上的配方/等级牌、墙上的咖啡菜单和金库；详细操作只在弹窗中显示。
- 浓缩速度快、拿铁售价高；两个柜台有不同擅长，制作中切换不会追改当前杯子。
- 整个viewport为店面，手机拖动镜头逛店；咖啡和金库在墙上，配方/升级控件在柜台上。常驻HUD只有¥金额，暂停/设置也在墙上真实物件中，详细操作按需弹出。
- 独立版本化本地档自动保存；暂停、恢复、有限离线收益、坏档保护和导出备份。

iCloud/CloudKit 只预留 AuthProvider / SaveRepository 边界，真实容器/账户尚未配置。当前只在本浏览器保存，不声称跨设备同步或已具备原生 App/PWA。

## 项目说明

- [文档导航](docs/README.md)
- [行为规格与调参边界](docs/product/specs/light-3d-slice.md)
- [实现与 CloudKit 目标边界](docs/development/light-3d-preview.md)
- [测试计划](docs/testing/plans/light-3d-slice.md)

使用 @babylonjs/core 9.29.0（Apache-2.0）。几何、材质、角色由代码原创生成，无外部贴图或游戏原作素材。既有 GitHub Pages 工作流与发布目标保持不变；本轮先推任务分支评审，不修改默认分支或部署设置。

全屏反馈修订的规格见REQ-3D-009–012，[测试计划](docs/testing/plans/fullscreen-world.md)。实际新版本视觉验收需独立Mac截图。

实体嵌入操作见REQ-3D-013–015，[新计划](docs/testing/plans/embedded-scene-controls.md)。所有操作只拾取真实可见几何，支持canvas键盘访问；新像素尚待Mac独立验证。
