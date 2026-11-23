import { describe, expect, it } from 'vitest'
import {
  FORK_DIGEST_DEFAULT_WINDOW_MS,
  FORK_DIGEST_MAX_WINDOW_MS,
  forkDigestDue,
  forkDigestLedgerDays,
  forkDigestScheduledAt,
  forkDigestWindowStart,
  parseForkDigestSince,
  readForkDigestConfig,
  totalForkDigest,
  type ForkDigestHost,
  type ForkDigestSection
} from './digest'
import { formatForkDigestText, forkDigestPayload } from './digest-format'
import { parseForkDigest, parseForkDigestSection } from './digest-schema'

function local(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime()
}

const SECTION: ForkDigestSection = {
  tasks: [
    { id: 't1', title: 'Build card', status: 'completed', at: 10, result: 'done' },
    { id: 't2', title: 'Fix CI', status: 'failed', at: 11, result: null }
  ],
  pullRequests: [
    {
      repo: 'orca',
      number: 7,
      title: 'Digest',
      url: 'https://github.com/o/r/pull/7',
      state: 'merged',
      draft: false,
      at: 12
    },
    {
      repo: 'orca',
      number: 8,
      title: 'Next',
      url: 'https://github.com/o/r/pull/8',
      state: 'open',
      draft: true,
      at: 13
    }
  ],
  waiting: [
    {
      chatId: 'c1',
      title: 'Coordinator',
      workspace: 'w',
      question: 'Ship it?',
      verdict: 'waiting_user',
      since: 9
    },
    {
      chatId: 'chat:s1',
      title: 'Looper',
      workspace: '',
      question: 'Failure loop',
      verdict: 'guard',
      since: 8
    }
  ],
  cost: {
    days: 2,
    chats: 3,
    totalTokens: 1000,
    costUsd: 1.5,
    subscriptionTokens: 0,
    unpricedTokens: 0
  },
  notes: []
}

describe('readForkDigestConfig', () => {
  it('is off with defaults when nothing is set', () => {
    expect(readForkDigestConfig({})).toEqual({
      enabled: false,
      hour: 8,
      pullRequests: true,
      desktop: false,
      webhookUrl: null,
      command: null
    })
  })

  it('follows the inbox targets until set, and refuses a bad address or hour', () => {
    const config = readForkDigestConfig({
      forkDigest: true,
      forkDigestHour: 25,
      forkInboxNotifyDesktop: true,
      forkInboxNotifyWebhookUrl: 'https://hooks.example/x',
      forkInboxNotifyCommand: '  notify  '
    })
    expect(config).toMatchObject({
      enabled: true,
      hour: 8,
      desktop: true,
      webhookUrl: 'https://hooks.example/x',
      command: 'notify'
    })
    const off = readForkDigestConfig({
      forkDigestDesktop: false,
      forkDigestWebhook: false,
      forkDigestCommand: false,
      forkInboxNotifyDesktop: true,
      forkInboxNotifyWebhookUrl: 'https://user:pw@hooks.example/x',
      forkInboxNotifyCommand: 'notify'
    })
    expect(off).toMatchObject({ desktop: false, webhookUrl: null, command: null })
    expect(readForkDigestConfig({ forkInboxNotifyWebhookUrl: 'file:///x' }).webhookUrl).toBeNull()
  })
})

describe('the daily schedule', () => {
  it('is due once today after the hour', () => {
    const before = local(2026, 11, 18, 7, 59)
    const after = local(2026, 11, 18, 8, 1)
    expect(forkDigestScheduledAt(after, 8)).toBe(local(2026, 11, 18, 8))
    expect(forkDigestDue(before, 8, null)).toBe(false)
    expect(forkDigestDue(after, 8, null)).toBe(true)
    expect(forkDigestDue(after, 8, local(2026, 11, 17, 8, 1))).toBe(true)
    expect(forkDigestDue(after, 8, local(2026, 11, 18, 8, 0))).toBe(false)
  })

  it('starts the window at the caller, the last digest or a day ago, at most 90 days back', () => {
    const now = local(2026, 11, 18, 9)
    expect(forkDigestWindowStart(now, undefined, null)).toBe(now - FORK_DIGEST_DEFAULT_WINDOW_MS)
    expect(forkDigestWindowStart(now, undefined, now - 5000)).toBe(now - 5000)
    expect(forkDigestWindowStart(now, now - 10, now - 5000)).toBe(now - 10)
    expect(forkDigestWindowStart(now, 0, null)).toBe(now - FORK_DIGEST_MAX_WINDOW_MS)
    expect(forkDigestWindowStart(now, now + 1000, null)).toBe(now)
  })

  it('counts the ledger days the window touches', () => {
    expect(forkDigestLedgerDays(local(2026, 11, 18, 1), local(2026, 11, 18, 9))).toBe(1)
    expect(forkDigestLedgerDays(local(2026, 11, 17, 23), local(2026, 11, 18, 9))).toBe(2)
    expect(forkDigestLedgerDays(local(2026, 11, 11, 9), local(2026, 11, 18, 9))).toBe(8)
  })
})

describe('parseForkDigestSince', () => {
  const now = local(2026, 11, 18, 9)
  it('reads durations and past dates', () => {
    expect(parseForkDigestSince('12h', now)).toBe(now - 12 * 3_600_000)
    expect(parseForkDigestSince('90m', now)).toBe(now - 90 * 60_000)
    expect(parseForkDigestSince('2d', now)).toBe(now - 2 * 86_400_000)
    expect(parseForkDigestSince('1w', now)).toBe(now - 7 * 86_400_000)
    expect(parseForkDigestSince('2026-11-17T07:00', now)).toBe(local(2026, 11, 17, 7))
  })

  it('refuses anything else', () => {
    expect(parseForkDigestSince('yesterday', now)).toBeNull()
    expect(parseForkDigestSince('12', now)).toBeNull()
    expect(parseForkDigestSince('2027-01-01', now)).toBeNull()
  })
})

describe('totals, text and payload', () => {
  const hosts: ForkDigestHost[] = [
    { hostKey: 'local', name: 'This machine', status: 'ok', section: SECTION },
    { hostKey: 'runtime:a', name: 'alpha', status: 'ok', section: { ...SECTION, cost: null } },
    { hostKey: 'runtime:b', name: 'old', status: 'no-digest', section: null }
  ]

  it('adds up every host and counts a pull request once', () => {
    expect(totalForkDigest(hosts)).toEqual({
      finished: 2,
      failed: 2,
      merged: 1,
      open: 1,
      waiting: 4,
      costUsd: 1.5,
      totalTokens: 1000
    })
  })

  it('formats ASCII text and a payload a webhook can read', () => {
    const digest = {
      since: Date.UTC(2026, 10, 17, 8),
      until: Date.UTC(2026, 10, 18, 8),
      hosts,
      serversDown: [{ name: 'bravo', downSince: Date.UTC(2026, 10, 18, 2) }],
      totals: totalForkDigest(hosts)
    }
    const text = formatForkDigestText(digest)
    expect(text).toContain('Digest 2026-11-17 08:00 to 2026-11-18 08:00 (UTC)')
    expect(text).toContain('2 finished, 2 failed, 1 merged, 1 open, 4 waiting on you, $1.50 est.')
    expect(text).toContain('Not answering: bravo since 2026-11-18 02:00')
    expect(text).toContain('Waiting on you (2)')
    expect(text).toContain('[guard] Looper: Failure loop')
    expect(text).toContain('== old (no digest here')
    expect(/^[\n -~]*$/.test(text)).toBe(true)
    const payload = JSON.parse(forkDigestPayload(digest))
    expect(payload.event).toBe('digest')
    expect(payload.totals.merged).toBe(1)
    expect(parseForkDigest(digest)).toEqual(digest)
  })
})

describe('digest schemas', () => {
  it('keeps the good rows of a section and drops the bad ones', () => {
    const parsed = parseForkDigestSection({
      ...SECTION,
      pullRequests: [
        ...SECTION.pullRequests,
        { ...SECTION.pullRequests[0], url: 'javascript:alert(1)' },
        'junk'
      ],
      tasks: [{ id: 1 }, SECTION.tasks[0]],
      cost: { days: 0 }
    })
    expect(parsed?.pullRequests).toHaveLength(2)
    expect(parsed?.tasks).toHaveLength(1)
    expect(parsed?.cost).toBeNull()
  })

  it('refuses a reply that is no section', () => {
    expect(parseForkDigestSection('nope')).toBeNull()
    expect(parseForkDigestSection(null)).toBeNull()
  })
})
