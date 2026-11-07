# 贡献指南

## 分支

| 分支 | 用途 |
| --- | --- |
| `main` | 可发布状态，只接受 PR 合并，不直接推送 |
| `dev-NN` | 阶段性开发分支，如 `dev-01` |
| `feat/<topic>` | 单个功能 |
| `fix/<topic>` | 单个修复 |

分支名小写，用 `-` 连接，不用中文。

## 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)，格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

- `subject` 用英文，祈使句，不超过 72 字符，结尾不加句号。
- `scope` 可选，如 `bridge`、`config`、`docs`。
- 正文说明**为什么改**和**怎么验证**，不要复述 diff。
- 破坏性变更用 `!` 标记，并在 footer 写 `BREAKING CHANGE:`。

| type | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 文档 |
| `refactor` | 重构，不改行为 |
| `test` | 测试 |
| `chore` | 构建、依赖、配置 |
| `perf` | 性能 |
| `ci` | CI 流程 |

**一次提交只做一件事。** 格式化改动单独提交，不要混在功能提交里。

示例：

```
fix(bridge): drop duplicate events after websocket reconnect

Feishu replays events with the same message_id after a reconnect, so a
turn could be dispatched twice. Track the last N ids per chat and skip
duplicates.

Verified with `pnpm test` (24 passing) and a manual reconnect test.
```

## PR

- 标题同提交信息格式。
- 正文写：关联 issue、动机、改动点、验证方式、风险与回滚。
- 至少通过 `pnpm run typecheck` 与 `pnpm test`。
- 合并前请确保 `git diff main...HEAD` 里没有无关文件。

## 安全

- **不要提交任何密钥**：`appSecret`、`GITHUB_TOKEN`、App Secret、证书一律不入库。
- 敏感配置只走环境变量，例如 `DSH_FEISHU_APP_SECRET`。
- 提交前自查：`git diff --cached | Select-String -Pattern "secret|token|ghp_"`。

## 构建产物

`lib/`、`lib-test/`、`dist/`、`*.tgz` 由 `.gitignore` 排除，不入库。安装时按 README 构建或使用打包后的 tarball。

## 本地命令

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```
