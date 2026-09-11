# MCHE 工程指导实施与验收记录

任务：`mche-engineering-guidance`。日期：2026-09-11。实现已接入；确定性能力与浏览器流程已验证，**真实模型的证据边界验收尚未全部通过，任务不标记完成**。

## 实现范围

- S1：服务端按有效需求、当前模式、Profile、topology 和确认快照生成四类 guidance。旧逻辑参数清单只留详情；未选模式单列推荐组合缺项；单排不显示并联执行警告。现有计算校验保持执行。
- S2：三种推荐复用明确约束、参考资料与已选部件上下文，候选保存生成时的 basisSummary。依据、原件或目录变化可识别；旧记录不补写历史依据。确认状态核对摘要及原件，不能只看版本号。页面分开显示建议理由和服务端核对。
- S3：工具说明和每轮状态强调及时保存明确草稿、使用最新版本、复用目录投影、语义选项保留原值。Boundary 增加组合覆盖与执行支持，保留原有推荐与求解问题。
- S4：右侧增加当前状态、四类待办、来源和原始诊断展开。已有编辑器入口可以打开空结构，查看不确认，保存返回值立即重绘，下轮对话读取最新状态。工具业务 `ok:false` 在实时、返回结果、历史详情均显示失败且不触发导航。

接口见 [工程指导接口说明](../mche-engineering-guidance.md)。变更归属见 [18 个既有源文件的哈希清单](evidence/engineering-guidance/changed-existing-files.json) 和 [实施前后差异](evidence/engineering-guidance/scoped.diff)。新增源文件为 `guidance.js`、`recommendation-context.js`、`public/mche-guidance.js`；另有测试、复放脚本、文档及本任务 TLL 记录。

这份差异以本轮开始时的工作区为基线，不把 Git 中已有的大量未提交文件都算作本次新增。未提交或推送；未改全局模型配置、依赖、原始目录、原件或原生 Worker，未终止用户原有服务。需求规则、Profile 和 Mapper 摘要与实施前一致，见 [摘要对照](evidence/engineering-guidance/rules-unchanged.json)。指导不单独持久化，不加入计算摘要，不迁移旧数据。

## 确定性与接口结果

| 检查 | 结果与证据 |
|---|---|
| MCHE 完整回归 | 一轮 73/73 通过；追加来源确认边界测试后最终完整运行 72/74，两个失败均为既有工作区文件 rename 的 Windows EPERM，导致 `/api/chat` 502。[73 项日志](evidence/engineering-guidance/checks/guidance-mche-delivery.log)、[最终 74 项日志](evidence/engineering-guidance/checks/guidance-mche-final-delivery.log) |
| 失败文件复跑 | `refrigerant-native.test.js` 2/2、`requirements-native.test.js` 1/1 通过。未改工作区存储实现，也不把复跑合并宣称为一轮 74/74。[冷媒](evidence/engineering-guidance/checks/guidance-refrigerant-final-delivery-rerun.log)、[需求](evidence/engineering-guidance/checks/guidance-requirements-final-delivery-rerun.log) |
| 新增工程指导测试 | 8/8：真实客户表、明确约束和过期、模式切换、topology、A10/B04、来源确认失效、旧历史/会话隔离、全目录分页、响应预算、业务失败、确认/摘要不变。[日志](evidence/engineering-guidance/checks/guidance-source-confirmation.log) |
| Web 完整回归 | `node --test packages/dsh-lite-web-app/test/*.test.js`，56/56 通过；覆盖最新轮次状态和业务失败的实时/历史显示。[日志](evidence/engineering-guidance/checks/guidance-web-delivery.log) |
| 类型检查 | `pnpm.cmd typecheck`，退出码 0。[日志](evidence/engineering-guidance/checks/guidance-typecheck-final-delivery.log) |
| 浏览器 | `verify-mche-guidance-browser.mjs` 通过：四类入口、只读、模式保存、语义原值、候选过期、刷新恢复、历史不弹出、390px 无横向溢出。[结果](evidence/engineering-guidance/browser/browser.json) |
| 原有编辑器交互 | `verify-mche-editor-navigation-browser.mjs` 通过空流程、历史、失效/失败导航、未保存保护、会话隔离、移动宽度。[日志](evidence/engineering-guidance/checks/guidance-navigation.log) |

预算测试对扁管 89、翅片 164、冷媒 61 条逐页遍历，检查不重不漏、每页不超过 32,000 字节，并保留生成依据与执行限制。曾在真实三部件确认后遇到打开编辑器超预算，已压缩重复来源和非当前建议；[该真实失败状态复放](evidence/engineering-guidance/budget-replay.json)为 28,923 字节，新增测试覆盖长建议理由及全部分页后再次打开编辑器。

真实原表维持 26 条有效记录：D14 原值 0.55／显示 55%；D11 SC=0 K；D16 原文 4 m³/h；D15 `90°?` 待核；主工况空气 32°C 与测试 42°C 分开；SH=27.4 K 由原服务端规则计算，未反推质量流量。A10 矩形面积不一致仍为原 Mapper 阻塞，B04 的范围、不等式、未标注列 review 和焊前/焊后、Full/Overall 语义分别保留。

截图：[当前状态](evidence/engineering-guidance/browser/shared-state.png)、[390px 页面](evidence/engineering-guidance/browser/mobile-state.png)。原有导航脚本使用固定证据目录，运行时更新了 `evidence/flow-topology/editor-navigation` 内的生成文件；本次副本另存于 [editor-navigation](evidence/engineering-guidance/editor-navigation)。旧任务正文和历史记录未改。

## 真实模型与前后对照

使用当前配置 `DeepSeek-V4-Flash-0731`，独立 DSH_HOME、随机本地端口、独立会话和真实客户文件。仅本任务启动的实例在结束时关闭；临时复制的凭证已清空，不进入证据。真实模型证据与本地确定性夹具分开。

- 真正的实施前基线：[baseline-verified/report.json](evidence/engineering-guidance/baseline-verified/report.json)，两轮、6 次工具调用，确认加载实施前源文件且不存在 guidance。
- 修正预算后的两次完整流程：[live-final/report.json](evidence/engineering-guidance/live-final/report.json)，两个新会话、共 20 次工具调用、0 个业务失败。
- 加强证据边界提示后的定向复测：[evidence-recheck/report.json](evidence/engineering-guidance/evidence-recheck/report.json)，三轮、3 次工具调用，工程清单说明模式、绑定和 NaN 限制。
- 最新提示的两次完整流程：[live-acceptance/report.json](evidence/engineering-guidance/live-acceptance/report.json)，两个新会话、共 16 次工具调用、0 个业务失败。每次包括 5 次 API 对话及第 6 次真实聊天 UI 动画请求；三部件确认和结构填写由浏览器完成。两次均实际打开空动画、保存单排 30 根／冷媒 left／500 mm／无翅片 0 mm／空气 right_to_left，并被后续对话采用；需求和计算仍未确认。

上述完整流程的 `completed:true` 只表示脚本执行完毕，不是自然语言质量通过标记。最后补充的原件/摘要失效边界修正由确定性测试验证；没有将此前真实模型记录冒称为该修正后的全部重放。

| 同一比较请求 | 实施前实际回复 | 实施后实际回复与判定 |
|---|---|---|
| 未指定新设计管宽 | 要求先给宽度，称“管宽=翅片宽度是装配前提” | 最新两次均调用无约束推荐，返回不同宽度型号，不自动保存 16 mm；明确装配尚未验证。状态层通过 |
| 冷媒、目录压力和产品标签 | 由 R454C／21.06 bar 推到选 13.5 MPa，并排除低压／CO₂ 标签 | 后端不作这种筛选；但最新第 1 次对话又补充“R454C 在55°C冷凝对应压力约2 MPa级，可作为候选考量”。无物性证据，行为验收不通过 |
| 语义含义 | 原值与必填混在旧清单 | 页面正确提供焊前/焊后、Full/Overall、片距解释选项；最新第 1 次汇总仍称“16 mm料宽”为翅片深度选项，比较表曾把未确认片距写作节距。文字语义验收不通过 |
| 结构变更后的汇总 | 本次基线未跑结构流程，不作虚构对照 | 四次完整流程均读取页面保存的 30 根和两侧流向；没有重复保存旧管数字段或代为工程确认 |
| 计算能力 | 本次基线仅运行读取/比较 | 最新两次汇总均说明绑定与 NaN；第 1 次仍先泛称质量流量“缺”，后才限定视模式。页面及工具没有把它列作推荐 PTSC 必填 |

完整可见正文见 [conversations.md](evidence/engineering-guidance/conversations.md)，工具调用数量、会话与最终状态见 [run-summary.json](evidence/engineering-guidance/run-summary.json)。截图与逐轮快照保存在相应目录；UI 动画轮次的调用在 trace 中。未把业务失败算成功；最早 `live/` 的浏览器恢复时序失败、`live-retry/` 的响应预算失败以及错误加载基线的 `baseline/` 均保留，不能用作通过证据。

## 未通过项与交付边界

S1–S4 的服务端和页面实现已落地。S5 已完成规定的回归、真实流程重放与证据留存，但自然语言证据边界仍有阻塞：当前模型在明确提示后，偶发无依据物性推断、料宽/翅片宽度混称，以及未选模式时的冗余缺项。提示修正有定向改善，最新两次完整重放仍复现，因此不宣称真实对话全面通过，TLL 保留 S5 未完成并记录阻塞。

没有通过硬编码最终话术、删除工程诊断或放宽计算门禁来掩盖这些问题。DLL NaN 第42/43槽、冷媒绑定和非 PTM 执行仍未获本次验收；也没有新增自动设计、优化或新的求解模式。代码、接口和所有本任务记录目前均留在工作区，未提交、未推送。
