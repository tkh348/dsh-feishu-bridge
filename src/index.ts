import { dirname, join } from 'node:path'
import { startFeishuBridge, type RunningBridge } from './channel.js'
import { isConfigured, resolveConfig, type Config } from './config.js'
import type { BridgeContext, BridgeLogger } from './context.js'
import { createFileLogger } from './log.js'

export const name = 'feishu-bridge'

/** The bridge needs the live Agent registry; other services are optional. */
export const inject = ['agents']

/**
 * Cordis entry point. An unconfigured or unreachable channel logs and leaves
 * the Harness running; fix the config and reload to retry.
 * @param ctx - plugin context.
 * @param rawConfig - plugin configuration from the profile patch.
 */
export function apply(ctx: BridgeContext, rawConfig: Config): void {
  const logger = ctx.logger
  let fileLog: BridgeLogger | undefined
  const log: BridgeLogger = {
    info: message => {
      fileLog?.info(message)
      try { logger.info(`[feishu-bridge] ${message}`) } catch { /* logging must not break the bridge */ }
    },
    warn: message => {
      fileLog?.warn(message)
      try { logger.warn(`[feishu-bridge] ${message}`) } catch { /* ignore */ }
    },
    error: message => {
      fileLog?.error(message)
      try { logger.error(`[feishu-bridge] ${message}`) } catch { /* ignore */ }
    },
  }
  let config
  try {
    config = resolveConfig(rawConfig ?? {}, process.cwd())
  } catch (error) {
    log.error(`invalid configuration: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  fileLog = createFileLogger(join(dirname(config.stateFile), 'bridge.log'))
  log.info(`apply appId=${config.appId} domain=${config.domain} streaming=${config.streaming} workspace=${config.workspace}`)
  if (!isConfigured(config)) {
    log.info('not configured: set appId and appSecret (or appSecretEnv) to connect to Feishu')
    return
  }

  let stopped = false
  let running: RunningBridge | undefined
  ctx.effect(() => {
    void startFeishuBridge(ctx, config, log)
      .then(bridge => {
        if (stopped) return bridge.dispose()
        running = bridge
      })
      .catch(error => {
        log.error(`could not start Feishu channel: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
      })
    return async () => {
      stopped = true
      if (running !== undefined) await running.dispose()
    }
  }, 'feishu-bridge: channel')
}
