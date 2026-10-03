# 云端验证报告：轻3D方向预览

2026-10-03，UTC。分支 codex/light-3d-coffee-slice；公开4efd3d9与核验增量2834e80恢复后，依用户最新许可清理旧实现，以新版为默认入口。未修改Pages工作流、发布目标或部署配置。

## 结论与环境

核心、本地档与原创场景的CPU结构/输入验证通过。真实像素、WebGL shader、触控、Back/Forward和浏览器玩家路径尚未验收，不能宣称完整UI验收通过。

Linux，Node24.19.0/npm11.9.0，TypeScript7.0.2/Vite8.3.0/Babylon9.29.0。模拟固定0.05秒，测试独立初始档，不改日常档。

## 已执行

- node --check app.js：PASS
- npm run typecheck：PASS
- npm test：25/25 PASS，15核心/持久化/CAS + 10NullEngine场景/输入
- npm run build：PASS
- git diff --check：PASS

核心：五顾客阶段、资金守恒/真实搬运、60fps分片和快照确定性、当前杯快照、配方柜台擅长、重复输入/费用/等级边界、暂停/非法时间、坏档/未来schema保留、重置前备份、离线cap/重复/重叠/倒拨时钟、保存失败可重试、两客户端mockCAS冲突和操作ID幂等。

场景：真实Babylon网格结构、只读同步、入口/柜台/菜单命中、拖动/长按/取消/次指针不误点、制作条/杯/现金/cart/设备升级、暂停摆动、销毁监听/晚输入、1100×600/1340×520/930×460投影边界、高DPR一次缩放。

独立审查修复：Retina命中重复缩放；beforeunload销毁可能使缓存恢复死页；交杯双重杯显示。现主循环缓存页保留监听，pageshow统一恢复，非缓存pagehide才销毁，隐藏中导航保留结算起点。生命周期是代码审查证据，实际Back/Forward待测。

## 阻塞与未执行

云浏览器访问开发服务器 http://127.0.0.1:4176 返回 net::ERR_BLOCKED_BY_CLIENT。未绕过，也未把合成图伪称截图。

- TC-3D-001/002/003/004真实UI路径：BLOCKED，核心对应断言PASS
- TC-3D-006实际桌面/手机像素、shader、触控、BFCache：BLOCKED，NullEngine断言PASS
- 真实CloudKit、原生App/PWA：out-of-scope，未配置

[Mac独立QA提示](local-qa-prompt.md)使用独立origin，仅测试咖啡项目。

## 实测draft平衡

模拟1小时无招客：Lv1默认赚217738分、存入216806分，最大柜台占比52.31%。柜台Lv20/经理Lv1赚822529分、存入372000分、积压449329分/运输1200分，最大占比69.06%。经理也Lv20时同产出存入822168分，只余361分台面。

Lv1–19两配方最长满负荷增量回本1817.84秒（30.3分，B浓缩19→20，11570分）。真实回本受客流/收运限制；UI标明“满负荷增量”。经理升级可解除实测瓶颈。无无限全局乘区或广告依赖，精确商业平衡仍draft。

子模块imports将主JS从6.78MB/1.49MB gzip降至约981KB/240KB gzip。500KB警告保留；实际手机帧率未测。
