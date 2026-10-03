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

canvas为真实viewport尺寸，100dvh与safe-area保护HUD/窗口；没有窄屏中的930px横向DOM画布或下方常驻经营卡片。镜头受限平移，墙体/地面延伸，竖屏局部逛店而非缩完整店面。

CoffeeSceneAction只打开对应操作或入口招客；升级/选配方由窗口按钮执行。projectAnchor和focusAnchor从物件同一world点计算CSS坐标，DOM触控按钮和3D拾取保持DPR一致。窗内只显示当前panel，关闭/背景/Escape回店；源代码和NullEngine不证明真实像素填充。
