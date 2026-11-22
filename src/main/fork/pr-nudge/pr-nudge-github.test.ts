// PR nudges (BAD-680): GitHub's payloads, hardcoded, into comments; the gh calls are argv only.
import { describe, expect, it } from 'vitest'
import type { PRWatchWorkspace } from '../../github/pr-watch/pr-watch-types'
import {
  parsePrNudgeAuthor,
  parsePrNudgeConversation,
  parsePrNudgeReviewComments,
  parsePrNudgeReviews,
  prNudgeGitHub
} from './pr-nudge-github'

const REVIEW_PAGES = JSON.stringify([
  [
    {
      id: 11,
      user: { login: 'rev' },
      author_association: 'MEMBER',
      path: 'src/a.ts',
      line: null,
      original_line: 9,
      body: 'use a map here',
      html_url: 'https://github.com/acme/api/pull/12#discussion_r11',
      in_reply_to_id: null
    }
  ],
  [{ id: 12, user: { login: 'rev' }, body: 'and here', in_reply_to_id: 11 }, { nope: true }]
])

describe('payload parsers', () => {
  it('read review comments across pages, with file and line', () => {
    const rows = parsePrNudgeReviewComments(REVIEW_PAGES)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'review-comment',
      id: 11,
      author: 'rev',
      association: 'MEMBER',
      path: 'src/a.ts',
      line: 9,
      replyTo: null
    })
    expect(rows[1]).toMatchObject({ id: 12, replyTo: 11, association: '' })
  })

  it('read conversation comments and drop pending reviews', () => {
    expect(
      parsePrNudgeConversation(JSON.stringify([[{ id: 5, user: { login: 'x' }, body: 'hi' }]]))
    ).toMatchObject([{ kind: 'conversation', id: 5, path: null, line: null }])
    const reviews = parsePrNudgeReviews(
      JSON.stringify([
        [
          { id: 1, state: 'PENDING', body: 'draft' },
          { id: 2, state: 'CHANGES_REQUESTED', body: 'fix', user: { login: 'r' } }
        ]
      ])
    )
    expect(reviews.map((r) => r.id)).toEqual([2])
  })

  it('survive junk', () => {
    expect(parsePrNudgeReviewComments('not json')).toEqual([])
    expect(parsePrNudgeReviewComments('{"id":1}')).toEqual([])
    expect(parsePrNudgeAuthor('{"user":{"login":"me"}}')).toBe('me')
    expect(parsePrNudgeAuthor('[]')).toBeNull()
  })
})

describe('prNudgeGitHub', () => {
  const ws: PRWatchWorkspace = {
    repoId: 'r',
    repoPath: '/w',
    checkoutPath: '/w',
    repoKind: 'git',
    branch: 'f',
    connectionId: null
  }

  it('reads with gh api only, naming the host for an enterprise server', async () => {
    const calls: string[][] = []
    const github = prNudgeGitHub(async (_ws, _pr, args) => {
      calls.push(args)
      return args.some((arg) => arg.endsWith('/comments?per_page=100') && arg.includes('pulls'))
        ? REVIEW_PAGES
        : args.at(-1)!.endsWith('pulls/12')
          ? '{"user":{"login":"me"}}'
          : '[]'
    })
    const read = await github.read(ws, {
      host: 'ghe.example.com',
      owner: 'acme',
      repo: 'api',
      number: 12
    })
    expect(read?.author).toBe('me')
    expect(read?.comments.map((c) => c.id)).toEqual([11, 12])
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(call.slice(0, 3)).toEqual(['api', '--hostname', 'ghe.example.com'])
      expect(call).not.toContain('--method')
    }
  })
})
