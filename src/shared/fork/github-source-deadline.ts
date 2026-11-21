// BAD-703: a Tasks GitHub source (one project, on one host) that never answers must fail on its own.

/** Longest one project's list/count call may stay unanswered, past the 30 s the gh process itself gets. */
export const GITHUB_SOURCE_DEADLINE_MS = 40_000

/** Longest one project may hold up the merged list, queue wait included. */
export const GITHUB_SOURCE_AGGREGATE_DEADLINE_MS = 60_000

export class GitHubSourceTimeoutError extends Error {
  readonly code = 'github_source_timeout'

  constructor(readonly timeoutMs: number) {
    super(`No answer from GitHub after ${Math.round(timeoutMs / 1000)} seconds.`)
    this.name = 'GitHubSourceTimeoutError'
  }
}

export function isGitHubSourceTimeoutError(error: unknown): error is GitHubSourceTimeoutError {
  return error instanceof GitHubSourceTimeoutError
}

/** Settles with `promise`, or rejects with a timeout error once `timeoutMs` passes; the late answer is dropped. */
export function withGitHubSourceDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number = GITHUB_SOURCE_DEADLINE_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GitHubSourceTimeoutError(timeoutMs)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export type GitHubFailedSource = {
  repoId: string
  reason: 'timeout' | 'error'
  message: string
}

export function describeGitHubSourceFailure(repoId: string, error: unknown): GitHubFailedSource {
  if (isGitHubSourceTimeoutError(error)) {
    return { repoId, reason: 'timeout', message: error.message }
  }
  return {
    repoId,
    reason: 'error',
    message: error instanceof Error ? error.message : String(error)
  }
}
