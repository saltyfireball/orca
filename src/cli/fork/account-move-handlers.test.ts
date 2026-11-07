import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient, RuntimeClientError } from '../runtime-client'
import { FORK_ACCOUNT_MOVE_HANDLERS, formatWhich } from './account-move-handlers'
import type { RuntimeRpcSuccess } from '../../shared/runtime-rpc-envelope'

/** A fake paired host answering accounts.list and the fork move RPC. */
function remoteHost(answers: Record<string, unknown>) {
  const client = new RuntimeClient('/tmp/orca-account-move-test', 60_000, null, null)
  vi.spyOn(client, 'isRemote', 'get').mockReturnValue(true)
  const call = vi.fn(async (method: string) => {
    if (!(method in answers)) {
      throw new RuntimeClientError('method_not_found', method)
    }
    const reply: RuntimeRpcSuccess<unknown> = {
      id: 'req',
      ok: true,
      result: answers[method],
      _meta: { runtimeId: 'remote-1' }
    }
    return reply
  })
  vi.spyOn(client, 'call').mockImplementation(call)
  return { client, call }
}

function run(
  command: 'account which' | 'account move',
  client: RuntimeClient,
  flags: [string, string | boolean][]
) {
  return FORK_ACCOUNT_MOVE_HANDLERS[command]({
    flags: new Map(flags),
    client,
    cwd: '/tmp/worktree',
    json: false
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('orca account move', () => {
  it('resolves the account by email on the remote host and moves the named chat', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { client, call } = remoteHost({
      'accounts.list': { claude: { accounts: [{ id: 'r2', email: 'Work@Example.test' }] } },
      'fork.claudeAccount.move': {
        host: 'devbox',
        accountId: 'r2',
        results: [{ sessionId: 's1', name: 'Release', status: 'queued', busy: 'turn' }]
      }
    })
    await run('account move', client, [
      ['account', 'work@example.test'],
      ['session', 's1']
    ])
    expect(call).toHaveBeenLastCalledWith('fork.claudeAccount.move', {
      accountId: 'r2',
      sessionId: 's1'
    })
    expect(log.mock.calls[0][0]).toContain('Queued Release (s1)')
    expect(log.mock.calls[0][0]).toContain('--now')
  })

  it('needs a session or worktree on a remote host and rejects a valued --now', async () => {
    const { client } = remoteHost({})
    await expect(run('account move', client, [['account', 'system']])).rejects.toThrow(
      '--session <id> or --worktree'
    )
    await expect(
      run('account move', client, [
        ['account', 'system'],
        ['session', 's1'],
        ['now', 'later']
      ])
    ).rejects.toThrow('--now takes no value')
  })

  it('names a host without the fork methods as incompatible', async () => {
    const { client } = remoteHost({})
    await expect(run('account which', client, [])).rejects.toMatchObject({
      code: 'incompatible_runtime'
    })
  })
})

describe('formatWhich', () => {
  it('shows the host and a pending move', () => {
    const text = formatWhich({
      host: 'devbox',
      sessions: [
        {
          sessionId: 's1',
          name: 'Release',
          workspaceId: 'w1',
          host: 'devbox',
          accountId: 'r2',
          accountLabel: 'r2@example.test',
          runningAccountId: 'r1',
          pinned: true,
          pending: true,
          busy: 'turn'
        }
      ]
    })
    expect(text.split('\n')[0]).toMatch(/^HOST\s+SESSION\s+CHAT\s+ACCOUNT\s+STATE$/)
    expect(text).toContain('devbox')
    expect(text).toContain('r2@example.test (moved)')
    expect(text).toContain('move waiting for its turn to end; a turn is running')
  })
})
