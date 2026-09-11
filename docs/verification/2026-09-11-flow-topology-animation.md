# 流向动画与多排流程验收

日期：2026-09-11；任务 `flow-topology-animation`。实现入口及接口见 [结构契约](../flow-topology.md)。保留原计算任务、原单排Profile和无关改动；未修改目录、DLL、全局模型配置、依赖或根配置；未提交、推送。

## 交付状态

已实现5排×6流程的结构草稿、服务端编号/矩阵、确认及历史快照、原生校验，以及原生SVG空气/冷媒动画。默认管数与方向待填。结构列表、动画路径和DLL入参共用，保存后以服务端结构重绘。对话只修改/执行单排，多排执行保留页面入口。

**整项工程验收未完成。** 当前DLL在单排/串联的42/43槽返回NaN，并联合成输入在两条独立调用路径都抛异常；并联正式执行保持阻塞。未提供真实工程确认资料，合成输入不作用户工程确认。S4并联工程机制、S5完整真实结果验收需等待DLL修复及工程依据，任务不能标记done。

## 确定性与应用验证

| 验证 | 结果 |
|---|---|
| 原软件2Pass/3Pass矩阵 | HeadInf及ConnectInf逐项精确复现；原文件哈希保存在 [source-samples.json](evidence/flow-topology/source-samples.json) |
| 最终计算/拓扑/Worker/工具/HTTP/对话状态定向回归 | **23/23通过**，无跳过；[完整TAP](evidence/flow-topology/targeted-tests.tap) |
| `pnpm run typecheck` | 退出0 |
| 三个新增前端模块 `node --check` | 全部退出0 |
| `git -c core.safecrlf=false diff --check` | 退出0；工作区包含既有未提交改动，此命令不表示那些改动已完成审阅 |

最终定向命令：

```powershell
node --test --test-concurrency=1 packages/dsh-mche/test/calculation-mapping.test.js packages/dsh-mche/test/calculation-topology.test.js packages/dsh-mche/test/calculation-runs.test.js packages/dsh-mche/test/calculation-native.test.js packages/dsh-mche/test/tools-http.test.js packages/dsh-lite-web-app/test/http.test.js packages/dsh-lite-web-app/test/mche-input.test.js
```

包含：单排双流程、双排串联/交替/并联、不同管数、方向反转、30流程/2500管边界、缺项、重复ID/顺序、遗漏、非法排数/管数/方向、旧版本冲突、管号连续性、管数守恒、逐排几何槽位、未用容量、非对称矩阵、自环/缺边/非法分叉及Profile摘要失配。Worker测试直接输入损坏的原生包，在DLL加载前拒绝；不依赖页面校验。

服务/工具测试覆盖保存及新的CaseStore实例恢复、旧确认/准备包失效、旧运行仍携带原结构、会话隔离、多排对话写入/执行拒绝、工具schema仅允许1排及30流程读取输出预算。原有取消、超时、崩溃、重启中断、幂等、对话/按钮并发及离线计算回归继续通过。未宣称全仓回归通过。

早期一次集成回归为7/8，失败日志显示 `lite-workspace.json` 原子重命名 EPERM，发生在模型/工具完成之后；最终沙箱外定向复验23/23。浏览器初始化的先prepare再chat路径也曾出现调用模型前的502，根因未完整确定；最终夹具改用应用已有的直接新建聊天路径，不修改生产工作区/聊天持久化实现。早期 `browser-failure.*` 和自动生成的 `page@*.webm` 保留为中间证据，最终结论以 `browser.json` 和 `flow-playback.webm` 为准。

## 浏览器、视觉和播放

使用已安装Playwright和Chromium，在隔离DSH_HOME及本地确定性模型上运行真实页面与HTTP服务。命令 `node scripts/verify-flow-topology-browser.mjs`；无新依赖，无真实外部模型请求。覆盖桌面1440×1050和窄屏390×844，检查结果见 [browser.json](evidence/flow-topology/browser.json)。

- 连续播放、暂停粒子transform完全不变、静态箭头仍在；速度和流线显隐不改变计算版本。
- 单排、多排交替、并联切换；SVG外部连边与服务器顺序一致；不同排管数分别保存；空气反转保留HeadInf，仅改变空气经过排顺序。
- 预览未保存提示、保存后重绘、详情关闭暂停、重新打开及浏览器刷新恢复。
- 页面确认快照保存对应结构；缺少工程输入仍不能执行；新增排/改结构后，旧确认与准备包均失效。
- HTML与SVG键盘选择，SVG重绘后保留焦点；减少动态立即停帧；连续5次切页旧控制器全部disposed；离开视口及会话切换暂停/释放。
- 窄屏无页面整体横向溢出，图内可滚动、展开和放大；30个流程仍有独立编辑和核对入口。
- 30流程最多80条动画轨迹；最终60个浏览器帧间隔样本记录在browser.json。前一次最终实现采样中位16.7ms、最大16.8ms，仅代表本机headless场景，不作所有设备性能保证。

[实际播放录像](evidence/flow-topology/flow-playback.webm)包括单排、跨排串联、并联以及暂停/显隐/展开操作，是浏览器录制的VP8 WebM，不是静态截图拼接。检查了录像解码的相邻时刻，确认冷媒和空气粒子沿对应方向移动、结构与标注保持稳定。录像帧率25fps与页面动画刷新率不同。

视觉检查：保留现有字体，扩宽含结构图的详情面板；金属芯体与隔板有层次，蓝/橙流线与静态箭头可区分，外部管路有浅色衬线。整体视图重叠排通过完整编辑列表核对，展开视图逐排滚动。窄屏保持文字尺寸，图内滚动查看右侧，避免缩成不可读总览。

| 图像 | 链接 |
|---|---|
| 单排 | [桌面](evidence/flow-topology/single-row-desktop.png) |
| 跨排串联 | [展开视图](evidence/flow-topology/alternating-expanded-desktop.png) |
| 并联 | [展开视图](evidence/flow-topology/parallel-desktop.png) |
| 窄屏 | [390px](evidence/flow-topology/narrow-expanded.png) |
| 减少动态 | [静态方向](evidence/flow-topology/reduced-motion.png) |

## 真实DLL独立重放

执行 `node scripts/mche-topology-replay.mjs`。MCHEdll SHA-256仍为 `13de5fc0f6e76e6585ff755fbc4bebea1e5e00f959b0c3dc70ae9c90a753a5f9`，每次Worker加载校验全部固定运行文件和32位SHProp实际加载位置。

独立对照通过单独维护的 `run_ltr_case.py` 和 `mche_driver.py` 传递同一入参，两者哈希及结果见 [汇总](evidence/flow-topology/native/summary.json)。每组 `*-request.json` 与 `*-comparison.json` 保存原生入参、topology、Profile/Mapper摘要、完整输出或缺输出、错误、Worker环境/日志、独立调用stdout/stderr与耗时。

| 合成重放 | 原始槽位对照 | 真实结果 |
|---|---|---|
| 单排原回归 | 64/64一致 | failed，42/43 NaN |
| 单排双流程 | 64/64一致 | failed，42/43 NaN |
| 双排逐排串联 | 64/64一致 | failed，42/43 NaN |
| 双排跨排交替 | 64/64一致 | failed，42/43 NaN |
| 不同管数双排串联 | 64/64一致 | failed，42/43 NaN |
| 双排并联 | 两路径均未返回完整数组 | failed，`OSError / 0xe06d7363` |

重放脚本因此以退出1结束，不能解释为通过。单排/串联主DLL调用记录0～16ms是Worker粗粒度计时，完整往返耗时另存比较文件，不能当作性能承诺。并联为未超时的原生异常，两条路径错误一致，但不能声称64槽相同。

NaN诊断：原`index.h`和`threadrun.cpp`明确把42/43槽作为管/翅片温度输出，不能当作未用容量忽略。原LTR、目录合成输入、多流程和多排串联均复现，且独立调用结果一致，现有证据无法通过JS映射改动修正。供应资料只有调用方源码，无DLL内部算法/调试符号；未改DLL、关联式或未核验模式以绕过问题。

并联诊断：[完整异常证据](evidence/flow-topology/native/two-row-parallel-comparison.json)。供应调用方代码只能确认uniform分配标志/可选分配场的传递，无法确认支路分流计算机制。未猜测等流量、未修改RefFlowType尝试放行。继续验收需供应方提供并联调用约定/可重放工程算例、修复或说明此异常及42/43槽NaN，再用新版本摘要重放并重新确认工程输入。

## 对话打开编辑器补修（2026-09-11）

问题：对话可直接使用每轮注入的 topology 描述当前结构，但纯文字不会触发详情抽屉；原有详情也只在点击工具链接时打开。管数/方向为 null 并非编辑器显示的前置条件。新增只读 `mche_calculation_open_editor` 工具，返回当前会话的 conditions 导航引用；实时回复结束、恢复编辑权限后仅消费一次，历史保留按钮。空结构、计算未就绪和多排读取均不要求计算确认。已手动打开后关闭、未保存草稿、失败或会话不匹配时不抢占页面。

- 定向单元/HTTP回归：`node --test --test-concurrency=1 packages/dsh-mche/test/tools-http.test.js packages/dsh-lite-web-app/test/response-view.test.js packages/dsh-lite-web-app/test/mche-input.test.js packages/dsh-lite-web-app/test/http.test.js`，12/12通过。[原始输出](evidence/flow-topology/editor-navigation/targeted-tests.tap)。`pnpm run typecheck`、`git -c core.safecrlf=false diff --check`通过。
- `node scripts/verify-mche-editor-navigation-browser.mjs`通过。真实 Chromium + 隔离 DSH 服务，本地确定性模型调用实际注册工具；验证当前回复自动打开空流程、输入可编辑、无工程版本/确认变化、对话侧无动画、键盘/点击重开、历史不弹窗、手动关闭不重开、新会话与390px窄屏。[浏览器结果](evidence/flow-topology/editor-navigation/browser.json)、[操作录像](evidence/flow-topology/editor-navigation/editor-navigation.webm)、[空结构桌面图](evidence/flow-topology/editor-navigation/empty-editor-open.png)、[窄屏图](evidence/flow-topology/editor-navigation/new-session-mobile.png)。失败/重复/过期会话/未保存防护在浏览器直接调用生产组件API的合成边界场景验证；不冒充真实用户工程资料。
- 额外尝试旧 `scripts/verify-chat-details-browser.mjs` 未通过：现有 `mockRequirementsResponse` 要求当前用户消息包含 workbook 引用，而旧脚本仅上传文件后发送无附件文字，抛出“首轮缺少服务端文件引用或 MCHE revision 通知”，尚未进入工具详情验收；旧脚本还假定4工具/5段文字，而当前需求夹具已采用直接读取。未修改这项旧夹具或将其记为通过。

本次未验证外部模型选择新工具的准确率，未重启用户正在运行的服务。新后端工具需要服务重启加载，前端需刷新；历史纯文字不会被追溯改写，可直接点击顶部“MCHE 方案”，或加载新版后发送“打开流动动画”。本修复未改DLL、映射或计算准入；原真实DLL阻塞仍有效，整项任务保持 blocked。未提交或推送。
