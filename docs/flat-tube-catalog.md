# 扁管名称与几何目录

来源为 `答复_/1-扁管选型.xls` 的 `总表!A3:P91`，共 **89 个型号**。
用原表“模具号”作为名称和唯一键，`A010S` 与 `A10` 是不同型号，不去前导零、不改大小写、不合并近似名称。

## 文件与查询

- [flat-tubes.json](../data/catalogs/flat-tubes.json)：Agent / 程序读取的完整目录，按 `byName[模具号]` 查询。
- [flat-tubes.csv](../data/catalogs/flat-tubes.csv)：可用 Excel 打开的全部型号和尺寸，保留原显示文本、来源区域与待核对说明。
- [33型号待核对清单 XLSX](../data/catalogs/扁管待核对清单_33型号.xlsx)：包含说明、33型号汇总、64个核对点明细及几何原值；两处已记录的尺寸矛盾单独标明，附核对后值和备注栏。
- [flat-tubes.mjs](../src/catalogs/flat-tubes.mjs)：导出 `getFlatTube(catalog, name)` 和 `listFlatTubes(catalog, filters)`。

在项目目录运行，Windows PowerShell / Linux 均可用：

```sh
node scripts/flat-tubes.mjs info
node scripts/flat-tubes.mjs get A01S
node scripts/flat-tubes.mjs list --width 16 --height 1.8
node scripts/flat-tubes.mjs list --width 25.4 --ports 26 --limit 10
node scripts/flat-tubes.mjs list --contains A19 --offset 0 --limit 20
```

`get` 返回该型号的完整几何、来源和问题。`list` 默认每页 20 项，返回 `nextOffset`；为 `null` 时结束。
尺寸和孔数是精确匹配，名称片段区分大小写；筛选不会隐藏存在特殊尺寸或矛盾的型号，结果包含 `review`。
查询读取已经保存的 JSON，不依赖原 Excel 进程、LibreOffice 或模型服务；通过脚本所在位置定位目录，支持其他工作目录调用。
目录模块负责数据与查询；对话 Agent 已通过独立 [MCHE 插件](../packages/dsh-mche/README.md) 接入查询、草稿推荐、确认快照与逻辑参数准备。目录本身保持只读，尚无正式 DLL 计算调用。

## 几何字段

| JSON 字段 | 原表列名 | 单位 |
|---|---|---|
| `widthMm` | 管宽 | mm |
| `heightMm` | 管高 | mm |
| `portCount` | 孔数 | 个，原表单位为空 |
| `neckWidthMm` | 缩口宽度 | mm |
| `neckLengthMm` | 缩口长度 | mm |
| `portWidthMm` | 孔宽 | mm |
| `portHeightMm` | 孔高 | mm |
| `noseMm` | Nose，保留原术语 | mm |
| `wallThicknessMm` | 壁厚 | mm |
| `ribThicknessMm` | 筋厚 | mm |
| `materialAreaMm2` | 材料截面积 | mm² |
| `flowAreaMm2` | 流通截面积 | mm² |

另在 `selection` 保存设计压力、焊前压力（原表单位 MPa）和应用范围。
`≥25`、`蛇形管11Mpa，平行流13.5` 等压力描述保留为字符串，不擅自变为一个压力值。

例如 `A01S` 的管宽 16 mm、管高 1.8 mm、孔数 10、孔宽 1.12 mm、孔高 1 mm、壁厚 0.4 mm、筋厚 0.42 mm。
名称与这些尺寸分别来自 `总表!A3`、`B3`、`C3`、`D3`、`G3`、`H3`、`J3`、`K3`。

## 原值与待核对内容

每个型号的 `evidence` 保存 16 个字段各自的单元格地址、`raw`、`display`、`formula` 和 `cached`。
几何只接受原数值或明确数值文本，例如原文 `0.70` 可规范化为 `0.7`，原字符串仍保留。
`非均匀`、`X形`、`φ0.7`、`0.7/1.0`、`0.63内齿`、`/`、`？` 不转换成单一数值：对应 `geometry` 为 `null`，原文和问题仍在。
`null` 不表示零，也不证明该尺寸不适用。选择此类型号时必须继续处理原描述，不能简单丢弃孔型信息。

**33 个型号**包含上述非单值/标记或尺寸矛盾；这是需要结合原文处理的数量，不等于 33 个型号都不可使用。
明确保留的例子：

| 型号 | 来源 | 记录与处理 |
|---|---|---|
| A192S1 | J67 / C67 | 壁厚 3 mm，管高 1.3 mm；记录矛盾，不改成猜测的小数 |
| A149S1 | H60 / C60 | 孔高 1.44 mm，管高 1.3 mm；保留原值并标记 |
| A1231 | G45 | 原文 `4.8.1`，保留文本，不猜成 4.81 |
| A209 | E76 / F76 | 缩口宽度和长度均为 `？`，留待补充 |

公式使用原文件的缓存值，保留表达式和显示精度；不执行公式重算来替换源值。
预览可能重算，仅用于核对表头、单位和布局。源文件包含隐藏的 `Macro1`，已检查并排除出型号目录，未执行宏。
图形颜色说明没有映射为供货状态，`availability` 为 `not_verified`；所有 89 个型号均被保留。
目录用于候选查询。`calculationReady=false`，选型和参数映射时必须保留型号、源文件摘要及 `review`，完成所需校验后才生成正式计算输入。

## 更新与验证

```sh
node scripts/import-flat-tubes.mjs
node --test src/catalogs/flat-tubes.test.mjs
```

导入默认读取上述原件，也可将文件路径作为参数；输出到固定的 `data/catalogs/flat-tubes.json` 和 `.csv`。
导入检查表头、单位、完整索引和唯一名称；重名、缺少名称、意外 Sheet 或列变化会停止，避免覆盖或漏项。
重复导入同一原文件产生相同数据。不会改写原 Excel；CSV 是导出视图，查询以 JSON 目录为准。

2026-09-08 验证：Windows / WSL Ubuntu **5/5** 测试通过，无跳过。
89 型号的 **1424 格**原值、显示值、公式及缓存逐项一致，CSV 显示文本一致，重新生成的 JSON 内容一致。
验证了按名称查询、宽高孔数筛选、分页全量遍历、未知名称/错误筛选拒绝，以及复杂尺寸不被误转成数值。
已人工核对隔离预览的表头和单位，未进行全部型号的图纸级几何和供货条件确认。
测试记录位于 `.dsh/tube-tests.log` 与 `.dsh/tube-linux-tests.log`；不替代整个应用或 DLL 计算验收。
若另一环境没有原件，实表相关测试会显示跳过，不能将其称为全量来源对账通过。

原文件：416768 字节；SHA-256：`d38659a4cb535c598cf1dd01737482e3db323cd5d58791c9e9ee38a7e1d5c37b`。
