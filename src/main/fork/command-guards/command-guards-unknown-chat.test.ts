// BAD-764: a live Claude chat nothing is known about shows as unguarded wherever guard state is shown,
// a live chat is never dropped from the registry for dead ones, and an ended chat counts nowhere. Real
// session host, launch and Agent SDK, on the stand-in CLI.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatCommandGuardsStatus } from '../../../cli/fork/command-guards-handlers'
import type { AgentConversationRow } from '../../../shared/agent-conversations/agent-conversation-contracts'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../shared/agent-session/view/structured-agent-session-projection'
import { ensureTestStructuredAgentSessionHost as ensureStructuredAgentSessionHost } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import { forkAgentRowsWithCommandGuards } from './command-guards-agent-rows'
import { attachGuardChat, guardHostDeps } from './command-guards-chat.test-fixture'
import {
  noteCommandGuardChat,
  noteCommandGuardChatAdopted,
  resetCommandGuardChats
} from './command-guards-chat-registry'
import { liveCommandGuardChats } from './command-guards-live-chats'
import { startForkCommandGuards, stopForkCommandGuards } from './command-guards-live'
import { forkCommandGuardStatus } from './command-guards-status'

let scratch = ''
let state = ''
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'guard-unknown-'))
  state = mkdtempSync(join(tmpdir(), 'guard-unknown-state-'))
  execFileSync('git', ['init', '-q', '-b', 'main', scratch])
  process.env.GUARD_FAKE_ANSWER_FILE = join(scratch, 'hook-answer.jsonl')
})
afterAll(() => {
  delete process.env.GUARD_FAKE_ANSWER_FILE
  rmSync(scratch, { recursive: true, force: true })
  rmSync(state, { recursive: true, force: true })
})
beforeEach(() => {
  resetCommandGuardChats()
  startForkCommandGuards({ requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] }) })
})
afterEach(async () => {
  stopForkCommandGuards()
  await stopStructuredAgentSessionRuntime()
})

async function startChat() {
  const session = `chat-${randomUUID()}`
  const host = await ensureStructuredAgentSessionHost(guardHostDeps({ state, scratch }))
  await attachGuardChat(host, session, state)
  /** Its provider process ends, as when the chat sleeps or its Claude Code exits. */
  const end = async (): Promise<void> => {
    await host.close(session, 'evict')
    await vi.waitFor(() => expect(host.loadedSessionIds()).not.toContain(session), {
      timeout: 10_000
    })
  }
  return { session, end }
}

const nativeChat = () =>
  forkCommandGuardStatus([]).surfaces?.find((row) => row.surface === 'native-chat')

function lineOf(session: string) {
  const row: AgentConversationRow = {
    orcaSessionId: null,
    kind: 'chat',
    agent: 'claude',
    state: 'working',
    worktreeId: `repo1::${scratch}`,
    workspace: 'demo',
    paneKey: structuredAgentSessionPaneKey(structuredAgentSessionTabId(session), session),
    title: null,
    lastAssistantMessage: null,
    updatedAt: 1
  }
  return forkAgentRowsWithCommandGuards([row], [])[0].commandGuard
}

function noteDeadChats(count: number): void {
  for (let index = 0; index < count; index += 1) {
    noteCommandGuardChat(`dead-${index}`, 'native-chat', liveCommandGuardChats)
  }
}

describe('a chat nothing is known about', () => {
  it('is unguarded in the agent line, the surface rows and the status, while it runs', async () => {
    const { session, end } = await startChat()
    expect(lineOf(session)).toMatchObject({ guarded: true })
    expect(nativeChat()).toMatchObject({ guarded: true, chats: { guarded: 1, unguarded: 0 } })

    resetCommandGuardChats()
    const status = forkCommandGuardStatus([])
    expect(status.chats).toEqual([
      {
        sessionId: session,
        surface: 'native-chat',
        guarded: false,
        reason: expect.stringContaining('not known to this app')
      }
    ])
    expect(lineOf(session)).toEqual({
      guarded: false,
      note: expect.stringMatching(/^unguarded: this chat is not known to this app/)
    })
    expect(nativeChat()).toMatchObject({
      guarded: false,
      note: 'unguarded: 1 chat not known to this app',
      chats: { guarded: 0, unguarded: 1 }
    })
    expect(formatCommandGuardsStatus(status)).toMatch(
      /native-chat +no +unguarded: 1 chat not known to this app/
    )

    await end()
    expect(nativeChat()).toMatchObject({ guarded: true, chats: { guarded: 0, unguarded: 0 } })
    // Still nothing known about it, so its line does not turn guarded.
    expect(lineOf(session)).toMatchObject({ guarded: false })
  }, 60_000)

  it('is none of the chats that run, however many ended ones came after', async () => {
    const { session } = await startChat()
    noteDeadChats(1200)
    expect(lineOf(session)).toMatchObject({ guarded: true })
    expect(nativeChat()).toMatchObject({ guarded: true, chats: { guarded: 1, unguarded: 0 } })
    const listed = forkCommandGuardStatus([]).chats ?? []
    expect(listed).toHaveLength(500)
    // The oldest ended ones went first, and what is known of them went with them.
    expect(lineOf('dead-0')).toMatchObject({ guarded: false })
    expect(lineOf('dead-1199')).toMatchObject({ guarded: true })
  }, 60_000)
})

describe('a chat that ended unguarded', () => {
  it('leaves its surface guarded', async () => {
    const { session, end } = await startChat()
    noteCommandGuardChatAdopted(session)
    expect(nativeChat()).toMatchObject({
      guarded: false,
      note: expect.stringContaining('1 chat carried over an app restart'),
      chats: { guarded: 0, unguarded: 1 }
    })
    await end()
    expect(nativeChat()).toMatchObject({ guarded: true, chats: { guarded: 0, unguarded: 0 } })
    expect(lineOf(session)).toMatchObject({ guarded: false })
  }, 60_000)

  it('is counted beside the others by reason while it runs', async () => {
    const first = await startChat()
    await startChat()
    resetCommandGuardChats()
    noteCommandGuardChat(first.session, 'native-chat', liveCommandGuardChats)
    noteCommandGuardChatAdopted(first.session)
    expect(nativeChat()).toMatchObject({
      note: 'unguarded: 1 chat carried over an app restart, guard hook not confirmed by Claude Code yet; 1 chat not known to this app',
      chats: { guarded: 0, unguarded: 2 }
    })
  }, 60_000)
})
