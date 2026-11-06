import { isAbsolute } from 'node:path'

/** Feishu China or international Lark. */
export type DomainName = 'feishu' | 'lark'
/** Who may start a direct conversation with the bot. */
export type DirectMessageMode = 'open' | 'allowlist' | 'disabled'

/** Plugin configuration, validated by the exported schema below. */
export interface Config {
  /** Feishu/Lark application id (`cli_...`). */
  appId?: string
  /** Literal application secret. Prefer {@link appSecretEnv}. */
  appSecret?: string
  /** Environment variable holding the application secret. */
  appSecretEnv?: string
  /** Feishu China or international Lark. */
  domain?: DomainName
  /** Require an explicit @bot mention in groups. */
  requireMention?: boolean
  /** Direct-message policy. */
  dmMode?: DirectMessageMode
  /** Group chat ids allowed to use the bot. Empty means no group restriction. */
  groupAllowlist?: string[]
  /** Sender open_ids allowed when `dmMode` is `allowlist`. */
  dmAllowlist?: string[]
  /** Provider route override. Empty follows the Harness default model. */
  provider?: string
  /** Model id override. Empty follows the Harness default model. */
  model?: string
  /** Reasoning effort override for this channel. */
  reasoningEffort?: string
  /** Agent preset that supplies tools and prompting for Feishu agents. */
  agentPreset?: string
  /** Absolute workspace directory for agents created by this bridge. */
  workspace?: string
  /** Stream assistant text into the Feishu message as it is produced. */
  streaming?: boolean
  /** Append a short line whenever the agent starts a tool call. */
  showToolStatus?: boolean
  /** Maximum queued prompts per conversation, excluding the running one. */
  queueLimit?: number
  /** Text returned when a turn fails. */
  errorMessage?: string
  /** Session mapping file. Defaults to `$DSH_HOME/feishu-bridge/sessions.json`. */
  stateFile?: string
}

export const DEFAULT_ERROR_MESSAGE = '抱歉，处理这条消息时遇到了问题，请稍后重试。'
export const DEFAULT_APP_SECRET_ENV = 'DSH_FEISHU_APP_SECRET'

/** Configuration after defaults and environment resolution. */
export interface ResolvedConfig {
  appId: string
  appSecret: string
  domain: DomainName
  requireMention: boolean
  dmMode: DirectMessageMode
  groupAllowlist: string[]
  dmAllowlist: string[]
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  workspace: string
  streaming: boolean
  showToolStatus: boolean
  queueLimit: number
  errorMessage: string
  stateFile: string
}

/** Thrown for configuration that cannot produce a safe bridge. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Resolve defaults, the application secret, and the workspace.
 * @param config - schema-validated plugin configuration.
 * @param cwd - process working directory used when no workspace is configured.
 * @param env - environment source for the secret.
 * @returns runtime configuration ready for the channel.
 */
export function resolveConfig(
  config: Config,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  if (config === null || typeof config !== 'object') throw new ConfigError('configuration must be an object')
  const appId = text(config.appId, 'appId')
  const secretEnv = text(config.appSecretEnv, 'appSecretEnv') || DEFAULT_APP_SECRET_ENV
  const appSecret = text(config.appSecret, 'appSecret') || (env[secretEnv] ?? '').trim()
  const domain = config.domain ?? 'feishu'
  if (domain !== 'feishu' && domain !== 'lark') throw new ConfigError('domain must be "feishu" or "lark"')
  const dmMode = config.dmMode ?? 'open'
  if (dmMode !== 'open' && dmMode !== 'allowlist' && dmMode !== 'disabled') {
    throw new ConfigError('dmMode must be "open", "allowlist", or "disabled"')
  }
  const dmAllowlist = stringArray(config.dmAllowlist, 'dmAllowlist')
  const groupAllowlist = stringArray(config.groupAllowlist, 'groupAllowlist')
  const workspace = text(config.workspace, 'workspace') || cwd
  if (!isAbsolute(workspace)) throw new ConfigError('workspace must be an absolute path')
  const errorMessage = text(config.errorMessage, 'errorMessage') || DEFAULT_ERROR_MESSAGE
  const provider = text(config.provider, 'provider')
  const model = text(config.model, 'model')
  const reasoningEffort = text(config.reasoningEffort, 'reasoningEffort')
  const agentPreset = text(config.agentPreset, 'agentPreset')
  if (errorMessage.length > 500) throw new ConfigError('errorMessage must not exceed 500 characters')
  if ((provider !== '') !== (model !== '')) throw new ConfigError('provider and model must be configured together')
  if (dmMode === 'allowlist' && dmAllowlist.length === 0) throw new ConfigError('dmMode is "allowlist" but dmAllowlist is empty')
  const queueLimit = config.queueLimit ?? 5
  if (!Number.isInteger(queueLimit) || queueLimit < 1 || queueLimit > 50) {
    throw new ConfigError('queueLimit must be an integer between 1 and 50')
  }
  return {
    appId,
    appSecret,
    domain,
    requireMention: boolean(config.requireMention, 'requireMention', true),
    dmMode,
    groupAllowlist,
    dmAllowlist,
    ...(provider === '' ? {} : { provider }),
    ...(model === '' ? {} : { model }),
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
    ...(agentPreset === '' ? {} : { agentPreset }),
    workspace,
    streaming: boolean(config.streaming, 'streaming', true),
    showToolStatus: boolean(config.showToolStatus, 'showToolStatus', true),
    queueLimit,
    errorMessage,
    stateFile: text(config.stateFile, 'stateFile') || defaultStateFile(env),
  }
}

/** Validate one optional string field. */
function text(value: unknown, field: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new ConfigError(`${field} must be a string`)
  return value.trim()
}

/** Validate one optional boolean field. */
function boolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ConfigError(`${field} must be a boolean`)
  return value
}

/** Validate one optional string array field. */
function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ConfigError(`${field} must be an array of strings`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

/**
 * Resolve the default mapping file under DSH_HOME.
 * @param env - environment source.
 * @returns absolute path to the session mapping file.
 */
export function defaultStateFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = (env.DSH_HOME ?? '').trim()
  const base = home || `${env.USERPROFILE ?? env.HOME ?? '.'}/.dsh`
  return `${base.replace(/[\\/]+$/u, '')}/feishu-bridge/sessions.json`
}

/** Whether the bridge has enough credentials to connect. */
export function isConfigured(config: ResolvedConfig): boolean {
  return config.appId !== '' && config.appSecret !== ''
}
