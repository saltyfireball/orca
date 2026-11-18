// Best of N (FORK.md, SLRM-2393): starting a run. Each attempt is a stock orchestration worker in
// its own new top-level worktree; the first start makes (or joins) the caller's Run and the others
// join it, so the attempts sit together in the orchestration views. The run is recorded once all
// starts have answered, failures included.
import {
  buildForkBestOfSpec,
  checkForkBestOfCount,
  FORK_BEST_OF_AUTO,
  FORK_BEST_OF_HERE,
  forkBestOfCycle,
  forkBestOfTitle,
  parseForkBestOfAgents,
  parseForkBestOfHosts,
  type ForkBestOfAgentChoice,
  type ForkBestOfAttempt,
  type ForkBestOfRun,
  type ForkBestOfSettings
} from '../../shared/fork/best-of/best-of'

export type ForkBestOfWorkerStart = {
  spec: string
  taskTitle: string
  displayName: string
  name: string
  on?: string
  repo?: string
  baseBranch?: string
  agent: string
  model?: string
  effort?: string
  run?: string
}

export type ForkBestOfWorkerReceipt = {
  runId: string
  taskId: string
  dispatchId: string
  state: string
  lastError?: string
}

export type ForkBestOfStartDeps = {
  settings: ForkBestOfSettings
  /** The stock worker start; throws when the start is refused. */
  startWorker: (params: ForkBestOfWorkerStart) => Promise<ForkBestOfWorkerReceipt>
  /** Auto placement for one attempt: a server for --on, or null for this machine. */
  placeAuto: (repo: string) => Promise<string | null>
  record: (attempts: ForkBestOfAttempt[]) => Promise<ForkBestOfRun>
  /** A short random tag for the attempts' worktree names. */
  tag: string
  note?: (line: string) => void
}

export type ForkBestOfStartRequest = {
  count: number
  prompt: string
  agents?: string
  on?: string
  repo?: string
  baseBranch?: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The --on value of one attempt: undefined is this machine. */
async function placement(
  host: string,
  repo: string | undefined,
  deps: ForkBestOfStartDeps
): Promise<string | undefined> {
  if (host === FORK_BEST_OF_HERE) {
    return undefined
  }
  if (host !== FORK_BEST_OF_AUTO) {
    return host
  }
  if (!repo) {
    deps.note?.('best-of: auto placement needs --repo; starting on this machine.')
    return undefined
  }
  return (await deps.placeAuto(repo)) ?? undefined
}

async function startOne(
  request: ForkBestOfStartRequest,
  deps: ForkBestOfStartDeps,
  index: number,
  choice: ForkBestOfAgentChoice,
  host: string,
  run: string | undefined
): Promise<ForkBestOfAttempt> {
  const title = forkBestOfTitle(request.prompt)
  const attempt: ForkBestOfAttempt = { index, ...choice, host }
  try {
    const on = await placement(host, request.repo, deps)
    attempt.host = on ?? FORK_BEST_OF_HERE
    const receipt = await deps.startWorker({
      spec: buildForkBestOfSpec(request.prompt, deps.settings.attemptNote, index, request.count),
      taskTitle: `Best of ${request.count} (${index}/${request.count}): ${title}`,
      displayName: `Best of ${request.count}: ${title} (${index})`,
      name: `best-of-${deps.tag}-${index}`,
      agent: choice.agent,
      ...(choice.model ? { model: choice.model } : {}),
      ...(choice.effort ? { effort: choice.effort } : {}),
      ...(on ? { on } : {}),
      ...(request.repo ? { repo: request.repo } : {}),
      ...(request.baseBranch ? { baseBranch: request.baseBranch } : {}),
      ...(run ? { run } : {})
    })
    attempt.dispatchId = receipt.dispatchId
    attempt.taskId = receipt.taskId
    attempt.runId = receipt.runId
    if (receipt.state === 'failed' || receipt.state === 'outcome_unknown') {
      attempt.startError = receipt.lastError ?? 'The worker did not start.'
    }
  } catch (error) {
    attempt.startError = message(error).slice(0, 2000)
  }
  deps.note?.(
    `best-of: attempt ${index} (${choice.agent}${choice.model ? ` ${choice.model}` : ''}) on ${attempt.host}: ${attempt.startError ? `failed: ${attempt.startError}` : 'started'}`
  )
  return attempt
}

export async function startForkBestOf(
  request: ForkBestOfStartRequest,
  deps: ForkBestOfStartDeps
): Promise<ForkBestOfRun> {
  if (!deps.settings.enabled) {
    throw new Error('Best of N is off. Turn it on in Settings > Blackfish.')
  }
  checkForkBestOfCount(request.count)
  if (!request.prompt.trim()) {
    throw new Error('The prompt is empty.')
  }
  const agents = parseForkBestOfAgents(request.agents ?? deps.settings.agents)
  const hosts = parseForkBestOfHosts(request.on ?? deps.settings.placement)
  const start = (index: number, run: string | undefined) =>
    startOne(
      request,
      deps,
      index,
      forkBestOfCycle(agents, index - 1),
      forkBestOfCycle(hosts, index - 1),
      run
    )
  // One at a time until a start names the Run, so parallel starts never each make their own;
  // the rest then join that Run together.
  const attempts: ForkBestOfAttempt[] = []
  let run: string | undefined
  let index = 1
  for (; index <= request.count && !run; index += 1) {
    const attempt = await start(index, undefined)
    attempts.push(attempt)
    run = attempt.runId
  }
  const rest = Array.from({ length: request.count - index + 1 }, (_, offset) =>
    start(index + offset, run)
  )
  attempts.push(...(await Promise.all(rest)))
  return deps.record(attempts)
}
