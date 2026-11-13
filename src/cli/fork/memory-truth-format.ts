// SLRM-2099: `orca diagnostics memory` prints the same whole-tree numbers as the resource popover
// (--json already carries them as `forkTruth`).
import type { MemorySnapshot } from '../../shared/process-stats-types'
import {
  formatForkBytes as bytes,
  type ForkMemoryBreakdown,
  type ForkMemoryTruth
} from '../../shared/fork/memory-truth'

function breakdown(b: ForkMemoryBreakdown): string {
  return `agent ${bytes(b.agent)}, tools ${bytes(b.tools)}, shells ${bytes(b.shells)}, other ${bytes(b.other)}`
}

export function formatForkMemoryTruth(truth: ForkMemoryTruth): string {
  const { status, app } = truth
  const lines = ['', `orcaTotal: ${bytes(truth.grandTotal)} (${truth.metric}, whole process trees)`]
  lines.push(
    `app: ${bytes(app.total)} (electron ${bytes(app.electron)}, helpers ${bytes(app.helpers)}, terminal host ${bytes(app.terminalHost)})`
  )
  const system = status.system
  if (system) {
    const parts = [`used ${bytes(system.used)} of ${bytes(system.total)}`]
    if (system.compressed !== null) {
      parts.push(`compressed ${bytes(system.compressed)}`)
    }
    if (system.swapUsed !== null) {
      parts.push(`swap ${bytes(system.swapUsed)}`)
    }
    parts.push(`pressure ${system.pressure}`)
    lines.push(`system: ${parts.join(', ')}`)
  }
  const s = status.settings
  const thresholds = [
    s.warnPressure === 'off' ? null : `pressure ${s.warnPressure}`,
    s.warnSwapGb > 0 ? `swap ${s.warnSwapGb} GB` : null
  ].filter((part): part is string => part !== null)
  lines.push(
    `warning: ${status.over ? `over (${status.reasons.join(', ')})` : 'no'}; threshold ${thresholds.join(' or ') || 'off'}; new agents ${status.launchesPaused ? 'paused' : 'allowed'}`
  )
  const sessions = [
    ...truth.workspaces.map((w) => ({
      title: w.repoName ? `${w.repoName} / ${w.worktreeName}` : w.worktreeName,
      memory: w.memory,
      breakdown: w.breakdown,
      sessions: w.sessions
    })),
    ...(truth.unattributed.length > 0
      ? [
          {
            title: '(no workspace)',
            memory: truth.unattributed.reduce((sum, x) => sum + x.memory, 0),
            breakdown: null,
            sessions: truth.unattributed
          }
        ]
      : [])
  ]
  if (sessions.length > 0) {
    lines.push('workspaces:')
  }
  for (const group of sessions) {
    lines.push(
      `  ${group.title}: ${bytes(group.memory)}${group.breakdown ? ` (${breakdown(group.breakdown)})` : ''}`
    )
    for (const x of group.sessions) {
      const label = x.kind === 'chat' ? `chat ${x.provider ?? ''}`.trim() : 'terminal'
      const detached = x.orphanCount > 0 ? `, ${x.orphanCount} detached` : ''
      lines.push(
        `    ${label} ${x.sessionId} pid ${x.pid}: ${bytes(x.memory)} in ${x.processCount} processes${detached} (${breakdown(x.breakdown)})`
      )
    }
  }
  return lines.join('\n')
}

/** Upstream's text plus the fork section when the runtime sent one. */
export function withForkMemoryTruth(
  format: (snapshot: MemorySnapshot) => string
): (snapshot: MemorySnapshot) => string {
  return (snapshot) =>
    snapshot.forkTruth
      ? `${format(snapshot)}\n${formatForkMemoryTruth(snapshot.forkTruth)}`
      : format(snapshot)
}
