# MCHE 工程指导与推荐依据

本次沿用已有工具、目录、需求草稿、确认快照及拓扑编辑器。指导按读取时的有效状态计算；计算仍使用原 Profile、Mapper、确认摘要和执行校验。

## 接口

`POST /api/mche/case`、现有需求/选型/草稿工具，以及 `mche_calculation_profile_get` 增加可选字段：

| 字段 | 含义 |
|---|---|
| `guidance.version` | 展示契约版本，目前 1 |
| `guidance.groups` | data / structure / confirmation / engineering 四类。问题包含 field、reasons、sources、impact、entry（view / component）；HTTP 另有稳定 id 与诊断 code |
| `guidance.boundary` | selected 当前模式；未选时 recommended 单独列组合覆盖、缺项与 executionSupported，不合并所有模式缺项 |
| `guidance.stages` | 资料读取、草稿保存、需求/部件/计算确认、映射、受控执行就绪、当前快照计算成功分别表示 |
| `guidance.capabilities` | 当前组合支持、DLL 非有限结果限制；仅当前多排并联时增加并联限制 |
| `guidance.semanticChoices` | 已选翅片的焊前/焊后、Full/Overall、节距/净间距选项与原值、单位、来源；不代用户选定含义 |
| `guidance.suggestedActions` | 最多三个可选页面入口；不限制工具顺序或自由讨论 |
| `guidance.details` | HTTP 保留旧逻辑缺项、原始计算诊断和 warnings。工具省去重复详情，完整诊断仍可通过页面和 Profile 工具读取 |
| `recommendationContext` | 明确保存的 constraints、需求 references、selected 部件、来源、boundary 和 fingerprint；不单独持久化 |

每轮模型通知采用同一份服务端指导和页面最新值。旧逻辑 `missing` 在工具响应中为兼容保留并标 `missingScope=legacy-logical-only`，不再注入每轮状态作为正式必填。旧 HTTP 字段仍保留；管数/冷媒方向以 topology 为准。

`tube_recommend`、`fin_recommend`、`refrigerant_recommend` 的现有候选记录新增可选 `basisSummary`：生成时的实际约束、草稿/确认状态、参考资料、已选部件、Boundary、来源和摘要。目录顺序、满足/不满足/未知、review 与分页语义不变。

当前依据摘要或目录改变时，读取投影返回 `stale=true` 和 `staleReason`；不会把新条件填进旧摘要。旧候选缺少摘要时要求重新比较，不回写历史。型号确认快照与正式计算门禁不因此自动放行。

Boundary 原有推荐上增加 `recommendation.combination`：`boundary`、`supplied`、`missing`、`inputComplete`、`executionSupported`、`executionMessage`。按现有数据推荐的 PTSC 等组合保留，不为执行 PTM 改换求解问题。该补充在展示层生成，不改需求规则摘要。

## 依据边界

- 只有用户明确保存的选型条件用于筛选；未确认条件可用于草稿比较。`application` 和未映射工况仅核对，不证明适用性。
- 需求中现用型号、安装空间、应用描述及已选部件都是参考，不自动生成管宽、设计耐压或管长条件。无约束可浏览或比较指定型号。
- 目录单位明确与 DLL 字段含义明确是两件事。几何来自已有服务端投影；补充值要求来源，范围、不等式、null 和原始 review 不被改写。
- 页面将建议理由与服务端核对分开。理由不修改校验状态；确认型号仅保存目录快照，不证明装配、供货、性能或安全余量。

## 页面与预算

右侧详情保留现有导航，新增当前状态与四类可展开待办。入口只读取方案；未保存草稿仍阻止跳转。来源及旧诊断可展开，其他模式未填字段默认折叠为非当前必填。保存后用服务端返回状态重绘。

工具仍遵守 32,000 字节预算。压缩重复来源和非当前建议，保留需求工具的完整映射与派生依据；推荐分页保留生成时的依据摘要、当前分类和执行限制。`nextOffset` 按实际返回候选数推进。业务 `ok:false` 不计成功，页面也按失败处理。

`guidance` 与 `recommendationContext` 不写入用户方案、不参与计算输入摘要；`basisSummary` 仅随已有候选版本保存。无需迁移用户数据。原始规则、Mapper、原生 Worker、模型全局配置均未修改。

验收与前后对照见 [实施验收记录](verification/2026-09-11-mche-engineering-guidance.md)。
