// Agent guards under Pause all (BAD-818): the real engine and its live ports (the real chat send and
// the real terminal send with its write guard), with the real switch in a temporary data folder.
// While paused a loop warning goes into a running turn, and one that would start a turn (the agent
// at rest, also when it comes to rest during the send) waits and goes once at resume-all, unless its
// loop ended meanwhile. Faked: the chat host's record, status and send, and the terminal runtime.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import {
  AGENT_GUARD_LOOP_MESSAGE,
  readAgentGuardSettings,
  type AgentGuardToolCall
} from '../../../shared/fork/agent-guards'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { resetForkPauseAllCacheForTests, writeForkPauseAll } from '../pause-all/pause-all-state'
import { liveAgentGuardActPorts } from './agent-guards-act'
import { AgentGuardEngine } from './agent-guards-engine'
import type { AgentGuardRecords } from './agent-guards-state'

const CHAT = { kind: 'chat' as const, agent: 'claude', title: 'Worker', worktreeId: 'wt' }
const TERMINAL = { kind: 'terminal' as const, agent: 'codex', title: 'Codex', worktreeId: 'wt' }

let now = 1000
const fail = (): AgentGuardToolCall => {
  now += 10
  return { tool: 'Bash', input: { command: 'npm test' }, failed: true, error: 'Exit 1', at: now }
}
const progress = (): AgentGuardToolCall => {
  now += 10
  return { tool: 'Edit', input: { file_path: 'a.ts' }, failed: false, error: '', at: now }
}

/** The chat host: one chat whose status the test sets; a send runs the host's admission check. */
function installChat(status: { value: string }, onSend: () => void = () => {}) {
  const sent: string[] = []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the guard's chat send reads only these.
  setStructuredAgentSessionHost({
    deps: { store: { getRecord: () => ({ sessionId: 's1', lease: { runtimeFence: 1 } }) } },
    readStatusSummary: () => ({ status: status.value }),
    send: async (
      _caller: unknown,
      message: { body: { blocks: { text: string }[] }; beforeRun?: () => void }
    ) => {
      onSend()
      await message.beforeRun?.()
      sent.push(message.body.blocks[0]!.text)
      return { ok: true, value: { clientMessageId: 'c1', submission: { dispatchState: 'sent' } } }
    }
  } as never)
  return sent
}

/** A terminal runtime whose agent the write guard proves; `inTurn` is what the host reports. */
function terminalRuntime(state: { inTurn: boolean; endTurnAtWrite?: boolean }) {
  const writes: string[] = []
  const runtime = {
    getTerminalHandleForPaneKey: () => 'h1',
    getTerminalPromptRequestBinding: () => ({ ptyId: 'p1', processIncarnation: 1 }),
    isWorkerAgentInTurn: () => state.inTurn,
    readTerminalMailHold: () => null,
    readTerminal: async () => ({ source: 'screen', tail: ['> '], draft: '' }),
    subscribeToTerminalData: () => () => {},
    readLaunchedAgentForeground: async () => {
      // The turn ends while the write is being checked.
      if (state.endTurnAtWrite) {
        state.inTurn = false
      }
      return 'agent'
    },
    sendTerminalAgentPrompt: async (
      _handle: string,
      body: string,
      options: { beforeWrite?: (ptyId: string) => Promise<void> }
    ) => {
      await options.beforeWrite?.('p1')
      writes.push(body)
      return { accepted: true }
    }
  }
  return { runtime, writes }
}

function engineWith(runtime: unknown = null) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal fake carries every member the ports call.
  const ports = liveAgentGuardActPorts(() => runtime as never)
  const records: AgentGuardRecords = new Map()
  return new AgentGuardEngine({
    ports,
    records,
    save: async () => {},
    now: () => now,
    settings: () => readAgentGuardSettings({ forkAgentGuardLoopRepeats: 3 }),
    spend: () => ({ totalUsd: null, isWorker: false }),
    notify: () => {},
    changed: () => {},
    startedAt: 500
  })
}

async function loop(engine: AgentGuardEngine, id: string, meta: typeof CHAT | typeof TERMINAL) {
  for (let index = 0; index < 3; index += 1) {
    await engine.observe(id, meta, fail())
  }
}

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'guards-pause-all-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  setStructuredAgentSessionHost(null)
  resetForkPauseAllCacheForTests()
  rmSync(paths.userData, { recursive: true, force: true })
})

describe('agent guard warnings while paused', () => {
  it('holds a warning to a chat at rest and sends it once at resume-all', async () => {
    const status = { value: 'idle' }
    const sent = installChat(status)
    const engine = engineWith()
    writeForkPauseAll(true, { by: 'cli' })
    await loop(engine, 's1', CHAT)
    expect(sent).toEqual([])
    expect(engine.entries()).toEqual([])

    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(sent).toEqual([AGENT_GUARD_LOOP_MESSAGE]))
    await vi.waitFor(() => expect(engine.entries()[0]).toMatchObject({ id: 's1', state: 'warned' }))
    writeForkPauseAll(true, { by: 'cli' })
    writeForkPauseAll(false, { by: 'cli' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toHaveLength(1)
  })

  it('sends a warning into a running turn while paused', async () => {
    const sent = installChat({ value: 'working' })
    const engine = engineWith()
    writeForkPauseAll(true, { by: 'cli' })
    await loop(engine, 's1', CHAT)
    expect(sent).toEqual([AGENT_GUARD_LOOP_MESSAGE])
  })

  it('holds a warning whose chat comes to rest during the send', async () => {
    const status = { value: 'working' }
    const sent = installChat(status, () => {
      status.value = 'idle'
    })
    const engine = engineWith()
    writeForkPauseAll(true, { by: 'cli' })
    await loop(engine, 's1', CHAT)
    expect(sent).toEqual([])
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(sent).toEqual([AGENT_GUARD_LOOP_MESSAGE]))
  })

  it('drops a held warning whose loop ended before resume-all', async () => {
    const sent = installChat({ value: 'idle' })
    const engine = engineWith()
    writeForkPauseAll(true, { by: 'cli' })
    await loop(engine, 's1', CHAT)
    await engine.observe('s1', CHAT, progress())
    writeForkPauseAll(false, { by: 'cli' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toEqual([])
  })

  it('holds a warning to a terminal agent at rest, also one that comes to rest at the write', async () => {
    for (const state of [{ inTurn: false }, { inTurn: true, endTurnAtWrite: true }]) {
      writeForkPauseAll(false, { by: 'cli' })
      const { runtime, writes } = terminalRuntime(state)
      const engine = engineWith(runtime)
      writeForkPauseAll(true, { by: 'cli' })
      await loop(engine, 'tab:1', TERMINAL)
      expect(writes).toEqual([])
      writeForkPauseAll(false, { by: 'cli' })
      await vi.waitFor(() => expect(writes).toEqual([AGENT_GUARD_LOOP_MESSAGE]))
    }
  })

  it('types a warning into a terminal agent in a turn while paused', async () => {
    const { runtime, writes } = terminalRuntime({ inTurn: true })
    const engine = engineWith(runtime)
    writeForkPauseAll(true, { by: 'cli' })
    await loop(engine, 'tab:1', TERMINAL)
    expect(writes).toEqual([AGENT_GUARD_LOOP_MESSAGE])
  })
})
