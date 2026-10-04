# 房间表面与真实近到远收款执行报告

2026-10-04 UTC，云端Linux/Node24；基线2363c1276a01b0fdd1b5c3ea7a58ae570a3fb83d。对应REQ-3D-019–021/TC-3D-010，测试为真实命令及确定性模拟时间。最终代码指纹见tested-source.sha256；交付版本/tree写在ZIP的START-HERE和Git记录中。

## 输入与实现

已通过当前Library流程读取并查看实际2560×1800的1280x900-scene(1).png及1280x900-vault-dialog.png。它们是2363c12的Mac输入证据，不是本版截图。实际图中经理牌压到金库顶端、地毯有装饰圈，地板两轴缝有不同亮度/阴影，墙上细条凸出。

删除全部pendant吊灯和queue-position装饰白圈，保留真实队列规则。地面使用一个连续solid承载2.4m世界尺度方格，墙裙使用同一实际面承载0.72m细纹；去掉分块高差与浮起杆线，地/墙/踢脚线和地毯接触面一致。固定orthographic斜俯视的相机方向没改，不能把“已修纹路结构”称作已证明最终透视观感。柔光/太阳强度调整为0.64/0.48，纹路改为较深哑光色，以降低原水平面过亮裁切风险；最终色调/字体/抗锯齿仍交实际Mac验收。

金库经理牌移到实体上方，避开整座金库的投影轮廓；保持wall-mounted几何/普通光照/深度和同一vault动作。原HUD¥+设置、无暂停入口、前脸selector、纸钞区域金额、按需popup及八经营实体入口继续保留。

真实core现在vault8.8→B5→A0→vault8.8，renderer直读manager.x，删除旧managerPresentationX。target仍是柜台数组索引或2金库。每柜台半袋预留、价格/费用/等级上限、速度/容量公式未改；圈长由26m变17.6m，收运时间确实改变，不能继续声称经济时间全不变。

managerRouteVersion2是当前两柜台档的窄路线迁移，外层schema/economyVersion/key仍1。先按旧范围验证无标识/1，再一次转换当前段坐标；正常中途收款轮以finishLegacySweep完成剩余旧停靠后清除，下轮B优先，避免重复收款。旧有效但历史不可达的stationary坐标归位到对应停靠，金额/timer不改；新路线档严格验证停靠点与移动段。<30秒读取不写原字节，正常save/离线端点成功才落盘，baseRaw冲突保护保持；未知未来路线版本不覆盖。没有导入历史三柜台档，没有实际CloudKit接入。

## 验证记录

- node --check app.js：PASS。
- npm run typecheck：PASS。
- npm test：102/102 PASS，50场景、28应用、24核心；见test-output.txt。
- npm run build：PASS，主JS994.27kB/gzip243.38kB；保留500kB块提醒，见build-output.txt。独立默认生产构建在审查构建结束后再次完成，交付dist只取该最后一次结果。
- 既有Pages base路径的独立outDir构建：PASS；无部署动作/配置变化。
- 独立审查：PASS，冻结前后src/tests SHA完全一致，无剩余源代码阻断。
- 最终diff --check：PASS；package/lock/.github、main.ts/style.css/sync.ts相对2363c12无diff。

24核心检查包括真实B→A→vault事件、Lv1/7/20半袋额度、时间分片、每个移动/收款/存款段保存恢复、旧当前路线中途迁移和一次性标识、杯/队列完整、未来/坏版本/动作坐标保护、离线幂等、quota失败、CAS/竞争窗口及暂停档。Lv1真实空轮在1.50秒到B、1.95秒离B，3.90/4.35秒到/离A，7.75秒到金库、8.35秒完成存款。1200模拟秒/柜台20级样本里，Lv1经理仍有103196分台面积压；Lv20经理消除台面积压，生产总额272738分相同。该样本是draft收运瓶颈检验，不是商业平衡已定。

50场景检查保留所有旧三尺寸/DPR/pan/44px/遮挡/拾取/输入/资源清理、现金与纸钞位置检查，并增加真正floor xz/wall xy UV轴、连续solid接缝、同宽低反差表面墨线/正常受光、新路线550分完整现金链。等级牌相对整个金库的真实投影留白desktop24.45px/portrait22.93px/landscape17.86px；沿牌顶真实前向ray不被长墙rail挡住。Float32接缝容差与144m斜rail全AABB假重叠已用正确局部几何/射线验证，未弱化金库完整轮廓间隔要求。

28应用检查保留¥设置/无pause/经理唯一入口/实际main handler、popup异步关闭重开/键盘/取消、保存/坏档/离线/BFCache/清理，并独立新增真实无标识/1路线raw archive在首RAF前boot、离线写失败与CAS保护恢复、隐藏首帧/重复save不二次迁移和结算。

独立旧引擎扫查：从Git基线2363c12真实engine生成10000个live snapshot，分别测试无标识/显式1，共20000次迁移和重复验证；覆盖六种经理target/phase，110次允许的空手金库出发重定向。金额/timer/杯/队列/claim不变，输入原字节不被修改，canonical validate/createEngine幂等。交付者再次复现相同JSON结果，repeatable脚本/result随本目录保存（需包含基线Git历史的checkout）。

NullEngine验证几何/投影/拾取，应用harness执行实际main handler+真实core/repository但DOM/scene是测试替身，均不代表真实浏览器像素通过。

## 实际UI边界

云浏览器localhost之前出现ERR_BLOCKED_BY_CLIENT，未换路线绕过。本版新实际像素、Safari/dialog、真实触控、墙地纹路观感和金库牌阅读尚待Mac独立origin4187复测，具体步骤见local-qa-prompt.md。此前Mac输入工具timeout导致2363c12长测未完成，不能将旧图或输入截断报告写成新版本通过。

500kB生产JS块提醒若仍出现如实保留，不为这次布局扩张框架或改部署。package/lock/.github与main保持既有范围；本轮只正常提交到任务分支，不合并/部署。
