import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from '../../agent-hook-server'
import { buildBody } from '../server.test-fixtures'
import {
  AGENT_TOOL_DECISION_HEADER,
  CLAUDE_PRE_TOOL_USE_DECISION
} from '../../../tool-events/agent-tool-plugin-hooks'
import {
  forkCommandGuardList,
  startForkCommandGuards
} from '../../../../fork/command-guards/command-guards-live'

vi.mock('../../../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

const WORKTREE = 'repo-1::/work/repo-a'
let server: AgentHookServer
let hookUrl: string
let hookToken: string
let settings: Record<string, unknown>

function useSettings(next: Record<string, unknown>): void {
  settings = next
  startForkCommandGuards({
    requireStore: () => ({ getSettings: () => settings, getRepos: () => [] })
  })
}

beforeEach(async () => {
  _internals.resetCachesForTests()
  useSettings({})
  server = new AgentHookServer()
  await server.start({ env: 'production' })
  const env = server.buildPtyEnv()
  hookUrl = `http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/claude`
  hookToken = env.ORCA_AGENT_HOOK_TOKEN
})

afterEach(() => {
  server.stop()
  vi.restoreAllMocks()
})

async function bash(command: string, decides = true): Promise<{ status: number; body: string }> {
  const response = await fetch(hookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orca-Agent-Hook-Token': hookToken,
      ...(decides ? { [AGENT_TOOL_DECISION_HEADER]: CLAUDE_PRE_TOOL_USE_DECISION } : {})
    },
    body: JSON.stringify(
      buildBody(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command },
          tool_use_id: 'toolu_guard_1'
        },
        { worktreeId: WORKTREE }
      )
    )
  })
  return { status: response.status, body: await response.text() }
}

describe('command guards at the Claude PreToolUse hook', () => {
  it('denies rm -rf .. with the reason and writes the audit entry', async () => {
    const reply = await bash('rm -rf ..')
    expect(reply.status).toBe(200)
    const decision = JSON.parse(reply.body).hookSpecificOutput
    expect(decision.hookEventName).toBe('PreToolUse')
    expect(decision.permissionDecision).toBe('deny')
    expect(decision.permissionDecisionReason).toContain('delete-outside-workspace')
    expect(forkCommandGuardList().entries[0]).toMatchObject({
      agent: 'claude',
      workspaceId: WORKTREE,
      rule: 'delete-outside-workspace',
      command: 'rm -rf ..'
    })
  })

  it('lets a safe command through', async () => {
    expect((await bash('rm -rf build')).status).toBe(204)
  })

  it('denies git push --force until the project allows the rule', async () => {
    expect((await bash('git push --force origin feature')).status).toBe(200)
    useSettings({ forkCommandGuardProjectRules: { 'repo-1': 'force-push' } })
    expect((await bash('git push --force origin feature')).status).toBe(204)
    useSettings({ forkCommandGuards: false })
    expect((await bash('rm -rf ..')).status).toBe(204)
  })

  it('does not block when the hook script does not read the answer', async () => {
    expect((await bash('rm -rf ..', false)).status).toBe(204)
  })
})
