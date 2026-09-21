# UI-005 / QUEUE-002 浏览器观察

执行入口：`http://127.0.0.1:5180/?test=ui005-final-check`

## 桌面

- 共享 world 内可见左侧入口、金库、三座柜台、三条绿色候客地毯、Phaser 顾客/咖啡师/经理和上方咖啡墙。
- 每座柜台台面右侧有当前咖啡真实图标；咖啡墙五张卡也使用对应 PNG 图标。
- 顾客标签位于候客地毯内，不再直接叠在柜台设备文字上；队首显示“制作中”，其他顾客显示“排队中/等候中”。

## 844×390 横屏

- 请求视口为 844×390，实际场景 `828×378`，页面没有横向溢出。
- 点击一号柜台图标后，选择器显示五个带图标的完整名称：美式、蜂蜜拿铁、燕麦摩卡、橙香冷萃、焦糖玛奇朵。
- 选择蜂蜜拿铁后当前图标和 aria-label 更新；没有触发柜台加急出杯。

## 390×844 竖屏兼容

- 页面宽度保持 390px；场景 world 保持 820px，柜台和顾客等待区留在同一可横向浏览区域。
- 竖屏不是主体验，只作为横屏旋转提示下的兼容布局保留。

## DOM / 控制台

- `.scene-customer-lane`：3 个；丰富存档下 filled slots：`[3, 3, 3]`。
- `.scene-art`、`.scene-recipe-wall`、`.scene-vault-marker`、`.station-drink-picker`、`.scene-station-belt`、`#phaserSceneLayer` 均可沿祖先追溯到 `#sceneWorld`。
- `select.station-drink-select`：0；选择器选项图片：5。
- 图片失败：0；最终新页 warn/error：`[]`。
