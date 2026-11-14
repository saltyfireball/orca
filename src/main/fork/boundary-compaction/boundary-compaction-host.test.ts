import { afterEach, describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session/journal/agent-session-journal-types'
import { chatEndingFromJournal } from '../idle-recovery/idle-recovery-ending'
import { boundaryCompactionJournalFacts } from './boundary-compaction-host'
import {
  clearForkBoundaryCompactionTyped,
  forkBoundaryCompactionTyped,
  setForkBoundaryCompactionTyped
} from './boundary-compaction-typed'

let sequence = 0

function row(body: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  sequence += 1
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test row with only the fields the reader looks at.
  return {
    itemId: `item-${sequence}`,
    revision: 1,
    sequence,
    observedAt: 1,
    body,
    ...extra
  } as AgentJournalRenderItem
}

function message(role: 'user' | 'assistant', text: string, body: Record<string, unknown> = {}) {
  return row({ kind: 'message', role, blocks: [{ type: 'text', text }], ...body })
}

function turn(used: Record<string, unknown>) {
  return row({
    kind: 'turn',
    turnId: `turn-${sequence}`,
    state: 'completed',
    contextUsage: { used }
  })
}

describe('boundaryCompactionJournalFacts', () => {
  it('reads the newest request and the context a finished turn reported', () => {
    const request = message('user', 'paint the fence')
    const facts = boundaryCompactionJournalFacts([
      message('user', 'an older request'),
      turn({ kind: 'report', usedTokens: 40_000, capturedAt: 10 }),
      request,
      message('assistant', 'done'),
      turn({ kind: 'report', usedTokens: 150_000, capturedAt: 20 })
    ])
    expect(facts).toEqual({
      requestItemId: request.itemId,
      commandSinceRequest: false,
      queued: false,
      contextTokens: 150_000,
      measuredAt: 20
    })
  })

  it('sees a compaction after the request, and the context it left unknown', () => {
    const request = message('user', 'paint the fence')
    const facts = boundaryCompactionJournalFacts([
      request,
      turn({ kind: 'report', usedTokens: 150_000, capturedAt: 20 }),
      message('user', '/compact', { command: { name: 'compact' } }),
      turn({ kind: 'unknown', capturedAt: 30 })
    ])
    expect(facts.requestItemId).toBe(request.itemId)
    expect(facts.commandSinceRequest).toBe(true)
    expect(facts.contextTokens).toBeNull()
    expect(facts.measuredAt).toBeNull()
  })

  it('says so when there is no request or no measurement', () => {
    expect(boundaryCompactionJournalFacts([])).toEqual({
      requestItemId: null,
      commandSinceRequest: false,
      queued: false,
      contextTokens: null,
      measuredAt: null
    })
    expect(
      boundaryCompactionJournalFacts([
        message('user', '/compact', { command: { name: 'compact' } })
      ]).requestItemId
    ).toBeNull()
  })

  it('counts only a message still waiting in the queue as queued', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the queue check reads.
    const submission = (fields: Record<string, unknown>) =>
      fields as unknown as AgentJournalSubmission
    const items = [message('user', 'paint the fence')]
    expect(
      boundaryCompactionJournalFacts(items, [
        submission({ handoverRecorded: true, dispatchState: 'pending' })
      ]).queued
    ).toBe(true)
    expect(
      boundaryCompactionJournalFacts(items, [
        submission({ handoverRecorded: true, dispatchState: 'pending', handedOverAt: 5 })
      ]).queued
    ).toBe(false)
  })
})

describe('idle recovery and a compaction', () => {
  it('judges the same ending before and after the compact entry', () => {
    const before = [message('user', 'paint the fence'), message('assistant', 'The fence is done.')]
    const after = [...before, message('user', '/compact', { command: { name: 'compact' } })]
    expect(chatEndingFromJournal(after)).toEqual(chatEndingFromJournal(before))
  })
})

describe('the typed report', () => {
  afterEach(() => clearForkBoundaryCompactionTyped())

  it('knows nothing until a window reports', () => {
    expect(forkBoundaryCompactionTyped('chat-1')).toBeNull()
    setForkBoundaryCompactionTyped(1, [])
    expect(forkBoundaryCompactionTyped('chat-1')).toBe(false)
  })

  it('holds a chat typed in any window, and drops a closed window', () => {
    setForkBoundaryCompactionTyped(1, [])
    setForkBoundaryCompactionTyped(2, ['chat-1'])
    expect(forkBoundaryCompactionTyped('chat-1')).toBe(true)
    expect(forkBoundaryCompactionTyped('chat-2')).toBe(false)
    clearForkBoundaryCompactionTyped(2)
    expect(forkBoundaryCompactionTyped('chat-1')).toBe(false)
    clearForkBoundaryCompactionTyped(1)
    expect(forkBoundaryCompactionTyped('chat-1')).toBeNull()
  })
})
