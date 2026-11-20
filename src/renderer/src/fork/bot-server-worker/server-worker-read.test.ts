import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BotOnHost } from '@/lib/bot-hosts'
import type { BotChatTreeWorker } from '../../../../shared/bots/bot-chat-tree'
import { readForkServerWorker, type ForkServerCall } from './server-worker-read'
import { forkServerWorkerOpen } from './fork-server-worker-open'

const openOrchestrationWorker = vi.fn()
vi.mock('@/lib/open-orchestration-worker', () => ({
  openOrchestrationWorker: (...args: unknown[]) => openOrchestrationWorker(...args)
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: vi.fn() }))

const WORKTREE = 'repo-1::/Users/me/orca/workspaces/farnsworth/marron'

function server(answers: Record<string, unknown>): { call: ForkServerCall; calls: unknown[][] } {
  const calls: unknown[][] = []
  const call = async <T>(target: unknown, method: string, params: unknown): Promise<T> => {
    calls.push([target, method, params])
    if (!(method in answers)) {
      throw new Error(`no ${method}`)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each answer is the shape its method's reader asks for.
    return answers[method] as T
  }
  return { call, calls }
}

describe('readForkServerWorker', () => {
  it('asks the worker’s own server for the Dispatch, its workspace and its linked PR', async () => {
    const { call, calls } = server({
      'orchestration.workerShow': {
        worker: { state: 'ready', worktreeId: WORKTREE },
        terminal: { lastOutputAt: 1_000 },
        observation: { status: 'live' }
      },
      'worktree.show': { worktree: { linkedPR: 12, repoId: 'repo-1' } },
      'github.repoSlug': { owner: 'acme', repo: 'farnsworth' }
    })
    await expect(readForkServerWorker('env-1', 'ctx_1', call)).resolves.toEqual({
      state: 'working',
      worktreeId: WORKTREE,
      seenAt: 1_000,
      pr: { number: 12, url: 'https://github.com/acme/farnsworth/pull/12' }
    })
    expect(calls.map(([target, method, params]) => [target, method, params])).toEqual([
      [
        { kind: 'environment', environmentId: 'env-1' },
        'orchestration.workerShow',
        { dispatch: 'ctx_1' }
      ],
      [
        { kind: 'environment', environmentId: 'env-1' },
        'worktree.show',
        { worktree: `id:${WORKTREE}` }
      ],
      [{ kind: 'environment', environmentId: 'env-1' }, 'github.repoSlug', { repo: 'id:repo-1' }]
    ])
  })

  it('reads no PR for a workspace with none linked, and keeps the worker when that read fails', async () => {
    const show = { worker: { state: 'succeeded', worktreeId: WORKTREE } }
    const none = server({
      'orchestration.workerShow': show,
      'worktree.show': { worktree: { linkedPR: null, repoId: 'repo-1' } }
    })
    await expect(readForkServerWorker('env-1', 'ctx_1', none.call)).resolves.toMatchObject({
      state: 'completed',
      pr: null
    })
    expect(none.calls).toHaveLength(2)
    const failing = server({ 'orchestration.workerShow': show })
    await expect(readForkServerWorker('env-1', 'ctx_1', failing.call)).resolves.toMatchObject({
      state: 'completed',
      pr: null
    })
  })

  it('throws when the server cannot be reached, and gives null when it has no such worker', async () => {
    await expect(readForkServerWorker('env-1', 'ctx_1', server({}).call)).rejects.toThrow()
    await expect(
      readForkServerWorker(
        'env-1',
        'ctx_1',
        server({ 'orchestration.workerShow': { worker: null } }).call
      )
    ).resolves.toBeNull()
  })
})

describe('forkServerWorkerOpen', () => {
  const bot: BotOnHost = { hostId: 'local' }
  const worker: BotChatTreeWorker = {
    key: 'ctx_1',
    title: 'Fix holophonor',
    state: 'running',
    startedAt: 1,
    dispatchId: 'ctx_1',
    hostId: 'runtime:env-1',
    forkServer: { environmentId: 'env-1' }
  }

  beforeEach(() => openOrchestrationWorker.mockClear())

  it("opens the worker through its server, not the bot's host", () => {
    forkServerWorkerOpen(bot, worker)?.()
    expect(openOrchestrationWorker).toHaveBeenCalledWith(
      { dispatchId: 'ctx_1', title: 'Fix holophonor', worktreeId: null, chatSessionId: null },
      { kind: 'environment', environmentId: 'env-1' }
    )
  })

  it('leaves other workers, and a bot on a server, to the stock open', () => {
    const { forkServer: _server, ...local } = worker
    expect(forkServerWorkerOpen(bot, local)).toBeUndefined()
    const remoteBot: BotOnHost = { hostId: 'runtime:env-2' }
    expect(forkServerWorkerOpen(remoteBot, worker)).toBeUndefined()
  })
})
