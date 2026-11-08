import { describe, expect, it, vi } from 'vitest'
import { FORK_UPDATE_INSTALL_WAIT_CHANNELS as CHANNELS } from '../../../shared/fork/update-install-wait'
import type { BusyChat } from './busy-chats'
import {
  RestartGuard,
  type RestartGuardChoice,
  type RestartGuardWaitingChoice
} from './restart-guard-machine'
import { createUpdateInstallWait, updateInstallWaitOf } from './update-install-wait'

function chat(sessionId: string): BusyChat {
  return {
    sessionId,
    name: sessionId,
    workspace: 'ws',
    activity: { kind: 'turn' }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The real guard machine wired the way restart-guard.ts wires it. */
function setup(options: {
  busy: BusyChat[]
  choice?: RestartGuardChoice
  waitingChoice?: RestartGuardWaitingChoice
}) {
  let busy = options.busy
  const timers: (() => void)[] = []
  const send = vi.fn()
  const guard: RestartGuard = new RestartGuard({
    readBusyChats: () => busy,
    askBeforeRestart: vi.fn(async () => options.choice ?? 'cancel'),
    askWhileWaiting: vi.fn(async () => options.waitingChoice ?? 'keep'),
    bringForward: vi.fn(),
    quitApp: vi.fn(),
    schedule: (run) => {
      timers.push(run)
      return () => {
        const index = timers.indexOf(run)
        if (index !== -1) {
          timers.splice(index, 1)
        }
      }
    },
    onProgress: (progress) => updateWait.progressChanged(progress),
    onWaitEnded: (kind, end) => updateWait.waitEnded(kind, end),
    now: () => 0,
    onError: vi.fn()
  })
  const updateWait = createUpdateInstallWait({
    send,
    getGuard: () => guard,
    onError: vi.fn()
  })
  const sent = (channel: string) => send.mock.calls.filter(([name]) => name === channel)
  return {
    guard,
    updateWait,
    send,
    sent,
    setBusy: (next: BusyChat[]) => {
      busy = next
    },
    tick: () => timers.shift()?.()
  }
}

describe('update install wait', () => {
  it('maps only an update wait to the card', () => {
    expect(updateInstallWaitOf(null)).toBeNull()
    expect(
      updateInstallWaitOf({
        kind: 'restart',
        total: 2,
        remaining: [chat('a')]
      })
    ).toBeNull()
    expect(updateInstallWaitOf({ kind: 'update', total: 2, remaining: [chat('a')] })).toEqual({
      total: 2,
      remaining: 1
    })
  })

  it('installs at once with no busy chat and tells the card nothing', async () => {
    const { updateWait, send } = setup({ busy: [] })
    const install = vi.fn()
    await updateWait.guardInstall(install)
    expect(install).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('shows the wait on the card, counts chats down and installs once they are idle', async () => {
    const { updateWait, send, sent, setBusy, tick } = setup({
      busy: [chat('a'), chat('b')],
      choice: 'wait'
    })
    const install = vi.fn()
    await updateWait.guardInstall(install)
    expect(install).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(CHANNELS.changed, {
      total: 2,
      remaining: 2
    })
    expect(send).toHaveBeenCalledWith('updater:quitAndInstallAborted')
    expect(updateWait.current()).toEqual({ total: 2, remaining: 2 })

    tick()
    // Unchanged counts are not pushed again.
    expect(sent(CHANNELS.changed)).toHaveLength(1)
    setBusy([chat('b')])
    tick()
    expect(send).toHaveBeenLastCalledWith(CHANNELS.changed, {
      total: 2,
      remaining: 1
    })

    setBusy([])
    tick()
    await flush()
    expect(install).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith(CHANNELS.changed, null)
    expect(sent(CHANNELS.released)).toHaveLength(0)
  })

  it('installs at once from the card and does not release the card', async () => {
    const { updateWait, sent } = setup({ busy: [chat('a')], choice: 'wait' })
    const install = vi.fn()
    await updateWait.guardInstall(install)
    updateWait.installNow()
    await flush()
    expect(install).toHaveBeenCalledTimes(1)
    expect(updateWait.current()).toBeNull()
    expect(sent(CHANNELS.released)).toHaveLength(0)
  })

  it('stops waiting from the card and releases it once', async () => {
    const { updateWait, sent, setBusy, tick } = setup({
      busy: [chat('a')],
      choice: 'wait'
    })
    const install = vi.fn()
    await updateWait.guardInstall(install)
    updateWait.stopWaiting()
    expect(sent(CHANNELS.released)).toHaveLength(1)
    expect(updateWait.current()).toBeNull()
    setBusy([])
    tick()
    await flush()
    expect(install).not.toHaveBeenCalled()
  })

  it('releases the card on Cancel in the first dialog', async () => {
    const { updateWait, sent } = setup({ busy: [chat('a')], choice: 'cancel' })
    const install = vi.fn()
    await updateWait.guardInstall(install)
    expect(install).not.toHaveBeenCalled()
    expect(sent(CHANNELS.released)).toHaveLength(1)
    expect(sent(CHANNELS.changed)).toHaveLength(0)
  })

  it('keeps the wait on a second Install with Keep Waiting', async () => {
    const { updateWait, sent } = setup({ busy: [chat('a')], choice: 'wait' })
    await updateWait.guardInstall(vi.fn())
    await updateWait.guardInstall(vi.fn())
    expect(sent(CHANNELS.released)).toHaveLength(0)
    expect(updateWait.current()).toEqual({ total: 1, remaining: 1 })
  })

  it('releases once on a second Install answered with Stop Waiting', async () => {
    const { updateWait, sent } = setup({
      busy: [chat('a')],
      choice: 'wait',
      waitingChoice: 'stop'
    })
    await updateWait.guardInstall(vi.fn())
    await updateWait.guardInstall(vi.fn())
    expect(sent(CHANNELS.released)).toHaveLength(1)
  })

  it('does not release on a second Install answered with Restart Now', async () => {
    const { updateWait, sent } = setup({
      busy: [chat('a')],
      choice: 'wait',
      waitingChoice: 'now'
    })
    const first = vi.fn()
    const second = vi.fn()
    await updateWait.guardInstall(first)
    await updateWait.guardInstall(second)
    await flush()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(sent(CHANNELS.released)).toHaveLength(0)
  })

  it('releases an Install dropped during a restart wait, which the card never shows', async () => {
    const { guard, updateWait, sent } = setup({
      busy: [chat('a')],
      choice: 'wait'
    })
    await guard.request('restart', vi.fn())
    await updateWait.guardInstall(vi.fn())
    expect(sent(CHANNELS.changed)).toHaveLength(0)
    expect(sent(CHANNELS.released)).toHaveLength(1)
  })
})
