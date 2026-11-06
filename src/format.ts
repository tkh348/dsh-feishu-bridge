/** Maximum Markdown body sent in one non-streaming message. */
export const MAX_MESSAGE_CHARS = 12_000

/**
 * Bound a Markdown body so Feishu does not reject an oversized message.
 * @param text - complete answer.
 * @param limit - maximum characters.
 * @returns the text, with a truncation notice when bounded.
 */
export function truncateMarkdown(text: string, limit: number = MAX_MESSAGE_CHARS): string {
  if (text.length <= limit) return text
  const notice = '\n\n> …输出过长，已截断。可让 Agent 继续输出剩余部分。'
  return `${text.slice(0, Math.max(0, limit - notice.length))}${notice}`
}

/**
 * Remove the application secret from a diagnostic string.
 * @param text - diagnostic text.
 * @param secret - secret to redact.
 * @returns text safe for logs.
 */
export function redact(text: string, secret: string): string {
  return secret === '' ? text : text.split(secret).join('[redacted]')
}
