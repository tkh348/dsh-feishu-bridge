import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { commandKind, formatDuration, parseCommand, renderHelp, renderStatus } from '../src/commands.js'

describe('parseCommand', () => {
  it('returns undefined for ordinary text', () => {
    assert.equal(parseCommand('帮我看看构建为什么失败'), undefined)
  })

  it('parses a command and its arguments', () => {
    assert.deepEqual(parseCommand('  /NEW   foo bar  '), { name: 'new', args: 'foo bar' })
  })

  it('keeps an unknown command parseable', () => {
    assert.deepEqual(parseCommand('/wat'), { name: 'wat', args: '' })
  })

  it('strips a leading group mention before parsing', () => {
    assert.deepEqual(parseCommand('@_user_1 /status'), { name: 'status', args: '' })
    assert.deepEqual(parseCommand('<at id="ou_x">DSH</at> /new'), { name: 'new', args: '' })
  })
})

describe('commandKind', () => {
  it('maps aliases', () => {
    assert.equal(commandKind({ name: 'reset', args: '' }), 'new')
    assert.equal(commandKind({ name: 'cancel', args: '' }), 'stop')
    assert.equal(commandKind({ name: 'nope', args: '' }), 'unknown')
  })
})

describe('renderHelp', () => {
  it('mentions group-only behavior when asked', () => {
    assert.equal(renderHelp(false).includes('@机器人'), false)
    assert.equal(renderHelp(true).includes('@机器人'), true)
  })
})

describe('renderStatus', () => {
  it('renders session and queue facts without secrets', () => {
    const text = renderStatus({
      sessionId: 'feishu-abc',
      workspace: 'C:\\work',
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      agentStatus: 'running',
      active: true,
      queued: 2,
      uptimeSeconds: 3_725,
    })
    assert.equal(text.includes('feishu-abc'), true)
    assert.equal(text.includes('deepseek-account/deepseek-flash'), true)
    assert.equal(text.includes('🟢 执行中'), true)
    assert.equal(text.includes('1h 2m'), true)
  })
})

describe('formatDuration', () => {
  it('uses the largest useful unit', () => {
    assert.equal(formatDuration(4), '4s')
    assert.equal(formatDuration(65), '1m 5s')
    assert.equal(formatDuration(3_600), '1h 0m')
    assert.equal(formatDuration(90_000), '1d 1h')
  })
})
