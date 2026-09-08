# @dsh-lite/prompt-config

DSH / Cordis 原生提示词覆盖插件，版本 0.2.0。使用共享 HTTP 服务，不另开端口。
导出 `name`、`inject`、`Config`、`apply`，通过 `dsh.bundle.patch` 加入 profile。

## 宿主与入口

需要 DSH 0.1.2-rc.1 的 `systemPrompt`、`agents`、`settings`、`agentDefaultModel`、`webServer` 服务。
不依赖 model-config 或 web-app 插件；裸 Cordis 需要先提供这些服务。
页面 `/prompts`；API：GET `/api/prompt-config/state`、POST `/api/prompt-config/preview`、POST `/api/prompt-config/save`。
页面导航到 `/`、`/models` 是本仓库的宿主约定，独立安装时对应页面可能不存在。

## 覆盖契约

- `inherit`：不注册覆盖，使用宿主默认。
- `persona`：在新 Agent 的 scope 注册 `deployment:persona`，遮蔽全局角色描述，保留身份和工具指导。
- `complete`：同一 scope 使用原生 `complete: true`，完整替换 system 文本。

设置保存在 DSH settings 的 `prompt-config-ui` 命名空间，字段 `mode`、`text`。
文本最长 24000 字符，允许 `{{model}}`、`{{provider}}`、`{{cwd}}`，自定义模式不接受空文本。
保存需要当前 `revision`，冲突返回 409。恢复默认保存 `{mode: "inherit", text: ""}`，不清空其他配置。

覆盖文本在 `agent/created` 时固定，因此保存仅影响此后创建的 Agent。
页面旧对话继续使用原提示词。配合 workspace 插件，项目新会话使用创建时采样的项目/全局配置；
恢复持久化会话使用原日志中的实际 system 字符串，不二次展开模板变量。
不加载 workspace 时仍保持独立的全局提示词覆盖能力；插件提供 promptSnapshots 服务标记。
卸载插件会移除其监听器、路由和作用域覆盖，设置数据仍保留。
本插件面向当前 lite 的无 preset Agent；宿主若在相同 Agent scope 已注册同名 persona，需先消除注册冲突。

完整覆盖不会禁用工具、改变沙箱或审批策略，也不删除独立注入的技能目录、运行时上下文和会话历史。
AGENTS.md 是否读取仍由宿主 agent-instructions 控制。此插件不提供工具或技能管理。

预览调用原生 `systemPrompt.assemble()` 和 `renderPrompt()`，使用当前默认模型和宿主全局配置，不创建会话、不调用模型。
特定 Agent preset 的额外覆盖与独立上下文不包含在预览中；模型选择或插件组成变化后应重新预览。
测试验证了本仓库无 preset 场景下，预览与实际 OpenAI-compatible 请求的 system 字段一致。

## 打包

```powershell
pnpm --dir packages/dsh-prompt-config pack --pack-destination ../../dist
pnpm run plugin add "E:/projects/dsh_lite/dist/dsh-lite-prompt-config-0.2.0.tgz"
```

加入实际 profile 的 bundles 后重启，页面保存本身不需要重启。
仅用于本地管理；提示词属于模型输入，请勿填写密钥、密码等敏感信息。
