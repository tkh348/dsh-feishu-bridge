import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Append-only diagnostic log. Writes are serialized and failures are swallowed
 * so logging can never take the bridge down.
 * @param file - absolute log path.
 * @returns a logger with the same shape as the Cordis logger.
 */
export function createFileLogger(file: string): {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
} {
  let chain: Promise<void> = Promise.resolve()
  const write = (level: string, message: string): void => {
    const line = `${new Date().toISOString()} ${level} ${message}\n`
    chain = chain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, line, 'utf8')
      })
      .catch(() => undefined)
  }
  return {
    info: message => { write('INFO', message) },
    warn: message => { write('WARN', message) },
    error: message => { write('ERROR', message) },
  }
}
