# 独立轻 3D 预览

默认 `index.html` 通过最小 `app.js` 启动纯 TypeScript / Babylon 新游戏。用户明确无需旧版兼容，旧版代码与素材已从当前分支清理，只保留在 Git 历史。没有修改 Pages 工作流、发布目标或部署配置。

- `src/slice/core/types.ts`：纯状态与渲染契约；金额整数分，坐标米。
- `src/slice/core/engine.ts`：唯一经营模拟；固定步、确定性到店序列、逐杯快照、真实搬运资产、有限升级。
- `src/slice/core/persistence.ts`：独立版本化本地档；保存/离线端点、坏档保护与本地写入冲突。
- `src/slice/core/sync.ts`：AuthProvider / SaveRepository 适配边界与 in-memory CAS 测试替身。
- `src/slice/render/CoffeeScene.ts`：原创几何与材质、固定斜俯视、人物/杯/钱/经理路线；从状态读取，不推进经济时间。
- `src/slice/main.ts`：唯一 RAF、UI 操作、自动保存、后台/回前台时间区间与清理。

真实 CloudKit 尚未配置。目标是 Web/iOS/macOS 共用同一 Apple container、environment、private database、zone 和字段编码；需 Apple 开发者配置和用户授权后另行接通。CloudKit 的 recordChangeTag 是 opaque CAS token。冲突先拉最新记录并保留本地分支，不把新 token 套在旧余额上覆盖，不 forceUpdate/forceReplace，不直接合并余额。

CloudKit 仅作同步存储，不执行经济逻辑。该方案不提供服务端权威、防作弊或真实跨设备同步。serverModifiedAt 是记录保存时间，不能冒充读取时服务器时间。账户切换后本地待同步副本必须隔离。Development 与 Production 记录分开，发布 schema 不迁移玩家档。参见 Apple [CloudKit JS](https://developer.apple.com/documentation/cloudkitjs)、[recordChangeTag](https://developer.apple.com/documentation/cloudkitjs/cloudkit.record/recordchangetag)、[修改记录协议](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/ModifyRecords.html)。

新预览未加入原生包装或安装式 PWA、广告、八柜台与付费服务；先验证方向和闭环。

## 全屏世界修订

下面保留0b60acc之前的实现方向背景；具体当前入口以文末“最新金库/前脸布局”为准。

canvas为真实viewport尺寸，100dvh与safe-area保护HUD/窗口；没有窄屏中的930px横向DOM画布或下方常驻经营卡片。镜头受限平移，墙体/地面延伸，竖屏局部逛店而非缩完整店面。

CoffeeSceneAction打开对应操作、入口招客或切换营业；升级/选配方由窗口按钮执行。常驻HTML只有¥钱包，全部操作入口由真实的墙面牌、柜台牌、金库、经理推车和营业/设置物件承载。文字用DynamicTexture绘制在固定实体面，几何的深度和光照正常生效；没有DOM投影按钮、billboard或透明点击箱。

projectAnchor只供只读QA坐标诊断，不定位任何DOM控件。focusAnchor/focusNext/activateFocused/panBy为键盘访问实体提供相同语义；单个可聚焦canvas含中文操作说明，左右箭头选物件、上下平移、Home回A柜台、Enter/空格激活，重复按键不重复交易。弹窗切换对齐可见关闭按钮，关闭恢复canvas焦点。字体符号¥是虚拟游戏货币展示，无真实付款功能。

几何拾取会先遇到前方可见实物，再决定有无对应action，不能穿过人物或家具。正常短按只发一次，拖动/长按/取消/不同目标抬起不发操作。全部入口用实体投影尺寸与受限pan做CPU验证；窗内只显示当前panel，关闭/背景/Escape回店。源代码和NullEngine不证明最终字体清晰度、光照、遮挡观感或Safari手势，仍交Mac真实QA。


## 最新金库/前脸布局

常驻HTML现在为¥钱包+唯一设置按钮，所有经营入口仍是深度正常的实体牌。暂停不再是玩家操作；core.togglePause只用于冲突冻结和恢复有效旧暂停状态后的当前营业。repository先以原暂停状态完成离线结算，main随后恢复，不补发旧暂停时间。

金库成为经理唯一管理入口（同一vault-panel），普通推车无Action/Anchor/大clipboard。金库位于视觉菜单左侧。前脸配方与升级、现金旁金额均为真正表面文字。经理升级效率显示对Lv.1的百分比。2363c12曾用分段渲染映射保持原core；下述新要求已替代这个历史方案。

## 最新房间表面/真实路线

删除吊灯与原排队装饰白圈，实际顾客仍由core队列规则推进。墙/地纹路依附连续实体面，同一世界轴和固定相机，不再通过凸出细杆/单独高起的砖块产生异样线与阴影。金库等级/升级牌提高到图标上方留间距。

WORLD.vaultX现在为8.8，经理target仍指向柜台数组索引或2=金库；每轮实际B(5)→A(0)→金库(8.8)，渲染直接读取x，不另映射。路线全长17.6m，之前逻辑26m；速度/容量、两柜台半袋预留、制作价格/费用/等级上限没改，但收运圈时会缩短。这是用户明确要求的真实顺序调整，不声称经济时间完全不变。

managerRouteVersion=2用于当前两柜台档的窄范围路线迁移，外层schema/economyVersion及保存key仍为1。缺少标识/1按原路线坐标先验证，再一次性转换当前路段位置；中途收款使用finishLegacySweep完成剩余旧轮后清除，下轮B优先。新金库空手出发可直接B优先；财产、timer、杯/队列、结算标识不变。历史策略曾在<30秒只返回路线迁移快照；当前REQ-3D-030要求旧策略区间（包括零/短/暂停）与新策略标记一次原子提交，仍用原baseRaw做冲突检查。未来路线版本保护、不用新版本悄悄覆盖。真实新像素仍需Mac复测。

## 可选路线 QA

独立测试 origin 上使用 `?qa=1`：底部可折叠面板提供稳定顾客 ID、选择下一位/A/B、同ID实际模型的无交互投影标签、core/插值/mesh位置、最近交叉/删除事件，以及经理停靠/经过/实际收款/存款。`window.__coffeeSliceDebug.readRoutes()` 返回分离的本地只读快照。裸`?qa`不再启用调试；默认入口无面板/标签/调试全局。

core的可选第二参数为分离标量事件观察者；诊断异常被隔离，经营事件及eventSequence不受影响。事件时间是模拟时间，收款/存款来自真实资产转移处；crossing只表示经过中心线，不是碰撞判定。内存限额128总事件/16所选顾客/16经理，所选despawn单独保留。无网络发出、不保存诊断，不增加RAF/定时器或改变业务速度。页面恢复/离线、读档、新店重置诊断会话，旧ID不会静默关联成新人物。QA本身不隔离存档，必须在独立测试环境操作。

实际mesh读数和投影只帮助识别，不判断遮挡/穿模或像素合格。NullEngine、core与DOM harness通过也不构成视觉验收通过；详见TC-3D-014。

## 当前离线事务与分批计算

新保存封装写 `offlinePolicyVersion:3`，游戏schema/key仍为1。`engine.beginOffline`先计算总步数/余数，再仅调用既有tick，所有批次共享一个领取ID；完成后才记入ID。`applyOffline`保留同步核心参考入口；真实UI一律使用repository的deferOffline + finishOffline，32步小批、约8ms计算预算、宏任务yield。无按天数分配的数组。

repository将来源快照/原字节/代际/固定端点保存在独立任务；候选只有完成且仍有效才一次写回。普通save/reset不能越过活动任务。新读取使旧任务失效；取消或异步失败保护写屏障，同一未保存现场只能以原快照/起点/字节严格重试。未来版本、缺失、不可读与坏档仍保护；乐观localStorage字节检查不是服务端原子CAS或防改时钟机制。

前台等待从请求端点起计作在线时间，main保留performance起点，成功后的普通时间入口结算尾部，保存前先flush；后台中断取消任务并重算原未领取区间。数值边界沿用elapsed≤4e9秒和主要整数≤1e12；超范围明确拒绝而不是截成较短收益。

对没有生命周期证据的异常长前台空档（超过60秒）采用保护冻结，不自动按离线重估、不截断后继续写入。连续回调确认的正常异步计算等待单独计入可推进的在线尾部；操作处理器先结算尾部再修改配方或升级，避免追溯应用新参数。此边界及数值安全边界不等同离线时长上限。
