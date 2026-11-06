import { createHash } from 'node:crypto'

/** The subset of a normalized Feishu message that identifies its conversation. */
export interface ConversationRef {
  chatId: string
  chatType: 'p2p' | 'group'
  threadId?: string
}

/**
 * Stable key for one Feishu conversation. Threads are isolated from their
 * parent chat so separate topics never share agent context.
 * @param message - normalized inbound message identity.
 * @returns a key suitable for queueing and session lookup.
 */
export function conversationKey(message: ConversationRef): string {
  return message.threadId === undefined
    ? `chat:${message.chatId}`
    : `thread:${message.chatId}:${message.threadId}`
}

/**
 * Opaque DSH session id derived from the conversation. It deliberately does
 * not contain raw Feishu ids, which may be sensitive in logs and filenames.
 * @param domain - Feishu or Lark deployment.
 * @param key - conversation key.
 * @param suffix - optional generation suffix used by `/new`.
 * @returns a stable session id.
 */
export function toSessionId(domain: string, key: string, suffix?: string): string {
  const digest = createHash('sha256').update(`${domain}\0${key}`).digest('hex').slice(0, 40)
  return suffix === undefined
    ? `feishu-${digest}`
    : `feishu-${digest}-${suffix}`
}

/** A generated suffix that sorts by creation time and stays filename-safe. */
export function newSessionSuffix(now: number = Date.now()): string {
  return now.toString(36)
}
