import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_RECOVERY_MESSAGE_TAIL_CHARS } from '../../../shared/fork/idle-recovery'
import {
  chatEndingFromJournal,
  clearIdleRecoveryEndingCache,
  readIdleRecoveryEndingWith
} from './idle-recovery-ending'
import { NOW, fakeHost, journalMessage } from './idle-recovery-test-fixtures'
import { readTranscriptEnding, readTranscriptLine } from './idle-recovery-transcript-tail'
import type { IdleRecoveryCandidate } from './idle-recovery-types'

function candidate(overrides: Partial<IdleRecoveryCandidate> = {}): IdleRecoveryCandidate {
  return {
    chatId: 'tab-1:leaf-1',
    kind: 'terminal',
    agent: 'claude',
    cwd: '/invented/garden',
    title: 'garden',
    workspace: 'garden',
    worktreeId: 'wt-1',
    role: 'standalone',
    requestSource: 'user',
    lastPrompt: 'prompt from the row',
    idleSince: NOW - 120_000,
    backgroundPending: false,
    scheduledWake: false,
    coordinatorBusy: false,
    ...overrides
  }
}

const line = (value: unknown): string => JSON.stringify(value)

/** An invented transcript in the entry-with-message shape. */
function inventedTranscript(): string[] {
  return [
    line({ type: 'user', message: { role: 'user', content: 'water the ferns' } }),
    line({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] }
    }),
    line({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Hose', input: {} }]
      }
    }),
    line({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]
      }
    }),
    line({ type: 'user', isSidechain: true, message: { role: 'user', content: 'side question' } }),
    line({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'The ferns are watered. Next I will prune.' }]
      }
    }),
    line({ type: 'summary', summary: 'not a message' })
  ]
}

let dir = ''

beforeEach(async () => {
  clearIdleRecoveryEndingCache()
  dir = await mkdtemp(join(tmpdir(), 'idle-recovery-ending-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readTranscriptEnding', () => {
  it('finds the last request and the last assistant text', async () => {
    const path = join(dir, 'a.jsonl')
    await writeFile(path, `${inventedTranscript().join('\n')}\n`)
    expect(await readTranscriptEnding(path)).toEqual({
      lastUserRequest: 'water the ferns',
      lastAssistantMessage: 'The ferns are watered. Next I will prune.'
    })
  })

  it('reads the payload-message shape', () => {
    expect(
      readTranscriptLine(
        line({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'done' }]
          }
        })
      )
    ).toEqual({ role: 'assistant', text: 'done' })
    expect(
      readTranscriptLine(
        line({ type: 'response_item', payload: { type: 'function_call', role: 'assistant' } })
      )
    ).toBeNull()
    expect(readTranscriptLine('{"type":"user","mess')).toBeNull()
  })

  it('reads only the tail of a large file', async () => {
    const path = join(dir, 'big.jsonl')
    const filler = line({
      type: 'assistant',
      message: { role: 'assistant', content: 'x'.repeat(900) }
    })
    const lines = [
      line({ type: 'user', message: { role: 'user', content: 'an old request' } }),
      ...Array.from({ length: 400 }, () => filler),
      line({ type: 'assistant', message: { role: 'assistant', content: 'the final answer' } })
    ]
    await writeFile(path, lines.join('\n'))
    // 4 KiB of tail holds the final answer but not the request that began the turn.
    expect(await readTranscriptEnding(path, 4096)).toEqual({
      lastUserRequest: null,
      lastAssistantMessage: 'the final answer'
    })
  })

  it('gives null for an unanswered request, a missing file and a path that is not a transcript', async () => {
    const path = join(dir, 'open.jsonl')
    await writeFile(
      path,
      line({ type: 'user', message: { role: 'user', content: 'still waiting' } })
    )
    expect(await readTranscriptEnding(path)).toBeNull()
    expect(await readTranscriptEnding(join(dir, 'missing.jsonl'))).toBeNull()
    const other = join(dir, 'notes.txt')
    await writeFile(other, inventedTranscript().join('\n'))
    expect(await readTranscriptEnding(other)).toBeNull()
    expect(await readTranscriptEnding('relative.jsonl')).toBeNull()
  })
})

describe('readIdleRecoveryEnding', () => {
  it('reads a terminal agent from its transcript', async () => {
    const path = join(dir, 'a.jsonl')
    await writeFile(path, inventedTranscript().join('\n'))
    const host = fakeHost([], {
      terminalStatus: async () => ({
        prompt: 'row prompt',
        lastAssistantMessage: 'preview',
        transcriptPath: path
      })
    })
    expect(await readIdleRecoveryEndingWith(host, candidate())).toEqual({
      lastUserRequest: 'water the ferns',
      lastAssistantMessage: 'The ferns are watered. Next I will prune.'
    })
  })

  it('falls back to the status row, and is null when nothing is known', async () => {
    const host = fakeHost([], {
      terminalStatus: async () => ({
        prompt: 'row prompt',
        lastAssistantMessage: 'preview of the answer',
        transcriptPath: join(dir, 'missing.jsonl')
      })
    })
    expect(await readIdleRecoveryEndingWith(host, candidate())).toEqual({
      lastUserRequest: 'row prompt',
      lastAssistantMessage: 'preview of the answer'
    })
    clearIdleRecoveryEndingCache()
    expect(await readIdleRecoveryEndingWith(fakeHost([]), candidate())).toBeNull()
  })

  it('keeps only the tail of a long assistant message', async () => {
    const long = `${'a'.repeat(IDLE_RECOVERY_MESSAGE_TAIL_CHARS)}THE END`
    const host = fakeHost([], {
      terminalStatus: async () => ({
        prompt: 'p',
        lastAssistantMessage: long,
        transcriptPath: null
      })
    })
    const ending = await readIdleRecoveryEndingWith(host, candidate())
    expect(ending?.lastAssistantMessage).toHaveLength(IDLE_RECOVERY_MESSAGE_TAIL_CHARS)
    expect(ending?.lastAssistantMessage.endsWith('THE END')).toBe(true)
  })

  it('reads a native chat from its journal, once per ending', async () => {
    const chatJournal = vi.fn(async () => [
      journalMessage('user', 'first request'),
      journalMessage('assistant', 'first answer'),
      journalMessage('user', 'second request'),
      journalMessage('reasoning', 'thinking it over'),
      journalMessage('assistant', 'part one'),
      journalMessage('assistant', 'sub-agent chatter', { agentId: 'sub-1' }),
      journalMessage('assistant', 'second answer. Want me to go on?')
    ])
    const host = fakeHost([], { chatJournal })
    const chat = candidate({ chatId: 'chat-1', kind: 'chat' })
    const expected = {
      lastUserRequest: 'second request',
      lastAssistantMessage: 'second answer. Want me to go on?'
    }
    expect(await readIdleRecoveryEndingWith(host, chat)).toEqual(expected)
    expect(await readIdleRecoveryEndingWith(host, chat)).toEqual(expected)
    expect(chatJournal).toHaveBeenCalledTimes(1)
    // The chat went idle again at another time: its ending is read again.
    await readIdleRecoveryEndingWith(host, { ...chat, idleSince: NOW })
    expect(chatJournal).toHaveBeenCalledTimes(2)
  })

  it('is null for a chat that is not loaded or has no answer yet', async () => {
    const chat = candidate({ chatId: 'chat-1', kind: 'chat' })
    expect(await readIdleRecoveryEndingWith(fakeHost([]), chat)).toBeNull()
    expect(chatEndingFromJournal([journalMessage('user', 'hello?')])).toBeNull()
    expect(chatEndingFromJournal([journalMessage('assistant', 'no request before me')])).toBeNull()
  })

  it('skips a command entry and says when another agent sent the request', () => {
    const ending = chatEndingFromJournal([
      journalMessage('user', 'report from a worker', {}, { from: { kind: 'agent', senders: [] } }),
      journalMessage('assistant', 'thanks'),
      journalMessage('user', '/compact', {}, { command: { name: 'compact' } })
    ])
    expect(ending).toEqual({
      lastUserRequest: 'report from a worker',
      lastAssistantMessage: 'thanks',
      fromAgent: true
    })
    expect(
      chatEndingFromJournal([journalMessage('user', 'typed'), journalMessage('assistant', 'ok')])
        ?.fromAgent
    ).toBe(false)
  })
})
