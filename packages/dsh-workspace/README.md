# @dsh-lite/workspace

适配 DSH `0.1.2-rc.1` / Cordis 的工作区插件，提供 `ctx.liteWorkspace`。
只维护工作区、项目、会话索引和配置快照；消息与 usage 由 DSH 原生 Session 保存。

## 安装与启动

```powershell
pnpm --dir packages/dsh-workspace pack --pack-destination ../../dist
$bundlePath = (Resolve-Path ./dist/dsh-lite-workspace-0.1.0.tgz).Path
pnpm run plugin add "$bundlePath"
```

项目中已通过 workspace dependency 和 lite profile 启用，无需重复安装。
配合 `@dsh-lite/web-app >=0.4.0` 显示侧栏，配合 `@dsh-lite/prompt-config >=0.2.0` 固定项目和恢复提示词。
只安装 workspace 提供管理 API；卸载 workspace 后聊天页面回到仅运行期会话，历史文件不会删除。
插件配置 `cwd` 指定当前项目根，`home` 指定 DSH home；项目启动器传入这两个值。

## 第一版范围

- 一个默认 `个人工作区`，下设项目与未归类会话。
- 项目默认模型、说明、提示词：仅在新会话创建时采样。
- 重命名、移动、归档/恢复；没有删除接口，归档不删除原始文件。
- 旧主会话按 cwd 导入索引，排除子代理与其他 cwd。
- 从 `request/header` 提取实际模型选项和 system prompt，不复制凭据。
- 恢复会话固定原始 system 字符串（不二次展开变量），不固定或绕过工具权限。

## 接口与存储

| 接口 | 职责 |
| --- | --- |
| `GET /api/workspace/state` | 工作区、项目、会话摘要、revision、不可读日志警告 |
| `POST /api/workspace/project` | 创建/更新项目：name、instructions、model、promptMode、promptText、archived、revision |
| `POST /api/workspace/session` | 更新会话：id、title、projectId（null 表示未归类）、archived、revision |
| `POST /api/session/open`（web-app） | 只读历史、逐条用量、累计用量和只读原因 |
| `POST /api/chat`（web-app） | 新会话接收 projectId/choice；已有 sessionId 忽略新模型选择 |

更新项目携带 id；所有元数据更新携带最新 revision，冲突返回 409，不自动覆盖其他窗口的修改。
只允许本机同源访问。索引 `${home}/lite-workspace.json` 使用进程内串行写和临时文件原子替换。
读取损坏索引失败时停止写入以保护原文件；单条不可读日志单独提示，不清理或修复源文件。
新会话首次成功回复后显示；若索引写入前崩溃，可从完成的原生日志补全索引。
读取历史使用已发布版本的 `sessionPersistence.inspect()`，不提交恢复、不创建 Agent；
继续消息使用 `agents.resume()`，成功返回前以原生 `load()` 等待平衡的 live 日志落盘。

本地单用户单进程 MVP，不提供跨进程锁、多工作区切换、身份验证、费用估算、目录读取或知识库。
模型连接和凭据仍是共享设置，修改连接地址/密钥会影响该提供方后续请求；快照不复制这些内容。
