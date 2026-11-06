# dsh-feishu-bridge

把 DeepSeek Harness（DSH）接进飞书 / Lark：在手机或群聊里发消息，由本机 DSH Agent 使用工具执行，并把过程和结果流式回到飞书。

- 飞书官方 WebSocket 长连接：不需要公网 IP、域名或 Webhook。
- 每个 `chat_id`（话题群再按 `thread_id`）对应一个独立 DSH Session，重启后自动恢复。
- 流式回复；工具开始时显示一行状态。
- `/new`、`/stop`、`/status`、`/model`、`/workspace`、`/id` 命令。
- 单聊/群聊白名单，支持飞书中国版与 Lark 国际版。

## 1. 创建飞书应用

1. 打开飞书 / Lark 开发者后台，创建**企业自建应用**。
2. 在「凭证与基础信息」记录 **App ID** 和 **App Secret**。
3. 在「添加应用能力」中添加**机器人**。
4. 在「权限管理」开通：

   | 权限标识 | 用途 |
   | --- | --- |
   | `im:message.p2p_msg:readonly` | 接收单聊消息 |
   | `im:message.group_at_msg:readonly` | 接收群里 @机器人 的消息 |
   | `im:message:send_as_bot` | 以机器人身份回复 |

   如果希望机器人在群里接收所有消息（不要求 @），还要申请 `im:message.group_msg`，并把配置里的 `requireMention` 设为 `false`。该权限通常需要管理员审批。

5. 在「事件与回调」→「事件订阅」选择**使用长连接接收事件**，添加事件 `im.message.receive_v1`。不要填写 Webhook 地址。
6. 创建版本、发布，并把应用安装到企业 / 测试企业；把机器人加进目标群，或直接发起单聊。

## 2. 构建插件

在插件目录执行（Windows 下可用 DSH 自带的 Node/pnpm）：

```powershell
pnpm install
pnpm run build
pnpm test
```

产物是 `lib/index.js`。飞书 SDK 与配置 schema 已打进产物，profile 不需要再装运行时依赖。

## 3. 安装到 DSH profile

安装已构建的 tarball（推荐；当前机器已安装到固定路径）：

```powershell
dsh plugin --profile desktop add "C:\Users\t1961\.dsh\plugins\feishu-bridge\dsh-feishu-bridge-0.1.1.tgz"
```

也可以从本地构建目录安装，但该目录必须已经生成 `lib/index.js`：

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-feishu-bridge"
```

`dsh plugin add` 会把插件加入 profile 的 `dsh.profile.bundles`，并自动应用包内的 `cordis.patch.yml`。**不要再手工 `insert` 同名 id**，否则会报 duplicate loader entry。

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾按 id 覆盖配置（只覆盖，不新增实例）：

```yaml
- id: feishu-bridge
  config:
    appId: 'cli_xxxxxxxxxxxxxxxx'
    appSecretEnv: DSH_FEISHU_APP_SECRET
    domain: feishu
    requireMention: true
    dmMode: open
    workspace: 'C:\Users\t1961\Documents\deepseek-harness\default-workspace'
    # 可选：不填则跟随 Harness 默认模型
    # provider: deepseek-account
    # model: deepseek-flash
    # reasoningEffort: high
```

### 配置 App Secret

推荐用环境变量，不要把 secret 写进 YAML：

```powershell
# 当前用户永久生效；设置后需要重启 DSH
[Environment]::SetEnvironmentVariable('DSH_FEISHU_APP_SECRET', '<your-app-secret>', 'User')
```

也可以在 patch 里写 `appSecret: '...'`，但不推荐。

## 4. 重启并验证

完全退出 DSH 桌面端再启动。日志中应出现：

```text
[feishu-bridge] WebSocket connected as <bot name>
```

在飞书里给机器人发 `/status`，再发一条普通消息，例如：

```text
列出当前工作区的文件，并告诉我最近修改的 3 个文件。
```

Agent 会使用本机工具执行，并把结果流式发回飞书。

## 5. 命令

| 命令 | 作用 |
| --- | --- |
| `/new`、`/reset` | 结束当前上下文，开新会话 |
| `/stop` | 停止正在执行的任务（不等待模型结束） |
| `/status` | 会话、模型、工作区、队列、运行时长 |
| `/model` | 当前 provider/model |
| `/workspace` | 当前工作区 |
| `/id` | 当前 `chat_id`、`thread_id`、`sender_id` |
| `/help` | 帮助 |

群聊默认需要 @机器人。话题群的每个话题是独立 Session。

## 6. 访问控制

```yaml
config:
  dmMode: allowlist          # open | allowlist | disabled
  dmAllowlist:
    - ou_xxxxxxxxxxxxxxxx    # 发送者 open_id，可先用 /id 获取
  groupAllowlist:
    - oc_xxxxxxxxxxxxxxxx    # 群 chat_id，空数组表示不限制
  requireMention: true
```

生产环境建议至少开启 `dmMode: allowlist` 和 `groupAllowlist`。机器人拿到的是**本机 DSH 的工具权限**，飞书用户身份不会自动降权。

## 7. 架构

```text
飞书用户
  │ im.message.receive_v1（WebSocket 长连接）
  ▼
飞书官方 Channel（重连、去重、过期事件过滤、@策略）
  │ NormalizedMessage
  ▼
conversationKey = chat_id (+ thread_id)
  │ 持久化映射
  ▼
DSH Agent（工作区、模型、工具、Session 日志）
  │ agent/assistant-stream / session 事件
  ▼
channel.stream() → 飞书流式卡片
```

- Session id 由 `sha256(domain + conversationKey)` 生成，不包含原始飞书 id。
- `/new` 会把新 Session id 写入 `$DSH_HOME/feishu-bridge/sessions.json`，重启后继续使用新会话。
- 桥接自己维护每会话队列，因此 `/stop` 可以绕过正在执行的 turn 立即处理。
- 同一会话的普通消息串行执行；不同会话可并行。

## 8. 已知限制

- 当前只处理文本；图片/文件会被飞书 SDK 规范化为占位标签，暂不作为 DSH 附件传入。
- 没有 Web 设置页；修改配置后需要重启 DSH。
- 一个飞书应用同时只应运行一个长连接消费者，否则事件可能被分散到不同连接。
- DSH 没有为桥接单独启用沙箱；Agent 的工具权限就是 DSH 进程的权限。

## 9. 故障排查

| 现象 | 检查 |
| --- | --- |
| 日志 `not configured` | `appId` 为空，或 `appSecretEnv` 指向的环境变量为空 |
| 连接失败 | App ID/Secret 是否同一应用；应用是否已发布安装 |
| 收不到消息 | 是否订阅 `im.message.receive_v1`；是否选择长连接；群聊是否 @机器人 |
| 能收不能回 | 是否开通 `im:message:send_as_bot` 且审批通过 |
| 单聊被拒绝 | `dmMode` 是否为 `disabled` / `allowlist`，sender 是否在白名单 |
| 模型报错 | `/model` 查看；或在 patch 里显式配置 provider/model |
| `pnpm install` 报 `_tmp_* ENOENT` | 当前目录对子进程不可写；把项目复制到 `%TEMP%` 构建，或修复该目录的 Windows 文件权限 |

## License

MIT
