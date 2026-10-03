# Mellow Bean · 轻量 3D 咖啡店

原创低多边形放置咖啡店的简易方向预览。两个柜台、浓缩/拿铁、一名收钱经理，先闭合可见经营链，正式平衡仍在调参。

## 运行

Node 24 推荐。npm install 后 npm run dev，打开输出的本地地址。遇到环境禁止枚举网卡时可用 npm run dev -- --host 127.0.0.1。

提交前：node --check app.js、npm run typecheck、npm test、npm run build。npm run preview 检查生产包。默认 index.html 已是新版；旧版仅保留在 Git 历史，不承担旧存档兼容。

## 玩法

客人自动进入、排队、等候出杯、取杯离店。钱先留在台面，经理沿柜台后通道收走并送回左侧金库；到账后才能购买升级。

- 点入口招客、柜台等级牌升级、后墙菜单切换配方；底部同样提供触控按钮。
- 浓缩速度快、拿铁售价高；两个柜台有不同擅长，制作中切换不会追改当前杯子。
- 手机横向滑动店面，经营卡片与存档控制可直接触控。
- 独立版本化本地档自动保存；暂停、恢复、有限离线收益、坏档保护和导出备份。

iCloud/CloudKit 只预留 AuthProvider / SaveRepository 边界，真实容器/账户尚未配置。当前只在本浏览器保存，不声称跨设备同步或已具备原生 App/PWA。

## 项目说明

- [文档导航](docs/README.md)
- [行为规格与调参边界](docs/product/specs/light-3d-slice.md)
- [实现与 CloudKit 目标边界](docs/development/light-3d-preview.md)
- [测试计划](docs/testing/plans/light-3d-slice.md)

使用 @babylonjs/core 9.29.0（Apache-2.0）。几何、材质、角色由代码原创生成，无外部贴图或游戏原作素材。既有 GitHub Pages 工作流与发布目标保持不变；本轮先推任务分支评审，不修改默认分支或部署设置。
