// Review guides (SLRM-2396, FORK.md): reads kept guides and writes new ones. A write runs in the
// background (a large pull request takes minutes), at most two at once and one per pull request;
// the window, the phone and the CLI all poll the same state. Nothing here marks files viewed: that
// stays with the stock viewed toggle, which only the user's own click sends.
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  forkReviewGuideKey,
  readForkReviewGuideSettings,
  type ForkReviewGuide,
  type ForkReviewGuideJob,
  type ForkReviewGuideRef
} from '../../../shared/fork/review-guide'
import type { ForkReviewGuideState } from '../../../shared/fork/review-guide-wire'
import {
  buildForkReviewGuidePrompt,
  cleanGuideText,
  normalizeForkReviewGuideAnswer,
  parseForkReviewGuideAnswer
} from '../../../shared/fork/review-guide-writer'
import type { GitHubRepositoryIdentity } from '../../../shared/github/repositories/repository-identity'
import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../../shared/source-control/ai/generation/commit-message-host-key'
import type { Repo } from '../../../shared/repository/repo-types'
import { getRepoRoutingConnectionId } from '../../../shared/execution-host/execution-host'
import { resolveGitHubRepoExecution } from '../../github/repositories/github-api-repository'
import { resolveCommitMessageSettings } from '../../text-generation/commit-message-text-generation'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentEnvironmentResolvers
} from '../../text-generation/execution/commit-message-agent-environment'
import { cancelLocalGeneration } from '../../text-generation/execution/source-control-generation-lanes'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { FORK_REVIEW_GUIDE_OPERATION, runForkReviewGuideAgent } from './review-guide-agent'
import { readForkReviewGuidePr } from './review-guide-github'
import { FORK_REVIEW_GUIDE_DIR, ForkReviewGuideStore } from './review-guide-store'

const MAX_RUNNING = 2

/** The local checkout a guide is read and written through, and the request. */
export type ForkReviewGuideCheckout = {
  repoPath: string
  repo: Pick<Repo, 'sourceControlAi'> | null
  pr: number
  prRepo: GitHubRepositoryIdentity | null
}

/** What this host supplies per call: its settings and how its agents get their accounts. */
export type ForkReviewGuideHost = {
  settings: Parameters<typeof resolveCommitMessageSettings>[0]
  agentEnvironment: CommitMessageAgentEnvironmentResolvers | undefined
}

export type ForkReviewGuideDeps = {
  store: ForkReviewGuideStore
  resolveRef: (checkout: ForkReviewGuideCheckout) => Promise<ForkReviewGuideRef>
  readPr: typeof readForkReviewGuidePr
  runAgent: typeof runForkReviewGuideAgent
  prepareEnv: typeof prepareLocalCommitMessageAgentEnv
  now: () => number
}

type Running = { job: ForkReviewGuideJob; token: string; cwd: string; laneId: string }

async function resolveRefFromGitHub(
  checkout: ForkReviewGuideCheckout
): Promise<ForkReviewGuideRef> {
  const { ownerRepo } = await resolveGitHubRepoExecution(checkout.repoPath, checkout.prRepo)
  if (!ownerRepo) {
    throw new Error('This project has no GitHub repository Orca can reach.')
  }
  return {
    host: ownerRepo.host ?? 'github.com',
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    number: checkout.pr
  }
}

export class ForkReviewGuideService {
  private readonly jobs = new Map<string, Running>()

  constructor(private readonly deps: ForkReviewGuideDeps) {}

  async state(
    host: ForkReviewGuideHost,
    checkout: ForkReviewGuideCheckout,
    headSha?: string | null
  ): Promise<ForkReviewGuideState> {
    const enabled = readForkReviewGuideSettings(host.settings).enabled
    if (!enabled) {
      return { enabled, guide: null, job: null, stale: null }
    }
    const ref = await this.deps.resolveRef(checkout)
    const guide = await this.deps.store.read(ref)
    return {
      enabled,
      guide,
      job: this.jobs.get(forkReviewGuideKey(ref))?.job ?? null,
      stale: guide && headSha ? guide.headSha.toLowerCase() !== headSha.toLowerCase() : null
    }
  }

  /** Starts a write unless one for this pull request is running; answers at once. */
  async write(
    host: ForkReviewGuideHost,
    checkout: ForkReviewGuideCheckout
  ): Promise<ForkReviewGuideState> {
    if (!readForkReviewGuideSettings(host.settings).enabled) {
      throw new Error('Review guides are off. Turn them on in Settings > Blackfish.')
    }
    const ref = await this.deps.resolveRef(checkout)
    const key = forkReviewGuideKey(ref)
    if (this.jobs.get(key)?.job.state !== 'running') {
      const running = [...this.jobs.values()].filter((entry) => entry.job.state === 'running')
      if (running.length >= MAX_RUNNING) {
        throw new Error('Two guides are being written already; try again when one is done.')
      }
      const entry: Running = {
        job: { state: 'running', startedAt: this.deps.now() },
        token: randomBytes(8).toString('hex'),
        cwd: checkout.repoPath,
        laneId: `fork-review-guide-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
      }
      this.jobs.set(key, entry)
      void this.run(host, checkout, ref, entry)
    }
    return this.state(host, checkout)
  }

  async cancel(
    host: ForkReviewGuideHost,
    checkout: ForkReviewGuideCheckout
  ): Promise<ForkReviewGuideState> {
    const ref = await this.deps.resolveRef(checkout)
    const key = forkReviewGuideKey(ref)
    const entry = this.jobs.get(key)
    if (entry) {
      this.jobs.delete(key)
      if (entry.job.state === 'running') {
        cancelLocalGeneration(FORK_REVIEW_GUIDE_OPERATION, entry.cwd, entry.laneId)
      }
    }
    return this.state(host, checkout)
  }

  private async run(
    host: ForkReviewGuideHost,
    checkout: ForkReviewGuideCheckout,
    ref: ForkReviewGuideRef,
    entry: Running
  ): Promise<void> {
    const key = forkReviewGuideKey(ref)
    const current = () => this.jobs.get(key)?.token === entry.token
    try {
      const guide = await this.produce(host, checkout, ref, entry, current)
      if (guide && current()) {
        await this.deps.store.save(guide)
        this.jobs.delete(key)
      }
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : String(error)
        this.jobs.set(key, {
          ...entry,
          job: { state: 'failed', error: cleanGuideText(message, 500), at: this.deps.now() }
        })
      }
    }
  }

  private async produce(
    host: ForkReviewGuideHost,
    checkout: ForkReviewGuideCheckout,
    ref: ForkReviewGuideRef,
    entry: Running,
    current: () => boolean
  ): Promise<ForkReviewGuide | null> {
    const settings = readForkReviewGuideSettings(host.settings)
    const { pr } = await this.deps.readPr(checkout.repoPath, ref.number, checkout.prRepo)
    if (pr.files.length === 0) {
      throw new Error('This pull request has no changed files.')
    }
    const resolved = resolveCommitMessageSettings(
      host.settings,
      LOCAL_COMMIT_MESSAGE_HOST_KEY,
      'pullRequest',
      checkout.repo
    )
    if (!resolved.ok) {
      throw new Error(resolved.error)
    }
    const env = await this.deps.prepareEnv(resolved.params.agentId, host.agentEnvironment)
    if (!env.ok) {
      throw new Error(env.error)
    }
    if (!current()) {
      return null
    }
    const prompt = buildForkReviewGuidePrompt({
      pr,
      instructions: settings.instructions,
      maxPatchBytes: settings.maxPatchBytes,
      marker: randomBytes(12).toString('hex')
    })
    const result = await this.deps.runAgent({
      params: resolved.params,
      prompt,
      target: {
        kind: 'local',
        cwd: checkout.repoPath,
        laneId: entry.laneId,
        ...(env.env ? { env: env.env } : {})
      },
      timeoutMs: settings.timeoutMs
    })
    if (!result.success) {
      if (result.canceled) {
        return null
      }
      throw new Error(result.error)
    }
    const parsed = parseForkReviewGuideAnswer(result.rawOutput)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    const body = normalizeForkReviewGuideAnswer(parsed.answer, pr.files)
    if (body.stops.length === 0) {
      throw new Error('The guide writer gave no stops a reviewer can follow.')
    }
    return {
      version: 1,
      ...ref,
      title: cleanGuideText(pr.title, 500),
      headSha: pr.headSha,
      createdAt: this.deps.now(),
      agentLabel: cleanGuideText(result.agentLabel ?? resolved.params.agentId, 120),
      ...body
    }
  }
}

/** A local project's checkout; an SSH project or an unknown id is refused. */
export function forkReviewGuideLocalCheckout(
  repos: readonly Repo[],
  match: (repo: Repo) => boolean,
  pr: number,
  prRepo: ForkReviewGuideCheckout['prRepo']
): ForkReviewGuideCheckout {
  const repo = repos.find(match)
  if (!repo) {
    throw new Error('No project matches.')
  }
  if (getRepoRoutingConnectionId(repo)) {
    throw new Error(
      'Review guides are written on the machine that holds the checkout; this project is on an SSH host.'
    )
  }
  return { repoPath: repo.path, repo, pr, prRepo }
}

let shared: ForkReviewGuideService | null = null

/** This host's one service, so every client sees the same writes in progress. */
export function forkReviewGuideService(): ForkReviewGuideService {
  shared ??= new ForkReviewGuideService({
    store: new ForkReviewGuideStore(join(getCanonicalUserDataPath(), FORK_REVIEW_GUIDE_DIR)),
    resolveRef: resolveRefFromGitHub,
    readPr: readForkReviewGuidePr,
    runAgent: runForkReviewGuideAgent,
    prepareEnv: prepareLocalCommitMessageAgentEnv,
    now: Date.now
  })
  return shared
}
