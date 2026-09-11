# 翅片编号与几何目录

来源为 `答复_/2-翅片选型.xls` 的唯一工作表 `Fin`，共 **164 个型号**。
沿用扁管目录的 JSON / CSV 与离线查询方式，保存编号、几何尺寸、单位依据、原文、公式缓存和来源。

## 文件与查询

- [fins.json](../data/catalogs/fins.json)：完整目录，`byName[型号]` 查询；`byCode[Code文本]` 为对应型号数组。
- [fins.csv](../data/catalogs/fins.csv)：Excel 可打开的全部型号及尺寸，带 UTF-8 BOM，保留原显示文本、分区、来源及待核对说明。
- [fins.mjs](../src/catalogs/fins.mjs)：导出 `getFin(catalog, name)`、`listFins(catalog, filters)`。

```sh
node scripts/fins.mjs info
node scripts/fins.mjs get B01
node scripts/fins.mjs list --code 310150
node scripts/fins.mjs list --width 16 --height-post 8.1 --pitch 1.4
node scripts/fins.mjs list --section tube_insert --stock-width 21
node scripts/fins.mjs list --section cross_insert --slot-pitch 12 --slot-width 2
node scripts/fins.mjs list --contains B4 --offset 0 --limit 20
```

名称与 Code 区分大小写、精确匹配；不去前导零或拆分编码范围。例如 `B0a` 不改为 `B0A`，`390065-66` 保留为完整编号文本。
原表数字 Code 在查询索引中转为字符串，原数值类型及显示格式仍在 `evidence.code`。
**17 个型号没有有效 Code/ERP**，包括两格 `无图纸`，不会补造编号；A 列型号均保留。
**4 个 Code 对应多个型号**，不会覆盖：`310150` 对应 `B0f/B150`，`310270` 对应 `B0t/B0tA`，
`315093` 对应 `B59B/B59C`，`317013` 对应 `B71C/B71D`。

`get` 返回完整型号与字段依据。`list` 默认每页 20 项、最多 100 项，返回 `nextOffset`，为 `null` 时结束。
尺寸是精确匹配，筛选结果保留 `geometryText`、未标注列和 `review`；进一步回查用 `get` 的 `evidence`。
焊前和焊后高度必须分别使用 `--height-pre`、`--height-post`；不提供含义不明确的 `--height`。
目录查询通过脚本路径定位数据，可从其他工作目录调用，不依赖原 XLS、Excel、LibreOffice 或模型服务。
对话 Agent 已接入 MCHE 翅片查询、比较、建议和用户确认界面；与扁管分别选择并保存完整快照，见 [插件使用说明](../packages/dsh-mche/README.md) 和 [翅片接入验收](verification/2026-09-09-fin-agent.md)。

## 分区与字段

| 分区键 | 原表区域 | 数量 | 保存规则 |
|---|---|---:|---|
| `main` | `A6:AA140` | 135 | 按第 2 行主表表头 |
| `tube_insert` | `A143:AA161` | 19 | 穿管模具，按第 142 行局部几何表头 |
| `dongsheng` | `A163:AA166` | 4 | 东升设备，保留第 162 行使用限制；按主表对应列保存并标注表头继承待确认 |
| `cross_insert` | `A169:AA174` | 6 | 横插翅片，按第 168 行局部几何表头 |

主表和东升设备的几何字段如下，长度单位来自第 4 行（mm），角度为 °，个数未写单位。

| 字段 | 原表列 | 含义 |
|---|---|---|
| `thicknessMm` | C | Fin Gage，料厚 |
| `widthMm` | D | Fin Width，翅片宽度 |
| `heightPreBrazingMm` | E | 焊前翅片高度 |
| `brazingChangeMm` | F | 钎焊过程高度变化量 |
| `heightPostBrazingMm` | G | 焊后翅片高度 |
| `finPitchMm` | H | 翅片间距 |
| `finPitchRangeMm` | I | 样品片距范围，原文保留；规范化数值始终为 null |
| `rMm` | J | R，保留原符号，不将上限改为确定值 |
| `louverLengthFullMm` | K | Louver Length (Full) |
| `louverLengthOverallMm` | L | Louver Length (Overall) |
| `louverPitchMm` | M | 开窗间距 |
| `louverAngleDeg` | N | 开窗角度 |
| `louverCount` | O | 开窗个数 |

穿管模具和横插翅片继续保存 `thicknessMm`、`finPitchMm`、`finPitchRangeMm`、`louverAngleDeg`、`louverCount`。
它们的 D 列按“料宽”保存为 `stockWidthMm`，L 列按“扁槽长度”保存为 `slotLengthMm`。
横插翅片 E 列为 `slotPitchMm`（槽间距）、M 列为 `slotWidthMm`（扁槽宽度），不套用焊前高度或开窗间距。
两个下部分区没有另写单位行，目录按同工作表第 4 行的 mm/° 保存，并在字段的 `unitBasis` 标明继承；正式计算映射前仍须确认。

穿管模具局部表头未标注 J/K/M 的含义，其已有数值保存在 `unclassified.sourceColumnJ/K/M` 和相应 `evidence`，不推测为 R、开窗长度或开窗间距。
例如 `B150L` 的 `J146=2.1`、`K146=7.6`、`M146=1.16` 均保留，但字段含义待核对。
Y/Z/AA 全表没有字段标题，也按 `unclassified.sourceColumnY/Z/AA` 保存原文，不能丢弃其中的状态或几何备注。

其他列在 `selection` 保存新旧图号、Status、模具数量、材料、复合层、单位长度重量、应用产品及工艺状态。
下部分区这些附加列沿用主表对应列标题，`headerCell` 标明依据；局部几何字段和原单元格可分别回查。
目录 `source.headers` 保存所有分区标题、表头、符号、单位及空白行；每个型号完整保存 A:AA 的 27 个单元格。

## 原值与待核对项

每格 `evidence` 含地址、`raw`、`display`、`formula`、`cached`、类型、数字格式、批注及超链接。
只把原数值或明确数值文本规范化为数字；空白、范围、不等式、多值、说明和非均匀描述不补零、不猜测。
`geometry` 为 `null` 时，应继续读取 `evidence`，不代表尺寸为零或已确认不适用。
原表明确的零保留，例如 `B0f` 高度变化量为 0，`B184` 开窗角度和个数为 0。

| 型号 | 来源 | 原文及处理 |
|---|---|---|
| B01 | I6 / J6 | `1.3~1.5` / `≤0.45`，保留范围与上限，不取中点或上限作为单值 |
| B704 | C119 | `0.08/0.09`，不擅选一个厚度 |
| B3q / B3t | M44 / N45 | `变`，保留非均匀间距/角度及备注 |
| B62 | L103 | `7.2(实际7)`，保留标称与实际说明，不擅改为 7 |
| B603 | F105 | `（0.04,0.02）`，保留多值 |
| B421 | J69 / E69:G69 | R 为 45 mm；8.13−8.1 与原变化量 0.02 不一致，保留并标注 |
| B604 / B605 / B208 | E106:G106 / E107:G107 / E135:G135 | 三处焊前后高度与变化量不一致，均不自动修正 |
| B184 | H174 / I174 | 片距 1.2 与范围 `2.0-2.4` 不一致，均保留 |
| B34 / B71D | Z37 / AA111 | `报废` / `无刀架，暂不可用`，不能仅按 R 列 Available 判断可用 |
| 东升设备 4 型号 | A162 | `模具存在，但基本无法使用`，该限制随每个型号保存 |

`reviewCount=164` 表示每个型号至少有范围、缺项、未标注列或其他需保留的说明，**不代表 164 个型号都有尺寸错误或全部不可使用**。
`review` 是有限的数据核对规则，不代替图纸、加工和供货核实。原表状态、分区限制和备注都要保留。
`availability=not_verified`、`calculationReady=false`；尚未核实当前供货，也未完成 DLL 参数映射。

## 导入与验证

```sh
node scripts/import-fins.mjs
node --test src/catalogs/fins.test.mjs src/catalogs/flat-tubes.test.mjs
```

导入可选传入 XLS 路径；输出固定为 `data/catalogs/fins.json` 与 `.csv`，不改原件。
已按此版本工作簿的具体布局校验；Sheet、行列、合并区域、表头、单位、分区或型号变化会停止，需要核对后更新映射。
Code 共享允许并标注，型号重复会停止。相同原件可重建完全相同的 JSON 与 CSV；公式使用原缓存，未执行重算或宏。

2026-09-09 目录阶段 Windows 验证：翅片 **7/7**、扁管回归 **5/5** 通过，无跳过。
逐项对账 **4428 个型号数据格 + 270 个表头格 = 4698 格**；包括 **219 条公式缓存**，原值、显示值和 CSV 文本一致，JSON/CSV 重建一致。
验证了全部分页、Code 一对多、分区尺寸筛选、错误输入拒绝，以及从其他目录调用 CLI。
通过隔离的 LibreOffice 预览核对了 `A1:O10`、`A139:O150`、`A162:O174` 共 6 页的表头、单位与分区布局；预览值不覆盖原缓存。
目录阶段未进行全应用回归或对话 UI 选型验收，后续接入结果见上述验收记录。尚未进行图纸级几何确认或 Linux 目录测试。
另一环境若缺少原件，实表相关测试会显示跳过，不能当作来源对账通过。

原件为 195584 字节，SHA-256：`ebe7eda0b9c8a323591b9877b3ef23188f9f6e72507eacc0a7233fa96a0d11ab`。
