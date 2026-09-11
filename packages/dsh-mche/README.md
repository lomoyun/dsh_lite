# MCHE 部件与冷媒选型插件

加载项目现有 `data/catalogs/flat-tubes.json`、`fins.json` 和 `refrigerants.json`，供当前 DSH Agent 自主查询、比较和建议。
资料见 [扁管目录](../../docs/flat-tube-catalog.md)、[翅片目录](../../docs/fin-catalog.md)，扁管需求见 [确认计划](../../docs/tube-agent-plan.md)。

## 使用

根依赖、默认 profile 和本 checkout 的实际 profile 已接入 `@dsh-lite/mche`。运行 `pnpm start` 后在聊天中描述尺寸、粘贴表格，或直接指定型号。
若服务已运行，需要重启以加载插件；本次实现没有终止用户原服务。其他已有 profile 需要自行加入此 bundle，启动器不会覆盖既有选择。

蓝色工具结果链接打开右侧详情，可切换扁管/翅片/冷媒，核对输入、比较候选、确认选择和准备参数。三种选择分别确认并同时保存。
表格的“确认发送”只把资料发给 Agent，不等于已确认正式输入。提取后的值、单位和来源需要用户单独核对。

## 工具和校验

当前方案新增统一工程指导 `guidance` 与 `recommendationContext`，供工具、每轮对话状态及右侧分类待办共用。候选保留生成时依据并检测过期；旧逻辑缺项仅在详情中核对。接口、证据边界和预算见 [工程指导说明](../../docs/mche-engineering-guidance.md)。

注册 `mche_case_get`、`mche_case_update_draft`、`tube_search`、`tube_get`、`tube_recommend`、`tube_propose_selection`、`mche_prepare_calculation`。
翅片增加 `fin_search`、`fin_get`、`fin_recommend`、`fin_propose_selection` 四个工具。
冷媒增加 `refrigerant_search`、`refrigerant_get`、`refrigerant_recommend`、`refrigerant_propose_selection`。[冷媒目录说明](../../docs/refrigerant-catalog.md)包含标识、分类、浓度基准及查询示例。
实际计算新增5个工具；冷凝器需求增加 `mche_requirements_files/read/get/update_draft/recommend_boundary` 五个工具；`mche_calculation_open_editor` 只读取当前方案并请求打开计算工况页，连同原选型与准备共26个工具。
用户要求查看流动动画或需要填写结构时调用打开工具，空管数/方向也能打开。当前回复完成后浏览器自动展示拓扑编辑器，并保留“打开流向与拓扑编辑器”链接；历史恢复不自动打开，导航不修改或确认工程数据。
无模型确认工具。会话 ID 来自执行上下文，不接受模型指定其他会话或覆盖目录几何。
各工具独立校验，无固定先后顺序；保留当前 Agent 循环。

查询支持精确值、单侧/双侧 `{min,max}` 范围，尺寸单位 mm；名称区分大小写，保留前导零。
服务最多每页100项；模型侧整个响应按32KB预算分页，`nextOffset` 非空时可继续读取。
推荐保留目录顺序，不生成总分或“最佳”；指定 `names` 时保留不满足项供比较。结果记录生成时的草稿/确认依据和来源。
压力只比较目录明确数值，复杂描述及场景适用性返回未知；性能、成本、供货始终标注未验证。
翅片支持精确型号、Code/ERP、分区和尺寸筛选；共享 Code 返回全部型号，不把不同分区视为可互换。范围/上限规格、未知几何、尺寸矛盾、使用限制分别呈现。

草稿 `changes` 按字段更新，`null` 清除字段，例如：

```json
{
  "tubeLength": { "value": 50, "unit": "cm", "source": "用户给定管长50cm" },
  "tubeWidth": { "value": { "min": 15, "max": 16 }, "unit": "mm", "source": "用户要求" },
  "finSection": { "value": "main", "unit": "", "source": "用户指定主表翅片" },
  "finWidth": { "value": 16, "unit": "mm", "source": "用户要求翅片宽度16mm" },
  "finHeightPostBrazing": { "value": 8.1, "unit": "mm", "source": "用户要求焊后高度8.1mm" },
  "finPitch": { "value": 1.4, "unit": "mm", "source": "用户要求片距1.4mm" }
}
```

支持管宽/管高/孔数约束、管长/管数/管间距、设计压力、应用场景和其他工况原文。
其他工况只保存原文，不猜正式字段映射或最终必填数量；管间距不推断为净间隙或中心距。
长度支持 mm/cm/m，压力支持 MPa/kPa/Pa/bar，数量用“个”并要求安全正整数。
翅片约束字段见 [fin-fields.js](src/fin-fields.js)：料厚、翅片宽度/料宽、焊前/焊后高度、片距、槽尺寸、开窗尺寸/角度/个数。
角度单位为 °；开窗角度和个数允许原表明确的零。`finSection` 只接受 `main`、`tube_insert`、`dongsheng`、`cross_insert`。
冷媒约束：`refrigerantCategory` 为 `refrigerant/water/eg/pg`，`refrigerantConcentration` 为百分数（单位 `%`、0–100，可用范围），`refrigerantConcentrationBasis` 为 `volume/mass`。文本枚举单位为空字符串。只有浓度数值而无基准时保留待核对提示，不认为质量与体积浓度可互换。

## HTTP 和用户确认

同源 POST 接口位于 `/api/mche/`，都需 `sessionId`，复用工作区归属和可编辑状态检查：

| 路径 | 额外参数 |
|---|---|
| `case` / `prepare` | 无 |
| `draft` | `changes`，可选 `revision` |
| `confirm-inputs` | `revision`、`reviewId`、`fields` |
| `search` | 尺寸、名称片段、分页 |
| `tube` | 精确 `name` |
| `recommend` | 可选 `names`、分页 |
| `propose` | 精确 `name`、`reason`，可选 `revision` |
| `confirm-tube` | `revision`、`proposalId` |
| `fin-search` | `code`、`nameContains`、`section`、几何字段及分页 |
| `fin` | 精确 `name` |
| `fin-recommend` | 可选 `names`、分页 |
| `fin-propose` | 精确 `name`、`reason`，可选 `revision` |
| `confirm-fin` | `revision`、`proposalId` |
| `refrigerant-search` | `nameContains`、`sequence`、`category`、`concentrationPercent`、`concentrationBasis`、分页 |
| `refrigerant` | 精确 `name` |
| `refrigerant-recommend` | 可选 `names`、分页 |
| `refrigerant-propose` | 精确 `name`、`reason`，可选 `revision` |
| `confirm-refrigerant` | `revision`、`proposalId` |

确认按会话、建议/核对令牌和版本原子校验，重复或过期请求返回409。
草稿变化清除相关字段确认，使受影响部件的待处理建议和旧参数准备失效，并重查该部件已选型号。
三种选择使用独立版本，冷媒条件变化不覆盖扁管或翅片建议/确认，反之亦然。共享应用场景会重查三种选择；未映射工况原文保留待核对状态。
型号不满足新约束或无法核实变更约束时需要重新确认；只改管长等参数不会撤销型号快照。
失效确认不会因后来删除条件而自动复活。
每轮开始把最新后端状态摘要提供给 Agent；浏览器确认不触发额外模型请求。

## 持久化和计算边界

方案保存在 `DSH_HOME/mche/cases/<sessionId>/<12位版本>.json`，每会话一个当前方案。
单服务内按会话串行提交，先完整写临时文件，再原子改名为新版本文件并保留历史。
读写失败不清空历史；不支持多个服务进程同时写同一 home，沿用本地单用户服务边界。
每次操作读取目录并计算 SHA-256；确认时再次比较摘要。目录更新不覆盖已确认几何。
确认快照保留完整几何、字段单位、原始证据、问题、目录及源文件摘要。

`selections.tube` 与 `selections.fin` 分别引用 `snapshots[snapshotId]`。翅片快照保存型号、Code/ERP、分区、几何、原单元格、未标注列和待核对项。
`selections.refrigerant` 引用保存介质标识、原表序号、类别、说明、浓度百分数/基准及原单元格证据的快照；原表序号不等于已验证的 DLL 编码。
旧记录读取时补充空翅片/冷媒状态及兼容版本，不回写历史文件；旧建议缺少 `component` 时按扁管处理。
`preparation` 包含版本、三种选择的快照引用、参数和来源：

- `tubeConfirmed` / `finConfirmed` / `refrigerantConfirmed`：对应选择的确认有效。
- `tubeParametersComplete`：扁管截面、管长、管数、管间距及已提供约束已确认并通过逻辑校验。
- `finParametersComplete`：翅片核心几何及已提供约束通过校验；R、片距范围和钎焊变化原文另行保留，不据此宣称正式参数完整。
- `refrigerantParametersComplete`：介质选择和已提供的冷媒约束已确认并通过目录校验；不代表物性、适用工况或 DLL 映射已验证。
- `parametersComplete`：上述三项同时满足，范围为 `tube-fin-refrigerant-logical`，不代表整机正式参数完整。
- `assemblyCompatibilityVerified`：本期为 `false`，不按宽度相等等假设自动判断扁管/翅片装配匹配。
- 逻辑几何视图中的 `dllMappingReady` 保留原范围语义；实际计算状态读取独立 `calculation.preparation`，`calculationReady` 仅在当前确认、映射和运行环境均就绪时为true。

逻辑参数按明确公制规则转换为 m/m²，保留原值、单位、系数和来源。
逻辑几何键为 `width`、`height` 等，去掉目录键的 `Mm`/`Mm2` 后缀；目录快照不变。
未知值保留 `null`，尺寸矛盾和未知几何分别阻塞。
孔型、周长、面积语义、管间距含义、编码和位置数组未核实，不猜测或补零。
参数包 `scope=tube-fin-refrigerant-logical`；保留 `parameters.geometry`/`design`/`finGeometry`，增加 `parameters.refrigerant` 和 `refrigerantSnapshotId`，未确认介质数据为 `null`。历史参数包保留生成时的范围标识，重新准备后使用当前范围。
冷媒浓度保留 `%` 数值与独立的质量/体积基准，不互相换算；未提供浓度不补成0%或100%。`dllFluidIdentifier=null`，物性和DLL映射继续阻塞。
翅片下部分区的继承单位未核实前不换算成计算数值，原值仍保留；范围、不等式和复合描述保持 `null` 及原文。
上述 `scope=tube-fin-refrigerant-logical` 保留原有逻辑展示；实际 DLL 计算使用下面的独立计算子状态。非均匀开窗和优化排名未开放。页面新增最多5排、每排6流程的结构编辑与空气/冷媒动画；多排计算的验证边界见 [流向结构契约](../../docs/flow-topology.md)。

## 实际计算

### 客户需求与 Boundary

上传冷凝器需求 Excel 后，Agent 可按表内标题和字段结构读取；页面从 **MCHE 方案 → 客户需求** 进入。只提取有值字段，原件/原文/单位候选和来源保留；参考表提取26条。已填客户需求、独立补填和测试条件均可核对。

`mche_requirements_read` 一次完成选中单位核对、换算与四区域 Profile 草稿。Quality、Sat.T、SH、SC 均可在需求页、计算工况页及 `mche_calculation_profile_get` 查询。参考表额外派生 SH=27.4 K，RH=55%、SC=0 K；保留空气流量原值4 m³/h。来源温度修改/清除后SH重算/清空，明确SH冲突需处理；完整映射与证据随用户确认快照保存。规则更新后旧需求须重新读取确认。

冷媒七种组合、空气三种状态和两种流量输入可切换并保值；推荐只说明字段覆盖依据，仍需用户选择。核对与当前计算草稿的差异后，用户确认原子应用 Boundary 和需求快照，使旧计算确认及准备包失效。其他模式明确阻塞执行；本期未扩展 DLL。已有需求时工况经客户需求页更新，下面的计算草稿接口继续处理结构和工程补充。

完整字段、模式、接口及单位依据见 [冷凝器需求填写](../../docs/condenser-requirements.md)，验证见 [需求验收](../../docs/verification/2026-09-10-condenser-requirements.md)。

### 计算 Profile

Profile 为 `mche.condenser.single_row.ptm.v1`：单排、单流程、冷媒入口绝对压力/温度/质量流量，空气入口绝对压力/干球温度/相对湿度/体积流量，均匀分配。原生契约和42参数说明见 [原生契约](../../docs/mche-native-contract.md)，完整范围见 [获批方案](../../docs/mche-calculation-plan.md)。

新增 `mche.condenser.multi_row.ptm.v1` 处理单排多流程及多排结构，保留原 Profile。`calculation.topology` 与图形、全局管号、HeadInf/连接矩阵共用；保存须传 `calculation.revision`，结构修改使确认与准备包失效。对话只写/执行单排，多排由页面编辑和触发；读取多排不受限制。并联可编辑预览，但当前 DLL 并联合成重放抛出 `0xe06d7363`，分配算法也缺少依据，正式执行阻塞。串联重放仍有42/43槽NaN，任何非有限输出均失败；参数就绪不表示已验证可计算。

当前只验证了 WATER 的精确物性绑定、均匀矩形孔和百叶窗几何映射。其他目录记录仍可查询选择；缺失映射会明确阻塞。目录已有流通面积不会改写。**当前真实 DLL 返回管/翅片温度NaN，程序严格记录失败；尚未形成工程验收通过的目录算例。** [验收记录](../../docs/verification/2026-09-09-mche-calculation.md)区分真实调用、接口回归和工程精度。

确认型号后，从聊天顶部“MCHE方案”或工具结果进入右侧详情：

1. 在“计算工况”填写工况、根数、带翅片/无翅片长度及方向，在“工程核对”补充孔型、翅片结构与尺寸含义、FPI定义、导热系数、单位和装配依据。
2. 核对原表值、采用值、单位换算、来源，以及全部待确认工况，点击“确认计算输入与工程核对”。模型可保存草稿，不能代替确认。修改相关输入、部件快照或规则会使确认失效。
3. 在“参数准备”生成原生包、查看完整数组及阻塞项。就绪后点击“开始计算”，无需模型在线。也可明确发送“开始计算”或“计算当前方案”。引用、附件、示例和插件提示不授予执行权；修改后未确认的草稿不能直接计算。
4. 在“计算结果”刷新/取消/查看原始输入与输出。任务立即保存并返回runId；切换方案后保留旧输入结果并标注历史方案。

| 工具 | 行为 |
|---|---|
| `mche_calculation_profile_get` | Profile、所需字段、当前缺项、运行环境 |
| `mche_calculation_update_draft` | 字段 `{value,unit,source}`；null删除；不接受确认标志 |
| `mche_prepare_calculation` | 原有逻辑准备和新原生准备共存 |
| `mche_calculate` | 只接收 preparationId，受本轮真实用户消息授权 |
| `mche_calculation_get` | 可选runId；否则按offset/limit分页，默认20项及总数；nextOffset继续读取 |
| `mche_calculation_cancel` | runId；取消排队或本次子进程 |

同源 POST `/api/mche/`：`calculation-profile`、`calculation-draft`（changes、可选revision）、`calculation-confirm`（revision、reviewId，仅用户接口）、`calculate`（preparationId、requestId）、`calculation-get`（可选runId、detail）、`calculation-cancel`（runId）。均要求当前工作区sessionId；归档只读。按钮与对话调用同一服务，同requestId幂等，同输入正在运行时并发触发合并为同runId。

计算子状态独立保存在方案的 `calculation`：draft、revision、confirmation、preparation；读取旧记录补空，不改历史快照。任务在 `DSH_HOME/mche/runs/<sessionId>/<runId>/<12位版本>.json` 追加保存，含输入、确认、部件证据、Profile/Mapper/DLL版本、完整原生入参、原始结果、触发来源、错误、日志与耗时。Agent只接收摘要，完整数组不挤占聊天上下文。全服务原生任务串行，每次独立进程；服务重启将未完成任务标为interrupted且不自动重跑。

### 本机运行环境

使用项目独立32位CPython；无需安装Python包。已有 `.dsh/mche-python-x86/python.exe` 可检查：

```powershell
.\scripts\mche-runtime-setup.ps1 -CheckOnly
```

新checkout需要用户提供现有完整Windows x86独立CPython目录，再执行 `scripts/mche-runtime-setup.ps1 -PythonSource <目录>`。脚本仅创建项目解释器和其SHDLL junction，不修改外部解释器，不覆盖既有目标，不安装全局环境。runtime文件必须与契约哈希一致。

插件配置 `pythonX86`、`runtimeRoot`、`calculationTimeoutMs`；前两项未配置时读取环境变量 `MCHE_PYTHON_X86` / `MCHE_RUNTIME_ROOT`，再回退到当前项目 `.dsh/mche-python-x86/python.exe` / `runtime`，超时默认120000ms（允许1000–3600000）。JSONL受控子进程，不接受模型指定路径或原生数组。取消先置停止标志，2秒不退出则只终止本次子进程。

## 验证

```sh
node --test packages/dsh-mche/test/*.test.js
node --test src/catalogs/refrigerants.test.mjs src/catalogs/fins.test.mjs src/catalogs/flat-tubes.test.mjs
pnpm test
pnpm run typecheck
pnpm peers check
pnpm run config:dump
```

集成测试使用真实 DSH 与本地确定性模型，验证语言/表格输入、工具、确认、追问及重启，不验证外部模型准确率。
历史证据见 [扁管验收](../../docs/verification/2026-09-08-tube-agent.md)，本次接入见 [翅片验收](../../docs/verification/2026-09-09-fin-agent.md)。
冷媒接入记录见 [冷媒验收](../../docs/verification/2026-09-09-refrigerant-agent.md)。
