import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asIdleRecoveryStoredState,
  emptyIdleRecoveryState,
  listIdleRecoveryInboxItems,
  loadIdleRecoveryState,
  parseIdleRecoveryState,
  saveIdleRecoveryState,
  type IdleRecoveryStoredChat
} from './idle-recovery-state'

function row(overrides: Partial<IdleRecoveryStoredChat> = {}): IdleRecoveryStoredChat {
  return {
    fingerprint: 'abc',
    verdict: 'waiting_user',
    question: 'Which one?',
    since: 10,
    wakes: 1,
    wakeAt: null,
    paused: false,
    reason: 'asked',
    nextStep: '',
    idleSince: 5,
    seenAt: 10,
    listed: true,
    kind: 'terminal',
    agent: 'claude',
    title: 'A chat',
    workspace: 'main',
    worktreeId: 'repo::/path',
    ...overrides
  }
}

describe('idle recovery state file', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'idle-recovery-state-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round trips through a file and leaves no temporary file behind', async () => {
    const path = join(dir, 'nested', 'state.json')
    const state = emptyIdleRecoveryState()
    state.chats.a = row()
    state.chats.b = row({ verdict: 'stalled', wakeAt: 99, nextStep: 'go on', wakes: 2 })
    await saveIdleRecoveryState(state, path)
    expect(await loadIdleRecoveryState(path)).toEqual(state)
    expect(await readdir(join(dir, 'nested'))).toEqual(['state.json'])
  })

  it('replaces an earlier file whole', async () => {
    const path = join(dir, 'state.json')
    const state = emptyIdleRecoveryState()
    state.chats.a = row()
    await saveIdleRecoveryState(state, path)
    delete state.chats.a
    state.chats.b = row()
    await saveIdleRecoveryState(state, path)
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')).chats)).toEqual(['b'])
  })

  it('starts empty when the file is missing, broken or of another version', async () => {
    const path = join(dir, 'state.json')
    expect(await loadIdleRecoveryState(path)).toEqual(emptyIdleRecoveryState())
    await writeFile(path, '{not json')
    expect(await loadIdleRecoveryState(path)).toEqual(emptyIdleRecoveryState())
    await writeFile(path, JSON.stringify({ version: 2, chats: { a: row() } }))
    expect(await loadIdleRecoveryState(path)).toEqual(emptyIdleRecoveryState())
  })

  it('drops rows that are not rows and keeps the rest', () => {
    const parsed = parseIdleRecoveryState(
      JSON.stringify({
        version: 1,
        chats: {
          good: row(),
          bad: { verdict: 'nonsense' },
          worse: 'text',
          negative: row({ wakes: -1 })
        }
      })
    )
    expect(Object.keys(parsed.chats)).toEqual(['good'])
  })

  it('fills the fields a row handed over in memory lacks', () => {
    const state = asIdleRecoveryStoredState({
      version: 1,
      chats: {
        a: {
          fingerprint: 'f',
          verdict: 'stalled',
          question: '',
          since: 7,
          wakes: 0,
          wakeAt: null,
          paused: false
        } as never
      }
    })
    expect(state.chats.a).toMatchObject({ seenAt: 7, listed: false, kind: 'chat', nextStep: '' })
  })

  it('lists waiting and stalled chats oldest first, and nothing finished or unlisted', () => {
    const state = emptyIdleRecoveryState()
    state.chats.newer = row({ since: 30 })
    state.chats.older = row({ since: 20, verdict: 'stalled', wakeAt: 50 })
    state.chats.done = row({ verdict: 'finished' })
    state.chats.busy = row({ listed: false })
    state.chats.waitingLater = row({ since: 40, wakeAt: 60 })
    expect(
      listIdleRecoveryInboxItems(state).map((item) => [item.chatId, item.verdict, item.wakeAt])
    ).toEqual([
      ['older', 'stalled', 50],
      ['newer', 'waiting_user', null],
      ['waitingLater', 'waiting_user', null]
    ])
  })
})
