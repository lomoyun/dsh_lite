# 冷凝器 Excel 与 Profile 映射验收

日期：2026-09-10。任务：`condenser-profile-mapping`。沿用既有 `condenser-requirements`，未改写其任务及验收历史。

## 交付范围

- `requirements-mapping.js` 统一字段标签、四区域目标字段和 SH/SC 规则；解析器、Profile 与页面使用同一映射，版本 `mche.condenser.requirements@2`。
- 按表内标题、字段结构和 Choose units 行识别；支持隐藏/改名/移动行列、多 Sheet 及纵向多表选择。重复字段保留并待核，不覆盖为单一输入。
- 根据 `■`/`□` 核对选中单位、值内单位及百分比格式；°F、psia、lbm/h、ACFM 确定性转换；温差与绝对温度分别处理。
- 后端独立派生 SH，保存两个来源及公式；来源修改/清除、无效/负差、明确 SH 冲突均有联动。仅浮点舍入误差范围内的等温差视为0，未给定值不补0。
- `mche_requirements_read/get/update_draft` 和 `mche_calculation_profile_get` 返回完整映射草稿；页面显示四区域、用途、来源与可展开依据，沿用冷媒精确建议/确认入口。
- 用户确认快照包含全部原始记录、edits/supplements、entries、derived、Profile、单位/公式依据及规则摘要。模式切换保值，只有当前输入组合进入计算；修改、规则变化或原件/索引损坏使原确认/准备失效。

## 真实样表

原件：`答复_/3-冷凝器客户输入.xls`，SHA-256：`5806f521604c4933f9005d4fa92f89547a6c47aa87b4f2f08f791511ee9513d0`。

| 项目 | 结果及证据 |
|---|---|
| 原始记录 | 26条；零、No、疑问、测试条件及未知参考信息保留；SH不增加原始记录数 |
| 入口温度 / 冷凝温度 | D6=`82,4 °C`，D8=`55 °C`；C3选中，单位格C6/C8 |
| SH | 独立派生27.4 K；保存 D6/D8、统一温度值及固定公式 |
| RH | D14 raw=0.55、display=55%、format=0%；采用55% |
| SC | D11原文0K；选中C11为oC，按温差等价采用0 K |
| 空气流量 | D16原文4 m³/h不变；规范值4/3600 m³/s |

## 自动验证

| 命令 / 范围 | 结果 |
|---|---|
| `node --test --test-concurrency=1 packages/dsh-mche/test/requirements-profile.test.js packages/dsh-mche/test/requirements.test.js packages/dsh-mche/test/requirements-native.test.js packages/dsh-mche/test/calculation-mapping.test.js packages/dsh-mche/test/native.test.js` | 最终25/25通过，无跳过；日志 `.dsh/profile-mapping-targeted-final.log` |
| `node --test --test-concurrency=1 packages/dsh-mche/test/*.test.js` | 扩展回归56/59通过；两条旧文案断言失败，一条扁管对话502；后者在最终定向复验通过。日志 `.dsh/profile-mapping-mche-final.log` |
| `node --test --test-concurrency=1 packages/dsh-lite-web-app/test/*.test.js packages/dsh-excel-understanding/test/*.test.js packages/dsh-model-config/test/*.test.js packages/dsh-workspace/test/*.test.js packages/dsh-prompt-config/test/*.test.js` | 77通过、1失败、2跳过；日志 `.dsh/profile-mapping-application-tests.log` |
| `pnpm run typecheck` | 通过 |
| 浏览器脚本 `scripts/verify-requirements-browser.mjs` | 桌面1440×1000、手机390×844通过，无页面错误 |

定向覆盖：左右列、双选/未选/缺单位/实质冲突、百分比格式与字面百分号、Quality百分数/分数/零、绝压、公英制温度及流量、K/°C温差等价、隐藏与移动、重复字段和多表候选、明确SH及来源修改/清空/负差、版本失效与原件损坏、全部快照恢复、PTM准备及未支持模式阻塞。

真实 DSH 集成使用本地确定性模型，验证上传→Agent读取/推荐→用户确认→准备阻塞→重启恢复→对话将入口温度改为84°C→Profile查询得到SH=29 K。原D6仍保存82,4 °C，旧确认及准备包失效。未将夹具输入当作正式工程确认。

宿主在长上下文中会裁剪工具历史。每轮状态摘要已精简，完整证据通过查询工具读取；集成夹具遇到裁剪会重新查询，不解析截断JSON或伪造完整结果。工具原始响应仍受32KB预算约束；不修改宿主压缩配置，不把此测试表述为外部模型准确率验收。

扩展回归未全绿：`fin-native.test.js:13`、`refrigerant-native.test.js:10`仍期待“确认翅片型号/确认冷媒”，现有`response-view.js`使用“查看翅片选型建议/查看冷媒选型建议”；这些文件及文案未在本任务修改。其他应用回归在既有`action-flow.js:38`的新会话请求出现502；该流程不读取冷凝器需求，保留日志，没有扩大修复范围。两个跳过项为Linux视觉预览和真实蒸发器视觉链路。

## 浏览器证据

验证四区域、27.4 K派生、RH/SC/空气流量、修改两种来源、来源清除不残留、明确SH冲突阻止确认、推荐/补填、一次需求确认、模式切换保值、未接入模式禁止执行、刷新恢复。

- [桌面映射页](evidence/profile-mapping-desktop.png)
- [手机页](evidence/profile-mapping-mobile.png)
- [手机字段编辑](evidence/profile-mapping-mobile-fields.png)
- [机器可读浏览器结果](evidence/profile-mapping-browser-result.json)

使用本机已有Playwright和无头Chromium，脚本创建隔离工作区并关闭本次服务/浏览器；未安装依赖、接管用户浏览器或终止用户服务。

## 边界

只覆盖当前冷凝器需求表及已验证的同结构变体；任意新模板、图片选框、含歧义的结构和未经核实的公式缓存仍待核。未启用其他DLL模式、反推质量流量、推算冷媒物性或替换工程输入。现有目录/原件及无关工作保留；本次记录与代码未提交或推送。
