// The fork-sync run's machine-readable status and its plain-words summary (FORK.md "Sync
// status"). The workflow's last job runs this on every run, success or failure; the app reads
// the JSON (src/shared/fork/fork-sync-status.ts parses the same shape).
//
//   node fork-sync-status.mjs <status.json out> [previous status.json]
//
// Inputs come from the environment: the sync job's outputs, each job's result and the run's
// own context, so nothing here names an owner.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const FORK_SYNC_STATUS_SCHEMA = 1

const FAILED = new Set(['failure', 'cancelled'])

function versionOfTag(tag) {
  return tag ? tag.replace(/^v/, '') : null
}

function list(text) {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Reads the workflow's environment into one plain object. */
export function inputFromEnv(env) {
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com'
  return {
    syncResult: env.SYNC_RESULT ?? '',
    buildResults: list(env.BUILD_RESULTS?.replace(/[ ,]+/g, '\n')),
    latest: env.LATEST ?? '',
    latestSha: env.LATEST_SHA ?? '',
    baseSha: env.BASE_SHA ?? '',
    baseVersion: env.BASE_VERSION ?? '',
    baseSource: env.BASE_SOURCE ?? '',
    detectState: env.DETECT_STATE ?? '',
    detectError: env.DETECT_ERROR ?? '',
    oldMain: env.OLD_MAIN ?? '',
    changed: env.CHANGED === 'true',
    conflict: env.CONFLICT === 'true',
    unsigned: env.UNSIGNED === 'true',
    rebaseError: env.REBASE_ERROR === 'true',
    conflicts: list(env.CONFLICTS),
    upstreamUrl: env.UPSTREAM_URL ?? '',
    runUrl:
      env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    runId: env.GITHUB_RUN_ID ?? 'manual'
  }
}

function stateAndReason(input) {
  if (!input.latest) {
    const why = input.detectError || 'The sync job failed before it could read the upstream tags.'
    return ['error', input.syncResult === 'cancelled' ? 'The run was cancelled.' : why]
  }
  if (input.detectState === 'error') {
    return ['error', input.detectError || 'The fork base could not be worked out.']
  }
  if (input.conflict) {
    return ['conflict', `Rebasing the fork commits onto ${input.latest} stopped on conflicts.`]
  }
  if (input.syncResult === 'success') {
    if (input.buildResults.some((result) => FAILED.has(result))) {
      return ['error', `main is on ${input.latest}, but the release build failed.`]
    }
    return ['in-sync', null]
  }
  if (input.detectState === 'in-sync') {
    return ['error', 'main is on the newest upstream tag, but the sync job failed.']
  }
  if (input.syncResult === 'cancelled') {
    return ['behind', 'The run was cancelled before main moved.']
  }
  if (input.rebaseError) {
    return [
      'behind',
      `The rebase onto ${input.latest} failed before any conflict; see the run log.`
    ]
  }
  if (input.unsigned) {
    return ['behind', 'The rebased commits were not all signed, so main was not pushed.']
  }
  if (input.changed) {
    return ['behind', 'The rebase worked, but the checks or the push failed, so main did not move.']
  }
  return ['behind', 'The sync job failed before main moved.']
}

/** The status to publish. `previous` is the last published status, or null. */
export function composeStatus(input, previous, now) {
  const [state, reason] = stateAndReason(input)
  const onLatest = input.syncResult === 'success' && Boolean(input.latest)
  const keepSince = previous && previous.state !== 'in-sync' && typeof previous.since === 'string'
  return {
    schema: FORK_SYNC_STATUS_SCHEMA,
    state,
    reason,
    upstreamVersion: versionOfTag(input.latest),
    upstreamSha: input.latestSha || null,
    forkBaseVersion: onLatest ? versionOfTag(input.latest) : input.baseVersion || null,
    forkBaseSha: onLatest ? input.latestSha : input.baseSha || null,
    conflicts: state === 'conflict' ? input.conflicts : [],
    since: state === 'in-sync' ? null : keepSince ? previous.since : now,
    runUrl: input.runUrl,
    checkedAt: now
  }
}

/**
 * The upstream commit main now sits on, recorded only when this run proved it: main was pushed
 * onto the newest tag, or main was already there. Anything else keeps the old record.
 */
export function baseRecordFor(input) {
  if (input.syncResult !== 'success' || !input.latestSha) {
    return ''
  }
  return input.changed || input.detectState === 'in-sync' ? input.latestSha : ''
}

const STATE_WORDS = {
  'in-sync': 'The fork is in sync with upstream.',
  behind: 'The fork is behind upstream.',
  conflict: 'The fork is behind upstream: the rebase hit conflicts.',
  error: 'The fork sync failed.'
}

function manualCommands(input) {
  const tagRef = `refs/upstream-tags/${input.latest}`
  return [
    '```sh',
    'git fetch origin',
    `git switch main && git merge --ff-only origin/main   # main must be ${input.oldMain}`,
    `git fetch --no-tags ${input.upstreamUrl || '<upstream url>'} "+refs/tags/${input.latest}:${tagRef}"`,
    `git branch fork-sync-backup-${input.runId} ${input.oldMain}`,
    `git rebase --onto ${input.latestSha} ${input.baseSha} main`,
    '# resolve each stop, then: git rebase --continue',
    `git log --format='%G? %h %s' ${input.latestSha}..main   # every line must start with G`,
    '# run the checks the sync job runs (typecheck, fork tests), then:',
    `git push --force-with-lease=main:${input.oldMain} origin main`,
    '```'
  ]
}

/** The run summary in plain words, with the exact commands to resync by hand when it failed. */
export function summaryMarkdown(status, input) {
  const lines = [`## Fork sync: ${status.state}`, '', STATE_WORDS[status.state]]
  if (status.reason) {
    lines.push('', status.reason)
  }
  lines.push(
    '',
    `- Newest upstream: ${status.upstreamVersion ?? 'unknown'}${input.latestSha ? ` (${input.latestSha})` : ''}`,
    `- Fork base: ${status.forkBaseVersion ?? 'unknown'}${status.forkBaseSha ? ` (${status.forkBaseSha}, from ${input.baseSource || 'this run'})` : ''}`
  )
  if (status.since) {
    lines.push(`- Not in sync since: ${status.since}`)
  }
  if (status.conflicts.length > 0) {
    lines.push('', 'Conflicting files:', '', ...status.conflicts.map((file) => `- \`${file}\``))
  }
  // Only a stopped rebase or failed checks leave a resync to do; an error needs a look first.
  const canResync = input.latestSha && input.baseSha && input.oldMain
  if (canResync && (status.state === 'behind' || status.state === 'conflict')) {
    lines.push(
      '',
      'To resync by hand (main on the fork is untouched):',
      '',
      ...manualCommands(input)
    )
  }
  return `${lines.join('\n')}\n`
}

function main(argv, env) {
  const [outPath, previousPath] = argv
  if (!outPath) {
    throw new Error('usage: fork-sync-status.mjs <status.json out> [previous status.json]')
  }
  let previous = null
  if (previousPath && existsSync(previousPath)) {
    try {
      previous = JSON.parse(readFileSync(previousPath, 'utf8'))
    } catch {
      previous = null
    }
  }
  const input = inputFromEnv(env)
  const status = composeStatus(input, previous, new Date().toISOString())
  writeFileSync(outPath, `${JSON.stringify(status, null, 2)}\n`)
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, summaryMarkdown(status, input))
  }
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `base_record=${baseRecordFor(input)}\nstate=${status.state}\n`
    )
  }
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env)
}
