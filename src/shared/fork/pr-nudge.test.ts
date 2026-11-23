// PR nudges (BAD-680): the pure rules.
import { describe, expect, it } from 'vitest'
import {
  newPrNudgeEntry,
  prNudgeAllowedComments,
  prNudgeCommentKey,
  prNudgeConflictDue,
  prNudgeConflictKey,
  prNudgeNewComments,
  readPrNudgeSettings,
  type PrNudgeComment
} from './pr-nudge'

const comment = (over: Partial<PrNudgeComment> = {}): PrNudgeComment => ({
  kind: 'review-comment',
  id: 1,
  author: 'rev',
  association: 'COLLABORATOR',
  path: 'src/a.ts',
  line: 4,
  body: 'rename this',
  url: 'https://github.com/acme/api/pull/12#discussion_r1',
  replyTo: null,
  ...over
})

describe('readPrNudgeSettings', () => {
  it('ships off, with collaborators only and 3 attempts', () => {
    expect(readPrNudgeSettings(undefined)).toEqual({
      enabled: false,
      reviews: true,
      conflicts: true,
      commenters: 'collaborators',
      conflictUpdate: 'merge',
      maxAttempts: 3
    })
  })

  it('keeps valid values and drops the rest', () => {
    expect(
      readPrNudgeSettings({
        forkPrNudgeEnabled: true,
        forkPrNudgeReviews: false,
        forkPrNudgeCommenters: 'anyone',
        forkPrNudgeMaxAttempts: 11
      })
    ).toEqual({
      enabled: true,
      reviews: false,
      conflicts: true,
      commenters: 'anyone',
      conflictUpdate: 'merge',
      maxAttempts: 3
    })
    expect(readPrNudgeSettings({ forkPrNudgeEnabled: 'yes' }).enabled).toBe(false)
  })
})

describe('dedupe keys', () => {
  it('key a comment by kind and id, a conflict by lower-case head', () => {
    expect(prNudgeCommentKey(comment({ id: 7 }))).toBe('review-comment:7')
    expect(prNudgeCommentKey(comment({ kind: 'conversation', id: 7 }))).toBe('conversation:7')
    expect(prNudgeConflictKey('ABCdef1')).toBe('conflict:abcdef1')
  })

  it('send each comment and each conflicted head once', () => {
    const entry = { ...newPrNudgeEntry('github.com/acme/api#12', 0), seen: ['review-comment:1'] }
    expect(
      prNudgeNewComments(entry, [comment({ id: 1 }), comment({ id: 2 })]).map((c) => c.id)
    ).toEqual([2])
    expect(prNudgeConflictDue({ conflictHeads: ['conflict:abc1234'] }, 'ABC1234')).toBe(false)
    expect(prNudgeConflictDue({ conflictHeads: ['conflict:abc1234'] }, 'def5678')).toBe(true)
  })
})

describe('prNudgeAllowedComments', () => {
  it('keeps collaborators by default and drops strangers, the author and empty text', () => {
    const all = [
      comment({ id: 1, association: 'OWNER' }),
      comment({ id: 2, association: 'NONE' }),
      comment({ id: 3, association: 'CONTRIBUTOR' }),
      comment({ id: 4, author: 'Me', association: 'OWNER' }),
      comment({ id: 5, body: '   ' }),
      comment({ id: 6, association: 'member' })
    ]
    expect(prNudgeAllowedComments(all, 'me', 'collaborators').map((c) => c.id)).toEqual([1, 6])
    expect(prNudgeAllowedComments(all, 'me', 'anyone').map((c) => c.id)).toEqual([1, 2, 3, 6])
  })
})
