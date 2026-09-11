# 冷媒与载冷剂目录

来源为 `答复_/5-冷媒库.xlsx` 的唯一工作表 `冷媒清单`，共 61 项：制冷剂 26、水 1、乙二醇类 19、丙二醇类 15（含 `PROPYLEN`）。

`data/catalogs/refrigerants.json` 保存全部记录、原表证据和来源摘要；`refrigerants.csv` 为带 UTF-8 BOM 的可读导出。对话 MCHE 已接入查询、比较、建议和用户确认，见 [插件说明](../packages/dsh-mche/README.md)。

## 字段及保留规则

| 字段 | 单元格列 | 规则 |
|---|---|---|
| `sequence` | A | 原表序号1–61；不是已验证的DLL编码 |
| `category` / `categoryKey` | B | 原类别完整保存；筛选键为 `refrigerant/water/eg/pg` |
| `name` | C | 精确介质标识，保留大小写、标点及特殊名称 |
| `description` | D | 介质说明原文 |
| `concentrationPercent` | E（隐藏） | 原浓度百分数；30代表30%，空值为 `null` |
| `concentrationBasis` | 根据C列标识 | `Vol.` 为 `volume`，`Wt.` 为 `mass`；保存依据单元格，不互相换算 |

`EG30Vol.` 与 `EG30Wt.` 是不同目录项。`CO2`、`WATER`、`PROPYLEN`、`R1234zez`、`R1234zee`、`R1233zde` 均按原表保存，不补别名或擅改标识。无浓度值的条目不补成0%或100%，也不据此断言纯度。

每项保存 A:E 五个单元格的原值、显示值、类型、格式、公式/缓存、批注与超链接；标题/表头、合并范围和列隐藏状态也保存。当前原件无公式。目录序号、名称及浓度在建议和确认时从后端读取，不能由模型覆盖。

## 查询与使用

```sh
node scripts/refrigerants.mjs info
node scripts/refrigerants.mjs get R134a
node scripts/refrigerants.mjs get EG30Vol.
node scripts/refrigerants.mjs list --sequence 26
node scripts/refrigerants.mjs list --category eg --concentration 30
node scripts/refrigerants.mjs list --category eg --concentration 30 --basis mass
node scripts/refrigerants.mjs list --contains PG --offset 0 --limit 10
```

CLI 由脚本位置定位目录，可以从其他工作目录调用；运行时查询不依赖 Excel。默认20项，最多100项，`nextOffset=null` 时结束。

对话中可以说“查询 R134a 并建议选择”，或者“查看乙二醇浓度30%的选项，比较质量浓度和体积浓度”。通过蓝色链接进入右侧冷媒页面，也可在“候选比较”中按类别浏览、按标识查询。确认后保存 `selections.refrigerant` 与完整快照，和扁管/翅片同时保留；输入条件变化时重查冷媒选择，刷新或重启可恢复。

目录没有温压范围、物性曲线、配比换算、材料兼容性、性能或供货信息。参数准备仅保留已确认介质、浓度及来源，`dllFluidIdentifier=null`，正式物性与DLL映射仍需核实。

## 导入和验证

```sh
node scripts/import-refrigerants.mjs
node --test src/catalogs/refrigerants.test.mjs
node --test packages/dsh-mche/test/refrigerants.test.js packages/dsh-mche/test/refrigerant-native.test.js
```

导入可选传入 XLSX 路径，固定输出 JSON/CSV，不修改源文件。工作表/范围/表头、序号、重复标识或浓度矛盾等变化会停止导入，要求核对；不会执行宏或重算公式。

原件 13353 字节，SHA-256 `ef2987e4328be020eff7e1c9a8beedff88ed68b9d0b8460780a6d63fe909cb66`。2026-09-09 已逐项核对305个数据格及10个标题/表头格，JSON/CSV重建一致。接入和运行边界详见 [验收记录](verification/2026-09-09-refrigerant-agent.md)。
