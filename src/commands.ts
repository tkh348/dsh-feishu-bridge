/** A slash command parsed from an inbound Feishu message. */
export interface ParsedCommand {
  /** Lowercase command name without the leading slash. */
  name: string
  /** Trimmed text after the command name. */
  args: string
}

/**
 * Parse one inbound message as a slash command.
 * @param text - normalized message content.
 * @returns the command, or `undefined` for ordinary chat text.
 */
export function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = stripLeadingMentions(text).trim()
  if (!trimmed.startsWith('/')) return undefined
  const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/u.exec(trimmed)
  if (match === null) return { name: '', args: '' }
  return {
    name: (match[1] ?? '').toLowerCase(),
    args: (match[2] ?? '').trim(),
  }
}

/** Remove Feishu's leading mention placeholders before command parsing. */
function stripLeadingMentions(text: string): string {
  let value = text
  while (true) {
    const next = value
      .replace(/^\s*@_user_\d+\s*/u, '')
      .replace(/^\s*@_all\s*/u, '')
      .replace(/^\s*<at\b[^>]*>[\s\S]*?<\/at>\s*/u, '')
    if (next === value) return value
    value = next
  }
}

/** Commands handled without waking the model. */
export const COMMAND_NAMES = [
  'help', 'new', 'reset', 'stop', 'status', 'id', 'whoami', 'model', 'workspace',
] as const

/** Names that reset the conversation. */
const RESET_COMMANDS = new Set(['new', 'reset'])
/** Names that cancel the active turn. */
const STOP_COMMANDS = new Set(['stop', 'cancel'])

/** Classify a command for the dispatcher. */
export type CommandKind = 'help' | 'new' | 'stop' | 'status' | 'id' | 'whoami' | 'model' | 'workspace' | 'unknown'

/**
 * Normalize aliases into one dispatcher kind.
 * @param command - parsed command.
 * @returns the command kind.
 */
export function commandKind(command: ParsedCommand): CommandKind {
  if (RESET_COMMANDS.has(command.name)) return 'new'
  if (STOP_COMMANDS.has(command.name)) return 'stop'
  switch (command.name) {
    case 'help': return 'help'
    case 'status': return 'status'
    case 'id': return 'id'
    case 'whoami': return 'whoami'
    case 'model': return 'model'
    case 'workspace': return 'workspace'
    default: return 'unknown'
  }
}

/** Facts rendered by `/status` without exposing secrets. */
export interface StatusFacts {
  sessionId: string
  workspace: string
  provider: string
  model: string
  agentStatus: 'idle' | 'running' | 'absent'
  active: boolean
  queued: number
  uptimeSeconds: number
}

/**
 * Render the `/status` card text.
 * @param facts - current bridge and agent facts.
 * @returns Markdown text.
 */
export function renderStatus(facts: StatusFacts): string {
  const uptime = formatDuration(facts.uptimeSeconds)
  return [
    '**DSH · 飞书桥接**',
    '',
    `- 会话：\`${facts.sessionId}\``,
    `- 工作区：\`${facts.workspace}\``,
    `- 模型：\`${facts.provider}/${facts.model}\``,
    `- Agent：${facts.active ? '🟢 执行中' : facts.agentStatus === 'absent' ? '⚪ 未创建' : '🟡 空闲'}`,
    `- 队列：${facts.queued}`,
    `- 已运行：${uptime}`,
  ].join('\n')
}

/**
 * Render the `/help` text.
 * @param includeGroupHints - whether to mention group-specific behavior.
 * @returns Markdown help text.
 */
export function renderHelp(includeGroupHints = false): string {
  const lines = [
    '**DSH · 飞书桥接**',
    '',
    '直接发消息就会交给 Agent 执行；它会使用工具操作本机工作区。',
    '',
    '- `/new` 或 `/reset`：结束当前上下文，开新会话',
    '- `/stop`：停止正在执行的任务',
    '- `/status`：查看会话、模型、工作区与队列',
    '- `/model`：查看当前模型',
    '- `/workspace`：查看当前工作区',
    '- `/id`：查看本会话的 chat/thread/sender 标识',
    '- `/help`：显示本帮助',
  ]
  if (includeGroupHints) {
    lines.push('', '群聊中默认需要 @机器人 才会响应。')
  }
  return lines.join('\n')
}

/**
 * Human-readable duration for status output.
 * @param seconds - elapsed seconds.
 * @returns compact duration such as `3h 12m`.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}
