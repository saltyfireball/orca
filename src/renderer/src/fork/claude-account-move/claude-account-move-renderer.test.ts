import { afterEach, describe, expect, it, vi } from 'vitest'
import { FORK_CLAUDE_TERMINAL_ACCOUNT_ENV } from '../../../../shared/fork/claude-account-move'
import type { ClaudeManagedAccountSummary } from '../../../../shared/managed-account-types'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import {
  queueClaudePaneAccountMoves,
  resetClaudePaneAccountMovesForTests,
  withForkClaudePaneAccount
} from './claude-pane-account-move'
import { moveAccountChoices, usageText } from './use-fork-claude-move-accounts'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

const usage = (usedPercent: number) => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt: null,
  resetDescription: null
})

function account(
  id: string,
  extra: Partial<ClaudeManagedAccountSummary> = {}
): ClaudeManagedAccountSummary {
  return {
    id,
    email: `${id}@example.test`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...extra
  }
}

describe('moveAccountChoices', () => {
  it("lists System default and the host's own accounts with each one's usage", () => {
    const rateLimits: RateLimitState = createEmptyRateLimitState({
      claude: {
        provider: 'claude',
        session: usage(40),
        weekly: usage(10),
        updatedAt: 1,
        error: null,
        status: 'ok'
      },
      inactiveClaudeAccounts: [
        {
          accountId: 'b',
          rateLimits: {
            provider: 'claude',
            session: usage(5),
            weekly: null,
            updatedAt: 1,
            error: null,
            status: 'ok'
          },
          updatedAt: 1,
          isFetching: false
        }
      ]
    })
    const choices = moveAccountChoices(
      {
        accounts: [account('a'), account('b'), account('w', { managedAuthRuntime: 'wsl' })],
        activeAccountId: 'a',
        activeAccountIdsByRuntime: { host: 'a', wsl: {} }
      },
      rateLimits
    )
    expect(choices.map((choice) => choice.id)).toEqual([null, 'a', 'b'])
    expect(usageText(choices[1])).toBe('5h 40% / week 10%')
    expect(usageText(choices[2])).toBe('5h 5%')
    expect(usageText(choices[0])).toBe('no usage yet')
  })
})

describe('Claude terminal pane moves', () => {
  afterEach(() => {
    resetClaudePaneAccountMovesForTests()
  })

  it('restarts only Claude panes, each once, with the account marker', () => {
    const claudePane = makePaneKey('tab-1', LEAF_A)
    const queuePaneAccountRestarts = vi.fn()
    const count = queueClaudePaneAccountMoves(
      {
        tabsByWorktree: { w1: [{ id: 'tab-1' }] },
        terminalLayoutsByTabId: {
          'tab-1': {
            ptyIdsByLeafId: { [LEAF_A]: 'pty-a', [LEAF_B]: 'pty-b' }
          }
        },
        agentStatusByPaneKey: {
          [claudePane]: { agentType: 'claude' },
          [makePaneKey('tab-1', LEAF_B)]: { agentType: 'codex' }
        },
        queuePaneAccountRestarts
      },
      'w1',
      null
    )
    expect(count).toBe(1)
    expect(queuePaneAccountRestarts).toHaveBeenCalledWith(['pty-a'], 'claude')
    const startup = { command: 'claude --resume x', env: { A: '1' } }
    expect(withForkClaudePaneAccount(startup, 'claude', claudePane)?.env).toEqual({
      A: '1',
      [FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]: 'system'
    })
    expect(withForkClaudePaneAccount(startup, 'claude', claudePane)).toBe(startup)
  })
})
