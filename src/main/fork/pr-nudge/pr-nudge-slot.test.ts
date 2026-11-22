// PR nudges (BAD-680): the watcher's storage, watched for who owns each pull request.
import { describe, expect, it } from 'vitest'
import type { PRWatchStorage } from '../../github/pr-watch/pr-watch-storage'
import type { PRChatAction } from '../../github/pr-watch/pr-watch-tables'
import { PR_NUDGE_OWNER_WINDOW_MS, forkPrNudgeAttach, forkPrNudgeOwner } from './pr-nudge-slot'

const action = (chatId: string, observedAt: number, number = 12): PRChatAction => ({
  chatId,
  anchor: { itemId: 'i', revision: 1 },
  forgeHost: 'github.com',
  owner: 'Acme',
  repo: 'api',
  number,
  kind: 'pushed',
  headSha: null,
  observedAt
})

function storage(result: unknown): PRWatchStorage {
  return {
    readOnly: false,
    isClosed: false,
    read: async () => [] as never,
    write: async () => result as never
  }
}

describe('forkPrNudgeAttach', () => {
  it('learns owners from settled actions and the startup read, newest action wins', async () => {
    const startup = new Map([['github.com/acme/api#20', action('chat-old', 100, 20)]])
    const deps = forkPrNudgeAttach({ database: storage(startup) })
    await deps.database.write({ kind: 'active', now: 1, windowMs: 1 })
    expect(forkPrNudgeOwner('github.com/acme/api#20', 200)).toBe('chat-old')

    const settled = forkPrNudgeAttach({ database: storage(undefined) })
    await settled.database.write({
      kind: 'settle',
      row: {} as never,
      indices: [],
      verified: [
        { action: action('chat-a', 1000), candidate: {} as never, movedAt: null },
        { action: action('chat-b', 2000), candidate: {} as never, movedAt: null },
        { action: action('chat-c', 1500), candidate: {} as never, movedAt: null }
      ]
    })
    expect(forkPrNudgeOwner('github.com/acme/api#12', 3000)).toBe('chat-b')
  })

  it('forgets an owner past the watch window and passes the storage through', async () => {
    const deps = forkPrNudgeAttach({ database: storage(undefined) })
    await deps.database.write({
      kind: 'settle',
      row: {} as never,
      indices: [],
      verified: [{ action: action('chat-a', 5000, 33), candidate: {} as never, movedAt: null }]
    })
    expect(forkPrNudgeOwner('github.com/acme/api#33', 5000 + PR_NUDGE_OWNER_WINDOW_MS)).toBeNull()
    expect(forkPrNudgeOwner('github.com/acme/api#99', 5000)).toBeNull()
    expect(deps.database.readOnly).toBe(false)
    expect(deps.database.isClosed).toBe(false)
  })
})
