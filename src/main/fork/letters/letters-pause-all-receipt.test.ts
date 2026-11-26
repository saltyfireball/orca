// Letters under Pause all (BAD-818), as the sender and pause-status see them: the real CLI commands
// (`orca letter send`, `orca pause-status`) over an in-process client into the real fork.letters.send
// and fork.pauseAll.status, the real letters service and store and the real switch, in a temporary
// data folder. A letter sent while paused, from a paired device (as in the live check) or a chat
// here, gets a receipt the host words, saying pause-all holds it; pause-status counts the queued
// letters and prints its held line while paused, also when nothing is held. Faked: the runtime's
// agent rows (two terminal agents) and its empty bot list.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import { FORK_LETTERS_HANDLERS } from '../../../cli/fork/letters-handlers'
import { FORK_PAUSE_ALL_HANDLERS } from '../../../cli/fork/pause-all-handlers'
import type { CommandHandler } from '../../../cli/dispatch/dispatch'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { eraseRpcMethods, isStreamingMethod, type RpcContext } from '../../runtime/rpc/core'
import { FORK_LETTERS_RPC_METHODS } from '../../runtime/rpc/methods/fork/fork-letters'
import { FORK_PAUSE_ALL_METHODS } from '../../runtime/rpc/methods/fork/fork-pause-all'
import { resetForkPauseAllCacheForTests, writeForkPauseAll } from '../pause-all/pause-all-state'
import { emptyForkLettersState, forkLettersStore } from './letters-store'

// One data folder for the file: the process's letters store keeps the first folder it is given.
paths.userData = mkdtempSync(join(tmpdir(), 'letters-pause-receipt-'))

const send = FORK_LETTERS_HANDLERS['letter send']!
const status = FORK_PAUSE_ALL_HANDLERS['pause-status']!
const METHODS = eraseRpcMethods([...FORK_LETTERS_RPC_METHODS, ...FORK_PAUSE_ALL_METHODS])
const HELD_RECEIPT =
  ': held by pause-all: delivered after `orca resume-all`, when the chat ends its turn.'

let db: OrchestrationDb

function runtime() {
  const agent = (paneKey: string) => ({
    paneKey,
    agentType: 'codex',
    state: 'idle',
    prompt: 'Builder',
    stateStartedAt: 0,
    updatedAt: 0
  })
  return {
    bots: { list: () => [] },
    getOrchestrationDb: () => db,
    requireStore: () => ({ getSettings: () => ({}) }),
    ensureStructuredAgentSessionHost: async () => undefined,
    getWorktreePs: async () => ({
      worktrees: [
        { worktreeId: 'wt-1', displayName: 'repo', agents: [agent('tab-1:1'), agent('tab-2:1')] }
      ]
    })
  }
}

/** The CLI's client: each call goes to the real method, and what comes back crosses as JSON. */
function client(extra: Partial<RpcContext>) {
  return {
    call: async (name: string, params: unknown) => {
      const method = METHODS.find((candidate) => candidate.name === name)
      if (!method || isStreamingMethod(method)) {
        throw new Error(`No method ${name}`)
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods read only the faked runtime members.
      const ctx = { runtime: runtime(), ...extra } as unknown as RpcContext
      const result = await method.handler(method.params?.parse(params), ctx)
      return {
        id: '1',
        ok: true,
        result: JSON.parse(JSON.stringify(result)),
        _meta: { runtimeId: 'h' }
      }
    }
  }
}

/** Runs one CLI command and returns what it printed. */
async function run(
  handler: CommandHandler,
  flags: Record<string, string>,
  options: { paired?: boolean; json?: boolean } = {}
): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await handler({
      flags: new Map(Object.entries(flags)),
      client: client(options.paired ? { pairedDeviceId: 'desk-1' } : {}) as never,
      cwd: '/',
      json: options.json === true
    })
    return log.mock.calls.map((call) => String(call[0])).join('\n')
  } finally {
    log.mockRestore()
  }
}

beforeEach(async () => {
  resetForkPauseAllCacheForTests()
  writeForkPauseAll(false, { by: 'cli' })
  db = new OrchestrationDb(':memory:')
  // A chat here sends as the second terminal agent.
  vi.stubEnv('ORCA_AGENT_SESSION_ID', '')
  vi.stubEnv('ORCA_PANE_KEY', 'tab-2:1')
  await forkLettersStore(getCanonicalUserDataPath()).update(() => ({
    next: emptyForkLettersState(),
    result: null
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  db.close()
  resetForkPauseAllCacheForTests()
})
afterAll(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

describe('the sender and pause-status while paused', () => {
  it("says in the sender's receipt that pause-all holds the letter, from a paired device and from a chat here", async () => {
    writeForkPauseAll(true, { by: 'cli' })
    for (const paired of [true, false]) {
      const receipt = await run(send, { to: 'tab-1:1', text: 'hello' }, { paired })
      expect(receipt).toMatch(/^Letter [0-9a-f]{12} to Builder \(tab-1:1\): /)
      expect(receipt.endsWith(HELD_RECEIPT)).toBe(true)

      const json = JSON.parse(
        await run(send, { to: 'tab-1:1', text: 'again' }, { paired, json: true })
      )
      expect(json.result.letter).toMatchObject({ state: 'queued' })
      expect(json.result.letter.note).toContain('Paused by pause-all')
      expect(json.result.receipt).toContain(HELD_RECEIPT)
    }

    writeForkPauseAll(false, { by: 'cli' })
    const running = await run(send, { to: 'tab-1:1', text: 'hello' }, { paired: true })
    expect(running.endsWith(': queued: delivered when the chat ends its turn.')).toBe(true)
  })

  it('counts the held letters in pause-status and prints its held line while paused, also when nothing is held', async () => {
    writeForkPauseAll(true, { by: 'cli' })
    const line = (letters: string) =>
      `Held for resume-all: 0 bot mail, 0 room hand-offs, 0 worker launches (orca agent queue list), ${letters} (orca letter list).`
    expect((await run(status, {})).split('\n')).toContain(line('0 letters'))

    await run(send, { to: 'tab-1:1', text: 'one' }, { paired: true })
    expect((await run(status, {})).split('\n')).toContain(line('1 letter'))
    await run(send, { to: 'tab-1:1', text: 'two' })
    expect((await run(status, {})).split('\n')).toContain(line('2 letters'))
    const json = JSON.parse(await run(status, {}, { json: true }))
    expect(json.result).toMatchObject({
      held: { mail: 0, handOffs: 0, launches: 0, letters: 2 },
      heldLine: line('2 letters')
    })

    writeForkPauseAll(false, { by: 'cli' })
    expect(await run(status, {})).toBe('Not paused.')
  })
})
