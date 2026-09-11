# dsh_lite

基于已发布 DSH `0.1.2-rc.1` 的轻量应用，不复制或修改 DSH 内核。
默认入口为原生 `lite` profile，聊天和模型配置运行在同一个 Cordis 运行时、同一个 HTTP 服务中。

## 启动

需要 Node.js `^22.19.0 || >=24.0.0`、pnpm `11.7.0`。

```powershell
pnpm install --frozen-lockfile
pnpm start
```

打开 http://127.0.0.1:43187 ，模型配置在 http://127.0.0.1:43187/models 。
不配置密钥也能打开页面。在模型配置页保存连接、密钥、默认模型即可开始聊天。
如果使用项目 `.env`，启动器会加载它，但不会修改它；环境中的密钥只读。

启动器只初始化缺失的 profile 文件、设置工作目录，然后**同进程加载 DSH CLI**。
没有 SDK 聊天子进程，也没有配置代理或第二个端口。
默认 DSH home 是项目 `.dsh/`；会话元数据 cwd 仍是项目根目录。

### 终端调用日志

默认关闭。可在项目 `.env` 中设置 `DSH_LITE_TRACE=1`，然后重启 `pnpm start`；改为 `0` 关闭。也可仅对当前 PowerShell 设置：

```powershell
$env:DSH_LITE_TRACE='1'
pnpm start
```

开启后终端出现 `[DSH trace]`。每行是带时间、会话ID、turn/step的JSON记录，包含输入及插件提示、步骤开始/结束、工具名/完整参数/完整结果/耗时、每次模型调用的 `assistant/response`、Token用量和请求错误。工具结果不沿用页面20,000字符的截断；并行调用通过callId关联。`ok:false`的业务错误也标为failed。

`assistant/response` 记录DSH组装后的模型输出；服务商实际返回reasoning时记录该内容，没有返回时不生成思考文本。终端按完整消息输出，不逐Token刷屏。请求头、模型配置和图片二进制不输出，常见凭证字段及已知环境密钥脱敏。此开关不修改页面展示或持久化格式，也不写入新的日志文件。

同名PowerShell环境变量优先于 `.env`。修改后需重启服务；用 `$env:DSH_LITE_TRACE='0'` 可明确关闭。机器运行时的普通启动日志不受此开关影响。

## 插件选择在哪里

模板是 [profiles/lite/package.json](profiles/lite/package.json)。
首次启动复制到 `.dsh/profiles/lite/package.json`，后续启动不会覆盖你的选择：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@dsh-lite/core",
        "@dsh-lite/workspace",
        "@dsh-lite/web-app",
        "@dsh-lite/model-config",
        "@dsh-lite/prompt-config",
        "@dsh-lite/excel-understanding",
        "@dsh-lite/mche"
      ],
      "patchReload": "startup"
    }
  }
}
```

- `dsh-base`：原生 Agent、会话、模型路由、压缩、工具、settings 和 credentials。
- `core`：中性角色，禁用代码编辑、文件操作、shell 等原有 coding 条目。
- `workspace`：默认工作区、项目与会话归属，维护配置快照；聊天消息仍保存在 DSH 原生日志。
- `web-app`：共享 HTTP 服务和轻量聊天页面，直接调用 `ctx.agents`。
- `model-config`：向共享服务注册配置页面和 API，可从 bundles 中移除。
- `prompt-config`：提示词编辑、覆盖和预览，页面 `/prompts`，独立可卸载。
- `excel-understanding`：原工作簿持久化、按区域查阅、来源校验和 Linux 布局预览，见 [插件说明](packages/dsh-excel-understanding/README.md)。
- `mche`：扁管、翅片与冷媒目录选型、确认快照，以及单排 PTM 工程核对、原生参数准备、异步 x86 DLL 计算和结果追溯，见 [插件说明](packages/dsh-mche/README.md)。全部目录仍可查询；只有已验证映射可执行。当前真实调用仍有 NaN 和工程算例资料验收阻塞，见 [计算验收记录](docs/verification/2026-09-09-mche-calculation.md)。

修改**实际 profile** 的 bundles 后重启生效。模板仅影响首次初始化。
不要移除其他插件依赖的底层服务。轻量版保留 dsh-base 的其他通用能力，并非安全沙箱。

修改端口可在 `.dsh/profiles/lite/cordis.patch.yml` 中设置：

```yaml
- id: lite-http
  config:
    host: 127.0.0.1
    port: 43189
```

DSH 的 config patch 会替换该条目的 config，因此这里要同时保留 host。
不启用热重载，修改插件组成或 patch 后重启；页面保存的模型配置使用原生 settings 动态生效。

## 安装插件包

本地包尚未发布公共 registry：

```powershell
pnpm --dir packages/dsh-model-config pack --pack-destination ../../dist
$bundlePath = (Resolve-Path ./dist/dsh-lite-model-config-0.4.0.tgz).Path
pnpm run plugin add "$bundlePath"
```

`plugin` 脚本仅转交原生 `dsh plugin --profile lite`。
声明 `dsh.bundle` 的包由 DSH 安装后加入 profile bundles；普通 npm 库不会自动启用。
也可直接用原生 CLI，但要设置同一个 `DSH_HOME`，并避免从含 DSH_* 的 .env 目录启动 DSH。
使用项目之外的自定义 DSH_HOME 时，需要先在该 profile 安装所列本地 bundle，不能依赖项目 node_modules 的祖先路径解析。

插件接口和存储说明见 [模型配置插件](packages/dsh-model-config/README.md)。

## 会话行为与限制

提示词设置位于 http://127.0.0.1:43187/prompts 。支持使用宿主默认、覆盖角色描述、完整覆盖 system prompt。
保存只影响新创建的 Agent，旧对话保持原提示词。恢复默认会清空本插件的自定义文本，不改写 core 配置。
完整覆盖不删除工具、技能目录或运行环境，不改变 AGENTS.md 加载策略。当前 lite 已禁用 agent-instructions。
预览按默认模型和全局插件组装，不调用模型；特定 preset 的覆盖不在预览范围内。
说明及安装方法见 [提示词插件](packages/dsh-prompt-config/README.md)。

模型配置页左侧列出多组已配置连接，右侧查看和编辑。点击列表不会改变默认模型，
每个模型旁的“设为默认”才切换新对话默认值；同一服务商的多组地址/密钥使用不同连接。
同一连接添加模型会按模型 ID 追加或更新，不覆盖其他模型。切换前会保护未保存的编辑。
设置页参考 macOS 设置的浅色侧栏与分组表单。新连接支持中文名称，自动生成内部 ID 和密钥引用；
点击“保存连接”一并保存连接和填写的密钥，留空保留旧密钥，跨服务部分失败会明确提示。
新连接至少填写一个模型；后续通过模型列表添加、编辑或设为默认。
最大输出 Token 按“连接 + 模型”保存；旧连接未编辑过的模型仍沿用原来的全局上限，旧数据不清空。
“测试连接 / 获取模型”仅在点击时请求目录，不调用推理；不支持目录的服务可以手动填模型 ID。
目录返回仅作为候选，不自动覆盖现有目录。上下文和容量的初始默认值需要按服务商文档核对。
本地兼容服务仍需配置适配器接受的密钥，暂不提供可靠的免认证模式。

聊天回复下方显示本轮 Token，侧栏显示当前会话累计，手机端累计放在输入框上方。
数据来自 DSH 最终 assistant/message 的 usage，不统计流式 chunk，避免重复累计。
DSH 的输入计数不含缓存，界面分别展示非缓存输入、输出、缓存命中/写入、推理和服务商总量。
总量直接读取适配器的 totalTokens；推理/缓存不再次叠加到总量。缺失值显示“未提供”，部分上报明确标注。
统计范围为当前会话已返回的回复，不是账户账单，不包含后台任务、其他会话或未返回的失败请求。
暂不提供费用估算和跨会话统计看板；重新打开历史时从原生日志恢复已上报的 Token。

聊天页可为新对话选择模型，不改变全局默认值；开始后选择器锁定，旧对话保留创建时的选择。
未单独选择时优先使用项目默认模型，否则使用全局默认；输出上限仍由模型配置插件管理。
提供方连接和密钥属于共享配置，修改后会影响该提供方的后续请求。
正文流式显示，表格、工具结果和 Excel 理解通过蓝色链接在右侧查看；每次处理一个对话轮次。
整轮默认最多十分钟，模型/工具连续三分钟没有新进展时停止；SSE 心跳不延长等待。两类时限可在 `lite-web-app` 配置中分别调整，超时保留已保存资料并显示明确提示。
新建对话释放旧 Agent；最多保留 32 个运行句柄，回收句柄不会删除历史。
侧栏按“个人工作区 → 项目 / 未归类 → 会话”组织，支持项目新建、重命名、归档和恢复，
会话重命名、移动、归档和恢复。刷新恢复最近打开的会话；浏览器只保存选择的 ID。
打开历史不会调用模型；继续发送时恢复原 Session ID、上下文、模型、输出上限与实际 system prompt。
项目说明和项目提示词只影响新会话，移动会话不改变原配置。归档内容可查看，恢复后才可继续。
缺少原快照、原模型配置或提示词插件时只读，不自动换成当前默认模型。
发送失败后可重新打开已有历史或新建对话；原始失败事件保留在 DSH 日志中。

工作区元数据保存在 `.dsh/lite-workspace.json`，不复制消息和密钥，使用串行写入与原子替换。
已有当前 cwd 的主会话自动归入“未归类”，不移动原日志；子代理会话不混入侧栏。
第一版只有一个默认工作区，面向单用户单服务，不提供多进程共享 home 的写入协调。
项目不是文件目录或安全边界，不自动读取项目文件或 AGENTS.md。
插件安装和接口说明见 [工作区插件](packages/dsh-workspace/README.md)。

密钥交给 DSH credentials，不回传明文，不保存在浏览器 localStorage。
`.dsh/settings.yaml` 和 `.dsh/.credentials.yaml` 由 DSH 管理；后者不承诺磁盘加密。
服务仅用于本机，无用户认证，不应暴露到公网。

## 验证和旧 CLI

```powershell
pnpm test
pnpm run typecheck
pnpm peers check
pnpm run config:dump
```

测试使用隔离 home 和本地模拟模型接口，验证原生调用、多轮上下文、配置持久化、密钥隔离、
会话释放、失败/超时和来源保护，不向外部服务发起模型请求。
typecheck 检查保留的 TypeScript CLI；新 JavaScript 插件由运行测试覆盖。

原 SDK 命令行示例保留为 `pnpm run cli "你的问题"`，它不参与网页启动，
仍按 `src/index.ts` 的显式环境变量配置运行。
升级时保持各 DSH 包版本一致，重新检查组合配置并运行回归测试。
