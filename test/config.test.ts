import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigError, defaultStateFile, isConfigured, resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('reads the secret from the configured environment variable', () => {
    const config = resolveConfig({ appId: 'cli_1', appSecretEnv: 'MY_SECRET' }, 'C:\\work', { MY_SECRET: 's3cret' })
    assert.equal(config.appSecret, 's3cret')
    assert.equal(config.workspace, 'C:\\work')
    assert.equal(isConfigured(config), true)
  })

  it('prefers an explicit secret over the environment', () => {
    const config = resolveConfig({ appId: 'cli_1', appSecret: 'inline', appSecretEnv: 'MY_SECRET' }, 'C:\\work', { MY_SECRET: 'env' })
    assert.equal(config.appSecret, 'inline')
  })

  it('requires provider and model together', () => {
    assert.throws(() => resolveConfig({ appId: 'a', appSecret: 'b', provider: 'p' }, 'C:\\work', {}), ConfigError)
  })

  it('rejects an empty allowlist in allowlist mode', () => {
    assert.throws(() => resolveConfig({ appId: 'a', appSecret: 'b', dmMode: 'allowlist' }, 'C:\\work', {}), ConfigError)
  })

  it('rejects a non-boolean switch', () => {
    assert.throws(
      () => resolveConfig({ appId: 'a', appSecret: 'b', streaming: 'yes' as never }, 'C:\\work', {}),
      ConfigError,
    )
  })

  it('rejects a relative workspace', () => {
    assert.throws(
      () => resolveConfig({ appId: 'a', appSecret: 'b', workspace: 'relative/dir' }, 'C:\\work', {}),
      ConfigError,
    )
  })
})

describe('defaultStateFile', () => {
  it('uses DSH_HOME when present', () => {
    assert.equal(defaultStateFile({ DSH_HOME: 'C:\\dsh' }), 'C:\\dsh/feishu-bridge/sessions.json')
  })
})
