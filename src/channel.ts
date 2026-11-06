import { createLarkChannel, Domain, LoggerLevel } from '@larksuiteoapi/node-sdk'
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { BridgeContext, BridgeLogger } from './context.js'
import { commandKind, parseCommand, renderHelp, renderStatus } from './commands.js'
import { isConfigured, type ResolvedConfig } from './config.js'
import { truncateMarkdown } from './format.js'
import { conversationKey } from './ids.js'
import { AgentPool } from './pool.js'
import { ChatQueue } from './queue.js'
import { SessionState } from './state.js'
import { startTurn, type AgentLike } from './turn.js'

/** A started bridge and its teardown. */
export interface RunningBridge {
  dispose(): Promise<void>
}

/**
 * Start the Feishu long-connection channel and wire it to DSH agents.
 * @param ctx - plugin context; all listeners are fiber-scoped.
 * @param config - resolved plugin configuration.
 * @param log - diagnostic logger.
 * @returns the running bridge.
 */
export async function startFeishuBridge(
  ctx: BridgeContext,
  config: ResolvedConfig,
  log: BridgeLogger,
): Promise<RunningBridge> {
  if (!isConfigured(config)) {
    throw new Error('appId and appSecret are required to start the Feishu connection')
  }
  const startedAt = Date.now()
  const state = await SessionState.load(config.stateFile, message => { log.warn(message) })
  const pool = new AgentPool(ctx, config, state, log)
  const queue = new ChatQueue()
  let stopped = false

  const channel: LarkChannel = createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    domain: config.domain === 'lark' ? Domain.Lark : Domain.Feishu,
    source: 'dsh-feishu-bridge',
    loggerLevel: LoggerLevel.info,
    handshakeTimeoutMs: 15_000,
    policy: {
      requireMention: config.requireMention,
      dmMode: config.dmMode,
      groupAllowlist: config.groupAllowlist,
      dmAllowlist: config.dmAllowlist,
      respondToMentionAll: false,
    },
    safety: {
      // Immersive prompts run for minutes; the bridge owns its own queue so a
      // `/stop` command can bypass the running turn instead of waiting for it.
      chatQueue: { enabled: false },
      staleMessageWindowMs: 5 * 60_000,
      dedup: { ttl: 10 * 60_000, maxEntries: 10_000 },
    },
  })

  const replyOptions = (message: NormalizedMessage): Record<string, unknown> => ({
    replyTo: message.messageId,
    ...message.threadId === undefined ? {} : { replyInThread: true },
  })

  const sendText = async (message: NormalizedMessage, text: string): Promise<void> => {
    await channel.send(message.chatId, { markdown: truncateMarkdown(text) }, replyOptions(message))
  }

  const runPrompt = async (message: NormalizedMessage, key: string, text: string): Promise<void> => {
    log.info(`run prompt key=${key} chars=${text.length}`)
    const agent: AgentLike = await pool.ensure(key)
    log.info(`agent ready id=${agent.id}`)
    await agent.whenIdle()
    if (stopped) return
    pool.activate(key, agent)
    const turn = startTurn(ctx, agent, text, {
      showToolStatus: config.showToolStatus,
      errorMessage: config.errorMessage,
      onError: error => { log.error(`agent error: ${redactError(error, config.appSecret)}`) },
    })
    log.info(`turn started id=${agent.id}`)
    try {
      if (config.streaming) {
        try {
          await channel.stream(message.chatId, {
            markdown: async (sink) => {
              for await (const chunk of turn.output) await sink.append(chunk)
            },
          }, replyOptions(message))
        } catch (streamError) {
          log.warn(`stream failed; falling back to normal send: ${redactError(streamError, config.appSecret)}`)
          let body = ''
          for await (const chunk of turn.output) body += chunk
          await sendText(message, body === '' ? '（Agent 已完成，但没有文本输出。）' : body)
        }
      } else {
        let body = ''
        for await (const chunk of turn.output) body += chunk
        await sendText(message, body === '' ? '（Agent 已完成，但没有文本输出。）' : body)
      }
      const outcome = await turn.done
      log.info(`turn finished id=${agent.id} kind=${outcome.kind}${outcome.detail === undefined ? '' : ` detail=${outcome.detail}`}`)
      if (outcome.kind === 'failed') {
        log.warn(`turn failed for ${key}: ${outcome.detail ?? 'unknown error'}`)
      }
      const sessions = ctx.get('sessions') as { flush?: (session: unknown) => Promise<unknown> } | undefined
      try {
        await sessions?.flush?.(agent.session)
      } catch (error) {
        log.warn(`session flush failed for ${key}: ${redactError(error, config.appSecret)}`)
      }
    } catch (error) {
      log.error(`prompt failed key=${key}: ${redactError(error, config.appSecret)}`)
      turn.dispose()
      agent.cancel({ kind: 'user' })
      throw error
    } finally {
      turn.dispose()
      pool.deactivate(key, agent)
    }
  }

  const handleCommand = async (message: NormalizedMessage, key: string, name: string, args: string): Promise<boolean> => {
    const kind = commandKind({ name, args })
    if (kind === 'unknown') {
      await sendText(message, `未知命令 \`/${name}\`。\n\n${renderHelp(message.chatType === 'group')}`)
      return true
    }
    switch (kind) {
      case 'help':
        await sendText(message, renderHelp(message.chatType === 'group'))
        return true
      case 'stop': {
        const cancelled = pool.cancel(key)
        await sendText(message, cancelled ? '⏹ 已请求停止当前任务。' : '当前没有执行中的任务。')
        return true
      }
      case 'new': {
        queue.invalidate(key)
        const sessionId = await pool.reset(key)
        await sendText(message, `🆕 已开新会话：\`${sessionId}\`\n\n下一条消息会使用新的上下文。`)
        return true
      }
      case 'status': {
        const info = pool.describe(key)
        const provider = info.selection?.provider ?? config.provider ?? '默认'
        const model = info.selection?.model ?? config.model ?? '默认'
        await sendText(message, renderStatus({
          sessionId: info.sessionId,
          workspace: config.workspace,
          provider,
          model,
          agentStatus: pool.status(key),
          active: pool.running(key) !== undefined,
          queued: queue.size(key),
          uptimeSeconds: (Date.now() - startedAt) / 1000,
        }))
        return true
      }
      case 'id':
        await sendText(message, [
          `- chat_id: \`${message.chatId}\``,
          `- chat_type: \`${message.chatType}\``,
          `- thread_id: ${message.threadId === undefined ? '（无）' : `\`${message.threadId}\``}`,
          `- sender_id: \`${message.senderId}\``,
        ].join('\n'))
        return true
      case 'whoami':
        await sendText(message, `sender_id: \`${message.senderId}\``)
        return true
      case 'model': {
        const info = pool.describe(key)
        await sendText(message, `模型：\`${info.selection?.provider ?? config.provider ?? '默认'}/${info.selection?.model ?? config.model ?? '默认'}\``)
        return true
      }
      case 'workspace':
        await sendText(message, `工作区：\`${config.workspace}\``)
        return true
      default:
        return false
    }
  }

  const handleMessage = async (message: NormalizedMessage): Promise<void> => {
    if (stopped) return
    const key = conversationKey(message)
    const command = parseCommand(message.content)
    log.info(`message received key=${key} sender=${message.senderId} chars=${message.content.length}`)
    try {
      if (command !== undefined) {
        log.info(`command key=${key} name=${command.name}`)
        await handleCommand(message, key, command.name, command.args)
        return
      }
      if (queue.size(key) >= config.queueLimit) {
        await sendText(message, `⏳ 当前会话排队已满（上限 ${config.queueLimit}），请稍后再发或发送 \`/stop\`。`)
        return
      }
      const generation = queue.generation(key)
      await queue.run(key, config.queueLimit, async () => {
        if (queue.generation(key) !== generation) return
        await runPrompt(message, key, message.content)
      })
    } catch (error) {
      log.error(`message handling failed: ${redactError(error, config.appSecret)}`)
      await padReply(message, '⚠️', config.errorMessage)
    }
  }

  const padReply = async (message: NormalizedMessage, prefix: string, body: string): Promise<void> => {
    await channel.send(message.chatId, { markdown: `${prefix} ${body}` }, replyOptions(message))
      .catch(error => { log.error(`fallback reply failed: ${redactError(error, config.appSecret)}`) })
  }

  const unsubscribers = [
    channel.on('message', (message) => { void handleMessage(message) }),
    channel.on('reject', (event) => { log.info(`message rejected by policy: ${event.reason}`) }),
    channel.on('error', (error) => { log.error(`channel error: ${redactError(error, config.appSecret)}`) }),
    channel.on('reconnecting', () => { log.warn('WebSocket reconnecting') }),
    channel.on('reconnected', () => { log.info('WebSocket reconnected') }),
  ]

  try {
    log.info(`connecting appId=${config.appId} domain=${config.domain}`)
    await channel.connect()
  } catch (error) {
    log.error(`connect failed: ${redactError(error, config.appSecret)}`)
    for (const unsubscribe of unsubscribers) unsubscribe()
    await pool.dispose()
    throw error
  }
  log.info(`WebSocket connected as ${channel.botIdentity?.name ?? 'bot'}`)

  return {
    async dispose() {
      stopped = true
      for (const unsubscribe of unsubscribers) unsubscribe()
      try {
        await channel.disconnect()
        log.info('WebSocket disconnected')
      } finally {
        await pool.dispose()
      }
    },
  }
}

/** Render one error without leaking the application secret. */
function redactError(error: unknown, secret: string): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return secret === '' ? text : text.split(secret).join('[redacted]')
}
