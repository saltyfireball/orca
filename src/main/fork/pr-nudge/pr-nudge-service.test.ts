// PR nudges (BAD-680): the service against stubs. No GitHub, gh, chat host or file is used.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import { readPrNudgeSettings, type PrNudgeComment } from '../../../shared/fork/pr-nudge'
import type { PRWatchWorkspace } from '../../github/pr-watch/pr-watch-types'
import type { IdleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import { PR_NUDGE_CONFLICT_MARKER, PR_NUDGE_REVIEW_MARKER } from './pr-nudge-message'
import {
  PR_NUDGE_COMMENT_READ_MS,
  PR_NUDGE_RETRY_MS,
  createPrNudgeService,
  type PrNudgeObservation
} from './pr-nudge-service'
import { emptyPrNudgeState, type PrNudgeState } from './pr-nudge-state'

const pause = vi.hoisted(() => ({ engaged: false }))
vi.mock('../pause-all/pause-all-state', () => ({
  isForkPauseAllEngaged: () => pause.engaged,
  forkPauseAllRefusal: () => (pause.engaged ? 'Paused by pause-all: test' : null),
  onForkPauseAllChanged: () => () => {}
}))
afterEach(() => {
  pause.engaged = false
})

const PR = 'github.com/acme/api#12'
const WS: PRWatchWorkspace = {
  repoId: 'r1',
  repoPath: '/work/api',
  checkoutPath: '/work/api-feature',
  repoKind: 'git',
  branch: 'feature',
  connectionId: null
}

const comment = (id: number, over: Partial<PrNudgeComment> = {}): PrNudgeComment => ({
  kind: 'review-comment',
  id,
  author: 'rev',
  association: 'MEMBER',
  path: 'src/a.ts',
  line: 4,
  body: `comment ${id}`,
  url: `https://github.com/acme/api/pull/12#discussion_r${id}`,
  replyTo: null,
  ...over
})

function harness(
  settings: Record<string, unknown> = { forkPrNudgeEnabled: true },
  options: { loaded?: boolean; sendOutcome?: 'sent' | 'queued' | 'refused' | 'unknown' } = {}
) {
  let now = 1_000_000
  let state: PrNudgeState = emptyPrNudgeState()
  let comments: PrNudgeComment[] = []
  let reads = 0
  const sent: { chatId: string; text: string }[] = []
  const notified: ForkIdleRecoveryInboxItem[] = []
  const answered: string[] = []
  const chat: IdleRecoveryChatPort = {
    read: () => ({ fence: 3, loaded: options.loaded ?? true, inTurn: false }),
    send: async (chatId, text) => {
      const outcome = options.sendOutcome ?? 'queued'
      if (outcome !== 'refused') {
        sent.push({ chatId, text })
      }
      return outcome
    }
  }
  const service = createPrNudgeService({
    now: () => now,
    settings: () => readPrNudgeSettings(settings as never),
    load: async () => state,
    save: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    },
    github: async () => ({
      read: async () => {
        reads += 1
        return { author: 'me', comments }
      }
    }),
    workspace: async () => WS,
    chat,
    answer: async (chatId) => {
      answered.push(chatId)
      return 'sent'
    },
    notify: async (items) => {
      notified.push(...items)
    },
    changed: () => {},
    warn: (message, error) => {
      throw new Error(`${message} ${String(error)}`)
    }
  })
  const seen = (over: Partial<PrNudgeObservation> = {}): PrNudgeObservation => ({
    prKey: PR,
    chatId: 'chat-1',
    headSha: 'abcdef1234567',
    baseRef: 'main',
    mergeable: 'MERGEABLE',
    state: 'open',
    ...over
  })
  return {
    service,
    seen,
    sent,
    notified,
    answered,
    state: () => state,
    reads: () => reads,
    setComments: (next: PrNudgeComment[]) => {
      comments = next
    },
    tick: (ms: number) => {
      now += ms
    }
  }
}

describe('review comments', () => {
  it('reads and sends nothing while pause-all is engaged, then nudges what is due (BAD-685)', async () => {
    const h = harness()
    await h.service.observed(h.seen())
    h.setComments([comment(2)])
    h.tick(PR_NUDGE_COMMENT_READ_MS)
    pause.engaged = true
    await h.service.observed(h.seen())
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    expect(h.sent).toHaveLength(0)
    pause.engaged = false
    await h.service.observed(h.seen())
    expect(h.sent).toHaveLength(1)
  })

  it('sends a new comment once, with file and line, and never resends it', async () => {
    const h = harness()
    h.setComments([comment(1, { association: 'OWNER' })])
    await h.service.observed(h.seen())
    expect(h.sent).toHaveLength(0)
    // The comment that was there when nudging began is the baseline: not sent.
    h.setComments([comment(1), comment(2, { path: 'src/b.ts', line: 30 })])
    h.tick(PR_NUDGE_COMMENT_READ_MS)
    await h.service.observed(h.seen())
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]!.chatId).toBe('chat-1')
    expect(h.sent[0]!.text).toContain(PR_NUDGE_REVIEW_MARKER)
    expect(h.sent[0]!.text).toContain('"file": "src/b.ts"')
    expect(h.sent[0]!.text).toContain('"line": 30')
    expect(h.sent[0]!.text).not.toContain('comment 1"')
    for (let poll = 0; poll < 3; poll += 1) {
      h.tick(PR_NUDGE_COMMENT_READ_MS)
      await h.service.observed(h.seen())
    }
    expect(h.sent).toHaveLength(1)
  })

  it('does not resend after a restart: the sent keys are on disk', async () => {
    const h = harness()
    await h.service.observed(h.seen())
    h.setComments([comment(2)])
    h.tick(PR_NUDGE_COMMENT_READ_MS)
    await h.service.observed(h.seen())
    expect(h.sent).toHaveLength(1)
    expect(h.state().entries[PR]!.seen).toContain('review-comment:2')
  })

  it('reads GitHub at most once a minute per pull request', async () => {
    const h = harness()
    await h.service.observed(h.seen())
    await h.service.observed(h.seen())
    await h.service.observed(h.seen())
    expect(h.reads()).toBe(1)
  })

  it('ignores strangers by default, the author and a closed pull request', async () => {
    const h = harness()
    await h.service.observed(h.seen())
    h.setComments([
      comment(2, { association: 'NONE' }),
      comment(3, { author: 'me', association: 'OWNER' })
    ])
    h.tick(PR_NUDGE_COMMENT_READ_MS)
    await h.service.observed(h.seen())
    await h.service.observed(h.seen({ state: 'merged' }))
    expect(h.sent).toHaveLength(0)
    const open = harness({ forkPrNudgeEnabled: true, forkPrNudgeCommenters: 'anyone' })
    await open.service.observed(open.seen())
    open.setComments([comment(2, { association: 'NONE' })])
    open.tick(PR_NUDGE_COMMENT_READ_MS)
    await open.service.observed(open.seen())
    expect(open.sent).toHaveLength(1)
  })

  it('does nothing with the setting off', async () => {
    const h = harness({})
    h.setComments([comment(2)])
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    expect(h.sent).toHaveLength(0)
    expect(h.reads()).toBe(0)
    expect(h.state().entries).toEqual({})
  })
})

describe('merge conflicts', () => {
  it('sends one update request per head and starts over once mergeable', async () => {
    const h = harness({ forkPrNudgeEnabled: true, forkPrNudgeReviews: false })
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    await h.service.observed(h.seen({ mergeable: 'UNKNOWN' }))
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]!.text).toContain(PR_NUDGE_CONFLICT_MARKER)
    expect(h.sent[0]!.text).toContain('Update request 1 of 3')
    expect(h.sent[0]!.text).toContain('Merge the base branch into this branch')
    expect(h.sent[0]!.text).not.toMatch(/force|rebase/iu)
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING', headSha: 'bbbbbbb1111' }))
    expect(h.sent).toHaveLength(2)
    await h.service.observed(h.seen({ mergeable: 'MERGEABLE', headSha: 'bbbbbbb1111' }))
    expect(h.state().entries[PR]!.conflictRounds).toBe(0)
  })

  it('asks for a rebase when the setting says rebase (BAD-783)', async () => {
    const h = harness({
      forkPrNudgeEnabled: true,
      forkPrNudgeReviews: false,
      forkPrNudgeConflictUpdate: 'rebase'
    })
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    expect(h.sent[0]!.text).toContain('Rebase this branch onto the base branch')
  })

  it('stops into the Decision inbox when the conflict outlives the requests', async () => {
    const h = harness({ forkPrNudgeEnabled: true, forkPrNudgeMaxAttempts: 2 })
    for (const head of ['1111111', '2222222', '3333333']) {
      await h.service.observed(h.seen({ mergeable: 'CONFLICTING', headSha: head }))
    }
    expect(h.sent).toHaveLength(2)
    expect(h.state().entries[PR]!.phase).toBe('stuck')
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0]).toMatchObject({ chatId: 'chat-1', source: 'nudge', prKey: PR })
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING', headSha: '4444444' }))
    expect(h.sent).toHaveLength(2)
  })
})

describe('attempt cap', () => {
  it('counts refused sends, waits between tries, then stops and asks you', async () => {
    const h = harness(
      { forkPrNudgeEnabled: true, forkPrNudgeReviews: false },
      { sendOutcome: 'refused' }
    )
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    expect(h.state().entries[PR]!.attempts['conflict:abcdef1234567']).toBe(1)
    for (let i = 0; i < 2; i += 1) {
      h.tick(PR_NUDGE_RETRY_MS)
      await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    }
    expect(h.state().entries[PR]!.phase).toBe('stuck')
    expect(h.state().entries[PR]!.reason).toBe('conflict-unsent')
    expect(h.notified).toHaveLength(1)
  })

  it('treats a chat that is not loaded as a failed send', async () => {
    const h = harness(
      { forkPrNudgeEnabled: true, forkPrNudgeReviews: false, forkPrNudgeMaxAttempts: 1 },
      { loaded: false }
    )
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    expect(h.sent).toHaveLength(0)
    expect(h.state().entries[PR]!.phase).toBe('stuck')
  })

  it('answer starts nudging again; Stop ends it', async () => {
    const h = harness({ forkPrNudgeEnabled: true, forkPrNudgeMaxAttempts: 1 }, { loaded: false })
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING' }))
    expect(await h.service.inboxItems()).toHaveLength(1)
    expect(await h.service.answer('chat-1', 'go on')).toBe('sent')
    expect(h.state().entries[PR]!.phase).toBe('ok')
    await h.service.observed(h.seen({ mergeable: 'CONFLICTING', headSha: '2222222' }))
    expect(await h.service.dismiss('chat-1')).toBe(true)
    expect(h.state().entries[PR]!.phase).toBe('stopped')
    expect(await h.service.inboxItems()).toHaveLength(0)
  })
})
