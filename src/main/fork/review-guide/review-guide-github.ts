// Review guides (SLRM-2396, FORK.md): the pull request a guide is written from, read through the
// same gh execution, host pinning and rate-limit budget as the Files tab, but with each file's
// patch, which the Files tab does not keep.
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { resolveGitHubRepoExecution } from '../../github/repositories/github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from '../../github/api/rate-limit'
import type { GitHubRepositoryIdentity } from '../../../shared/github/repositories/repository-identity'
import type {
  ForkReviewGuidePr,
  ForkReviewGuidePrFile
} from '../../../shared/fork/review-guide-writer'

/** GitHub lists at most 3000 files per pull request; a guide reads the first 300, as the Files tab does. */
const MAX_FILES = 300

type RestPull = {
  title?: string
  body?: string | null
  user?: { login?: string } | null
  base?: { ref?: string }
  head?: { ref?: string; sha?: string }
}

type RestFile = {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export type ForkReviewGuideGitHub = {
  host: string
  pr: ForkReviewGuidePr
}

export type ForkReviewGuideGhExec = typeof ghExecFileAsync

export async function readForkReviewGuidePr(
  repoPath: string,
  number: number,
  prRepo: GitHubRepositoryIdentity | null,
  exec: ForkReviewGuideGhExec = ghExecFileAsync
): Promise<ForkReviewGuideGitHub> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(repoPath, prRepo)
  if (!ownerRepo) {
    throw new Error('This project has no GitHub repository Orca can reach.')
  }
  const api = async <T>(path: string): Promise<T> => {
    if (repositoryRateLimitGuard(ownerRepo, 'core', ghOptions).blocked) {
      throw new Error('GitHub rate limit nearly used up; try again later.')
    }
    noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
    const { stdout } = await exec(['api', path], ghOptions)
    return JSON.parse(stdout) as T
  }
  const base = `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${number}`
  const pull = await api<RestPull>(base)
  const files: RestFile[] = []
  for (let page = 1; files.length < MAX_FILES; page += 1) {
    const batch = await api<RestFile[]>(`${base}/files?per_page=100&page=${page}`)
    files.push(...batch.slice(0, MAX_FILES - files.length))
    if (batch.length < 100) {
      break
    }
  }
  const headSha = pull.head?.sha ?? ''
  if (!/^[0-9a-f]{7,64}$/i.test(headSha)) {
    throw new Error(`GitHub did not return pull request #${number}.`)
  }
  return {
    host: ownerRepo.host ?? 'github.com',
    pr: {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      number,
      title: pull.title ?? '',
      body: pull.body ?? '',
      author: pull.user?.login ?? '',
      baseRef: pull.base?.ref ?? '',
      headRef: pull.head?.ref ?? '',
      headSha,
      files: files.map((file): ForkReviewGuidePrFile => ({
        path: file.filename,
        ...(file.previous_filename ? { oldPath: file.previous_filename } : {}),
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        ...(typeof file.patch === 'string' ? { patch: file.patch } : {})
      }))
    }
  }
}
