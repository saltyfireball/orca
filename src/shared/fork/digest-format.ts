// Digest (SLRM-2388, FORK.md): the digest as plain text (the CLI and the notification command's
// readers) and as the JSON the webhook and command get. No locale: ISO-ish times, ASCII only.
import type { ForkDigest, ForkDigestHost, ForkDigestTotals } from './digest'
import { formatForkUsd } from './usage-report'

const MAX_TITLE_CHARS = 120
const MAX_ROWS_PER_KIND = 25

function clip(text: string, max = MAX_TITLE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}

function when(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

const STATUS_NOTE: Record<ForkDigestHost['status'], string> = {
  ok: '',
  unreachable: 'not answering',
  'no-digest': 'no digest here (stock Orca or an older Blackfish)'
}

/** One line: "3 finished, 1 failed, 2 merged, 4 open, 1 waiting on you, $1.20". */
export function forkDigestHeadline(totals: ForkDigestTotals): string {
  const parts = [
    `${totals.finished} finished`,
    `${totals.failed} failed`,
    `${totals.merged} merged`,
    `${totals.open} open`,
    `${totals.waiting} waiting on you`
  ]
  if (totals.costUsd !== null) {
    parts.push(`${formatForkUsd(totals.costUsd)} est.`)
  }
  return parts.join(', ')
}

function hostLines(host: ForkDigestHost): string[] {
  const lines = [`== ${host.name}${host.status === 'ok' ? '' : ` (${STATUS_NOTE[host.status]})`}`]
  const section = host.section
  if (!section) {
    return lines
  }
  const failed = section.tasks.filter((task) => task.status === 'failed')
  const finished = section.tasks.filter((task) => task.status === 'completed')
  const merged = section.pullRequests.filter((pr) => pr.state === 'merged')
  const open = section.pullRequests.filter((pr) => pr.state === 'open')
  const block = <T>(title: string, rows: T[], line: (row: T) => string): void => {
    if (rows.length === 0) {
      return
    }
    lines.push(`${title} (${rows.length})`)
    for (const row of rows.slice(0, MAX_ROWS_PER_KIND)) {
      lines.push(`  ${line(row)}`)
    }
    if (rows.length > MAX_ROWS_PER_KIND) {
      lines.push(`  and ${rows.length - MAX_ROWS_PER_KIND} more`)
    }
  }
  block('Waiting on you', section.waiting, (row) => {
    const what = row.question || (row.verdict === 'stalled' ? 'stalled' : 'waiting')
    const tag =
      row.source === 'babysit' ? '[PR babysitter] ' : row.verdict === 'guard' ? '[guard] ' : ''
    return `${tag}${clip(row.title || row.chatId, 60)}: ${clip(what)}`
  })
  block(
    'Worker retries',
    section.retries ?? [],
    (retry) =>
      `${when(retry.at)}  ${clip(retry.title)}: retry ${retry.attempt} ${retry.status} (${clip(retry.reason, 80)})`
  )
  block('Failed', failed, (task) => `${when(task.at)}  ${clip(task.title)}`)
  block('Finished', finished, (task) => `${when(task.at)}  ${clip(task.title)}`)
  block('Merged', merged, (pr) => `${pr.repo}#${pr.number} ${clip(pr.title)}  ${pr.url}`)
  block(
    'Open pull requests',
    open,
    (pr) => `${pr.repo}#${pr.number}${pr.draft ? ' (draft)' : ''} ${clip(pr.title)}  ${pr.url}`
  )
  if (section.cost) {
    const cost = section.cost
    const money =
      cost.costUsd === null
        ? cost.subscriptionTokens > 0
          ? 'subscription'
          : '-'
        : `${formatForkUsd(cost.costUsd)}${cost.unpricedTokens > 0 ? ' +?' : ''}`
    lines.push(
      `Cost (est., ${cost.days} day${cost.days === 1 ? '' : 's'}): ${money}, ${cost.totalTokens} tokens in ${cost.chats} chats`
    )
  }
  for (const note of section.notes) {
    lines.push(`Note: ${note}`)
  }
  if (lines.length === 1) {
    lines.push('Nothing in this window.')
  }
  return lines
}

export function formatForkDigestText(digest: ForkDigest): string {
  const lines = [
    `Digest ${when(digest.since)} to ${when(digest.until)} (UTC)`,
    forkDigestHeadline(digest.totals)
  ]
  for (const server of digest.serversDown) {
    lines.push(`Not answering: ${server.name} since ${when(server.downSince)}`)
  }
  for (const host of digest.hosts) {
    lines.push('', ...hostLines(host))
  }
  return lines.join('\n')
}

/** The JSON a webhook or command gets. `event` tells it apart from the other fork alerts. */
export function forkDigestPayload(digest: ForkDigest): string {
  return JSON.stringify({
    event: 'digest',
    since: new Date(digest.since).toISOString(),
    until: new Date(digest.until).toISOString(),
    headline: forkDigestHeadline(digest.totals),
    totals: digest.totals,
    serversDown: digest.serversDown,
    hosts: digest.hosts,
    text: formatForkDigestText(digest)
  })
}
