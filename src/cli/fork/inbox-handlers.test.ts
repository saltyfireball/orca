// Idle recovery (FORK.md): `orca inbox` against a fake client; no app is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type {
  ForkIdleRecoveryInboxItem,
  ForkIdleRecoveryInboxResult
} from '../../shared/fork/idle-recovery-wire'
import { formatInboxAnswer, formatInboxList, formatInboxPause } from './inbox-format'
import { FORK_INBOX_HANDLERS, pickInboxItem } from './inbox-handlers'

const NOW = 100 * 60_000

function item(over: Partial<ForkIdleRecoveryInboxItem> & { chatId: string }) {
  const base: ForkIdleRecoveryInboxItem = {
    chatId: over.chatId,
    kind: 'chat',
    agent: 'claude',
    title: 'Plan the release',
    workspace: 'alpha',
    worktreeId: null,
    verdict: 'waiting_user',
    question: 'Use the second option?',
    reason: 'asked a question',
    since: NOW - 12 * 60_000,
    wakes: 0,
    wakeAt: null,
    paused: false
  }
  return { ...base, ...over }
}

function inbox(
  items: ForkIdleRecoveryInboxItem[],
  mode: ForkIdleRecoveryInboxResult['mode'] = 'inbox'
): ForkIdleRecoveryInboxResult {
  return { now: NOW, mode, items }
}

type Call = { method: string; params: unknown }
let calls: Call[] = []
let printed: string[] = []

async function run(
  key: string,
  flags: Record<string, string | boolean>,
  list: ForkIdleRecoveryInboxResult,
  second: unknown = {},
  json = false
): Promise<string> {
  calls = []
  printed = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    printed.push(line)
  })
  const ctx = {
    flags: new Map(Object.entries(flags)),
    json,
    cwd: '/tmp',
    client: {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params })
        const result = method === 'fork.idleRecovery.inbox' ? list : second
        return { id: '1', ok: true, result, _meta: { runtimeId: 't' } }
      }
    }
  } as unknown as HandlerContext
  await FORK_INBOX_HANDLERS[key](ctx)
  return printed.join('\n')
}

afterEach(() => vi.restoreAllMocks())

describe('pickInboxItem', () => {
  const items = [item({ chatId: 'abc-1' }), item({ chatId: 'abd-2', title: 'Other' })]

  it('finds an exact id or a unique prefix', () => {
    expect(pickInboxItem(items, 'abd').chatId).toBe('abd-2')
    expect(pickInboxItem(items, 'abc-1').chatId).toBe('abc-1')
  })

  it('lists the matches of an ambiguous prefix', () => {
    expect(() => pickInboxItem(items, 'ab')).toThrow(/matches 2 chats[\s\S]*abc-1[\s\S]*abd-2/)
  })

  it('rejects an unknown prefix', () => {
    expect(() => pickInboxItem(items, 'zz')).toThrow(/No chat in the inbox with id "zz"/)
  })

  it('prefers an exact id over a longer one that starts with it', () => {
    const both = [item({ chatId: 'tab-1' }), item({ chatId: 'tab-10' })]
    expect(pickInboxItem(both, 'tab-1').chatId).toBe('tab-1')
  })
})

describe('formatInboxList', () => {
  it('says plainly when the mode is off and how to turn it on', () => {
    const text = formatInboxList(inbox([], 'off'))
    expect(text).toMatch(/is off/)
    expect(text).toMatch(/orca settings set forkIdleSweepMode inbox/)
  })

  it('says when nothing waits', () => {
    expect(formatInboxList(inbox([]))).toBe('No chats are waiting on you.')
  })

  it('prints short id, kind, age and title, then the question on its own line', () => {
    const text = formatInboxList(
      inbox([
        item({ chatId: '3f2a1b9c-0000-1111' }),
        item({
          chatId: 'tab-1:leaf-2',
          kind: 'terminal',
          verdict: 'stalled',
          title: 'Build',
          question: '',
          reason: 'said it would run tests',
          paused: true
        })
      ])
    )
    const lines = text.split('\n')
    expect(lines[0]).toBe('1 chat, 1 paused (ID, kind, age, title):')
    expect(lines[1]).toBe('3f2a1b9c  waiting  12m  Plan the release  [alpha]')
    expect(lines[2]).toBe('    Use the second option?')
    expect(lines[3]).toBe('tab-1:leaf-2  stalled  12m  Build  [alpha]  (paused)')
    expect(lines[4]).toBe('    said it would run tests')
  })

  it('lists paused chats last and leaves them out of the count', () => {
    const lines = formatInboxList(
      inbox([
        item({ chatId: 'paused-1', paused: true }),
        item({ chatId: 'live-1111', title: 'Live' }),
        item({ chatId: 'live-2222', title: 'Also live' })
      ])
    ).split('\n')
    expect(lines[0]).toBe('2 chats, 1 paused (ID, kind, age, title):')
    expect(lines[1]).toMatch(/^live-111 /)
    expect(lines[5]).toMatch(/^paused-1 .*\(paused\)$/)
    expect(formatInboxList(inbox([item({ chatId: 'p', paused: true })])).split('\n')[0]).toBe(
      '0 chats, 1 paused (ID, kind, age, title):'
    )
  })
})

describe('formatInboxAnswer and formatInboxPause', () => {
  it('explain each outcome', () => {
    expect(formatInboxAnswer({ chatId: 'a', result: 'sent' })).toBe('a: answer sent')
    expect(formatInboxAnswer({ chatId: 'a', result: 'not-waiting' })).toMatch(/not waiting/)
    expect(formatInboxAnswer({ chatId: 'a', result: 'not-found' })).toMatch(/no such chat/)
    expect(formatInboxAnswer({ chatId: 'a', result: 'unavailable' })).toMatch(
      /cannot take a message right now/
    )
    const base = { chatId: 'a', pausedCount: 1 }
    expect(formatInboxPause({ ...base, paused: true, saved: true })).toBe('a: paused')
    expect(formatInboxPause({ ...base, paused: false, saved: true })).toBe('a: resumed')
    expect(formatInboxPause({ ...base, paused: true, saved: false })).toMatch(/not saved/)
  })
})

describe('inbox handlers', () => {
  const list = inbox([item({ chatId: 'aaaa-1111' }), item({ chatId: 'bbbb-2222' })])

  it('list prints the table, and the raw result with --json', async () => {
    expect(await run('inbox list', {}, list)).toMatch(/^2 chats/)
    const json = JSON.parse(await run('inbox list', {}, list, {}, true))
    expect(json.result.items).toHaveLength(2)
  })

  it('answer resolves a prefix to the full id and sends the text unchanged', async () => {
    const out = await run('inbox answer', { id: 'bb', text: ' Yes, B ' }, list, {
      chatId: 'bbbb-2222',
      result: 'sent'
    })
    expect(calls[1]).toEqual({
      method: 'fork.idleRecovery.answer',
      params: { chatId: 'bbbb-2222', text: ' Yes, B ' }
    })
    expect(out).toBe('bbbb-2222: answer sent')
  })

  it('answer sends nothing for an unknown or ambiguous prefix', async () => {
    await expect(run('inbox answer', { id: 'zz', text: 'x' }, list)).rejects.toThrow(/No chat/)
    await expect(
      run(
        'inbox answer',
        { id: 'a', text: 'x' },
        inbox([item({ chatId: 'a1' }), item({ chatId: 'a2' })])
      )
    ).rejects.toThrow(/matches 2 chats/)
    expect(calls.map((c) => c.method)).toEqual(['fork.idleRecovery.inbox'])
  })

  it('answer without an id or text is a usage error', async () => {
    await expect(run('inbox answer', { text: 'x' }, list)).rejects.toThrow(/Name a chat/)
    await expect(run('inbox answer', { id: 'aaaa' }, list)).rejects.toThrow(/Give the answer/)
    expect(calls).toEqual([])
  })

  it('answer and pause explain an off mode instead of a missing chat', async () => {
    await expect(run('inbox answer', { id: 'a', text: 'x' }, inbox([], 'off'))).rejects.toThrow(
      /forkIdleSweepMode/
    )
    await expect(run('inbox pause', { id: 'a' }, inbox([], 'off'))).rejects.toThrow(/is off/)
  })

  it('pause and --resume send the flag the user asked for', async () => {
    await run('inbox pause', { id: 'aa' }, list, {
      chatId: 'aaaa-1111',
      paused: true,
      pausedCount: 1,
      saved: true
    })
    expect(calls[1].params).toEqual({ chatId: 'aaaa-1111', paused: true })
    const out = await run('inbox pause', { id: 'aa', resume: true }, list, {
      chatId: 'aaaa-1111',
      paused: false,
      pausedCount: 0,
      saved: true
    })
    expect(calls[1].params).toEqual({ chatId: 'aaaa-1111', paused: false })
    expect(out).toBe('aaaa-1111: resumed')
  })

  it('an older host without the methods gets an update hint', async () => {
    const ctx = {
      flags: new Map(),
      json: false,
      cwd: '/tmp',
      client: {
        call: async () => {
          throw new RuntimeClientError('method_not_found', 'nope')
        }
      }
    } as unknown as HandlerContext
    await expect(FORK_INBOX_HANDLERS['inbox list'](ctx)).rejects.toThrow(/Update the desktop app/)
  })
})
