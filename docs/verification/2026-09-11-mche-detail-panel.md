# MCHE 右侧详情精简与整理验收

Task：`mche-detail-panel`，按用户 S1–S4 计划实施。分支 `dsh_mche_agent`，基线 HEAD `596ab22438e70d1d52fa2aafa31e0622c379fc5f`。现有工作区含大量未提交工作，本次仅修改前端和验收脚本，无提交或推送。

## 交付内容

- 四个主入口：需求、部件、计算、结果；部件及计算子导航按页显示。通用入口默认需求；全部旧 view、component、精确型号、proposalId、runId 和 openEditor 引用兼容。再次切换恢复当前面板内的位置、折叠及流图设置。
- 合并部件、计算和待办状态。阶段、四类待办和原始诊断位于“查看全部状态”；当前页额外待办最多直接显示三条，其余可展开。缺项、过期、冲突和计算能力限制继续可见。
- 需求采用值保留单一编辑区，原文、原始值、显示值、坐标、单位、派生和填写依据放入各字段的“依据”。设计要求、测试条件、其他模式及映射核对表折叠；主工况和测试条件独立。
- 保存与确认独立。点击“核对并确认”只展开页内差异，第二次明确确认才调用原确认接口。折叠不写接口、不清除控件，保存重绘恢复展开与滚动；缺依据/SH冲突会展开并定位字段。
- 候选保留精确标识、关键尺寸/介质、匹配计数、不满足/未知/使用限制及操作；满足项、推荐依据和已选型号完整目录快照按需展开。工程核对突出需确定含义或依据的字段；完整来源、换算和已填字段可展开。
- 计算页显示已应用快照摘要与完整查看入口；结果默认突出指定或最近任务，其他任务折叠，完整输入、版本、原生输出和日志可访问。指定任务不在首批历史中时单独读取，不改变历史分页偏移。
- 保留原字体、蓝色强调和原生 JS/CSS。默认660px抽屉，导航和当前操作固定、正文独立滚动；390px字段纵向排列，证据表自身滚动且可键盘聚焦。流向图默认220px；放大最多1100px，开放速度/显隐/各排视图。明确动画请求直接放大，减少动态及关闭/切页清理继续有效。

## 前后对照

截图均来自 Chromium 与隔离原生运行时。旧版通过实施前保留的前端副本重放，同一需求表夹具；新版截图包含未选模式和已确认需求两种状态。

| 内容 | 调整前 | 调整后 |
| --- | --- | --- |
| 桌面需求 | [旧面板](evidence/mche-detail-panel/before-requirements.png) | [默认需求](evidence/mche-detail-panel/after-requirements.png) |
| 桌面工况 | [自动宽流图](evidence/mche-detail-panel/before-conditions.png) | [660px紧凑预览](evidence/mche-detail-panel/after-conditions.png) |
| 窄屏需求 | [旧窄屏](evidence/mche-detail-panel/before-mobile.png) | [390px采用值](evidence/mche-detail-panel/after-390-requirements.png) |
| 放大与结果 | — | [完整图示](evidence/mche-detail-panel/after-expanded.png) / [真实失败任务原始输出](evidence/mche-detail-panel/native-result-details.png) |

人工检查了桌面需求、紧凑/放大流图、390px需求和流图截图。四个入口的页面及正文横向溢出断言通过，导航与底部操作无重叠，默认无展开的原始JSON。所有记录、单位、关键值和异常使用正文或可展开内容，没有依赖省略号或悬浮提示。

## 验证

| 检查 | 实际结果 |
| --- | --- |
| `node scripts/verify-mche-panel-browser.mjs` | 通过：四入口、26条原表记录逐项核对原始/显示值、单位候选和来源坐标，折叠不写入、折叠后保存、未保存保护、缺依据定位、二次确认、SH/主工况快照、位置/播放设置恢复、660/1100px与220px、桌面/390px、键盘和减少动态。 |
| `node scripts/verify-mche-panel-links-browser.mjs` | 通过：全部旧视图、三种精确目录/型号、指定proposalId、真实失败runId与日志、历史折叠、首批历史未含指定任务的模拟分页、版本冲突保留本地值、候选过期、跨会话拒绝写入。 |
| `node scripts/verify-requirements-browser.mjs <已有Playwright模块>` | 通过：26条/4个Profile分区，SH重算/清空/冲突，零/No/90°?，模式切换保值，主32°C与测试42°C隔离，确认快照、未接入模式阻塞、刷新及390px。更新导航/折叠/二次确认操作，保留业务断言。 |
| `node scripts/verify-mche-guidance-browser.mjs` | 通过：四类待办、能力限制、只读跳转、语义选项原值和单位、推荐依据/过期禁用、模式保存、刷新和窄屏。 |
| `node scripts/verify-flow-topology-browser.mjs` | 通过：单/多排、串并联、方向、实际管数、30流程编辑、确认及准备失效、动画播放/暂停、速度/显隐不改版本、关闭/视口外暂停、5次切页清理、会话隔离、减少动态及窄屏。 |
| `node scripts/verify-mche-editor-navigation-browser.mjs` | 通过：明确对话请求直接放大，空结构、历史重开、提前关闭、重复/失败事件、未保存保护、新会话和390px。 |
| `node --test --test-concurrency=1 packages/dsh-lite-web-app/test/*.test.js packages/dsh-mche/test/*.test.js` | 130项：129通过、1失败、0跳过。失败是 `fin-native.test.js` 中隔离工作区原子重命名 `EPERM`，并非前端断言。 |
| `node --test packages/dsh-mche/test/fin-native.test.js` | 上述文件单独复跑2/2通过。初轮并行回归另外两组原生对话曾出现502，单独串行复跑4/4通过。保留首次失败，不将这些运行表述为单次全绿。 |
| `pnpm run typecheck`、受影响前端语法检查、`git diff --check`、前端副本差异审阅 | 通过；没有更改后端计算/持久化/确认契约、依赖或配置。自审，未使用独立评审代理。 |

浏览器模块使用机器上已有 Playwright；没有安装依赖。主面板和历史链接验收分别记录于 [browser.json](evidence/mche-detail-panel/browser.json) 与 [links.json](evidence/mche-detail-panel/links.json)。代码身份、命令结果及复跑情况见 [checks.json](evidence/mche-detail-panel/checks.json)。完整测试输出保留在 `.dsh/mche-detail-*.log`。

## 边界与状态

本轮完成前端验收；模型为确定性本地夹具，非真实供应商模型验收。真实 DLL 运行使用隔离合成工程输入，返回的非有限输出仍判失败，本轮没有验证成功工况的工程精度，也没有扩大 DLL 能力。Windows 隔离持久化测试偶发 `EPERM rename` 如上单独记录，未扩大修复后端范围。

TLL 使用独立 `mche-detail-panel` Task，S1–S4验收完成后记录checkpoint并finish；配置已核实 `autoCommit: off`。所有代码、TLL和证据仍在本地未提交工作区。用户现有运行进程未重启；浏览器刷新后加载静态前端即可查看本轮布局。
