// BAD-741 proof: a `--profile` launch reaches the real launch builders with the profile's
// permission mode, account and preamble, capped by this host's policy and refused when it cannot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAgentTerminalCreateOptions } from '../../runtime/terminal/launch/runtime-agent-terminal-startup'
import { buildDispatchPreamble } from '../../runtime/orchestration/workers/launch/worker-dispatch-preamble'
import { withForkMcpLaunchScope } from '../mcp-profiles/mcp-launch-scope'
import { forkFederatedCarry } from '../completion-contract/contract-carry-start'
import {
  ClaudeSessionAccountPins,
  setClaudeSessionAccountPinsForTests
} from '../claude-account-move/claude-session-account-pins'
import { installForkAgentProfileLaunch } from './agent-profile-launch-scope'
import { ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY } from '../../../shared/orchestration/orchestration-runtime-capabilities'
import type { TerminalCreateOptions } from '../../runtime/terminal/launch/terminal-create-options'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import '../../runtime/orchestration/db/contract-constants'
import '../../runtime/orchestration/db/messages/mailbox-routing-page'
import '../../runtime/orchestration/db/dispatch-row-writer'
import '../../runtime/orchestration/db/attempt-outcome-projection'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { forkStoreDoneContract } from '../completion-contract/completion-gate-live'
import { resetForkTaskProfilePreamblesForTests } from './agent-profile-task-store'

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

function settings(extra: Record<string, unknown> = {}) {
  return {
    agentPermissionDefault: 'own',
    forkAgentProfiles: [
      {
        name: 'reviewer',
        agent: 'claude',
        model: 'sonnet',
        permissionMode: 'full-access',
        account: 'dev@example.com',
        preamble: 'You review code.'
      }
    ],
    claudeManagedAccounts: [ACCOUNT],
    ...extra
  }
}

let current = settings()
const signedIn = new Set(['acct-1'])
const savedPins = new Map<string, string | null>()
let pins: ClaudeSessionAccountPins

beforeEach(() => {
  current = settings()
  createdChats.length = 0
  pins = new ClaudeSessionAccountPins('/nonexistent/fork-claude-session-accounts.json')
  savedPins.clear()
  vi.spyOn(pins, 'set').mockImplementation(async (id, pin) => {
    savedPins.set(id, pin ?? null)
  })
  setClaudeSessionAccountPinsForTests(pins)
  installForkAgentProfileLaunch({
    readSettings: () => current,
    claudeRouter: () => ({
      accountLogin: (id: string) => (signedIn.has(id) ? { email: ACCOUNT.email } : null),
      coveredBySystemDefault: () => false
    })
  })
})

afterEach(() => {
  setClaudeSessionAccountPinsForTests(null)
  vi.restoreAllMocks()
})

function call(method: string, params: Record<string, unknown>) {
  return { request: { method, params } }
}

const workspace = {
  id: 'wt-1',
  path: '/tmp/repo',
  connectionId: null,
  repo: null,
  folderWorkspace: null
}

function terminalPlan(opts: TerminalCreateOptions) {
  return resolveAgentTerminalCreateOptions(workspace, opts, {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal plan reads only getSettings.
    store: { getSettings: () => current } as never,
    hostIdentity: 'host-1',
    toSessionOptions: (preferences) =>
      preferences
        ? Object.fromEntries(Object.entries(preferences).filter(([, value]) => value))
        : undefined
  })
}

const terminalOpts: TerminalCreateOptions = {
  startupAgent: 'claude',
  launchPreferences: { model: 'sonnet' },
  launchRuntime: {
    platform: 'darwin',
    pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
  }
}

describe('worker-start --profile on a terminal worker', () => {
  it('launches with the capped permission mode and the account marker', async () => {
    const built = await withForkMcpLaunchScope(
      call('orchestration.workerStart', { agent: 'claude', forkAgentProfile: 'reviewer' }),
      () => terminalPlan(terminalOpts)
    )
    // full-access is wider than the default cap (accept-edits), so accept-edits is applied.
    expect(built.command).toContain("'--permission-mode' 'acceptEdits'")
    expect(built.command).not.toContain("'--dangerously-skip-permissions'")
    expect(built.command).toContain('sonnet')
    expect(built.env?.ORCA_FORK_CLAUDE_ACCOUNT).toBe('acct-1')
  })

  it('uses the full mode when Settings > Agents allows it', async () => {
    current = settings({ agentPermissionDefault: 'full-access' })
    const built = await withForkMcpLaunchScope(
      call('orchestration.workerStart', { agent: 'claude', forkAgentProfile: 'reviewer' }),
      () => terminalPlan(terminalOpts)
    )
    expect(built.command).toContain("'--dangerously-skip-permissions'")
  })

  it('leaves a launch without --profile as stock', async () => {
    const built = await withForkMcpLaunchScope(
      call('orchestration.workerStart', { agent: 'claude' }),
      () => terminalPlan(terminalOpts)
    )
    expect(built.command).not.toContain('--permission-mode')
    expect(built.env?.ORCA_FORK_CLAUDE_ACCOUNT).toBeUndefined()
  })

  it('refuses a signed-out or missing account before running anything', () => {
    const run = vi.fn()
    signedIn.delete('acct-1')
    expect(() =>
      withForkMcpLaunchScope(
        call('orchestration.workerStart', { agent: 'claude', forkAgentProfile: 'reviewer' }),
        run
      )
    ).toThrow(/signed out on this computer/)
    signedIn.add('acct-1')
    current = settings({ claudeManagedAccounts: [] })
    expect(() =>
      withForkMcpLaunchScope(
        call('orchestration.workerStart', { agent: 'claude', forkAgentProfile: 'reviewer' }),
        run
      )
    ).toThrow(/does not exist on this computer/)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('--profile on a chat launch', () => {
  it('seeds the chat permission mode and pins the chat to the account', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: createStructuredAgentSession is mocked, so the context is never read.
    const delegates = structuredAgentSessionEntryDelegates(() => ({}) as never)
    await withForkMcpLaunchScope(
      call('agent.launch', { agent: 'claude', forkAgentProfile: 'reviewer' }),
      () =>
        delegates.create(
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked create reads only the params.
          { callerKey: 'k' } as never,
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create params with only the fields the hook reads.
          {
            envelope: { sessionId: 'chat-1' },
            provider: 'claude',
            agent: 'claude',
            location: {},
            options: { model: 'sonnet', permissionMode: 'ask' }
          } as never
        )
    )
    expect(createdChats[0]?.options).toEqual({ model: 'sonnet', permissionMode: 'accept-edits' })
    expect(savedPins.get('chat-1')).toBe('acct-1')
  })
})

describe('the profile preamble on a worker', () => {
  const base = {
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    coordinatorHandle: 'term_c',
    workerHandle: 'term_w'
  }

  it('goes in front of a --task spec that has none, and only once when the spec has it', () => {
    const scope = call('orchestration.workerStart', {
      agent: 'claude',
      task: 'task_1',
      forkAgentProfile: 'reviewer'
    })
    const plain = withForkMcpLaunchScope(scope, () =>
      buildDispatchPreamble({ ...base, taskSpec: 'Fix the parser.' })
    )
    expect(plain).toContain('=== TASK ===\nYou review code.\n\nFix the parser.')
    const both = withForkMcpLaunchScope(scope, () =>
      buildDispatchPreamble({ ...base, taskSpec: 'You review code.\n\nFix the parser.' })
    )
    expect(both.split('You review code.')).toHaveLength(2)
  })

  it('a follow-up or automatic retry without --profile still sends it, once', () => {
    resetForkTaskProfilePreamblesForTests()
    const db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'p',
      coordinatorHandle: 'term_c',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a well-formed pane key; the brand only marks it as parsed.
      coordinatorPaneKey: 'tab-c::22222222-2222-4222-8222-222222222222' as never
    })
    const first = db.createTask({ spec: 'Fix the parser.', runId: run.id })
    withForkMcpLaunchScope(
      call('orchestration.workerStart', {
        agent: 'claude',
        task: first.id,
        forkAgentProfile: 'reviewer'
      }),
      () => forkStoreDoneContract(db, first.id, {})
    )
    const dispatch = createRootDispatch(db, first.id, 'term_w')
    const followUp = db.createTask({ spec: 'Also the lexer.', runId: run.id })
    resetForkTaskProfilePreamblesForTests()
    forkStoreDoneContract(db, followUp.id, {}, dispatch.id)
    const text = buildDispatchPreamble({
      ...base,
      taskId: followUp.id,
      taskSpec: 'Also the lexer.'
    })
    expect(text).toContain('=== TASK ===\nYou review code.\n\nAlso the lexer.')
    resetForkTaskProfilePreamblesForTests()
    forkStoreDoneContract(db, first.id, { retryOf: dispatch.id })
    const retried = buildDispatchPreamble({
      ...base,
      taskId: first.id,
      taskSpec: 'Fix the parser.'
    })
    expect(retried.split('You review code.')).toHaveLength(2)
  })

  it('is refused while an imported preamble is unconfirmed', () => {
    current = settings({
      forkAgentProfiles: [
        { name: 'reviewer', agent: 'claude', preamble: 'x', imported: { path: '/a.md' } }
      ]
    })
    expect(() =>
      withForkMcpLaunchScope(
        call('orchestration.workerStart', { agent: 'claude', forkAgentProfile: 'reviewer' }),
        () => undefined
      )
    ).toThrow(/has not been confirmed/)
  })
})

describe('worker-start --profile --on a paired server', () => {
  const db = new OrchestrationDb(':memory:')
  const startOn = call('orchestration.workerStart', {
    agent: 'claude',
    on: 'server-a',
    forkAgentProfile: 'reviewer'
  })

  it('carries the home resolution to a server that takes it', () => {
    current = settings({ claudeManagedAccounts: [] })
    const wire = withForkMcpLaunchScope(startOn, () =>
      forkFederatedCarry(db, {}, undefined, 'server-a', [
        ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY,
        'orchestration.fork-contract-carry.v1'
      ])
    )
    expect(wire('task_1')).toMatchObject({
      forkAgentProfileLaunch: {
        name: 'reviewer',
        agent: 'claude',
        permissionMode: 'accept-edits',
        account: 'dev@example.com',
        preamble: 'You review code.'
      }
    })
  })

  it('refuses an older server before anything is created', () => {
    expect(() =>
      withForkMcpLaunchScope(startOn, () => forkFederatedCarry(db, {}, undefined, 'server-a', []))
    ).toThrow(/cannot apply profile "reviewer"/)
  })

  it('the server applies it, or refuses a mode wider than its own policy', async () => {
    const wire = {
      name: 'reviewer',
      agent: 'claude',
      permissionMode: 'accept-edits',
      account: 'dev@example.com'
    }
    const attach = call('orchestration.federationAttachStart', {
      agent: 'claude',
      forkAgentProfileLaunch: wire
    })
    const built = await withForkMcpLaunchScope(attach, () => terminalPlan(terminalOpts))
    expect(built.command).toContain("'--permission-mode' 'acceptEdits'")
    expect(built.env?.ORCA_FORK_CLAUDE_ACCOUNT).toBe('acct-1')
    current = settings({ agentPermissionDefault: 'ask' })
    expect(() => withForkMcpLaunchScope(attach, () => undefined)).toThrow(
      /wider than this computer's Settings allow/
    )
  })
})
