import { describe, expect, it, vi } from 'vitest'
import type { BusyChat } from './busy-chats'
import {
  RestartGuard,
  type RestartGuardChoice,
  type RestartGuardDeps,
  type RestartGuardWaitingChoice
} from './restart-guard-machine'

function chat(sessionId: string): BusyChat {
  return { sessionId, name: sessionId, workspace: 'ws', activity: { kind: 'turn' } }
}

function asking(sessionId: string): BusyChat {
  return { sessionId, name: sessionId, workspace: 'ws', activity: { kind: 'question' } }
}

const quiet = { defaultPrevented: false, systemShutdown: false, committedElsewhere: false }

function setup(options: {
  busy: BusyChat[]
  choice?: RestartGuardChoice
  waitingChoice?: RestartGuardWaitingChoice
}) {
  let busy = options.busy
  let clock = 0
  const timers: (() => void)[] = []
  const deps: RestartGuardDeps = {
    readBusyChats: vi.fn(() => busy),
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
    onProgress: vi.fn(),
    now: () => clock,
    onError: vi.fn()
  }
  return {
    deps,
    guard: new RestartGuard(deps),
    setBusy: (next: BusyChat[]) => {
      busy = next
    },
    tick: () => timers.shift()?.(),
    advance: (ms: number) => {
      clock += ms
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('RestartGuard', () => {
  it('lets a restart through at once when no chat is busy', async () => {
    const { guard, deps } = setup({ busy: [] })
    expect(await guard.request('restart', vi.fn())).toBe('proceed')
    expect(deps.askBeforeRestart).not.toHaveBeenCalled()
  })

  it('waits for busy chats, then proceeds once they are idle', async () => {
    const { guard, deps, setBusy, tick } = setup({ busy: [chat('a'), chat('b')], choice: 'wait' })
    const proceed = vi.fn()
    expect(await guard.request('restart', proceed)).toBe('waiting')
    expect(deps.askBeforeRestart).toHaveBeenCalledWith('restart', [chat('a'), chat('b')])

    setBusy([chat('b')])
    tick()
    expect(deps.onProgress).toHaveBeenLastCalledWith({
      kind: 'restart',
      total: 2,
      remaining: [chat('b')]
    })
    expect(proceed).not.toHaveBeenCalled()

    setBusy([])
    tick()
    await flush()
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(deps.onProgress).toHaveBeenLastCalledWith(null)
    expect(guard.getProgress()).toBeNull()
  })

  it('also waits for a chat that starts working during the wait', async () => {
    const { guard, deps, setBusy, tick } = setup({ busy: [chat('a')], choice: 'wait' })
    const proceed = vi.fn()
    await guard.request('update', proceed)
    setBusy([chat('c')])
    tick()
    expect(deps.onProgress).toHaveBeenLastCalledWith({
      kind: 'update',
      total: 2,
      remaining: [chat('c')]
    })
    expect(proceed).not.toHaveBeenCalled()
  })

  it('does nothing on Cancel', async () => {
    const { guard, tick } = setup({ busy: [chat('a')], choice: 'cancel' })
    const proceed = vi.fn()
    expect(await guard.request('restart', proceed)).toBe('cancelled')
    tick()
    await flush()
    expect(proceed).not.toHaveBeenCalled()
  })

  it('goes now on Now and approves the quit that follows', async () => {
    const { guard } = setup({ busy: [chat('a')], choice: 'now' })
    expect(await guard.request('restart', vi.fn())).toBe('proceed')
    expect(guard.onBeforeQuit(quiet)).toBe('pass')
  })

  it('stops waiting from the status dialog without proceeding', async () => {
    const { guard, deps, setBusy, tick } = setup({
      busy: [chat('a')],
      choice: 'wait',
      waitingChoice: 'stop'
    })
    const proceed = vi.fn()
    await guard.request('restart', proceed)
    await guard.askAboutWaiting()
    expect(deps.onProgress).toHaveBeenLastCalledWith(null)
    setBusy([])
    tick()
    await flush()
    expect(proceed).not.toHaveBeenCalled()
  })

  it('goes now from the status dialog', async () => {
    const { guard } = setup({ busy: [chat('a')], choice: 'wait', waitingChoice: 'now' })
    const proceed = vi.fn()
    await guard.request('restart', proceed)
    await guard.askAboutWaiting()
    await flush()
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('holds a user quit while chats are busy and quits after Now', async () => {
    const { guard, deps } = setup({ busy: [chat('a')], choice: 'now' })
    expect(guard.onBeforeQuit(quiet)).toBe('hold')
    await flush()
    expect(deps.quitApp).toHaveBeenCalledTimes(1)
    expect(guard.onBeforeQuit(quiet)).toBe('pass')
  })

  it('holds a repeated quit while its dialog is open without asking twice', () => {
    const { guard, deps } = setup({ busy: [chat('a')], choice: 'wait' })
    expect(guard.onBeforeQuit(quiet)).toBe('hold')
    expect(guard.onBeforeQuit(quiet)).toBe('hold')
    expect(deps.askBeforeRestart).toHaveBeenCalledTimes(1)
  })

  it('never holds OS shutdown, a vetoed quit or a quit another owner committed', () => {
    const { guard, deps } = setup({ busy: [chat('a')] })
    expect(guard.onBeforeQuit({ ...quiet, systemShutdown: true })).toBe('pass')
    expect(guard.onBeforeQuit({ ...quiet, defaultPrevented: true })).toBe('pass')
    expect(guard.onBeforeQuit({ ...quiet, committedElsewhere: true })).toBe('pass')
    expect(deps.askBeforeRestart).not.toHaveBeenCalled()
  })

  it('lets a quit through when every chat is idle', () => {
    const { guard } = setup({ busy: [] })
    expect(guard.onBeforeQuit(quiet)).toBe('pass')
  })

  it('asks again once an old approval has expired', async () => {
    const { guard, advance } = setup({ busy: [chat('a')], choice: 'now' })
    await guard.request('restart', vi.fn())
    advance(3 * 60 * 1000)
    expect(guard.onBeforeQuit(quiet)).toBe('hold')
  })

  it('runs a when-idle update at once with nothing busy, else after the wait', async () => {
    const idle = setup({ busy: [] })
    const install = vi.fn()
    expect(idle.guard.whenIdle('update', install)).toBe('proceed')
    await flush()
    expect(install).toHaveBeenCalledTimes(1)

    const busy = setup({ busy: [chat('a')] })
    const later = vi.fn()
    expect(busy.guard.whenIdle('update', later)).toBe('waiting')
    expect(busy.deps.askBeforeRestart).not.toHaveBeenCalled()
    busy.setBusy([])
    busy.tick()
    await flush()
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('fails open when reading the chats throws', async () => {
    const { guard, deps } = setup({ busy: [] })
    vi.mocked(deps.readBusyChats).mockImplementation(() => {
      throw new Error('host gone')
    })
    expect(guard.onBeforeQuit(quiet)).toBe('pass')
    expect(await guard.request('restart', vi.fn())).toBe('proceed')
    expect(deps.onError).toHaveBeenCalled()
  })

  it('goes ahead when the dialog itself fails', async () => {
    const { guard, deps } = setup({ busy: [chat('a')] })
    vi.mocked(deps.askBeforeRestart).mockRejectedValueOnce(new Error('no dialog'))
    expect(await guard.request('restart', vi.fn())).toBe('proceed')
  })

  it('quits when the dialog fails during a held quit', async () => {
    const { guard, deps } = setup({ busy: [chat('a')] })
    vi.mocked(deps.askBeforeRestart).mockRejectedValueOnce(new Error('no dialog'))
    expect(guard.onBeforeQuit(quiet)).toBe('hold')
    await flush()
    expect(deps.quitApp).toHaveBeenCalledTimes(1)
  })

  it('brings the dialog forward before asking and again on a repeated quit', () => {
    const { guard, deps } = setup({ busy: [chat('a')], choice: 'wait' })
    guard.onBeforeQuit(quiet)
    expect(deps.bringForward).toHaveBeenCalledTimes(1)
    guard.onBeforeQuit(quiet)
    expect(deps.bringForward).toHaveBeenCalledTimes(2)
  })

  it('quits on Cmd-Q then Now during a restart wait, keeping the latest intent', async () => {
    const { guard, deps } = setup({ busy: [chat('a')], choice: 'wait', waitingChoice: 'now' })
    const restart = vi.fn()
    await guard.request('restart', restart)
    expect(guard.onBeforeQuit(quiet)).toBe('hold')
    await flush()
    await flush()
    expect(deps.askWhileWaiting).toHaveBeenCalledWith({
      kind: 'quit',
      total: 1,
      remaining: [chat('a')]
    })
    expect(deps.quitApp).toHaveBeenCalledTimes(1)
    expect(restart).not.toHaveBeenCalled()
    expect(guard.getProgress()).toBeNull()
  })

  it('lists chats waiting for an answer but does not wait for them', async () => {
    const { guard, deps, setBusy, tick } = setup({
      busy: [asking('q'), chat('a')],
      choice: 'wait'
    })
    expect(deps.readBusyChats()).toHaveLength(2)
    const restart = vi.fn()
    expect(await guard.request('restart', restart)).toBe('waiting')
    expect(deps.askBeforeRestart).toHaveBeenCalledWith('restart', [asking('q'), chat('a')])
    expect(guard.getProgress()).toEqual({ kind: 'restart', total: 1, remaining: [chat('a')] })
    setBusy([asking('q')])
    tick()
    await flush()
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('goes ahead at once on "when idle" when only answer-waiting chats are open', async () => {
    const { guard } = setup({ busy: [asking('q')], choice: 'wait' })
    const restart = vi.fn()
    expect(await guard.request('restart', restart)).toBe('proceed')
    await flush()
    expect(restart).not.toHaveBeenCalled()
  })
})
