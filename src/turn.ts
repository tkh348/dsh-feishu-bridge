import { randomUUID } from 'node:crypto'
import type { BridgeContext } from './context.js'

/** Minimal live-Agent surface used by the bridge; avoids depending on loop internals. */
export interface AgentLike {
  readonly id: string
  readonly session: { readonly id: string; readonly seq: number }
  readonly options?: { provider?: string; model?: string; reasoningEffort?: string }
  whenIdle(): Promise<void>
  followup(message: unknown): void
  cancel(cause: { kind: 'user' }): void
  readonly status?: string
}

/** Final classification of one agent turn. */
export interface TurnOutcome {
  kind: 'completed' | 'failed' | 'aborted' | 'blocked' | 'max-tokens'
  /** Safe text for logs; never sent verbatim unless already configured. */
  detail?: string
}

/** Options that shape one streamed turn. */
export interface TurnOptions {
  showToolStatus: boolean
  errorMessage: string
  onError?: (error: unknown) => void
}

/** A promise-and-queue stream of incremental Markdown, always settling. */
class MarkdownStream implements AsyncIterable<string> {
  private readonly values: string[] = []
  private readonly waiters: Array<(result: IteratorResult<string>) => void> = []
  private ended = false
  readonly done: Promise<TurnOutcome>
  private resolveDone!: (outcome: TurnOutcome) => void

  constructor() {
    this.done = new Promise(resolve => { this.resolveDone = resolve })
  }

  push(text: string): void {
    if (this.ended || text === '') return
    const waiter = this.waiters.shift()
    if (waiter !== undefined) waiter({ done: false, value: text })
    else this.values.push(text)
  }

  finish(outcome: TurnOutcome): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
    this.resolveDone(outcome)
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: async () => {
        const value = this.values.shift()
        if (value !== undefined) return { done: false, value }
        if (this.ended) return { done: true, value: undefined }
        return await new Promise<IteratorResult<string>>(resolve => { this.waiters.push(resolve) })
      },
    }
  }
}

/** A live turn and its ordered output stream. */
export interface RunningTurn {
  output: AsyncIterable<string>
  done: Promise<TurnOutcome>
  dispose(): void
}

/**
 * Extract visible text from one assistant message's content blocks.
 * @param message - event message payload.
 * @returns concatenated text, excluding reasoning and tool calls.
 */
export function assistantText(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      block !== null && typeof block === 'object'
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Deliver a prompt and expose the turn's assistant text as it streams.
 * The caller must have awaited `agent.whenIdle()` before calling.
 * @param ctx - plugin context whose event listeners are fiber-scoped.
 * @param agent - exact live agent.
 * @param text - user prompt.
 * @param options - streaming and failure presentation.
 * @returns the live turn.
 */
export function startTurn(ctx: BridgeContext, agent: AgentLike, text: string, options: TurnOptions): RunningTurn {
  const stream = new MarkdownStream()
  const rawSeq = Number(agent.session.seq)
  const firstSeq = Number.isFinite(rawSeq) ? rawSeq : 0
  let lastAssistantText = ''
  let emittedText = false
  let failure: unknown
  let finished = false
  let currentTurn = 0

  const finish = (outcome: TurnOutcome): void => {
    if (finished) return
    finished = true
    if (!emittedText && lastAssistantText !== '') {
      emittedText = true
      stream.push(lastAssistantText)
    }
    if (outcome.kind === 'failed') {
      stream.push(`\n\n> ⚠️ ${options.errorMessage}\n`)
    } else if (outcome.kind === 'aborted') {
      stream.push(emittedText ? '\n\n> ⏹ 已停止。\n' : '⏹ 已停止。')
    } else if (outcome.kind === 'blocked') {
      stream.push(emittedText ? '\n\n> ⚠️ 本轮被拦截。\n' : '⚠️ 本轮被拦截。')
    } else if (outcome.kind === 'max-tokens') {
      stream.push('\n\n> ⚠️ 输出达到模型上限。\n')
    } else if (!emittedText) {
      stream.push('（Agent 已完成，但没有文本输出。）')
    }
    stream.finish(outcome)
    dispose()
  }

  const onSessionEvent = (session: { id: string }, event: { seq: number; type: string; data: unknown }): void => {
    try {
      if (session.id !== agent.id || Number(event.seq) < firstSeq) return
      const data = event.data as Record<string, unknown> | undefined
      switch (event.type) {
        case 'turn/start':
          currentTurn = Number((data as { turn?: number } | undefined)?.turn ?? currentTurn)
          break
        case 'tool/call':
          if (options.showToolStatus) {
            const name = String((data as { name?: unknown } | undefined)?.name ?? 'tool')
            stream.push(`\n> 🛠️ \`${name.replace(/[`\r\n]/gu, '')}\`\n\n`)
          }
          break
        case 'assistant/message': {
          const next = assistantText((data as { message?: unknown } | undefined)?.message)
          if (next !== '') lastAssistantText = next
          break
        }
        case 'turn/end': {
          const reason = (data as { reason?: { kind?: string } } | undefined)?.reason
          const kind = reason?.kind ?? 'completed'
          if (kind === 'error') {
            finish({ kind: 'failed', detail: failure === undefined ? 'turn ended with error' : String(failure) })
          } else if (kind === 'aborted' || kind === 'cancelled') {
            finish({ kind: 'aborted', detail: 'turn aborted' })
          } else if (kind === 'blocked') {
            finish({ kind: 'blocked', detail: 'turn blocked' })
          } else if (kind === 'max-tokens') {
            finish({ kind: 'max-tokens', detail: 'max tokens reached' })
          } else {
            finish({ kind: 'completed' })
          }
          break
        }
        default:
          break
      }
    } catch (error) {
      options.onError?.(error)
    }
  }

  const onAssistantStream = (payload: { agent?: { id?: string }; frame?: { type?: string; chunk?: { type?: string; text?: string } } }): void => {
    try {
      if (payload.agent?.id !== agent.id) return
      const frame = payload.frame
      if (frame?.type !== 'chunk' || frame.chunk?.type !== 'text-delta') return
      const delta = frame.chunk.text ?? ''
      if (delta === '') return
      emittedText = true
      stream.push(delta)
    } catch (error) {
      options.onError?.(error)
    }
  }

  const onAgentError = (payload: { agent?: { id?: string }; error?: unknown }): void => {
    if (payload.agent?.id !== agent.id) return
    failure = payload.error
    options.onError?.(payload.error)
  }

  const offSession = ctx.on('session/event', onSessionEvent as never)
  const offStream = ctx.on('agent/assistant-stream', onAssistantStream as never)
  const offError = ctx.on('agent/error', onAgentError as never)

  function dispose(): void {
    offSession()
    offStream()
    offError()
  }

  try {
    agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
  } catch (error) {
    failure = error
    options.onError?.(error)
    queueMicrotask(() => finish({ kind: 'failed', detail: String(error) }))
  }

  // `currentTurn` is intentionally retained for future diagnostics; it proves
  // the observer is bound to the turn opened after this prompt.
  void currentTurn

  return {
    output: stream,
    done: stream.done,
    dispose,
  }
}
