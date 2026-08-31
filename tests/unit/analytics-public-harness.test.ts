// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { stopHarnessChild } from '../config/owner-analytics-harness-cleanup.mjs'

async function within<T>(operation: Promise<T>): Promise<T | 'timed out'> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([operation, new Promise<'timed out'>(resolve => {
      timer = setTimeout(() => resolve('timed out'), 1000)
    })])
  } finally { clearTimeout(timer!) }
}

async function ownedChild(ignoreTerm = false) {
  const child = spawn(process.execPath, ['-e', `
    ${ignoreTerm ? "process.on('SIGTERM', () => {})" : ''}
    setInterval(() => {}, 1000)
    process.send('ready')
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  await once(child, 'message')
  return child
}

async function dispose(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await within(exited)
  }
}

describe('public analytics harness owned-child cleanup', () => {
  it('continues cleanup when the child has already exited by signal', async () => {
    const child = await ownedChild()
    try {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
      expect(child.exitCode).toBeNull()
      expect(child.signalCode).toBe('SIGTERM')
      expect(await within(stopHarnessChild(child, { graceMs: 40, killMs: 40 }))).toBe(true)
    } finally { await dispose(child) }
  })

  it('waits for normal graceful teardown before continuing', async () => {
    const child = await ownedChild()
    try {
      expect(await within(stopHarnessChild(child, { graceMs: 100, killMs: 100 }))).toBe(true)
      expect(child.signalCode).toBe('SIGTERM')
    } finally { await dispose(child) }
  })

  it('bounds an unresponsive SIGTERM child by escalating only that child to SIGKILL', async () => {
    const child = await ownedChild(true)
    try {
      expect(await within(stopHarnessChild(child, { graceMs: 40, killMs: 100 }))).toBe(true)
      expect(child.signalCode).toBe('SIGKILL')
    } finally { await dispose(child) }
  })

  it('returns failure and permits later cleanup if even SIGKILL produces no exit event', async () => {
    // The OS cannot normally ignore SIGKILL. Model this exceptional boundary only;
    // the other cases exercise real child processes, not a mocked launcher.
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: () => false })
    expect(await within(stopHarnessChild(child, { graceMs: 20, killMs: 20 }))).toBe(false)
    expect(child.listenerCount('exit')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
  })
})
