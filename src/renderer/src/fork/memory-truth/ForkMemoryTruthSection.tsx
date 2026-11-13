// SLRM-2099: the resource popover's truthful view. System memory, what Orca holds in total, the
// app's own share, and every workspace's sessions (terminals and chats) with their whole process
// trees broken down into the agent, its tool servers, shells and the rest.
import { cn } from '@/lib/class-names'
import type { Translate } from '@/i18n/use-translate'
import {
  formatForkBytes,
  type ForkMemoryBreakdown,
  type ForkMemoryTruth,
  type ForkSessionMemory,
  type ForkSystemMemory,
  type ForkWorkspaceMemory
} from '../../../../shared/fork/memory-truth'

export function forkBreakdownText(breakdown: ForkMemoryBreakdown, t: Translate): string {
  const parts: string[] = []
  const add = (bytes: number, label: string): void => {
    if (bytes > 0) {
      parts.push(`${label} ${formatForkBytes(bytes)}`)
    }
  }
  add(breakdown.agent, t('fork.memory.breakdown.agent', 'agent'))
  add(breakdown.tools, t('fork.memory.breakdown.tools', 'tool servers'))
  add(breakdown.shells, t('fork.memory.breakdown.shells', 'shells'))
  add(breakdown.other, t('fork.memory.breakdown.other', 'other'))
  return parts.join(', ')
}

export function forkPressureLabel(level: ForkSystemMemory['pressure'], t: Translate): string {
  switch (level) {
    case 'normal':
      return t('fork.memory.pressure.normal', 'normal')
    case 'warn':
      return t('fork.memory.pressure.warn', 'warning')
    case 'critical':
      return t('fork.memory.pressure.critical', 'critical')
    default:
      return t('fork.memory.pressure.unknown', 'unknown')
  }
}

export function forkSystemLine(system: ForkSystemMemory, t: Translate): string {
  const parts = [
    t('fork.memory.system.used', '{{used}} of {{total}} used', {
      used: formatForkBytes(system.used),
      total: formatForkBytes(system.total)
    })
  ]
  if (system.compressed !== null) {
    parts.push(
      t('fork.memory.system.compressed', '{{bytes}} compressed', {
        bytes: formatForkBytes(system.compressed)
      })
    )
  }
  if (system.swapUsed !== null) {
    parts.push(
      t('fork.memory.system.swap', '{{bytes}} swap', { bytes: formatForkBytes(system.swapUsed) })
    )
  }
  parts.push(
    t('fork.memory.system.pressure', 'pressure {{level}}', {
      level: forkPressureLabel(system.pressure, t)
    })
  )
  return parts.join(', ')
}

function sessionLabel(session: ForkSessionMemory, t: Translate): string {
  const kind =
    session.kind === 'chat'
      ? t('fork.memory.session.chat', 'Chat {{provider}}', { provider: session.provider ?? '' })
      : t('fork.memory.session.terminal', 'Terminal')
  const procs = t('fork.memory.session.processes', '{{count}} processes', {
    count: session.processCount
  })
  const orphans =
    session.orphanCount > 0
      ? `, ${t('fork.memory.session.orphans', '{{count}} detached', { count: session.orphanCount })}`
      : ''
  return `${kind} (${procs}${orphans})`
}

function SessionLine({
  session,
  t
}: {
  session: ForkSessionMemory
  t: Translate
}): React.JSX.Element {
  return (
    <li className="pl-3">
      <div className="flex justify-between gap-2">
        <span className="truncate">{sessionLabel(session, t)}</span>
        <span className="tabular-nums">{formatForkBytes(session.memory)}</span>
      </div>
      <div className="truncate text-muted-foreground">
        {forkBreakdownText(session.breakdown, t)}
      </div>
    </li>
  )
}

function WorkspaceBlock({
  workspace,
  t
}: {
  workspace: ForkWorkspaceMemory
  t: Translate
}): React.JSX.Element {
  const name = workspace.repoName
    ? `${workspace.repoName} / ${workspace.worktreeName}`
    : workspace.worktreeName
  return (
    <details className="group">
      <summary className="flex cursor-pointer justify-between gap-2 py-0.5 hover:bg-accent/50">
        <span className="truncate">
          {name} ({workspace.sessions.length})
        </span>
        <span className="tabular-nums">{formatForkBytes(workspace.memory)}</span>
      </summary>
      <div className="pl-3 text-muted-foreground">{forkBreakdownText(workspace.breakdown, t)}</div>
      <ul className="space-y-0.5">
        {workspace.sessions.map((session) => (
          <SessionLine key={`${session.kind}:${session.sessionId}`} session={session} t={t} />
        ))}
      </ul>
    </details>
  )
}

export function ForkMemoryTruthSection({
  truth,
  t
}: {
  truth: ForkMemoryTruth | undefined
  t: Translate
}): React.JSX.Element | null {
  if (!truth) {
    return null
  }
  const { app, status } = truth
  const system = status.system
  return (
    <div className="max-h-[35%] shrink-0 space-y-1 overflow-y-auto border-b border-border/50 px-3 py-2 text-[11px] scrollbar-sleek">
      {system && (
        <div className={cn(status.over && 'text-yellow-600 dark:text-yellow-400')}>
          <span className="font-medium">{t('fork.memory.system.label', 'System')}: </span>
          {forkSystemLine(system, t)}
        </div>
      )}
      {status.launchesPaused && (
        <div className="text-destructive">
          {t('fork.memory.paused', 'New agents are paused until memory frees up.')}
        </div>
      )}
      <div className="flex justify-between gap-2 font-medium">
        <span>{t('fork.memory.grandTotal', 'Orca and its sessions')}</span>
        <span className="tabular-nums">{formatForkBytes(truth.grandTotal)}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="truncate">
          {t(
            'fork.memory.app',
            'App: Electron {{electron}}, helpers {{helpers}}, terminal host {{host}}',
            {
              electron: formatForkBytes(app.electron),
              helpers: formatForkBytes(app.helpers),
              host: formatForkBytes(app.terminalHost)
            }
          )}
        </span>
        <span className="tabular-nums">{formatForkBytes(app.total)}</span>
      </div>
      {truth.workspaces.map((workspace) => (
        <WorkspaceBlock key={workspace.worktreeId} workspace={workspace} t={t} />
      ))}
      {truth.unattributed.length > 0 && (
        <WorkspaceBlock
          workspace={{
            worktreeId: '',
            worktreeName: t('fork.memory.unattributed', 'No workspace'),
            repoName: '',
            memory: truth.unattributed.reduce((sum, session) => sum + session.memory, 0),
            cpu: 0,
            breakdown: truth.unattributed.reduce(
              (sum, session) => ({
                agent: sum.agent + session.breakdown.agent,
                tools: sum.tools + session.breakdown.tools,
                shells: sum.shells + session.breakdown.shells,
                other: sum.other + session.breakdown.other
              }),
              { agent: 0, tools: 0, shells: 0, other: 0 }
            ),
            sessions: truth.unattributed
          }}
          t={t}
        />
      )}
    </div>
  )
}
