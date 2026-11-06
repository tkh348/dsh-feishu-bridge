import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { conversationKey, newSessionSuffix, toSessionId } from '../src/ids.js'

describe('conversationKey', () => {
  it('separates a chat from its threads', () => {
    assert.equal(conversationKey({ chatId: 'oc_1', chatType: 'p2p' }), 'chat:oc_1')
    assert.equal(conversationKey({ chatId: 'oc_1', chatType: 'group', threadId: 'omt_2' }), 'thread:oc_1:omt_2')
  })
})

describe('toSessionId', () => {
  it('is stable and hides raw Feishu ids', () => {
    const key = 'chat:oc_secret'
    const first = toSessionId('feishu', key)
    assert.equal(first, toSessionId('feishu', key))
    assert.equal(first.includes('oc_secret'), false)
    assert.match(first, /^feishu-[0-9a-f]{40}$/u)
  })

  it('separates deployments and generations', () => {
    assert.notEqual(toSessionId('feishu', 'chat:1'), toSessionId('lark', 'chat:1'))
    assert.notEqual(toSessionId('feishu', 'chat:1', newSessionSuffix(1_000)), toSessionId('feishu', 'chat:1'))
  })
})
