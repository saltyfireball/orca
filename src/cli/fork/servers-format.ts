// Server updates (FORK.md, SLRM-2310): text for `orca servers`. Strings from a server are passed
// through `clean` first, so a server cannot write control sequences to this terminal.
import {
  FORK_SSH_MANAGED_MESSAGE,
  type ForkServerRow,
  type ForkServersListResult,
  type ForkServersRunResult,
  type ForkServersRunRow
} from '../../shared/fork/server-update-wire'

export function clean(text: string | undefined | null): string {
  // oxlint-disable-next-line no-control-regex -- stripping them is the point
  return (text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 300)
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  return rows
    .map((cells) =>
      cells
        .map((cell, col) => cell.padEnd(widths[col]))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

function serverState(row: ForkServerRow): string {
  if (row.error === 'unreachable') {
    return 'not answering'
  }
  if (row.error === 'no-support' || !row.status) {
    return 'no server updates (update it once by hand)'
  }
  const status = row.status
  if (row.sshManaged) {
    return FORK_SSH_MANAGED_MESSAGE
  }
  if (!status.install) {
    return clean(status.problem) || 'cannot update here'
  }
  const job = status.job
  if (job && ['downloading', 'verifying', 'waiting', 'restarting'].includes(job.phase)) {
    return `${clean(job.kind)} to ${clean(job.targetVersion)}: ${clean(job.phase)}`
  }
  const versus =
    row.versus === null
      ? 'unknown'
      : row.versus < 0
        ? 'behind'
        : row.versus > 0
          ? 'ahead'
          : 'current'
  return `${versus}${status.accept ? '' : ', refuses updates'}`
}

export function formatServersList(result: ForkServersListResult): string {
  if (result.servers.length === 0) {
    return 'No paired servers.'
  }
  const rows = [
    ['NAME', 'VERSION', 'BUILD', 'STATE', 'KIND', 'ROLLBACK'],
    ...result.servers.map((row) => [
      clean(row.name),
      clean(row.status?.version) || '-',
      clean(row.status?.buildVersion) || '-',
      serverState(row),
      row.status?.install
        ? `${row.status.install.kind} (${clean(row.status.install.service)})`
        : '-',
      clean(row.status?.previousVersion) || '-'
    ])
  ]
  return `This desktop: ${clean(result.version)}\n${table(rows)}`
}

export function formatRunRow(row: ForkServersRunRow): string {
  const from = row.fromVersion ? ` ${clean(row.fromVersion)}` : ''
  const to = row.version && row.version !== row.fromVersion ? ` -> ${clean(row.version)}` : ''
  const message = row.message ? `: ${clean(row.message)}` : ''
  return `${clean(row.name)}: ${row.outcome}${row.phase && row.outcome === 'running' ? ` (${clean(row.phase)})` : ''}${from}${to}${message}`
}

export function formatServersRun(result: ForkServersRunResult): string {
  return result.rows.map(formatRunRow).join('\n') || 'No servers.'
}
