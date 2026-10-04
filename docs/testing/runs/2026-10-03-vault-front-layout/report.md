# 金库与柜台前脸布局：云端验证

2026-10-03 UTC，基线0b60accd07f44ed069fcb1078131f70d73ba3570。同一任务分支，用户最新反馈覆盖旧位置和入口要求；最终源码冻结后聚合通过；视觉仍待Mac。

## 输入与实现

通过当前Library流程实际下载/查看844x390-landscape(2).png像素。它显示真实字牌效果已比DOM浮层改善，但设置/暂停仍在墙上，柜台选择与金额仍高立在台上，经理巨型clipboard覆在推车上；用户明确要求重新安放。

新HUD¥+设置，没有玩家暂停。设置使用同一个原生dialog/input suspension/focus恢复，不增经营DOM牌。经理窗口并入金库，所有等级/效率/升级只经金库，去掉推车操作牌和独立入口。普通小车只显示真实纸钞。

金库按画面方向移到所有咖啡菜单左侧。原镜头screenX与worldX方向相反，因此使用可视位置而不是机械认定负X是“左”。经理三段逻辑进度映射至可视金库/A/B，各端点连续，现金到新金库才呈现存款；纯core位置/时长/速度/容量、资金、schema和repository完全未动。UI效率相对Lv.1百分比，不虚报重新布局后的真实米速。

两柜台配方牌和升级牌贴前脸，正常材质/深度/真实拾取。待收金额纸片与实际纸钞共用现金root，低贴台面，并在现金收走时一起隐藏，没有高收银台牌或浮动HUD。

没有玩家暂停入口后，有效先前暂停档在repository按原暂停状态结算离线（0收入），再恢复当前营业；冲突/offline anchor写失败继续技术冻结，保留数据，不因去掉按钮解除保护。

## 最终验证

源码冻结后最终聚合：Node24.19.0 / TypeScript7.0.2 / Vite8.3.0 / Babylon9.29.0。

- node --check app.js：PASS
- npm run typecheck：PASS
- npm test：81/81 PASS（41场景CPU、25源码/真实main应用handler、15核心/保存/CAS）
- npm run build：PASS，主JS992.15KB / 242.75KB gzip；500KB chunk advisory保留。
- 既有Pages base路径本地构建：PASS，不是部署。归档dist为默认本地路径构建。
- 最终tracked/cached diff check：PASS；core、package/lock、.github相对0b60acc无diff。
- [源码SHA](tested-source.sha256)、[测试日志](test-output.txt)、[构建日志](build-output.txt)保留。

41场景测试：三viewport×DPR1/1.75的八个实际经营面/44px内切目标、全金库边界视觉左排序、柜台前脸边界/普通服务顾客中心tap、现金cluster与平纸片一起显示/消失、第一小笔钱和文字区前方ray可见、移除pause/settings/manager动作、等级元数据归金库；模拟数据映射连续且不写snapshot，0.55秒未入账→0.6秒一次入账，收款/存款端点实际对应实体。小推车沿新服务路线不穿墙/柜台/咖啡师，实体/光照/深度、拾取/拖动/长按/取消、键盘和清理回归。

金额纸片为1.4×.64，短样本¥9.50的名义glyph几何高度在横屏约11CSSpx；长完整金额按真实canvas measureText缩字号而不截断、不缩写。长金额适应性只证明line fit，不代表所有长字符串仍有11px字高或真实浏览器可读，Mac需看不同待收金额。

25应用检查：¥+settings唯一HUD，无用户暂停/旧经理/墙面设置入口或热键；金库统一经理等级/效率/费用与core quote一致，一次扣款；HUD设置native modal guard/focus/继续自动经营；旧有效暂停档先0离线再恢复当前play，冲突/offline写失败不解冻；坏/未来/外来档保留原字节、manual save/export、异步close/reopen、keyboardrepeat、一次BFCache/RAF和销毁/晚回调回归。fakeDOM验证实际handler，不冒充原生浏览器测试。

独立审查没有发现剩余源码blocker。真实新像素仍需Mac，当前source/CPU不代表实际可读性和构图通过。

## Mac待测

此云端浏览器既有ERR_BLOCKED_BY_CLIENT，未绕过。新三尺寸scene-fill、画面左金库、金库等级/升级、柜台前脸可读/可点、纸钞旁金额、真实送款路线/小车比例，以及native dialog/触控/dvh/Safari与90秒玩家资金链，交[Mac focused QA](local-qa-prompt.md)，独立origin4186。
