import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ChatQueue } from '../src/queue.js'

const tick = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

describe('ChatQueue', () => {
  it('runs tasks for one conversation in order', async () => {
    const queue = new ChatQueue()
    const order: number[] = []
    const first = queue.run('chat', 5, async () => { order.push(1) })
    const second = queue.run('chat', 5, async () => { order.push(2) })
    await Promise.all([first, second])
    assert.deepEqual(order, [1, 2])
  })

  it('skips work whose generation became stale while waiting', async () => {
    const queue = new ChatQueue()
    const gate = Promise.withResolvers<void>()
    const running = queue.run('chat', 5, () => gate.promise)
    const stale = queue.run('chat', 5, async () => 'ran')
    queue.invalidate('chat')
    gate.resolve()
    await running
    assert.equal(await stale, undefined)
  })

  it('rejects a full queue before enqueueing', async () => {
    const queue = new ChatQueue()
    const gate = Promise.withResolvers<void>()
    const running = queue.run('chat', 1, () => gate.promise)
    const rejected = queue.run('chat', 1, async () => 'ran')
    assert.equal(await rejected, undefined)
    gate.resolve()
    await running
  })

  it('counts waiting tasks until they settle', async () => {
    const queue = new ChatQueue()
    const gate = Promise.withResolvers<void>()
    const running = queue.run('chat', 5, () => gate.promise)
    const waiting = queue.run('chat', 5, async () => { await tick() })
    assert.equal(queue.size('chat'), 2)
    gate.resolve()
    await Promise.all([running, waiting])
    assert.equal(queue.size('chat'), 0)
  })
})
