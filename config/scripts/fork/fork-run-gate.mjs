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
const MAX_FETCH_FAILURES = 12

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

const GATES = { lanes: lanesGate, 'fork-template': forkTemplateGate, qualified: qualifiedGate }

/** Whether `gate` is ready, still waiting or failed, given the run's jobs from the Actions API. */
export function gateState(gate, jobs) {
  const decide = GATES[gate]
  if (!decide) {
    throw new Error(`Unknown gate "${gate}"; expected one of ${Object.keys(GATES).join(', ')}`)
  }
  return decide(jobs)
}

async function listRunJobs(env) {
  const base = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/jobs`
  const jobs = []
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${base}?filter=latest&per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'x-github-api-version': '2022-11-28'
      }
    })
    if (!response.ok) {
      throw new Error(`Listing the run's jobs returned HTTP ${response.status}`)
    }
    const body = await response.json()
    jobs.push(...body.jobs)
    if (body.jobs.length < 100) {
      return jobs
    }
  }
}

async function waitForGate(gate, env) {
  for (const name of ['GITHUB_API_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_TOKEN']) {
    if (!env[name]) {
      throw new Error(`${name} is not set; this gate runs inside a workflow job`)
    }
  }
  // Fail on an unknown gate before the first request.
  gateState(gate, [])
  const deadline = Date.now() + DEADLINE_MS
  let fetchFailures = 0
  let lastReason = ''
  while (Date.now() < deadline) {
    let jobs = null
    try {
      jobs = await listRunJobs(env)
      fetchFailures = 0
    } catch (error) {
      fetchFailures += 1
      console.log(`[fork-run-gate] ${error.message} (${fetchFailures} in a row)`)
      if (fetchFailures >= MAX_FETCH_FAILURES) {
        throw error
      }
    }
    if (jobs) {
      const { state, reason } = gateState(gate, jobs)
      if (state === 'ready') {
        console.log(`[fork-run-gate] ${gate}: ${reason}`)
        return
      }
      if (state === 'failed') {
        throw new Error(`${gate}: ${reason}`)
      }
      if (reason !== lastReason) {
        console.log(`[fork-run-gate] ${gate}: waiting, ${reason}`)
        lastReason = reason
      }
    }
    await new Promise((done) => setTimeout(done, POLL_MS))
  }
  throw new Error(`${gate}: timed out after ${DEADLINE_MS / 60_000} minutes (${lastReason})`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    await waitForGate(process.argv[2], process.env)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exit(1)
  }
}
