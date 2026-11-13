import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../shared/claude-profile-routing'
import { FORK_CLAUDE_TERMINAL_ACCOUNT_ENV } from '../../../shared/fork/claude-account-move'
import type { ClaudeRuntimeAuthPreparation } from '../../claude-accounts/runtime-auth/runtime-auth-types'
import type { ClaudeAccountSelectionTarget } from '../../claude-accounts/selection/runtime-selection'
import type { PinnedClaudeRouter } from './claude-pinned-route'
import { forkPinTerminalClaudeAccount } from './claude-terminal-account-pin'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fakeRouter(): PinnedClaudeRouter {
  const dir = mkdtempSync(join(tmpdir(), 'fork-pane-pin-'))
  dirs.push(dir)
  return {
    pointerPath: join(dir, 'claude-pointer'),
    savedAccount: (id) =>
      id === 'b'
        ? {
            id,
            email: 'b@example.test',
            managedAuthPath: join(dir, 'b'),
            authMethod: 'subscription-oauth',
            createdAt: 0,
            updatedAt: 0,
            lastAuthenticatedAt: 0
          }
        : undefined,
    coveredBySystemDefault: () => false,
    accountHome: (id) => join(dir, 'accounts', id),
    systemDefaultHome: () => '/fake/home/.claude'
  }
}

const AUTH: ClaudeRuntimeAuthPreparation = {
  configDir: '/fake/accounts/a',
  runtime: 'host',
  envPatch: {
    [CLAUDE_PROFILE_POINTER_ENV]: '/global-pointer',
    CLAUDE_CONFIG_DIR: '/fake/accounts/a',
    [CLAUDE_INJECTED_CONFIG_DIR_ENV]: '/fake/accounts/a'
  },
  provenance: 'profile:a'
}

describe('forkPinTerminalClaudeAccount', () => {
  it('leaves a pane without the marker alone', () => {
    const env = { [CLAUDE_PROFILE_POINTER_ENV]: '/global-pointer' }
    expect(forkPinTerminalClaudeAccount(env, undefined, AUTH, fakeRouter())).toEqual({
      env,
      auth: AUTH
    })
  })

  it('gives a moved pane its own pointer naming the account', () => {
    const router = fakeRouter()
    const { env, auth } = forkPinTerminalClaudeAccount(
      { [FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]: 'b', [CLAUDE_PROFILE_POINTER_ENV]: '/global-pointer' },
      { runtime: 'host' },
      AUTH,
      router
    )
    const pointer = env?.[CLAUDE_PROFILE_POINTER_ENV] ?? ''
    expect(pointer).not.toBe('/global-pointer')
    expect(readFileSync(pointer, 'utf8')).toBe(router.accountHome('b'))
    expect(env?.[FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]).toBeUndefined()
    expect(auth?.envPatch).toMatchObject({
      [CLAUDE_PROFILE_POINTER_ENV]: pointer,
      CLAUDE_CONFIG_DIR: router.accountHome('b')
    })
  })

  it('points a pane moved to System default at an empty pointer', () => {
    const { env, auth } = forkPinTerminalClaudeAccount(
      { [FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]: 'system' },
      undefined,
      AUTH,
      fakeRouter()
    )
    expect(readFileSync(env?.[CLAUDE_PROFILE_POINTER_ENV] ?? '', 'utf8')).toBe('')
    expect(auth?.envPatch.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(auth?.configDir).toBe('/fake/home/.claude')
  })

  it('drops the marker without routing a WSL pane or a removed account', () => {
    const cases: [string, ClaudeAccountSelectionTarget | undefined][] = [
      ['b', { runtime: 'wsl', wslDistro: 'Ubuntu' }],
      ['gone', undefined]
    ]
    for (const [marker, target] of cases) {
      const result = forkPinTerminalClaudeAccount(
        { [FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]: marker },
        target,
        AUTH,
        fakeRouter()
      )
      expect(result).toEqual({ env: {}, auth: AUTH })
    }
  })
})
