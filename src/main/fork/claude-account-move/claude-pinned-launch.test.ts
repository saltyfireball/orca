import { describe, expect, it, vi } from 'vitest'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../shared/claude-profile-routing'
import type { ClaudeManagedAccount } from '../../../shared/managed-account-types'
import { POSIX_PROVIDER_SUPERVISOR_SCRIPT } from '../../provider-process/provider-process-supervisor'
import { chatSurviveLaunchHash } from '../chat-survive/chat-survive-launch-hash'
import { forkPinnedClaudeAccountHome, forkPinnedClaudeLaunchAccount } from './claude-pinned-launch'
import type { PinnedClaudeRouter } from './claude-pinned-route'
import type { ClaudeSessionPin } from './claude-session-account-pins'

const SAVED = new Set(['acct-a', 'acct-b'])

function account(id: string): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@example.test`,
    managedAuthPath: `/fake/orca/claude-accounts/${id}`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

function fakeRouter(): PinnedClaudeRouter {
  return {
    pointerPath: '/fake/orca/claude-pointer',
    savedAccount: (id) => (SAVED.has(id) ? account(id) : undefined),
    coveredBySystemDefault: () => false,
    accountHome: (id) => `/fake/orca/claude-accounts/${id}`,
    systemDefaultHome: () => '/fake/home/.claude',
    prepareAccount: vi.fn(async (id: string) => `/fake/orca/claude-accounts/${id}`)
  }
}

function pins(entries: Record<string, ClaudeSessionPin>) {
  return { get: (id: string) => (id in entries ? entries[id] : undefined) }
}

/** The env stock's router gives a launch on account A. */
function launchedOnA(): Record<string, string> {
  const home = '/fake/orca/claude-accounts/acct-a'
  return {
    PATH: '/bin',
    [CLAUDE_PROFILE_POINTER_ENV]: '/fake/orca/claude-pointer',
    CLAUDE_CONFIG_DIR: home,
    [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home
  }
}

const SPEC: PipedProcessSpec = {
  program: '/bin/sh',
  args: ['-e', POSIX_PROVIDER_SUPERVISOR_SCRIPT, '--', 'claude', '--resume', 'abc'],
  cwd: '/work',
  stdio: 'pipe'
}

describe('pinned Claude launch', () => {
  it('leaves an unpinned chat to the stock selection', async () => {
    const env = launchedOnA()
    expect(await forkPinnedClaudeLaunchAccount(fakeRouter(), env, 's1', pins({}))).toBeNull()
    expect(env).toEqual(launchedOnA())
  })

  it('launches a moved chat on its account, under a launch hash chat-survive will not adopt', async () => {
    const before = chatSurviveLaunchHash(SPEC, launchedOnA())
    const env = launchedOnA()
    const recipe = await forkPinnedClaudeLaunchAccount(
      fakeRouter(),
      env,
      's1',
      pins({ s1: 'acct-b' })
    )
    expect(recipe).toEqual({
      route: 'managed',
      accountId: 'acct-b',
      home: '/fake/orca/claude-accounts/acct-b'
    })
    expect(env.CLAUDE_CONFIG_DIR).toBe('/fake/orca/claude-accounts/acct-b')
    expect(env[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe('/fake/orca/claude-accounts/acct-b')
    expect(chatSurviveLaunchHash(SPEC, env)).not.toBe(before)
  })

  it('moves a chat to System default by dropping only Orca injected folder', async () => {
    const before = chatSurviveLaunchHash(SPEC, launchedOnA())
    const env = launchedOnA()
    const recipe = await forkPinnedClaudeLaunchAccount(fakeRouter(), env, 's1', pins({ s1: null }))
    expect(recipe).toEqual({ route: 'system', home: '/fake/home/.claude', configDir: null })
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBeUndefined()
    expect(chatSurviveLaunchHash(SPEC, env)).not.toBe(before)

    const own = {
      ...launchedOnA(),
      CLAUDE_CONFIG_DIR: '/mine',
      [CLAUDE_INJECTED_CONFIG_DIR_ENV]: ''
    }
    await forkPinnedClaudeLaunchAccount(fakeRouter(), own, 's1', pins({ s1: null }))
    expect(own.CLAUDE_CONFIG_DIR).toBe('/mine')
  })

  it('reads the same home the launch uses, so the outgrown-child check settles', async () => {
    const record: Pick<AgentSessionRecord, 'sessionId' | 'provider' | 'location'> = {
      sessionId: 's1',
      provider: 'claude',
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'w1',
        workspaceKind: 'git-worktree'
      }
    }
    const router = fakeRouter()
    const home = forkPinnedClaudeAccountHome(record, launchedOnA(), router, pins({ s1: 'acct-b' }))
    expect(home).toEqual({
      variable: 'CLAUDE_CONFIG_DIR',
      path: '/fake/orca/claude-accounts/acct-b'
    })
    expect(forkPinnedClaudeAccountHome(record, launchedOnA(), router, pins({ s1: null }))).toEqual({
      variable: 'CLAUDE_CONFIG_DIR',
      path: '/fake/home/.claude'
    })
    // A removed account, a WSL chat or no pin: stock decides.
    expect(forkPinnedClaudeAccountHome(record, {}, router, pins({ s1: 'gone' }))).toBeNull()
    expect(forkPinnedClaudeAccountHome(record, {}, router, pins({}))).toBeNull()
    const wsl = { ...record, location: { ...record.location, wslDistro: 'Ubuntu' } }
    expect(forkPinnedClaudeAccountHome(wsl, {}, router, pins({ s1: 'acct-b' }))).toBeNull()
  })
})
