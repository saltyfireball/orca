import { describe, expect, it } from 'vitest'
import {
  CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS,
  chatHandoffLimitKey,
  chatHandoffLimitTarget,
  chatHandoffRoom,
  chatHandoffTokens,
  otherChatHandoffAgent,
  readChatHandoffSettings
} from './chat-handoff'
import {
  CHAT_HANDOFF_DEFAULT_REQUEST,
  CHAT_HANDOFF_MARKER,
  buildChatHandoffMessage,
  compactChatHandoffText,
  isChatHandoffMessage,
  selectChatHandoffHistory,
  type ChatHandoffEntry
} from './chat-handoff-select'
import type { LimitResumeEntry } from './limit-resume'

const SOURCE = 'chat-source-0001'

function entry(seq: number, role: ChatHandoffEntry['role'], text: string): ChatHandoffEntry {
  return { seq, role, text }
}

/** A conversation of `turns` request and answer pairs, each answer `size` characters. */
function conversation(turns: number, size: number): ChatHandoffEntry[] {
  const entries: ChatHandoffEntry[] = []
  for (let turn = 0; turn < turns; turn += 1) {
    entries.push(entry(turn * 10 + 1, 'user', `request ${turn}`))
    entries.push(entry(turn * 10 + 2, 'activity', `Bash ls -la -> exit 0`))
    entries.push(entry(turn * 10 + 3, 'assistant', `answer ${turn} ${'x'.repeat(size)}`))
  }
  return entries
}

describe('chat handoff settings', () => {
  it('defaults to on, 16000 tokens, hand back on, offer on a limit', () => {
    expect(readChatHandoffSettings(null)).toEqual({
      enabled: true,
      budgetTokens: CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS,
      reuse: true,
      onLimit: 'offer'
    })
  })

  it('clamps the budget and ignores values it does not know', () => {
    expect(readChatHandoffSettings({ forkChatHandoffBudgetTokens: 10 }).budgetTokens).toBe(1024)
    expect(readChatHandoffSettings({ forkChatHandoffBudgetTokens: 1e9 }).budgetTokens).toBe(64000)
    expect(readChatHandoffSettings({ forkChatHandoffBudgetTokens: 'big' }).budgetTokens).toBe(
      CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS
    )
    expect(readChatHandoffSettings({ forkChatHandoffOnLimit: 'always' }).onLimit).toBe('offer')
    expect(readChatHandoffSettings({ forkChatHandoffOnLimit: 'auto' }).onLimit).toBe('auto')
    expect(readChatHandoffSettings({ forkChatHandoff: false }).enabled).toBe(false)
  })

  it('knows the other agent only for Claude and Codex', () => {
    expect(otherChatHandoffAgent('claude')).toBe('codex')
    expect(otherChatHandoffAgent('codex')).toBe('claude')
    expect(otherChatHandoffAgent('gemini')).toBeNull()
  })

  it('charges one token per UTF-8 byte', () => {
    expect(chatHandoffTokens('abc')).toBe(3)
    expect(chatHandoffTokens('é')).toBe(2)
  })

  it('leaves the reserve free, assuming 128k when no window is known', () => {
    expect(chatHandoffRoom({ windowTokens: null, usedTokens: 0, estimatedUsed: 0 })).toBe(96_000)
    expect(chatHandoffRoom({ windowTokens: 200_000, usedTokens: 100_000, estimatedUsed: 0 })).toBe(
      50_000
    )
    expect(chatHandoffRoom({ windowTokens: 64_000, usedTokens: null, estimatedUsed: 60_000 })).toBe(
      0
    )
  })
})

describe('selectChatHandoffHistory', () => {
  it('carries a short chat whole and points at nothing older', () => {
    const entries = conversation(3, 10)
    const selection = selectChatHandoffHistory(entries, 16_000, {
      sourceId: SOURCE,
      complete: true
    })
    expect(selection.count).toBe(entries.length)
    expect(selection.omittedBefore).toBeNull()
    expect(selection.text.split('\n')[0]).toBe('[#1 user] request 0')
    expect(selection.tokens).toBeLessThanOrEqual(16_000)
  })

  it('keeps the original request and the newest entries within the budget', () => {
    const entries = conversation(40, 400)
    const selection = selectChatHandoffHistory(entries, 4_000, {
      sourceId: SOURCE,
      complete: true
    })
    const lines = selection.text.split('\n')
    expect(lines[0]).toBe('[#1 user] request 0')
    expect(lines[1]).toBe('[... older entries left out ...]')
    expect(lines.at(-1)).toMatch(/^\[#393 assistant\] answer 39 x+$/)
    expect(selection.tokens).toBeLessThanOrEqual(4_000)
    expect(selection.omittedBefore).not.toBeNull()
    expect(selection.cut).toBe(false)
  })

  it('keeps each kept message whole and in order', () => {
    const entries = conversation(40, 400)
    const selection = selectChatHandoffHistory(entries, 4_000, {
      sourceId: SOURCE,
      complete: true
    })
    const seqs = [...selection.text.matchAll(/^\[#(\d+) /gm)].map((match) => Number(match[1]))
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    for (const line of selection.text.split('\n').filter((l) => l.includes('assistant]'))) {
      expect(line.length).toBeGreaterThan(400)
    }
  })

  it('cuts a newest entry bigger than the budget and says how to read it whole', () => {
    const entries = [entry(5, 'user', 'go'), entry(6, 'assistant', 'y'.repeat(10_000))]
    const selection = selectChatHandoffHistory(entries, 2_000, {
      sourceId: SOURCE,
      complete: true
    })
    expect(selection.cut).toBe(true)
    expect(selection.text).toContain(`orca chat history ${SOURCE} --before 7 --limit 1`)
    expect(selection.tokens).toBeLessThanOrEqual(2_000)
  })

  it('points at older history it did not read when the rows are not complete', () => {
    const entries = conversation(2, 10)
    const selection = selectChatHandoffHistory(entries, 16_000, {
      sourceId: SOURCE,
      complete: false
    })
    expect(selection.omittedBefore).toBe(1)
  })

  it('shows an earlier handoff message as one line', () => {
    const long = `${CHAT_HANDOFF_MARKER} ${'z '.repeat(500)}`
    const selection = selectChatHandoffHistory([entry(3, 'handoff', long)], 16_000, {
      sourceId: SOURCE,
      complete: true
    })
    expect(selection.text.length).toBeLessThan(320)
  })
})

describe('buildChatHandoffMessage', () => {
  const selection = selectChatHandoffHistory(conversation(40, 400), 4_000, {
    sourceId: SOURCE,
    complete: true
  })

  it('names the source, how to read more, the history and the request', () => {
    const message = buildChatHandoffMessage({
      mode: 'new',
      source: { id: SOURCE, name: 'Fix the login', agent: 'claude' },
      selection,
      request: 'Finish the tests'
    })
    expect(isChatHandoffMessage(message)).toBe(true)
    expect(message).toContain(`"Fix the login" (Orca chat ${SOURCE}), which ran on Claude`)
    expect(message).toContain(`orca chat history ${SOURCE} --before ${selection.omittedBefore}`)
    expect(message).toContain(selection.text)
    expect(message.endsWith('Finish the tests')).toBe(true)
  })

  it('asks the agent to carry on when no request is given, and never cuts a request', () => {
    const request = 'r'.repeat(15_000)
    expect(
      buildChatHandoffMessage({
        mode: 'continue',
        source: { id: SOURCE, name: 'x', agent: 'codex' },
        selection
      }).endsWith(CHAT_HANDOFF_DEFAULT_REQUEST)
    ).toBe(true)
    expect(
      buildChatHandoffMessage({
        mode: 'new',
        source: { id: SOURCE, name: 'x', agent: 'codex' },
        selection,
        request
      }).endsWith(request)
    ).toBe(true)
  })

  it('compacts whitespace and cuts with an ellipsis', () => {
    expect(compactChatHandoffText('a \n\t b')).toBe('a b')
    expect(compactChatHandoffText('x'.repeat(300))).toHaveLength(240)
  })
})

describe('limit handoff keys', () => {
  const parked: LimitResumeEntry = {
    id: 'chat:s-1',
    kind: 'chat',
    paneKey: 'chat:s-1',
    sessionId: 's-1',
    worktreeId: 'w',
    agent: 'claude',
    title: 'chat',
    resetsAt: 100,
    resumeAt: 160,
    tries: 0,
    maxTries: 5,
    state: 'parked',
    line: ''
  }

  it('offers only parked native Claude and Codex chats', () => {
    expect(chatHandoffLimitTarget(parked)).toBe('codex')
    expect(chatHandoffLimitTarget({ ...parked, state: 'cancelled' })).toBeNull()
    expect(chatHandoffLimitTarget({ ...parked, kind: 'terminal' })).toBeNull()
    expect(chatHandoffLimitTarget({ ...parked, agent: 'gemini' })).toBeNull()
  })

  it('keys a stop by chat and reset', () => {
    expect(chatHandoffLimitKey(parked)).toBe('s-1:100')
    expect(chatHandoffLimitKey({ ...parked, resetsAt: null })).toBe('s-1:160')
  })
})
