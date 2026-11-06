/** A disposable registration returned by `ctx.on` and `ctx.effect`. */
export type Disposer = () => void

/** Logger shape provided by Cordis. */
export interface BridgeLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/**
 * The narrow Cordis surface this plugin uses. Keeping it local removes a
 * compile-time dependency on the Harness packages while remaining structurally
 * compatible with the live context.
 */
export interface BridgeContext {
  get(name: string): unknown
  on(event: string, listener: (...args: never[]) => void): Disposer
  effect(execute: () => void | Disposer | Promise<void>, label?: string): Disposer
  logger: BridgeLogger
}
