import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GitHubSourceTimeoutError,
  describeGitHubSourceFailure,
  withGitHubSourceDeadline
} from './github-source-deadline'

describe('withGitHubSourceDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a request that never answers', async () => {
    const pending = withGitHubSourceDeadline(new Promise<string>(() => {}), 5_000)
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await outcome).toBeInstanceOf(GitHubSourceTimeoutError)
  })

  it('passes an answer through before the deadline', async () => {
    await expect(withGitHubSourceDeadline(Promise.resolve('ok'), 5_000)).resolves.toBe('ok')
  })

  it('names a timeout and an ordinary failure differently', () => {
    expect(describeGitHubSourceFailure('r1', new GitHubSourceTimeoutError(40_000))).toEqual({
      repoId: 'r1',
      reason: 'timeout',
      message: 'No answer from GitHub after 40 seconds.'
    })
    expect(describeGitHubSourceFailure('r2', new Error('boom'))).toEqual({
      repoId: 'r2',
      reason: 'error',
      message: 'boom'
    })
  })
})
