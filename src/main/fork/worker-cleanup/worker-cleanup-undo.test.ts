import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForkWorkerCleanupItem } from '../../../shared/fork/worker-cleanup'
import {
  readWorkerCleanupHeld,
  rememberNotice,
  resetWorkerCleanupNotices,
  setWorkerCleanupHeld,
  setWorkerCleanupPublisher,
  takeNotice
} from './worker-cleanup-notices'
import { undoWorkerCleanupItems } from './worker-cleanup-undo'

afterEach(() => resetWorkerCleanupNotices())

const items: ForkWorkerCleanupItem[] = [
  {
    kind: 'chat-closed',
    worktreeId: 'r::/w',
    sessionId: 's-1',
    agent: 'claude'
  },
  {
    kind: 'chat-released',
    worktreeId: 'r::/w',
    sessionId: 's-2',
    paneKey: 'tab:2'
  },
  { kind: 'terminal-closed', worktreeId: 'r::/w', handle: 'term-3' }
]

describe('worker cleanup notices', () => {
  it('hands a notice back for Undo once', () => {
    const notice = rememberNotice(items)
    expect(takeNotice(notice.id)).toEqual(items)
    expect(takeNotice(notice.id)).toEqual([])
  })

  it('forgets the oldest notices past its cap', () => {
    const first = rememberNotice(items)
    for (let i = 0; i < 20; i++) {
      rememberNotice(items)
    }
    expect(takeNotice(first.id)).toEqual([])
  })

  it('publishes the held list only when it changes', () => {
    const held = vi.fn()
    setWorkerCleanupPublisher({ notice: vi.fn(), held })
    const list = [{ paneKey: 'tab:1', sessionId: null, reason: 'unpushed' as const }]
    setWorkerCleanupHeld(list)
    setWorkerCleanupHeld([...list])
    expect(held).toHaveBeenCalledOnce()
    expect(readWorkerCleanupHeld()).toEqual(list)
    setWorkerCleanupHeld([])
    expect(held).toHaveBeenCalledTimes(2)
  })
})

describe('undoWorkerCleanupItems', () => {
  it('reopens terminals, keeps released chats open and hands closed chats back', async () => {
    const reopenTerminal = vi.fn(async () => true)
    const keepOpen = vi.fn()
    const result = await undoWorkerCleanupItems(items, {
      reopenTerminal,
      keepOpen
    })
    expect(reopenTerminal).toHaveBeenCalledWith('term-3')
    expect(keepOpen).toHaveBeenCalledWith('tab:2')
    expect(result.reopenChats).toEqual([items[0]])
  })

  it('carries on past a step that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const keepOpen = vi.fn()
    const result = await undoWorkerCleanupItems([items[2]!, items[1]!], {
      reopenTerminal: async () => {
        throw new Error('gone')
      },
      keepOpen
    })
    expect(keepOpen).toHaveBeenCalledOnce()
    expect(result.reopenChats).toEqual([])
    warn.mockRestore()
  })
})
