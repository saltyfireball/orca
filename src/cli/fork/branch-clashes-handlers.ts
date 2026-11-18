// Branch clashes (FORK.md, SLRM-2394): `orca clashes`, through fork.clashes.scan.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ForkClashParticipant, ForkClashResult } from '../../shared/fork/branch-clashes'

const STATUS: Record<string, string> = {
  off: 'branch clashes are off there',
  unreachable: 'did not answer',
  'no-clashes': 'runs a version without branch clashes'
}

function who(entry: ForkClashParticipant): string {
  return entry.hostId === 'local' ? entry.branch : `${entry.branch} @ ${entry.hostName}`
}

export function formatForkClashes(result: ForkClashResult): string {
  const lines: string[] = []
  for (const project of result.projects) {
    lines.push(
      `${project.name} (${project.projectKey.includes('\u0000') ? 'no remote' : project.projectKey})`
    )
    if (project.files.length === 0) {
      lines.push('  No shared files.')
    }
    for (const entry of project.files) {
      const more = entry.participantsTruncated ? ', ...' : ''
      lines.push(`  ${entry.file}  <-  ${entry.participants.map(who).join(', ')}${more}`)
    }
    if (project.filesTruncated) {
      lines.push('  (more shared files not shown)')
    }
    for (const entry of project.behind) {
      const flag = entry.stale ? '  [stale]' : ''
      lines.push(`  behind: ${who(entry)} is ${entry.behind} commit(s) behind${flag}`)
    }
    for (const note of project.incomplete) {
      lines.push(`  Note: ${note}`)
    }
  }
  if (result.projects.length === 0) {
    lines.push('No shared files and no stale branches.')
  }
  for (const host of result.hosts) {
    if (host.status !== 'ok') {
      lines.push(`Note: ${host.hostName}: ${STATUS[host.status] ?? host.status}`)
    }
  }
  return lines.join('\n')
}

export const FORK_BRANCH_CLASHES_HANDLERS: Record<string, CommandHandler> = {
  clashes: async (ctx) => {
    const project = getOptionalStringFlag(ctx.flags, 'project')
    const params = {
      ...(project ? { project } : {}),
      ...(ctx.flags.has('refresh') ? { refresh: true } : {})
    }
    const result = await ctx.client
      .call<ForkClashResult>('fork.clashes.scan', params)
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no branch clashes check. Update it and try again.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatForkClashes)
  }
}
