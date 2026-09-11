# 冷凝器客户需求与 Boundary 填写

上传 Excel 后，Agent 可通过 MCHE 插件读取需求并给出 Boundary 推荐。也可在聊天顶部 **MCHE 方案 → 客户需求 → 选择当前会话 Excel** 中读取，填写与确认按钮不依赖模型在线。

对话整理冷凝器需求时优先使用 `mche_requirements_read`：附件已附服务端核验的 `fileId`/Sheet 概览，新会话也注入方案 `revision=0`。一次读取返回完整 Profile、原始记录、单位/派生依据、推荐及冷媒精确匹配，直接复用；后续写入使用最近返回的顶层方案版本，实际冲突时再刷新。标准样表以 1～3 次识别调用为目标，不设硬上限。

多张候选请用户选表；未知结构按诊断搜索、局部读取或预览，分页只补当前问题所需证据。通用理解发布保留严格来源/覆盖校验，原值或转换错误附字段名、路径和坐标。已有 Profile 时直接引导客户需求页，不主动另加“整理参数表”卡片；用户明确需要独立表格时仍可整理。测试条件单独说明，可疑风量只核对原值与单位。复测结果见 [处理收敛验收](verification/2026-09-10-excel-processing-convergence.md)。

1. 核对四个区域：Refrigerant Side、Heat Exchange Inlet、Heat Exchange Outlet、Air Side。完整草稿含 Quality、Sat.T、SH、SC、采用值、用途、来源及待核原因，转换/派生依据可展开。空白字段不产生原始提取记录。
2. 选择冷媒、空气状态和流量模式，或点击“采用推荐作为草稿”。切换模式自动保存现有填写值，重新显示用途与缺项；这一步不等于确认。
3. 已提取字段直接修改采用值；原表未填的 Boundary 字段在独立补填区填写。保存入口温度或冷凝温度后，SH 自动重算；清除来源后派生值清空。独立明确的 SH 用于与派生结果比较，冲突需修改来源/明确值或清除明确 SH 后再确认。
4. 核对当前计算草稿的前后差异，点击“确认需求并应用当前工况草稿”。需求核对完成和当前模式输入齐备分别记录，允许确认含缺项的需求。
5. 在“计算工况”补充管数、带翅片/无翅片长度及方向，在“工程核对”核对工程含义；部件选型继续独立确认。随后准备参数。

## 模式范围

| 冷媒模式 | 本次唯一冷媒输入 | 执行 |
|---|---|---|
| `ptm` | 入口绝压、入口温度、质量流量 | 仅结合空气 `ptrh` 和 `volume` 接入 |
| `pxm` | 入口绝压、入口干度、质量流量 | 未接入 |
| `ptsc` | 入口绝压、入口温度、出口过冷度 | 未接入 |
| `ptt` | 入口绝压、入口温度、出口温度 | 未接入 |
| `tsat_sh_m` | 饱和温度、入口过热度、质量流量 | 未接入 |
| `tsat_sh_sc` | 饱和温度、入口过热度、出口过冷度 | 未接入 |
| `tsat_sh_t` | 饱和温度、入口过热度、出口温度 | 未接入 |

空气状态：`ptrh` 为绝压/干球温度/相对湿度，`ptwb` 为绝压/干球温度/湿球温度，`ptx` 为绝压/干球温度/含湿量。流量选择 `volume`（体积流量）或 `velocity`（迎面风速）。七种冷媒组合与三种空气状态、两种流量共 42 种填写组合。

未接入组合可以保存和确认，但准备包 `native=null`、`calculationReady=false`。不得复用旧 PTM 包。输入齐备不代表部件、工程映射或物性已通过验收。

## 参考表字段清单

`答复_/3-冷凝器客户输入.xls`，Sheet `Condenser Inputs`。下面的坐标仅是验收证据，识别程序通过标题、字段锚点和重复单位列结构推导填写列；改名、移动行列、隐藏 Sheet 不改变识别依据。

| 来源 | 字段键 | 原始填写 / 用途 |
|---|---|---|
| D5 | refrigerant | R454C；介质参考，与部件选择单独核对 |
| D6 | refTemperature | 82,4 °C；入口温度 |
| D7 | refPressure | 21,06 bar(a)；绝压 |
| D8 | refSatTemperature | 55 °C；按模式作为输入或参考 |
| D9 | heatLoad | 16 kW；设计目标 |
| D11 | refSubcooling | 0K；零保留，按模式作为输入或目标 |
| D12 | refPressureDrop | 1 bar；设计上限 |
| D13 | airTemperature | 32 °C；主工况 |
| D14 | airHumidity | raw=0.55，display=55%；按格式读取为55% |
| D15 | airAngle | 90°?；带疑问的参考原文 |
| D16 | airVolumeFlow | 4 m³/h；原值保留，不按经验修正 |
| D18 | airPressureDrop | 150 Pa；设计上限 |
| D21 / D24 | spaceLength / spaceHeight | 600 / 600；保留 B/C 单位候选及 C3 选框依据 |
| D38 / D39 | bracket / installation | Yes / 安装说明原文 |
| D41 / D42 / D43 | background / application / environment | 项目背景 / HVAC / 环境原文 |
| D44 / D47 | environmentalProtection / certification | RoHS, REACH, CE / PED |
| D45 / D46 / D48 / D51 | dust / appearance / fatigue / corrosion | 四项 No 全部保留 |
| D50 | testConditions | Tc= 55°C, Tair=42°C；测试条件独立保存 |

共26条；D10质量流量、D17风速等空白项不提取。SH 作为独立派生项得到27.4 K，不增加原始记录数。新增但未映射的有值字段按参考原文保留。多张需求表返回候选（包括隐藏 Sheet 和同页纵向多表），用户选择精确 Sheet 和标题坐标后读取；重复字段逐项保留并标记待核，清除不采用的值后可恢复单一工况。填写列歧义及不完整索引明确拒绝。

## 数字、单位与来源

`requirements.document.records` 保留原字段名、raw/display、公式/缓存、单元格格式、单位候选、单位依据、隐藏/合并及文件/索引摘要。原文件继续由 Excel 插件保存，需求编辑只修改 `edits`；补填保存在 `supplements`，不会写回 Excel。

按 `Choose units` 标记行与双单位列定位 `■`/`□`，只读取各字段所在行的选中单位，并同时核对值内单位/百分比格式。两列均选中/均未选中、单位缺失或冲突时保留原值，规范化值为 null，不回退到另一列。图片选框及新结构模板明确报告限制。

公英制转换包括：绝对温度 `K=(°F−32)×5/9+273.15`；`psia×6894.757293168→Pa`（绝压，不接受表压/压差）；`lbm/h×0.45359237/3600→kg/s`；`ACFM×0.028316846592/60→m³/s`（实际体积流量，不推算标况）。每项保存原值、单位选框/单位格证据、factor/offset及规范化值。

温差独立处理：K 与 °C 温差等价，°F 温差乘5/9，不加偏移。因此样表 `0K` 与选中列的 °C 一致。RH 的 Excel raw=0.55/format=0% 先读取为55%，Quality 规范化为0～1。小数逗号支持 `82,4`、`21,06`；`1,000` 等易与千分位混淆的写法待核。零、false、No、疑问和未核公式缓存均保留。

版本化定义位于 `packages/dsh-mche/src/requirements-mapping.js`，由解析器、Profile 投影和页面共同使用，映射版本为 `mche.condenser.requirements@2`。SH 统一来源温度到K后执行固定公式 `refTemperature−refSatTemperature`，保存两个来源及公式版本；缺项、无效或负差值为待核。显示值消除浮点尾差；独立 SH 核对容差为1e-6 K。SC 在业务输入保存非负过冷度；`SC(-)=-refSubcooling[K]` 仅为后续 DLL 映射说明，尚未执行该模式。

不推算物性或工程缺项：热量不反推质量流量，空间长度不作带翅片长度或迎风面积，空气夹角不作流向枚举，测试温度不覆盖主工况。需要用户补填的依据不能由模型代确认。

## 服务与门禁

Agent工具：`mche_requirements_files/read/get/update_draft/recommend_boundary`。`read` 一次返回四区域 `profileDraft`；`mche_calculation_profile_get` 同样包含完整草稿，不再局限于 PTM 字段。输入中的 sessionId 由当前 Agent 提供，模型不能指定其他会话，也没有需求确认工具。`read` 和 `update_draft` 必须带最新方案 `revision`；多表读取可传 `sheet` 和 `table`（标题坐标）。每轮只注入当前状态摘要，完整证据由查询工具读取。

需求介质用于目录精确匹配；匹配成功后通过现有冷媒建议/确认入口选择。页面同时显示当前介质及差异，无精确记录时保留缺项，不自动替换为近似冷媒。

同源 POST `/api/mche/`：`requirements-files`、`requirements-read`、`requirements`、`requirements-draft`、`requirements-recommend`、`requirements-confirm`。最后一项仅接受用户接口，要求方案 revision 和服务端 reviewId；归档会话只读。

确认在现有 CaseStore 串行事务中完成，绑定会话、需求版本、规则摘要、当前计算输入及部件快照，复查原件/索引摘要后保存完整需求快照（含所有 entries、derived、profileDraft、单位及派生依据）并原子替换当前 Boundary 输入。结构和工程草稿保留；本次不采用的工况从计算草稿移除，但需求中继续保存。旧计算确认、逻辑准备和原生准备均失效。查询、准备和执行时复核原件/索引完整性；规则变化需重新读取原表。历史版本、需求快照及运行结果保留。

旧会话读取时补空需求状态，不回写历史。已有需求后，冷媒/空气工况统一经客户需求页更新；`calculation-draft` 仅继续接收结构与工程补充，防止并行维护两套工况。

原需求功能验收见 [既有验收记录](verification/2026-09-10-condenser-requirements.md)，本次四区域映射与SH联动见 [Profile 映射验收](verification/2026-09-10-condenser-profile-mapping.md)。
