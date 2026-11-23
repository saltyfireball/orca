// Waits inside a fork-sync job for another job of the same run, so the macOS build can start
// beside the orcad template lanes instead of after them (`needs` would hold the whole job back).
// Usage: node config/scripts/fork/fork-run-gate.mjs <lanes|fork-template|qualified>
import { resolve } from 'node:path'

// Job ids in fork-sync.yml; a reusable workflow's jobs are listed as "<caller job> / <job>".
export const UPSTREAM_TEMPLATE_JOB = 'orcad-template'
export const FORK_TEMPLATE_JOB = 'orcad-template-fork'
// In upstream's node-server-tests.yml: the job that assembles the template, and its step that
// passes once every qualification lane has succeeded.
export const UPSTREAM_ASSEMBLER_JOB = 'desktop_template'
export const UPSTREAM_LANE_GATE_STEP = 'Wait for every template qualification lane'

const PASSED = new Set(['success', 'skipped'])
const POLL_MS = 5_000
const DEADLINE_MS = 45 * 60_000
// After a failed call, wait longer each time (5s, 10s, 20s, 30s, 30s ...), never past the deadline.
const MAX_BACKOFF_MS = 30_000

const wait = (reason) => ({ state: 'wait', reason })
const ready = (reason) => ({ state: 'ready', reason })
const failed = (reason) => ({ state: 'failed', reason })

function upstreamTemplateJobs(jobs) {
  return jobs.filter((job) => job.name.startsWith(`${UPSTREAM_TEMPLATE_JOB} / `))
}

function firstFailure(jobs) {
  return jobs.find((job) => job.status === 'completed' && !PASSED.has(job.conclusion))
}

function describeFailure(job) {
  return `${job.name} ended with ${job.conclusion}`
}

/** Every lane has passed and left its slot: the fork template can be assembled. */
function lanesGate(jobs) {
  const upstream = upstreamTemplateJobs(jobs)
  const failure = firstFailure(upstream)
  if (failure) {
    return failed(describeFailure(failure))
  }
  const assembler = upstream.find((job) => job.name.endsWith(` / ${UPSTREAM_ASSEMBLER_JOB}`))
  if (!assembler) {
    return wait(`${UPSTREAM_ASSEMBLER_JOB} has not been listed yet`)
  }
  if (assembler.status === 'completed') {
    // A skipped assembler checked no lanes.
    return assembler.conclusion === 'success'
      ? ready(`${assembler.name} succeeded`)
      : failed(describeFailure(assembler))
  }
  // Upstream's own lane gate, so the lane list and counts stay upstream's. Should the step be
  // renamed, this waits for the whole job instead: slower, never earlier.
  const step = (assembler.steps ?? []).find((entry) => entry.name === UPSTREAM_LANE_GATE_STEP)
  if (step?.status === 'completed') {
    return step.conclusion === 'success'
      ? ready(`"${UPSTREAM_LANE_GATE_STEP}" passed`)
      : failed(`"${UPSTREAM_LANE_GATE_STEP}" ended with ${step.conclusion}`)
  }
  return wait('qualification lanes are still running')
}

/** The fork-versioned template artifact has been uploaded. */
function forkTemplateGate(jobs) {
  const job = jobs.find((entry) => entry.name === FORK_TEMPLATE_JOB)
  if (!job) {
    return wait(`${FORK_TEMPLATE_JOB} has not been listed yet`)
  }
  if (job.status !== 'completed') {
    return wait(`${FORK_TEMPLATE_JOB} is ${job.status}`)
  }
  return job.conclusion === 'success'
    ? ready(`${FORK_TEMPLATE_JOB} succeeded`)
    : failed(describeFailure(job))
}

/** What `needs: orcad-template` with result success proved: every upstream template job passed. */
function qualifiedGate(jobs) {
  const upstream = upstreamTemplateJobs(jobs)
  const failure = firstFailure(upstream)
  if (failure) {
    return failed(describeFailure(failure))
  }
  const assembler = upstream.find((job) => job.name.endsWith(` / ${UPSTREAM_ASSEMBLER_JOB}`))
  if (!assembler) {
    return wait(`${UPSTREAM_ASSEMBLER_JOB} has not been listed yet`)
  }
  const pending = upstream.find((job) => job.status !== 'completed')
  if (pending) {
    return wait(`${pending.name} is ${pending.status}`)
  }
  // A skipped assembler built no template, so nothing was qualified.
  return assembler.conclusion === 'success'
    ? ready(`all ${upstream.length} ${UPSTREAM_TEMPLATE_JOB} jobs passed`)
    : failed(describeFailure(assembler))
}

const GATES = {
  lanes: lanesGate,
  'fork-template': forkTemplateGate,
  qualified: qualifiedGate
}

/** Whether `gate` is ready, still waiting or failed, given the run's jobs from the Actions API. */
export function gateState(gate, jobs) {
  const decide = GATES[gate]
  if (!decide) {
    throw new Error(`Unknown gate "${gate}"; expected one of ${Object.keys(GATES).join(', ')}`)
  }
  return decide(jobs)
}

/** A call that may work if made again: a network error, HTTP 429 or any 5xx. */
export class TransientApiError extends Error {}

/** A call that will not work if made again (auth, not found, bad request): fail at once. */
export class PermanentApiError extends Error {}

/** True for a status worth another try: rate limited (429) or a GitHub server error (5xx). */
export function isTransientStatus(status) {
  return status === 429 || status >= 500
}

async function listRunJobs(env, fetchImpl) {
  const base = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/jobs`
  const jobs = []
  for (let page = 1; ; page += 1) {
    let response
    let body
    try {
      response = await fetchImpl(`${base}?filter=latest&per_page=100&page=${page}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'x-github-api-version': '2022-11-28'
        }
      })
      if (response.ok) {
        body = await response.json()
      }
    } catch (error) {
      // fetch rejects on a network error, and json() on a body cut off mid-way.
      throw new TransientApiError(`Listing the run's jobs failed: ${error.message}`)
    }
    if (!response.ok) {
      const Kind = isTransientStatus(response.status) ? TransientApiError : PermanentApiError
      throw new Kind(`Listing the run's jobs returned HTTP ${response.status}`)
    }
    jobs.push(...body.jobs)
    if (body.jobs.length < 100) {
      return jobs
    }
  }
}

const realSleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Polls until `gate` is ready. A network error, 429 or 5xx is retried, with a growing pause,
 * until the deadline; a failed lane or any other API error (401, 403, 404, ...) ends it at once.
 * `deps` lets a test swap the network, the clock and the sleep.
 */
export async function waitForGate(gate, env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const log = deps.log ?? console.log
  for (const name of ['GITHUB_API_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_TOKEN']) {
    if (!env[name]) {
      throw new Error(`${name} is not set; this gate runs inside a workflow job`)
    }
  }
  // Fail on an unknown gate before the first request.
  gateState(gate, [])
  const deadline = now() + DEADLINE_MS
  let failuresInARow = 0
  let lastReason = ''
  let lastError = ''
  while (now() < deadline) {
    let pause = POLL_MS
    let jobs = null
    try {
      jobs = await listRunJobs(env, fetchImpl)
      failuresInARow = 0
    } catch (error) {
      if (!(error instanceof TransientApiError)) {
        throw error
      }
      failuresInARow += 1
      lastError = error.message
      pause = Math.min(POLL_MS * 2 ** (failuresInARow - 1), MAX_BACKOFF_MS)
      log(
        `[fork-run-gate] ${error.message} (${failuresInARow} in a row), retrying in ${pause / 1000}s`
      )
    }
    if (jobs) {
      const { state, reason } = gateState(gate, jobs)
      if (state === 'ready') {
        log(`[fork-run-gate] ${gate}: ${reason}`)
        return
      }
      if (state === 'failed') {
        throw new Error(`${gate}: ${reason}`)
      }
      if (reason !== lastReason) {
        log(`[fork-run-gate] ${gate}: waiting, ${reason}`)
        lastReason = reason
      }
    }
    await sleep(Math.max(0, Math.min(pause, deadline - now())))
  }
  const detail = failuresInARow > 0 ? `last error: ${lastError}` : lastReason
  throw new Error(`${gate}: timed out after ${DEADLINE_MS / 60_000} minutes (${detail})`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    await waitForGate(process.argv[2], process.env)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exit(1)
  }
}
