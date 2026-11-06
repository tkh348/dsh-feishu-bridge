/**
 * Per-conversation FIFO with a generation token. Commands such as `/stop`
 * and `/new` bump the generation so prompts queued behind the active turn
 * are discarded instead of running against a conversation that changed.
 */
export class ChatQueue {
  private readonly tails = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, number>()
  private readonly generations = new Map<string, number>()

  /**
   * Current generation for one conversation.
   * @param key - conversation key.
   */
  generation(key: string): number {
    return this.generations.get(key) ?? 0
  }

  /**
   * Number of tasks waiting behind the running one.
   * @param key - conversation key.
   */
  size(key: string): number {
    return this.pending.get(key) ?? 0
  }

  /**
   * Invalidate queued work and return the new generation.
   * @param key - conversation key.
   */
  invalidate(key: string): number {
    const next = this.generation(key) + 1
    this.generations.set(key, next)
    return next
  }

  /**
   * Run one task after the conversation's previous task settles. The task is
   * skipped (and reports `skipped`) when its generation became stale while
   * waiting, or when a queue limit was reached before enqueueing.
   * @param key - conversation key.
   * @param limit - maximum waiting tasks.
   * @param task - work to run.
   * @returns the task's value, or `undefined` when skipped.
   */
  run<T>(key: string, limit: number, task: () => Promise<T>): Promise<T | undefined> {
    if (this.size(key) >= limit) return Promise.resolve(undefined)
    const generation = this.generation(key)
    this.pending.set(key, this.size(key) + 1)
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.generation(key) !== generation) return undefined
        return task()
      })
      .finally(() => {
        const left = (this.pending.get(key) ?? 1) - 1
        if (left <= 0) this.pending.delete(key)
        else this.pending.set(key, left)
        if (this.tails.get(key) === tracked) this.tails.delete(key)
      })
    const tracked = next.then(() => undefined, () => undefined)
    this.tails.set(key, tracked)
    return next
  }
}
