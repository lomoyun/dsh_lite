# MCHE 单排 PTM 原生契约

Profile：`mche.condenser.single_row.ptm.v1`；Mapper release：1。机器契约在 [contract.json](../packages/dsh-mche/src/worker/contract.json)，确定性映射在 [calculation-mapper.js](../packages/dsh-mche/src/calculation-mapper.js)。本契约不预填用户工况或几何，不执行表达式。

## 依据与验收状态

原始依据是本机 `E:/projects_related_files/微通道/解释文件(2)/` 的 `dll.h`、`index.h`、`threadrun.h`、`threadrun.cpp`、`data.cpp`。各文件 SHA-256 保存在机器契约 `sources`。容量来自实际 C++ 调用方；ctypes ABI/矩阵缓冲管理复用 `E:/projects/MHCE_agent/solver_worker/mche_driver.py` 和 `worker.py` 的绑定部分。没有引入旧 Agent、FastAPI 或数据库。

本版本以真实 LTR 输入验证参数位置及物性加载路径，**尚未通过工程计算验收**：当前 DLL 返回 42/43 槽 NaN，运行被标记失败；真实目录组合的用户工程确认资料尚缺。详见 [验收记录](verification/2026-09-09-mche-calculation.md)。成功加载或数值对照相同不构成精度证明。

| 文件 | SHA-256 |
|---|---|
| MCHEdll.dll | `13de5fc0f6e76e6585ff755fbc4bebea1e5e00f959b0c3dc70ae9c90a753a5f9` |
| SHDLL/SHProp.dll | `2db0c210a88df01187a9dc13da63ddc61d243c9028247a1aef75611473853e6c` |
| SHDLL/REFPROP.dll | `ff17e8e9183ab25a10ee3d59954bcb207face3b62d549f915160f1fe8c5ba652` |

Worker 每次执行检查 MCHEdll 和全部 SHDLL 文件（共181个）的哈希、32位 Windows Python、解释器旁 SHDLL 的实际目标，以及 `GetModuleFileNameW` 返回的 SHProp 加载位置。契约内容以排序 JSON 的 SHA-256 标识；确认和准备包另绑定 Mapper/字段/Worker绑定代码摘要。启动忽略外部Python环境变量，只导入插件内绑定。DLL、物性或求解规则变化后须重新核验并确认，不能只修改允许的哈希以放行。

## ABI 与全部42参数

Windows x86、`extern "C"`、cdecl；`ctypes.CDLL`。返回 `bool`；`double` 为64位，`int` 为32位，`bool` 为 `ctypes.c_bool`。字符串按 GBK 编码、NUL 终止。矩阵是逐行分配并保活的指针数组，不是把二维连续缓冲强制转换为 `T**`。表中 I/O 表示本插件调用方使用方向；未支持分支的内部读写语义不作扩展承诺。

| 位置 | 原生参数 / 类型 | 方向 | 本 Profile 的容量、值或适用条件 |
|---|---|---|---|
| 1 | mainPath / const char* | I | 插件配置的项目 runtime 绝对路径；模型无此参数 |
| 2 | dGeneral / double* | I | 16项，固定求解配置，见下表 |
| 3 | dTubeGemSI / double* | I | 70项，14项×5排容量，只用首排 |
| 4 | dFinGemSI / double* | I | 50项，10项×5排容量，只用首排 |
| 5 | dFinK / double | I | 用户确认的翅片导热系数，W/(m·K)，正数 |
| 6 | iInlterlaced / int* | I | 3项 `[0,1,0]`，非交叉结构的调用方配置 |
| 7 | iNonUniformType / int | I | 0；均匀几何 |
| 8 | iConInf / int** | I | 3×3连接矩阵，单流程加入口/出口节点 |
| 9 | iHeadInf / int** | I | 1×4：`[1,N,d,0]`，管数N；入口方向d=±1 |
| 10 | iPassNum / int | I | 1；由 header 行数生成 |
| 11 | iRefFlowType / int | I | 0，固定调用方流程模型 |
| 12 | dResidual / double* | I | 12项；首槽−1为已核对调用约定，其余初始化0；不能由聊天任意修改 |
| 13 | cRef / const char* | I | 精确 `WATER`，不是目录序号 |
| 14 | dRefInputSI / double* | I | 15项；仅 PTM |
| 15 | bUniformRef / bool | I | true |
| 16 | dRefLiqDis / double** | I | NULL；均匀冷媒分配时不传分配场 |
| 17 | dRefVapDis / double** | I | NULL；同上 |
| 18 | iRowNum / int | I | 0；冷媒分配场行数，非整机排数 |
| 19 | iColNum / int | I | 0；冷媒分配场列数 |
| 20 | dHeaderGem / double** | I | NULL；本 Profile 不启用集流管几何压降分支 |
| 21 | dHeaderDP / double* | I | NULL；同上 |
| 22 | iHeaderNum / int | I | 0；同上 |
| 23 | dRefPort / double** | I | NULL；均匀矩形孔，无指定孔截面矩阵 |
| 24 | iPortRow / int | I | 0；指定截面矩阵无行 |
| 25 | dPortWeb / double** | I | NULL；未启用非均匀筋/孔结构 |
| 26 | iBlockNum / int | I | 0；同上 |
| 27 | dBlockNo / int** | I | NULL；同上（名称以d开头但类型为int**） |
| 28 | iBPN / int | I | 0；同上 |
| 29 | iAirFlowDir / int | I | +1从左到右，−1反向；用户明确提供 |
| 30 | dAirInputSI / double* | I | 8项；PTRH、体积流量 |
| 31 | dAirVelField / double** | I | NULL；均匀空气速度 |
| 32 | dAirTemField / double** | I | NULL；均匀空气温度 |
| 33 | iTubeNum / int | I | 0；非均匀空气场行数，**不是** Tube[1]的管数 |
| 34 | bAutoCor / bool | I | false；使用固定关联式 |
| 35 | dCorInf / double* | I | 12项，见下文 |
| 36 | dDehum / double* | I | 3项 `[0,1,1]`，除湿模型关闭 |
| 37 | bStop / bool* | I/O | 初始false，取消监听线程置true；持有到原生退出 |
| 38 | dResult / double* | O | 64项，以0初始化输出容量；返回后逐项有限性检查 |
| 39 | strError / char* | O | 1024字节空缓冲；原调用方256字节，这里保留更大容量，GBK解码 |
| 40 | Rmodel / int | I | 0；不启用外部阻力/风机工作点模型 |
| 41 | Res5 / double* | I | **实际6项**，调用方 `res6[6]`；Rmodel=0时全0，仅此模式放行 |
| 42 | FanCoe7 / double* | I | **实际10项**，调用方 `fancoe[10]`；Rmodel=0时全0，仅此模式放行 |

单排单流程连接矩阵为 `[[0,1,0],[-1,0,1],[0,-1,0]]`。**HeadInf 四列依次为全局起始管号、全局结束管号、冷媒方向（±1）、从0开始的物理排索引**。因此 `[1,N,d,0]` 表示第0排从1到N号管；流程管数为结束号−起始号+1。原文将首列解释为排号、末列解释为非扭转状态有误，已根据2Pass/3Pass原软件样例校正，单排数组数值保持不变。管数1–500、孔数1–500、开窗数量0–1000是容量保护，不代表工程适用范围。集流管/附加阻力未启用，结果中的压降不可描述成已覆盖全部实际接管及装配损失。

2026-09-11新增独立 `mche.condenser.multi_row.ptm.v1`，共用此基础契约的物性、孔型、翅片、空气和残差设置，范围及逐排槽位见 [流向结构契约](flow-topology.md)。本页下文“固定1排/单流程/只用首排”描述原单排 Profile，不限制新增 Profile。两者均未通过真实工程验收。

## 数组位置、单位与未使用槽位

以下索引均从0开始；完整英文枚举见机器契约 `arrays.*.slots`。所有必需采用值必须有目录证据或带来源的工程补充。下面的0仅为固定模型标志、明确未启用分支或输出缓冲初始化，不是缺失输入的替代值。

### General[16]

| 槽 | 枚举后缀 | 值 / 单位 / 说明 |
|---|---|---|
| 0 | HXTYPE | 0，原调用方换热器类型 |
| 1 | BANKNUM | 1排 |
| 2 | TYPE | 1=CON，调用 CalcCondenser |
| 3 | BINTERLACED | 0，非交叉 |
| 4 | BTWISTED | 0，非扭转 |
| 5 | BSER | 0，非蛇形 |
| 6 | BSTAG | 0，非错排 |
| 7 | SOLVERTYPE | 0，Based On Tube |
| 8 | SEGNUM | 20段，固定 LTR 求解配置 |
| 9 | BUNITUBE | 1，均匀管几何 |
| 10 | BUNIFIN | 1，均匀翅片几何 |
| 11 | AIRBUNIVEL | 1，均匀空气速度 |
| 12 | AIRBUNIT | 1，均匀空气温度 |
| 13 | BEXFIN | 1，Extend Fin，固定 LTR 配置，装配核对需明确此含义 |
| 14 | YBIAS | 0 m，长度偏置关闭 |
| 15 | XBIAS | 0 m，高度偏置关闭 |

### Tube[70]

| 槽 | 含义 | 单位 / 来源 / 条件 |
|---|---|---|
| 0 | NAME | 0，手工几何兼容槽；不是目录编码 |
| 1 | NUM | 根数，用户确认 |
| 2 | L | m，每根带翅片长度，用户确认 |
| 3 | H | m，管高 |
| 4 | W | m，管宽 |
| 5 | PORT_TYPE | 0=矩形；孔宽/高的存在不构成孔型确认 |
| 6 | PORT_NUM | 孔数 |
| 7 | PORT_H | m，均匀矩形孔高 |
| 8 | PORT_W | m，均匀矩形孔宽 |
| 9 | L_UNFIN | m，每根无翅片总长度，允许明确提供0 |
| 10 | P | m，**扁管周长**；矩形几何模式不使用，固定0 |
| 11 | CSA | m²，管截面积；当前矩形分支不使用，固定0 |
| 12 | PORT_P | m，孔周长；当前矩形分支不使用，固定0 |
| 13 | PORT_CSA | m²，孔截面积；当前矩形分支不使用，固定0 |
| 14–69 | 排2–5容量 | 单排模式未使用；逐项0初始化 |

`tubePitch` 不映射到槽10。目录已有总流通面积不改写；采用的矩形孔高×宽×孔数必须与之数值一致（仅浮点容差），否则阻塞。原始非矩形/非均匀截面不能通过“修正”目录面积绕过。原材料导热系数中只有翅片 K 是这42参数中的独立输入，未使用的成本、密度、管材料 K 不强制补齐。

### Fin[50]

| 槽 | 含义 | 单位 / 来源 / 条件 |
|---|---|---|
| 0 | NAME | 0，手工几何兼容槽 |
| 1 | TYPE | 1=Louver Fin；用户确认结构 |
| 2 | FPI | 1/in；必须核对节距、净间距或直接FPI |
| 3 | H | m；明确选焊前、焊后或工程补充 |
| 4 | D | m；明确 Fin Width 对应深度或工程补充；不取料宽 |
| 5 | T | m，厚度 |
| 6 | LOUVER_COUNT | 数量，目录明确0可保留 |
| 7 | LOUVER_L | m；Full、Overall、工程补充分别核对 |
| 8 | LOUVER_A | 度（°），**不是弧度**；rad输入乘180/π |
| 9 | LOUVER_P | m，开窗间距 |
| 10–49 | 排2–5容量 | 单排未使用；每10项中TYPE槽=1，其余=0，与调用方初始化一致 |

若片距为节距p(mm)，FPI=25.4/p；若为净间距g(mm)，FPI=25.4/(g+t)，t为采用厚度(mm)。不能统一套用25.4/片距。范围、不等式、多值保持原文，未明确采用值时阻塞；下部分区单位须提供工程依据。

### Refrigerant[15] 与 Air[8]

| 数组槽 | 含义 | 当前模式 |
|---|---|---|
| Ref[0] | IN_REF | WATER兼容槽22；只据LTR精确绑定，不使用Excel序号 |
| Ref[1] | BFASTSOLVE | 0 |
| Ref[2] | REFINTYPE | 0=INPUT_PTM |
| Ref[3] | REFP | Pa，入口绝压；设计压力不替代 |
| Ref[4] | REFT | K，入口温度；本模式不是焓 |
| Ref[5] | REFX | 无量纲干度，PTM未使用，0 |
| Ref[6] | REFM | kg/s，总质量流量 |
| Ref[7] | REFTXVP | Pa，TXV分支未使用，0 |
| Ref[8] | REFTXVT | K，TXV分支未使用，0 |
| Ref[9] | REFOUTP | Pa，出口目标未使用，0 |
| Ref[10] | REFOUTSH | K温差，出口目标未使用，0 |
| Ref[11] | REFSATT | K，饱和边界未使用，0 |
| Ref[12] | REFINSH | K温差，过热边界未使用，0 |
| Ref[13] | BREFOUTT | 0，不反算出口目标 |
| Ref[14] | REFOUTT | K，出口目标未使用，0 |
| Air[0] | AIRTYPE | 0=IN_AIR_PTRH |
| Air[1] | AIRP | Pa，入口绝压 |
| Air[2] | AIRTDB | K，入口干球温度 |
| Air[3] | AIRRH | 百分数0–100；0%有效 |
| Air[4] | AIRTWB | K，PTRH未使用，0 |
| Air[5] | AIRBVOL | 1，给定体积流量 |
| Air[6] | AIRVOL | m³/s，总体积流量 |
| Air[7] | AIRVEL | m/s，体积流量模式未使用，0 |

温度°C加273.15；负°C可接受，归一化后必须大于0 K。压力bar乘100000、MPa乘10⁶、kPa乘1000；不接受表压单位。质量kg/h除3600，体积m³/h除3600、L/s乘0.001；湿度fraction乘100。EG/PG浓度及质量/体积基准绑定未验证，明确阻塞；空浓度不推成0或100%。除WATER外目录仍能查询选择，但无计算物性绑定。

### Correlation、Dehumidification、Residual

Correlation[0..5]分别是空气HTC、空气DP、冷媒单相HTC、单相DP、两相HTC、两相DP枚举，固定 `[4,5,0,2,4,0]`，沿用当前LTR配置；不根据旧软件名称推断当前DLL中的公式语义。Correlation[6..11]是相应无量纲修正系数 `[1,1,1,1,1,0.6]`。接口回归仅验证这组值及本DLL，不证明这些关联式对任意工况的精度。

Dehumidification[0]为启用开关0；[1]为未启用时的模型兼容槽1；[2]为未启用时的无量纲系数1。Residual[0..11]按 `index.h` 分别为 CON_PORT_P_RES、STEP、COE、CON_OUT_SC_RES、STEP、EVA_PORT_P_RES、STEP、COE、EVA_OUT_SH_RES、STEP、EVA_OUT_P_RES、STEP。本版只使用调用约定 `[-1,0,0,0,0,0,0,0,0,0,0,0]`；−1是调用方默认求解哨兵，不作为负压力。非哨兵残差/步长的尺度未作为用户输入验证，禁止开放修改。

### Result[64]

原始数组与页面换算分开保存。表中索引是原生输出，不是原UI的 OUT_* 显示索引；后者存在额外派生项，不能直接复用其序号。

| 槽 | 原生含义 | 单位 |
|---|---|---|
| 0–5 | 总/显/潜/液相/两相/气相换热量 | W |
| 6–10 | 总/液相/两相/气相/集流管充注量 | kg |
| 11–12 | 冷媒/空气质量流量 | kg/s |
| 13–14 | 空气/标准空气体积流量 | m³/s |
| 15 | 空气入口速度 | m/s |
| 16–17 | 空气/冷媒压降 | Pa |
| 18 | 冷媒饱和温降 | K温差 |
| 19–20 | 入口/出口集流管压降 | Pa |
| 21–22 | 空气出口干球/湿球温度 | K |
| 23 | 空气出口湿度 | % |
| 24 | 冷媒出口绝压 | Pa |
| 25 | 冷媒出口温度 | K |
| 26 | 冷媒出口干度 | 无量纲 |
| 27–28 | 冷媒过冷/过热度 | K温差 |
| 29 | 冷媒速度 | m/s |
| 30–34 | 主/次/总/冷媒换热面积、迎风面积 | m² |
| 35 | 翅片效率 | 无量纲 |
| 36–40 | 空气/冷媒总/液相/两相/气相HTC | W/(m²·K) |
| 41 | 霜体积 | m³ |
| 42–43 | 管/翅片温度 | K；当前实测NaN，不按未用槽忽略 |
| 44–46 | 液/两相/气相分布 | 原UI按百分数展示；保留原始尺度，不另行缩放 |
| 47–50 | 管/翅片/集流管/连接管材料体积 | m³ |
| 51–53 | 芯体长/深/高 | m |
| 54 | 风机功率 | W |
| 55 | 风机压差 | Pa |
| 56 | 时间槽 | 原调用方另外写入时间；本插件以Worker计时，不使用此槽计费/计时 |
| 57–58 | 空气入口干球/湿球温度 | K |
| 59 | 空气入口湿度 | % |
| 60 | 冷媒入口绝压 | Pa |
| 61 | 冷媒入口温度 | K |
| 62 | 冷媒入口干度 | 无量纲 |
| 63 | 冷媒入口过冷度 | K温差 |

原函数返回false、错误文本非空、任何非有限结果、缺结果、进程崩溃均不能成功。NaN/Inf以 `{ "nonFinite": "nan" }` 等标记保留原位置，不序列化为JSON null，不替换为0。页面只对成功结果显示工程摘要；失败时仍能查阅完整原始输出用于诊断。
