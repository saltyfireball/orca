import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../persistence/loading-store/user-data-path', () => ({
  getCanonicalUserDataPath: () => '/nonexistent'
}))
vi.mock('../../text-generation/commit-message-text-generation', () => ({
  resolveCommitMessageSettings: () => ({ ok: true, params: { agentId: 'claude' } })
}))
vi.mock('./review-guide-agent', () => ({
  FORK_REVIEW_GUIDE_OPERATION: 'pull-request-fields',
  runForkReviewGuideAgent: vi.fn()
}))
vi.mock('./review-guide-github', () => ({ readForkReviewGuidePr: vi.fn() }))

import {
  ForkReviewGuideService,
  type ForkReviewGuideDeps,
  type ForkReviewGuideHost
} from './review-guide-service'
import { ForkReviewGuideStore } from './review-guide-store'
import type { ForkReviewGuidePr } from '../../../shared/fork/review-guide-writer'

const PR: ForkReviewGuidePr = {
  owner: 'o',
  repo: 'r',
  number: 7,
  title: 'Title',
  body: '',
  author: 'a',
  baseRef: 'main',
  headRef: 'f',
  headSha: 'abcdef1234567',
  files: [
    { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+x' },
    { path: 'b.ts', status: 'modified', additions: 1, deletions: 0 }
  ]
}

const ANSWER = JSON.stringify({
  summary: 'sum',
  stops: [
    { title: 'Core', body: 'b', lookClosely: null, files: [{ path: 'a.ts', lines: [[1, 1]] }] }
  ]
})

const settings = {}
const host = { settings, agentEnvironment: undefined }
const checkout = { repoPath: '/repo', repo: null, pr: 7, prRepo: null }
const ref = { host: 'github.com', owner: 'o', repo: 'r', number: 7 }

let dir: string
let deps: ForkReviewGuideDeps
let finishAgent: (value: unknown) => void

async function settle(): Promise<void> {
  // ast-grep-ignore: test-no-polling-loop -- yields macrotasks so chained promise work in the service settles
  for (let i = 0; i < 20; i += 1) {
    // ast-grep-ignore: test-no-real-time-wait -- a 1ms timer only yields to the event loop, nothing waits on the clock
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'review-guide-'))
  deps = {
    store: new ForkReviewGuideStore(join(dir, 'guides')),
    resolveRef: vi.fn(async () => ref),
    readPr: vi.fn(async () => ({ host: 'github.com', pr: PR })),
    runAgent: vi.fn(
      () =>
        new Promise((resolve) => {
          finishAgent = resolve
        })
    ) as unknown as ForkReviewGuideDeps['runAgent'],
    prepareEnv: vi.fn(async () => ({ ok: true as const })),
    now: () => 1000
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ForkReviewGuideService', () => {
  it('writes in the background, keeps the guide and reads it back', async () => {
    const service = new ForkReviewGuideService(deps)
    const started = await service.write(host, checkout)
    expect(started.job).toEqual({ state: 'running', startedAt: 1000 })
    await settle()
    finishAgent({ success: true, rawOutput: ANSWER, agentLabel: 'Claude' })
    await settle()
    const state = await service.state(host, checkout, 'abcdef1234567')
    expect(state.job).toBeNull()
    expect(state.stale).toBe(false)
    expect(state.guide).toMatchObject({
      owner: 'o',
      number: 7,
      agentLabel: 'Claude',
      stops: [{ title: 'Core', files: [{ path: 'a.ts', lines: [[1, 1]] }] }],
      mechanical: [{ title: 'Other changed files', paths: ['b.ts'] }]
    })
    expect((await service.state(host, checkout, '9999999')).stale).toBe(true)
    const [file] = await readdir(join(dir, 'guides'))
    expect((await stat(join(dir, 'guides', file))).mode & 0o777).toBe(0o600)
  })

  it('sends the agent a fenced prompt under the guide time limit', async () => {
    const service = new ForkReviewGuideService(deps)
    await service.write(host, checkout)
    await settle()
    const call = vi.mocked(deps.runAgent).mock.calls[0][0]
    expect(call.prompt).toMatch(/BEGIN-UNTRUSTED-PULL-REQUEST-[0-9a-f]{24}/)
    expect(call.target).toMatchObject({ kind: 'local', cwd: '/repo' })
    expect(call.timeoutMs).toBe(5 * 60_000)
    finishAgent({ success: false, error: 'x', canceled: true })
    await settle()
  })

  it('keeps one write per pull request and reports a failed answer', async () => {
    const service = new ForkReviewGuideService(deps)
    await service.write(host, checkout)
    await service.write(host, checkout)
    await settle()
    expect(deps.runAgent).toHaveBeenCalledTimes(1)
    finishAgent({ success: true, rawOutput: 'not json' })
    await settle()
    const state = await service.state(host, checkout)
    expect(state.guide).toBeNull()
    expect(state.job).toEqual({
      state: 'failed',
      error: 'The guide writer did not answer with JSON.',
      at: 1000
    })
  })

  it('drops a canceled write and refuses when guides are off', async () => {
    const service = new ForkReviewGuideService(deps)
    await service.write(host, checkout)
    const canceled = await service.cancel(host, checkout)
    expect(canceled.job).toBeNull()
    await settle()
    finishAgent({ success: true, rawOutput: ANSWER })
    await settle()
    expect((await service.state(host, checkout)).guide).toBeNull()
    const off = {
      settings: { forkReviewGuides: false } as ForkReviewGuideHost['settings'],
      agentEnvironment: undefined
    }
    await expect(service.write(off, checkout)).rejects.toThrow('Review guides are off')
    expect(await service.state(off, checkout)).toEqual({
      enabled: false,
      guide: null,
      job: null,
      stale: null
    })
  })
})
