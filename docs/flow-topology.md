# 空气、冷媒与流程结构

任务 `flow-topology-animation`，关联 `mche-calculation-plugin`。页面入口：MCHE方案 → 计算工况。动画与结构编辑共用 `calculation.topology`，带翅片长度等工况仍使用原有带来源的 calculation.draft；它们共同参与输入摘要、确认和运行快照。

## 结构与保存

```json
{
  "schemaVersion": 1,
  "rows": [
    { "id": "r1", "passes": [
      { "id": "r1p1", "tubeCount": 43, "direction": "left" },
      { "id": "r1p2", "tubeCount": 20, "direction": "right" }
    ] }
  ],
  "connection": "series",
  "order": ["r1p1", "r1p2"],
  "source": "2Pass_Opti.sh流程矩阵，仅用于解释结构，非用户工程确认"
}
```

例值仅作契约说明，不预填新方案。初始一排一流程，管数和方向均为 null。1～5排，每排1～6流程，每流程正整数管数、每排合计≤500；草稿允许 null 待填，待填时不能形成完整原生包。left/right 表示扁管左进右出/右进左出。排与流程ID必须全局唯一、以字母开头，限40字符。source限1200字；已填结构须有依据。origin由服务端标记，不采信客户端声明。

排数、流程数、总管数和管号不是可写字段。服务器按物理排/流程列表顺序连续编号，生成 `topologyLayout` 的 passes、rowCounts、header、connection、edges。某流程管数待填时，后续全局范围也显示待填，不补零、不猜号。空字段不是0根管。

`POST /api/mche/calculation-draft`：`{sessionId, revision, changes?, topology?}`。revision为 calculation.revision；传 topology 时必须有版本，冲突409。保留原接口变化字段及工程依据验证。结构启用后，从当前草稿删除旧 tubeCount/refDirection 输入，后续修改两者必须通过 topology，禁止两套数据相互覆盖。旧记录只投影为单排单流程，不重写旧文件。源数据版本、确认及准备包仍保存于原有会话存储中，不新增数据库。

串联 order必须是全部流程ID的完整排列；默认逐排，页面提供跨排交替及完整顺序编辑，选择某位置会交换两个流程，避免制造重复。并联只允许每排内部列表顺序流动，全部支路共用总入口/出口，order采用物理列表顺序；不开放任意分叉和合并。更换结构使确认/准备失效；旧运行仍绑定其原始 topology、部件和工况。

对话工具 `mche_calculation_update_draft` 有可选topology，schema只允许1排，服务端也检查已有/目标排数。已有多排方案的计算草稿不能被对话修改或静默改成单排。`mche_calculate` 在多排方案上拒绝对话执行，只允许页面入口。模型可通过 case/profile工具读取完整结构和阻塞项，30流程结果仍在32KB预算内。

`mche_calculation_open_editor({})` 只读取当前会话方案，返回 `mche: { sessionId, view: 'conditions', openEditor: true, ... }` 展示引用。用户要看动画或需到页面填写结构时，Agent 调用此工具；已有状态通知不能替代导航调用。空管数/方向也可打开编辑器，不自动填演示值。浏览器仅在当前实时回复结束并恢复编辑权限后消费一次打开请求；工具详情保留“打开流向与拓扑编辑器”按钮。历史加载、普通说明文本和失败工具不自动打开；会话不匹配、有本地未保存草稿或用户已手动打开后关闭时不抢占页面。没有新增 HTTP 写接口，也不改变确认、准备或计算状态。后端新工具需重启服务加载，前端刷新加载。

## 原软件与原生矩阵

[原样例矩阵及SHA-256](verification/evidence/flow-topology/source-samples.json)从两份本机原软件文件提取。`2Pass_Opti.sh` 为 `[1,43,+1,0]`、`[44,63,-1,0]`；`3Pass_Opti.sh` 的后3个流程全局管号78～154、排索引1，串联节点顺序为 `0→1→4→5→2→3→6→7`。定向测试逐项比较 HeadInf 与 ConnectInf，无容差。3Pass原样例另有 BTWISTED=1；本次仅复现其流程矩阵，不宣称完整扭转模型已在新Profile中验证。

新机器契约 `src/worker/topology-contract.json` 继承基础单排契约，摘要是 `{base,topology}` 的排序JSON SHA-256。Mapper摘要还包括拓扑映射、Python结构校验和其他原有映射/Worker文件。旧Profile和原单排数组保持兼容。

| 入参 | 生成规则 |
|---|---|
| General[1] BANKNUM | rows.length |
| General[9] BUNITUBE | 各排总管数相同为1，否则0 |
| Tube[70] | 每排14槽；均匀时仅首块，非均匀时填每个活动排完整块，并在14×排索引+1保存对应管数；其余槽初始化0 |
| General[10] BUNIFIN / Fin[50] | 共用翅片，仍为1及首块；后续块TYPE兼容槽1，其余0 |
| HeadInf | `[globalStartTube,globalEndTube,+1或-1,zeroBasedRowIndex]` |
| ConnectInf | 大小为流程数+2；总入口节点0，流程节点1～N按物理列表排列，总出口N+1；有向a→b保存[a][b]=1、[b][a]=-1 |

逐排槽位依据 `data.cpp` 的14槽/排、10槽/排和 `threadrun.cpp` 逐项SI传参；均匀与逐排Tube分支依据其BUNITUBE访问方式。相同型号、端口尺寸及长度用于所有排，差异仅在各排管数。Worker独立检查排数、连续管号、方向、每排流程数/守恒、活动/未用槽位、固定几何、矩阵尺寸/反对称、完整串联或逐排并联、入口出口方向；在加载DLL前拒绝非法请求。

冷媒仍精确WATER绑定，PTM、PTRH与体积空气流量、矩形孔、百叶窗及固定关联式范围不变。`uniform_refrigerant_distribution=true` 和空分配场来自现有调用契约，**不能据此断言排间等流量或压降平衡算法**。原供应资料缺少DLL内部并联算法；两条真实调用路径的并联合成输入均抛异常，因此页面准备包以 `dll_parallel_distribution_unverified` 阻塞正式执行。独立重放脚本允许保留失败诊断，不开放用户并联计算。

## 图形与生命周期

扁管轴线为X，空气穿过翅片和各排的深度为Z，两者物理正交；Y为管列高度。SVG投影的屏幕斜角不是物理夹角。反转airDirection只改变Z方向和空气经过的排顺序，排索引与全局管号不变。

金属芯体、代表管与翅片、集流管隔板、外部管路使用原生SVG；蓝色为空气、橙色为冷媒，保持静态箭头和入口出口文字。暂停与减少动态仍能读方向。图上排/流程和下方列表可键盘选择；外部管路在芯体上层，并以浅色衬线区别。整体视图压叠各排，展开视图逐排排列，窄屏保持标签字号并提供滚动和放大。

独立requestAnimationFrame控制器仅改变粒子transform；路径重采样只在结构/选中状态或视图变化时发生。播放、速度、显隐、展开/放大不写工程状态。减少动态、document隐藏、图形离开视口、详情关闭时取消动画帧；切页和切会话断开观察器/监听器并释放路径。保存前显示“未保存”，保存响应后按服务端状态重绘，不显示假温度云图或相变结果。

验证入口：[验收记录](verification/2026-09-11-flow-topology-animation.md)。当前整项未完成真实DLL验收，不以动画/矩阵/加载成功代替工程验证。
