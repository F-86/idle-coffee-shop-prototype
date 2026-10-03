# 全屏世界反馈修订：云端验证

2026-10-03，UTC。基线cb87787，仍是codex/light-3d-coffee-slice任务分支；未改main或部署设置。

## 来源与修改

已从Library实际读取并观察旧版本Mac desktop1280×900、portrait390×844、landscape844×390截图像素。旧图显示网页页头与常驻经营卡片；竖屏局部canvas裁到大片空白，横屏scene被网页头部和固定高画布挤出viewport。用户明确要求整个屏幕是场景，操作嵌入墙面/柜台，仅少量HUD。

新实现默认100vw×100dvh真实viewport画布，无外层frame或页面滚动。连续地面/墙体、局部放大的固定角度镜头和受限拖动替代fit完整plinth。墙面两款咖啡/金库、柜台配方/等级牌、入口和经理共9个worldanchor，DOM触控牌与3D拾取共享坐标和DPR规则。HUD仅余额/状态、暂停与设置；详细经营和保存操作只在一个按需native dialog里。

所有共享core、保存schema、经济参数和CloudKit边界保持cb87787不变。两款咖啡原本均可用，“已解锁”不添加新解锁价格/研发。补充Babylon许可证与NOTICE到public/licenses，随构建带出。

## 实际检查

环境Linux/Node24.19.0，TypeScript7.0.2/Vite8.3.0/Babylon9.29.0。

- node --check app.js：PASS
- npm run typecheck：PASS
- npm test：38/38 PASS（15核心/保存/CAS，17Babylon NullEngine，6HTML/CSS/handler契约）
- npm run build：PASS，主JS约991KB/242KB gzip，500KB chunk警告仍保留
- git diff --check：PASS
- shared core/配置与基线diff：无变化

17场景检查包括：三种实际viewport＋DPR1/1.75的9目标投影/焦点/拾取、满视口连续表面ray覆盖、极端拖动边界与固定摄影角度、pointercapture所有权/取消/销毁、入口/配方/菜单/金库/经理状态、移动经理anchor，以及从扩大DOM控件范围开始的单击/长按/拖出返回/重复pointerup不误触。初始portrait柜台A升级/选择器/浓缩菜单可見，landscape两菜单与两升级牌在HUD下可見。

6界面契约只证明源码结构：viewport/dvh/无网页frame，少量HUD，9真实anchor，closed native dialog中的按需panel，44px/safe-area/resize/清理，以及实际委托click handler忽略pointer-click但保留keyboard-click。不是Safari DOM或像素通过。

独立审查指出并修复：DOM牌普通click绕过画布gesture；开着的窗口从金库切到经理时旧焦点隐藏；移动物件关闭后焦点可能不可见。如今DOM pointerdown复用同一个canvas捕获/拖动/长按路径，指针合成click忽略、键盘click保留；切panel焦点到关闭按钮，必要时关闭回设置。物件投影有全触控宽度/HUD上方安全带，focus导航避免边缘裁切。

## 未验证与交付边界

上一轮云浏览器localhost明确ERR_BLOCKED_BY_CLIENT，未绕过。此轮没有实际新版本截图，旧图仅用作问题证据。房间ray覆盖、projection和CSS100%均不能代表用户的视觉方向已认可。

TC-3D-007真实scene-fill三尺寸、新像素/shader/触控/地址栏/旋转/弹窗/BackForward，以及完整玩家资金链：仍BLOCKED于云端，交给[Mac focused QA](local-qa-prompt.md)。真实iCloud/原生App范围未新增。
