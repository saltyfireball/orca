// BAD-741 proof: a worker first started with `--profile` comes back on an automatic retry, a
// follow-up or `--retry-of` with the same permission mode (capped by this host's policy as it is
// then), the same account (or not at all) and the same MCP profile. The restart goes through the
// real retry -> startWorkerFollowUp -> startWorker -> startLocalWorker; only the placement of the
// agent, which needs a whole runtime, is stood in for. It runs the real terminal plan and chat
// creation hooks in the scope the start placed it in.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { observeWorker } from '../../runtime/orchestration/workers/turn-stops/worker-presence-report'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { resolveAgentTerminalCreateOptions } from '../../runtime/terminal/launch/runtime-agent-terminal-startup'
import type { TerminalCreateOptions } from '../../runtime/terminal/launch/terminal-create-options'
import { structuredAgentSessionLaunchPermission } from '../../native-chat/agent-session-wire/options/structured-agent-session-launch-permission'
import { agentSessionRecordIdentityFields } from '../../runtime/agent-session/records/agent-session-record-founding'
import { installForkWorkerRetry } from '../worker-retry/worker-retry-live'
import { listRetries } from '../worker-retry/retry-store'
import { forkStoreDoneContract } from '../completion-contract/completion-gate-live'
import {
  currentForkMcpLaunchScope,
  setForkMcpProfileCheck,
  withForkMcpLaunchScope
} from '../mcp-profiles/mcp-launch-scope'
import {
  ClaudeSessionAccountPins,
  setClaudeSessionAccountPinsForTests
} from '../claude-account-move/claude-session-account-pins'
import { forkPinnedClaudeAccountHome } from '../claude-account-move/claude-pinned-launch'
import { installForkAgentProfileLaunch } from './agent-profile-launch-scope'
import { forkWithTaskProfileLaunch } from './agent-profile-task-launch'
import { ORCHESTRATION_WORKER_START_METHODS } from '../../runtime/rpc/methods/orchestration/worker/worker-start-method'
import {
  planWorkerFollowUp,
  startWorkerFollowUp
} from '../../runtime/rpc/methods/orchestration/messaging/worker-follow-up'

vi.mock('../pause-all/pause-all-state', () => ({ isForkPauseAllEngaged: () => false }))

type Seen = {
  command?: string
  env?: Record<string, string>
  terminalRefused?: string
  chat?: unknown
  mcp?: string
}
const placed = vi.hoisted(() => ({
  seen: [] as unknown[],
  inScope: null as null | (() => unknown)
}))
vi.mock(
  '../../runtime/rpc/methods/orchestration/worker/start/placement/worker-start-agent-placement',
  async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    placeWorkerAgent: async () => {
      placed.seen.push(await placed.inScope?.())
      throw new Error('placement stands in for a whole runtime')
    }
  })
)
const createdChats: { options?: Record<string, string> }[] = []
vi.mock('../../native-chat/agent-session-wire/acquisition/structured-agent-session-create', () => ({
  createStructuredAgentSession: (_ctx: unknown, _caller: unknown, params: never) => {
    createdChats.push(params)
    return Promise.resolve({ ok: true })
  }
}))
const { structuredAgentSessionEntryDelegates } =
  await import('../../native-chat/agent-session-wire/acquisition/structured-agent-session-entry-delegates')

const ACCOUNT = { id: 'acct-1', email: 'dev@example.com', managedAuthRuntime: 'host' }
const PROFILE = {
  name: 'reviewer',
  agent: 'claude',
  model: 'sonnet',
  permissionMode: 'accept-edits',
  account: 'dev@example.com',
  mcpProfile: 'review-tools',
  preamble: 'You review code.'
}

let settings: Record<string, unknown>
const signedIn = new Set<string>()
const mcpProfiles = new Set<string>()
let activeDb: OrchestrationDb
let pinFolder: string
let pins: ClaudeSessionAccountPins

const runtime = {
  getOrchestrationDb: () => activeDb,
  getNestedWorkerMaxDepth: () => 4,
  showTerminal: async (handle: string) => ({ handle, worktreeId: 'wt_1' }),
  validateOrchestrationAgentLauncher: () => undefined,
  getTerminalProcessIncarnation: () => 'pid-coordinator',
  getRuntimeId: () => 'runtime_test',
  showManagedTerminalWorkspace: async () => ({ id: 'wt_1', path: '/work/app', repoId: 'repo_1' }),
  getTerminalPaneKey: () => 'tab-c::22222222-2222-4222-8222-222222222222',
  requireStore: () => ({ getSettings: () => settings }),
  notifyMessageArrived: vi.fn()
} as unknown as OrcaRuntimeService

const workspace = {
  id: 'wt_1',
  path: '/work/app',
  connectionId: null,
  repo: null,
  folderWorkspace: null
}
const terminalOpts: TerminalCreateOptions = {
  startupAgent: 'claude',
  launchPreferences: { model: 'sonnet' },
  launchRuntime: {
    platform: 'darwin',
    pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
  }
}

/** What a terminal worker and a chat worker would launch with, in the scope the start set. */
async function launchInScope(): Promise<Seen> {
  const built: TerminalCreateOptions | { refused: string } =
    await resolveAgentTerminalCreateOptions(workspace, terminalOpts, {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal plan reads only getSettings.
      store: { getSettings: () => settings } as never,
      hostIdentity: 'host-1',
      toSessionOptions: (preferences) =>
        preferences
          ? Object.fromEntries(Object.entries(preferences).filter(([, v]) => v))
          : undefined
    }).catch((error: Error) => ({ refused: error.message }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: createStructuredAgentSession is mocked, so the context is never read.
  const delegates = structuredAgentSessionEntryDelegates(() => ({}) as never)
  createdChats.length = 0
  await delegates.create(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked create reads only the params.
    { callerKey: 'k' } as never,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create params with only the fields the hook reads.
    {
      envelope: { sessionId: 'chat-retry' },
      provider: 'claude',
      agent: 'claude',
      location: {},
      options: { model: 'sonnet' }
    } as never
  )
  return {
    ...('refused' in built ? { terminalRefused: built.refused } : {}),
    ...('command' in built && built.command ? { command: built.command } : {}),
    ...('env' in built && built.env ? { env: built.env as Record<string, string> } : {}),
    chat: { options: createdChats[0]?.options, pin: pins.get('chat-retry') },
    ...(currentForkMcpLaunchScope()?.profile ? { mcp: currentForkMcpLaunchScope()!.profile } : {})
  }
}

/** A Task whose first worker started under --profile reviewer, with its MCP profile or not. */
function rig(withMcp = false) {
  const db = new OrchestrationDb(':memory:')
  activeDb = db
  const run = db.createRun({
    objective: 'retry',
    coordinatorHandle: 'term_coordinator',
    coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
  })
  const task = db.createTask({ spec: 'Review the parser.', runId: run.id })
  // The first start, under --profile reviewer: what it stores for the Task.
  withForkMcpLaunchScope(
    {
      request: {
        method: 'orchestration.workerStart',
        params: {
          agent: 'claude',
          forkAgentProfile: 'reviewer',
          ...(withMcp ? { forkMcpProfile: 'review-tools' } : {})
        }
      }
    },
    () => forkStoreDoneContract(db, task.id, {})
  )
  const dispatch = createRootDispatch(db, task.id, 'term_worker')
  db.db
    .prepare(
      "INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options, updated_at) VALUES (?, 'ready', 'wt_1', '{\"agent\":\"claude\"}', datetime('now'))"
    )
    .run(dispatch.id)
  installForkWorkerRetry(runtime, db)
  const kill = () =>
    observeWorker(
      db,
      { kind: 'local', dispatch },
      {
        presence: 'gone',
        fence: 'pid-1',
        legacyStopKey: 'exit:pid-1',
        gone: { from: 'term_worker', reason: 'exited', lastOutput: undefined }
      },
      { getDb: () => db, isWaitingForMail: () => false, notify: vi.fn() }
    )
  return { db, run, task, dispatch, kill }
}

beforeEach(() => {
  vi.useFakeTimers()
  placed.seen = []
  placed.inScope = launchInScope
  settings = {
    forkWorkerRetry: true,
    agentPermissionDefault: 'own',
    forkAgentProfilePermissionCap: 'accept-edits',
    forkAgentProfiles: [PROFILE],
    claudeManagedAccounts: [ACCOUNT]
  }
  signedIn.clear()
  signedIn.add('acct-1')
  mcpProfiles.clear()
  mcpProfiles.add('review-tools')
  setForkMcpProfileCheck((name) => mcpProfiles.has(name))
  pinFolder = mkdtempSync(join(tmpdir(), 'fork-profile-pins-'))
  pins = new ClaudeSessionAccountPins(join(pinFolder, 'pins.json'))
  setClaudeSessionAccountPinsForTests(pins)
  installForkAgentProfileLaunch({
    readSettings: () => settings as never,
    claudeRouter: () => ({
      accountLogin: (id: string) => (signedIn.has(id) ? { email: ACCOUNT.email } : null),
      coveredBySystemDefault: () => false
    })
  })
})

afterEach(async () => {
  vi.useRealTimers()
  setForkMcpProfileCheck(null)
  setClaudeSessionAccountPinsForTests(null)
  await (pins as unknown as { writes: Promise<void> }).writes
  rmSync(pinFolder, { recursive: true, force: true })
})

describe('an automatic retry of a worker started with --profile', () => {
  it('launches a terminal worker with the same mode and account', async () => {
    const { db, kill } = rig()
    kill()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(placed.seen, JSON.stringify(listRetries(db))).toHaveLength(1)
    const seen = placed.seen[0] as Seen
    expect(seen.command).toContain("'--permission-mode' 'acceptEdits'")
    expect(seen.env?.ORCA_FORK_CLAUDE_ACCOUNT).toBe('acct-1')
  })

  it('launches a chat worker with the same mode, account and MCP profile', async () => {
    const { db, task, kill } = rig(true)
    const row = db.db
      .prepare('SELECT * FROM fork_task_agent_profiles WHERE task_id = ?')
      .get(task.id)
    // The stored row names the account by its id, never a credential.
    expect(row).toEqual({
      task_id: task.id,
      profile: 'reviewer',
      preamble: 'You review code.',
      agent: 'claude',
      permission_mode: 'accept-edits',
      account: 'acct-1',
      mcp_profile: 'review-tools'
    })
    kill()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(placed.seen, JSON.stringify(listRetries(db))).toHaveLength(1)
    const seen = placed.seen[0] as Seen
    // A terminal cannot take the MCP profile, so a terminal start refuses rather than drop it.
    expect(seen.terminalRefused).toMatch(/MCP profile "review-tools" applies only to Claude chats/)
    expect(seen.chat).toEqual({
      options: { model: 'sonnet', permissionMode: 'accept-edits' },
      pin: 'acct-1'
    })
    expect(seen.mcp).toBe('review-tools')
    // The retried Task keeps the row as first stored, so a later start is capped from it again.
    const retried = db.db
      .prepare('SELECT task_id FROM fork_task_agent_profiles WHERE task_id != ?')
      .all(task.id)
    expect(retried).toHaveLength(1)
  })

  it('is capped by the policy this host has when it restarts', async () => {
    const { kill } = rig()
    settings = { ...settings, agentPermissionDefault: 'ask' }
    kill()
    await vi.advanceTimersByTimeAsync(31_000)
    const seen = placed.seen[0] as Seen
    expect(seen.command).not.toContain('acceptEdits')
    expect((seen.chat as { options: Record<string, string> }).options.permissionMode).toBe('ask')
  })

  it('does not start on a signed-out account, and says why', async () => {
    const { db, run, kill } = rig()
    signedIn.delete('acct-1')
    kill()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(placed.seen).toHaveLength(0)
    const [entry] = listRetries(db)
    expect(entry).toMatchObject({ status: 'failed' })
    expect(entry?.detail).toMatch(
      /first started with profile "reviewer".*signed out on this computer/
    )
    const [escalation] = db.getUnreadRunMailbox(run.id, 100, ['escalation'])
    expect(escalation?.body).toMatch(/signed out on this computer/)
  })

  it('does not start when the MCP profile is gone from this host', async () => {
    const { db, kill } = rig(true)
    mcpProfiles.clear()
    kill()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(placed.seen).toHaveLength(0)
    expect(listRetries(db)[0]?.detail).toMatch(/Unknown MCP profile "review-tools"/)
  })
})

describe('a follow-up and --retry-of without --profile', () => {
  it('a follow-up through the real startWorkerFollowUp keeps the mode and account', async () => {
    const { db, dispatch } = rig()
    db.failDispatch(dispatch.id, 'exited', { workerProcessExited: true })
    const plan = planWorkerFollowUp(db, dispatch.id, 'dispatch')
    expect(plan?.kind).toBe('start')
    await startWorkerFollowUp({
      ctx: { runtime },
      db,
      plan: plan as Extract<typeof plan, { kind: 'start' }> & object,
      from: 'term_coordinator',
      message: { subject: 'Also the lexer', body: 'Also the lexer.' }
    }).catch(() => undefined)
    const seen = placed.seen[0] as Seen
    expect(seen.command).toContain("'--permission-mode' 'acceptEdits'")
    expect(seen.env?.ORCA_FORK_CLAUDE_ACCOUNT).toBe('acct-1')
  })

  it('--retry-of takes the Task launch; an explicit other agent or --profile wins', async () => {
    const { db, dispatch } = rig()
    const seen = (params: Record<string, string>) =>
      forkWithTaskProfileLaunch(db, params, undefined, launchInScope)
    expect((await seen({ retryOf: dispatch.id })).env?.ORCA_FORK_CLAUDE_ACCOUNT).toBe('acct-1')
    expect(
      (await seen({ retryOf: dispatch.id, agent: 'codex' })).env?.ORCA_FORK_CLAUDE_ACCOUNT
    ).toBeUndefined()
    settings = {
      ...settings,
      forkAgentProfiles: [PROFILE, { name: 'plain', agent: 'claude' }]
    }
    const own = await withForkMcpLaunchScope(
      {
        request: {
          method: 'orchestration.workerStart',
          params: { agent: 'claude', forkAgentProfile: 'plain', retryOf: dispatch.id }
        }
      },
      () => seen({ retryOf: dispatch.id })
    )
    expect(own.command).not.toContain('--permission-mode')
  })
})

describe('a chat worker', () => {
  it('first start reads its account pin before the pin file is written', async () => {
    const { db, task } = rig()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: createStructuredAgentSession is mocked, so the context is never read.
    const delegates = structuredAgentSessionEntryDelegates(() => ({}) as never)
    const router = {
      savedAccount: (id: string) => id === 'acct-1',
      coveredBySystemDefault: () => false,
      accountHome: (id: string) => `/homes/${id}`,
      systemDefaultHome: () => '/homes/system',
      pointerPath: '/homes/pointer'
    }
    const write = vi.spyOn(pins as never, 'write' as never)
    let homeAtCreate: unknown
    vi.mocked(createdChats).length = 0
    await forkWithTaskProfileLaunch(db, { task: task.id }, undefined, () => {
      const created = delegates.create(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked create reads only the params.
        { callerKey: 'k' } as never,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create params with only the fields the hook reads.
        {
          envelope: { sessionId: 'chat-new' },
          provider: 'claude',
          agent: 'claude',
          location: {}
        } as never
      )
      // The chat's first start reads the pin synchronously, as the launch does, before any save.
      homeAtCreate = forkPinnedClaudeAccountHome(
        { sessionId: 'chat-new', provider: 'claude', location: {} } as never,
        {},
        router as never,
        pins
      )
      return created
    })
    expect(write).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(homeAtCreate)).toContain('/homes/acct-1')
  })

  it('that resumes its own session keeps the mode the session was created with', async () => {
    // A follow-up reopens the same session rather than creating one. Every start of a session,
    // a resume too, launches on the permission mode saved on its record at creation.
    const { db, task } = rig()
    const seen = await forkWithTaskProfileLaunch(db, { task: task.id }, undefined, launchInScope)
    const options = (seen.chat as { options: Record<string, string> }).options
    const record = agentSessionRecordIdentityFields(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the record keeps for this.
      { sessionId: 'chat-retry', provider: 'claude', location: {}, options } as never,
      0
    )
    expect(record.permissionMode).toBe('accept-edits')
    const relaunch = await structuredAgentSessionLaunchPermission(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch read asks only whether the agent is registered.
      { agents: { definition: () => ({}) } } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the record fields the launch read takes.
      record as never
    )
    expect(relaunch).toBe('accept-edits')
  })
})

describe('an MCP profile where it cannot apply', () => {
  const start = (params: Record<string, string>) =>
    withForkMcpLaunchScope(
      { request: { method: 'orchestration.workerStart', params } },
      () => 'ran'
    )

  it('refuses worker-start --on, and a start of an agent with no MCP profiles, before running', () => {
    expect(() =>
      start({ agent: 'claude', on: 'server-a', forkMcpProfile: 'review-tools' })
    ).toThrow(/cannot be applied on paired server server-a yet.*Nothing was started/)
    expect(() => start({ agent: 'codex', forkMcpProfile: 'review-tools' })).toThrow(
      /applies only to Claude chats, and codex takes none/
    )
    mcpProfiles.add('all')
    expect(start({ agent: 'claude', on: 'server-a', forkMcpProfile: 'all' })).toBe('ran')
  })

  it('refuses a --retry-of --on of a Task first started with one', async () => {
    const { db, dispatch } = rig(true)
    expect(() =>
      forkWithTaskProfileLaunch(
        db,
        { retryOf: dispatch.id, on: 'server-a' },
        undefined,
        () => 'ran'
      )
    ).toThrow(/cannot be applied on paired server server-a/)
  })

  it('leaves a terminal launch with no MCP profile byte for byte as it was', async () => {
    const plain = await launchInScope()
    const named = await withForkMcpLaunchScope(
      { request: { method: 'orchestration.workerStart', params: { agent: 'claude' } } },
      launchInScope
    )
    expect(plain.terminalRefused).toBeUndefined()
    expect(named.command).toBe(plain.command)
    expect(named.env).toEqual(plain.env)
  })
})

describe('worker-start --task --retry-of through the real method', () => {
  it('starts under the Task profile when it names none of its own', async () => {
    const { db, task, dispatch } = rig()
    db.failDispatch(dispatch.id, 'exited', { workerProcessExited: true })
    db.db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(task.id)
    const method = ORCHESTRATION_WORKER_START_METHODS.find(
      (entry) => entry.name === 'orchestration.workerStart'
    )!
    const outcome = await method
      .handler(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the parsed params a CLI start sends.
        {
          from: 'term_coordinator',
          task: task.id,
          retryOf: dispatch.id,
          agent: 'claude',
          worktree: 'id:wt_1'
        } as never,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the context fields worker-start reads.
        { runtime } as never
      )
      .catch((error: Error) => error.message)
    expect(placed.seen, String(outcome)).toHaveLength(1)
    const seen = placed.seen[0] as Seen
    expect(seen.command).toContain("'--permission-mode' 'acceptEdits'")
    expect(seen.env?.ORCA_FORK_CLAUDE_ACCOUNT).toBe('acct-1')
  })
})
