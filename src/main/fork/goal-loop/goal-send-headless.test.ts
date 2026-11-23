// BAD-682: the goal loop's send to a terminal agent on a runtime with no window (`orca serve`).
// The real headless runtime and its real PTY wiring start a stand-in agent (a program named
// `claude` that takes lines at a prompt and reports no status of its own); the loop's real send
// and the real idle-recovery ports write to it. Before the fix a terminal this process never saw
// change status live was refused as "unverified" and the text was never typed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  idleRecoveryChatPort,
  idleRecoveryTerminalPort,
  type IdleRecoveryPorts
} from '../idle-recovery/idle-recovery-ports'
import { sendGoalText } from './goal-send'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

const AGENT_SOURCE = `process.stdout.write('> ')
process.stdin.on('data', (d) => process.stdout.write('got: ' + String(d).trim() + '\\r\\n> '))
setInterval(() => {}, 1000)
`

const started: number[] = []
let work = ''

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'goal-send-data-'))
  work = mkdtempSync(join(tmpdir(), 'goal-send-work-'))
  writeFileSync(join(work, 'agent.js'), AGENT_SOURCE)
})

afterEach(async () => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid)
    } catch {
      // Already gone.
    }
  }
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

async function headlessRuntime() {
  const store = createStore()
  store.addRepo({
    id: 'r1',
    path: work,
    displayName: 'demo',
    badgeColor: '#fff',
    addedAt: 1,
    kind: 'folder'
  } as never)
  const { OrcaRuntimeService } = await import('../../runtime/orca-runtime')
  const { registerHeadlessPtyRuntime } = await import('../../ipc/pty/register-headless-runtime')
  const runtime = new OrcaRuntimeService(store as never)
  await registerHeadlessPtyRuntime(
    runtime,
    undefined,
    () => store.getSettings() as never,
    undefined,
    store as never
  )
  runtime.setOrchestrationDb(new OrchestrationDb(':memory:'))
  return runtime
}

type Created = { paneKey: string; processId: number; handle: string }

/** A terminal on the headless runtime; `command` runs in it, or the shell stays at its prompt. */
async function openTerminal(
  runtime: Awaited<ReturnType<typeof headlessRuntime>>,
  command?: string
): Promise<Created> {
  const made = (await runtime.createTerminal(
    `id:r1::${work}`,
    command ? { command } : {}
  )) as unknown as Created
  started.push(made.processId)
  // The agent runs a Run's coordinator, so its terminal is a mailbox terminal, as a launched one is.
  runtime.getOrchestrationDb().createRun({
    objective: 'goal',
    coordinatorHandle: made.handle,
    coordinatorPaneKey: made.paneKey as never
  })
  return made
}

async function screenOf(
  runtime: Awaited<ReturnType<typeof headlessRuntime>>,
  handle: string,
  until: RegExp
): Promise<string> {
  let text = ''
  for (let tries = 0; tries < 40; tries += 1) {
    const read = await runtime.readTerminal(handle, { screen: true, limit: 40 })
    text = read.tail.join('\n')
    if (until.test(text)) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return text
}

function portsFor(runtime: Awaited<ReturnType<typeof headlessRuntime>>): IdleRecoveryPorts {
  return {
    chat: idleRecoveryChatPort(() => null),
    terminal: idleRecoveryTerminalPort(() => runtime)
  }
}

describe('the goal loop sends to a terminal agent on a headless runtime', () => {
  it('types the continue text into an idle agent whose status was never seen change live', async () => {
    const runtime = await headlessRuntime()
    const agent = await openTerminal(
      runtime,
      `exec -a claude "${process.execPath}" "${join(work, 'agent.js')}"`
    )
    await screenOf(runtime, agent.handle, /^> $/m)

    const taken = await sendGoalText(
      { chatId: agent.paneKey, kind: 'terminal', agent: 'claude', idleSince: Date.now() - 60_000 },
      'The check failed: done.txt is missing. Keep going.',
      portsFor(runtime)
    )

    expect(taken).toBe(true)
    expect(await screenOf(runtime, agent.handle, /got: The check failed/)).toContain(
      'got: The check failed: done.txt is missing. Keep going.'
    )
  }, 60_000)

  it('still types nothing into a terminal where a shell, not the agent, is in front', async () => {
    const runtime = await headlessRuntime()
    const shell = await openTerminal(runtime)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const taken = await sendGoalText(
      { chatId: shell.paneKey, kind: 'terminal', agent: 'claude', idleSince: Date.now() - 60_000 },
      'echo should-not-run-1234',
      portsFor(runtime)
    )

    expect(taken).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const read = await runtime.readTerminal(shell.handle, { screen: true, limit: 40 })
    expect(read.tail.join('\n')).not.toContain('should-not-run-1234')
  }, 60_000)
})
