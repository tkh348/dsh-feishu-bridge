import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface SessionRecord {
  sessionId: string
  updatedAt: number
}

interface StateFile {
  version: 1
  sessions: Record<string, SessionRecord>
}

const EMPTY: StateFile = { version: 1, sessions: {} }

/**
 * Durable mapping from a Feishu conversation key to the current DSH session.
 * `/new` needs this because the deterministic base id would otherwise bring
 * the previous conversation back after a restart.
 */
export class SessionState {
  private state: StateFile = EMPTY
  private writeChain: Promise<void> = Promise.resolve()

  private constructor(private readonly file: string) {}

  /**
   * Load the mapping file, tolerating a missing or corrupt file.
   * @param file - absolute mapping path.
   * @param warn - logger for a corrupt file; the bridge then starts fresh.
   * @returns the loaded store.
   */
  static async load(file: string, warn: (message: string) => void): Promise<SessionState> {
    const store = new SessionState(file)
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StateFile>
      if (parsed.version === 1 && parsed.sessions !== null && typeof parsed.sessions === 'object') {
        const sessions: Record<string, SessionRecord> = {}
        for (const [key, value] of Object.entries(parsed.sessions)) {
          if (value !== null && typeof value === 'object'
            && typeof value.sessionId === 'string' && value.sessionId !== ''
            && typeof value.updatedAt === 'number') {
            sessions[key] = { sessionId: value.sessionId, updatedAt: value.updatedAt }
          }
        }
        store.state = { version: 1, sessions }
      } else {
        warn(`ignoring unrecognized session state in ${file}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        warn(`could not read ${file}; starting with an empty session map: ${String(error)}`)
      }
    }
    return store
  }

  /**
   * Current session id for a conversation.
   * @param key - conversation key.
   */
  current(key: string): string | undefined {
    return this.state.sessions[key]?.sessionId
  }

  /**
   * Persist the current session id for a conversation.
   * @param key - conversation key.
   * @param sessionId - DSH session id.
   */
  async set(key: string, sessionId: string): Promise<void> {
    this.state.sessions[key] = { sessionId, updatedAt: Date.now() }
    await this.flush()
  }

  /** Serialize writes so two chats cannot clobber each other's mapping. */
  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2)
    this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.file)
    })
    return this.writeChain
  }
}
