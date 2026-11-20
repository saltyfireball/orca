import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forkBotAsksNotifyPayload,
  type ForkBotAskNotice
} from '../../../shared/fork/inbox-bot-asks'
import type { ForkNotifyMessage } from '../idle-recovery/idle-recovery-notify'
import {
  createForkBotAsksNotifier,
  emptyForkBotAsksState,
  forkBotAsksToTell,
  loadForkBotAsksState,
  saveForkBotAsksState,
  type ForkBotAsksSettingsSource,
  type ForkBotAsksState
} from './bot-asks-notify'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

function notice(key: string, fields: Partial<ForkBotAskNotice> = {}): ForkBotAskNotice {
  return { key, bot: 'Dotfiles', title: `Item ${key}`, question: `Question ${key}?`, ...fields }
}

function harness(settings: ForkBotAsksSettingsSource = {}) {
  let saved: ForkBotAsksState = emptyForkBotAsksState()
  let now = 10 * DAY
  const sent: ForkNotifyMessage[] = []
  const pushed: { id: string; title: string; body: string }[] = []
  const saves = vi.fn()
  const notifier = createForkBotAsksNotifier({
    now: () => now,
    loadState: async () => saved,
    saveState: async (state) => {
      saves(state)
      saved = state
    },
    settings: () => settings,
    sendTargets: async (message) => {
      sent.push(message)
    },
    phone: () => (entry) => pushed.push(entry)
  })
  return {
    notifier,
    sent,
    pushed,
    saves,
    advance: (ms: number) => {
      now += ms
    },
    saved: () => saved
  }
}

describe('forkBotAsksToTell', () => {
  it('tells only asks not seen, once each, and marks every reported ask', () => {
    const first = forkBotAsksToTell(emptyForkBotAsksState(), [notice('a'), notice('a')], 1000)
    expect(first.fresh.map((ask) => ask.key)).toEqual(['a'])
    expect(first.changed).toBe(true)
    const again = forkBotAsksToTell(first.next, [notice('a'), notice('b')], 2000)
    expect(again.fresh.map((ask) => ask.key)).toEqual(['b'])
  })

  it('writes nothing for asks marked within the hour, and forgets asks unseen for a week', () => {
    const first = forkBotAsksToTell(emptyForkBotAsksState(), [notice('a')], 0)
    expect(forkBotAsksToTell(first.next, [notice('a')], HOUR - 1).changed).toBe(false)
    expect(forkBotAsksToTell(first.next, [notice('a')], HOUR).changed).toBe(true)
    const late = forkBotAsksToTell(first.next, [], 7 * DAY)
    expect(late.next.seen).toEqual({})
    expect(late.changed).toBe(true)
  })
})

describe('createForkBotAsksNotifier', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const targets: ForkBotAsksSettingsSource = {
    forkInboxNotifyDesktop: true,
    forkInboxNotifyWebhookUrl: 'https://example.test/hook',
    forkInboxNotifyCommand: 'cat'
  }

  it('tells the targets of a new ask once, with the chat-waiting payload shape', async () => {
    const h = harness(targets)
    expect(await h.notifier.report({ asks: [notice('a')] })).toEqual({ notified: 1 })
    expect(await h.notifier.report({ asks: [notice('a')] })).toEqual({ notified: 0 })
    expect(h.sent).toHaveLength(1)
    const [message] = h.sent
    expect(message!.desktop).toEqual({
      title: 'Dotfiles is waiting on you',
      body: 'Question a?'
    })
    expect(message!.webhookUrl).toBe('https://example.test/hook')
    expect(message!.command).toBe('cat')
    expect(JSON.parse(message!.payload())).toEqual({
      count: 1,
      items: [{ id: 'a', title: 'Dotfiles: Item a', kind: 'bot-ask', question: 'Question a?' }]
    })
  })

  it('tells a new ask once when two windows report it at the same time', async () => {
    const h = harness(targets)
    const [one, two] = await Promise.all([
      h.notifier.report({ asks: [notice('a')] }),
      h.notifier.report({ asks: [notice('a')] })
    ])
    expect(one.notified + two.notified).toBe(1)
    expect(h.sent).toHaveLength(1)
  })

  it('tells a new question on an item already listed', async () => {
    const h = harness(targets)
    await h.notifier.report({ asks: [notice('host|bot|uid|e1')] })
    await h.notifier.report({ asks: [notice('host|bot|uid|e1'), notice('host|bot|uid|e9')] })
    expect(h.sent).toHaveLength(2)
    expect(JSON.parse(h.sent[1]!.payload()).items[0].id).toBe('host|bot|uid|e9')
  })

  it('leaves the desktop banner off for an ask on screen, but still runs the other targets', async () => {
    const h = harness(targets)
    await h.notifier.report({ asks: [notice('a', { onScreen: true })] })
    expect(h.sent[0]!.desktop).toBeNull()
    expect(h.sent[0]!.webhookUrl).toBe('https://example.test/hook')
  })

  it('sends no desktop banner while the desktop target is off', async () => {
    const h = harness({})
    await h.notifier.report({ asks: [notice('a')] })
    expect(h.sent[0]!.desktop).toBeNull()
    expect(h.sent[0]!.webhookUrl).toBeNull()
  })

  it('pushes each new ask to the phone unless the phone or notifications are off', async () => {
    const on = harness({})
    await on.notifier.report({ asks: [notice('a'), notice('b')] })
    expect(on.pushed.map((entry) => entry.title)).toEqual(['Dotfiles: Item a', 'Dotfiles: Item b'])
    expect(on.pushed[0]).toMatchObject({ body: 'Question a?', desktop: false })
    expect(new Set(on.pushed.map((entry) => entry.id)).size).toBe(2)

    const phoneOff = harness({ forkInboxBotAsksPhone: false })
    await phoneOff.notifier.report({ asks: [notice('a')] })
    expect(phoneOff.pushed).toEqual([])

    const muted = harness({ notifications: { enabled: false } })
    await muted.notifier.report({ asks: [notice('a')] })
    expect(muted.pushed).toEqual([])
  })

  it('does nothing while bot asks are off', async () => {
    const h = harness({ ...targets, forkInboxBotAsks: false })
    expect(await h.notifier.report({ asks: [notice('a')] })).toEqual({ notified: 0 })
    expect(h.sent).toEqual([])
    expect(h.pushed).toEqual([])
    expect(h.saves).not.toHaveBeenCalled()
  })

  it('saves only when a mark is new or an hour old', async () => {
    const h = harness({})
    await h.notifier.report({ asks: [notice('a')] })
    await h.notifier.report({ asks: [notice('a')] })
    expect(h.saves).toHaveBeenCalledTimes(1)
    h.advance(HOUR)
    await h.notifier.report({ asks: [notice('a')] })
    expect(h.saves).toHaveBeenCalledTimes(2)
  })

  it('sums several new asks into one banner', async () => {
    const h = harness(targets)
    await h.notifier.report({ asks: [notice('a'), notice('b'), notice('c'), notice('d')] })
    expect(h.sent[0]!.desktop).toEqual({
      title: '4 bot asks are waiting on you',
      body: 'Dotfiles: Item a, Dotfiles: Item b, Dotfiles: Item c, and 1 more'
    })
  })
})

describe('the state file', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('round-trips, is private, and reads a damaged file as empty', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fork-bot-asks-'))
    const path = join(dir, 'fork-bot-asks.json')
    await saveForkBotAsksState({ version: 1, seen: { a: 5 } }, path)
    expect(await loadForkBotAsksState(path)).toEqual({ version: 1, seen: { a: 5 } })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, seen: { a: 5 } })
    await saveForkBotAsksState({ version: 1, seen: { a: 'x' as unknown as number } }, path)
    expect(await loadForkBotAsksState(path)).toEqual({ version: 1, seen: {} })
    expect(await loadForkBotAsksState(join(dir, 'missing.json'))).toEqual(emptyForkBotAsksState())
  })
})

describe('forkBotAsksNotifyPayload', () => {
  it('clips long fields', () => {
    const payload = JSON.parse(
      forkBotAsksNotifyPayload([notice('a', { question: 'q'.repeat(900) })])
    )
    expect(payload.items[0].question).toHaveLength(500)
  })
})
