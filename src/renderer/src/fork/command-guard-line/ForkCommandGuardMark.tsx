// Command guards (FORK.md, BAD-686): a quiet shield on an agent row whose tooltip is the agent's
// guard line: guarded, or unguarded with the reason. The line comes from the agent's own host's
// `fork.commandGuards.status` through the same function `orca agent list` uses, so it matches the
// status. Nothing shows while the host's command guards are off, or before the host has answered.
import React from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { STATE_INDICATOR_TOOLTIP_DELAY_MS } from '@/components/agent/status/StateIndicatorTooltip'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { runtimeRpcTargetForAuthorityKey } from '@/runtime/rpc/targets/runtime-client-target'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { commandGuardAgentLine } from '../../../../shared/fork/command-guards-agent-line'
import { chatSessionIdForRow } from '../cache-cold/cache-cold-view'
import {
  commandGuardHostKey,
  loadCommandGuardHostStatus,
  useCommandGuardHostStatus
} from './command-guard-host-status'

export type ForkCommandGuardMarkRow = {
  paneKey: string
  agentType?: string | null
  tab: { id: string; worktreeId: string }
}

const ENVIRONMENT = 'environment:'

function hostTarget(key: string): RuntimeClientTarget | null {
  if (key === 'local') {
    return { kind: 'local' }
  }
  return key.startsWith(ENVIRONMENT)
    ? { kind: 'environment', environmentId: key.slice(ENVIRONMENT.length) }
    : null
}

export function ForkCommandGuardMark({
  agent,
  highlighted
}: {
  agent: ForkCommandGuardMarkRow
  highlighted: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  // A direct SSH workspace has no Orca host of its own to ask, so it gets no mark.
  const targetKey = useAppStore((s) => {
    const target = runtimeRpcTargetForAuthorityKey(
      getExecutionHostIdForWorktree(s, agent.tab.worktreeId)
    )
    return target ? commandGuardHostKey(target) : ''
  })
  const sessionId = useAppStore((s) =>
    chatSessionIdForRow(s.unifiedTabsByWorktree[agent.tab.worktreeId], agent.tab.id, agent.paneKey)
  )
  const target = hostTarget(targetKey)
  const status = useCommandGuardHostStatus(target)
  const line = status
    ? commandGuardAgentLine(status, {
        agent: agent.agentType,
        paneKey: agent.paneKey,
        worktreeId: agent.tab.worktreeId,
        sessionId
      })
    : null
  if (!line) {
    return null
  }
  const label = line.guarded
    ? t('fork.commandGuardMark.guarded', 'Command guards: guarded ({{note}})', { note: line.note })
    : t('fork.commandGuardMark.unguarded', 'Command guards: {{note}}', { note: line.note })
  const Icon = line.guarded ? ShieldCheck : ShieldOff
  return (
    <Tooltip
      delayDuration={STATE_INDICATOR_TOOLTIP_DELAY_MS}
      onOpenChange={(open) => {
        if (open && target) {
          void loadCommandGuardHostStatus(target, true)
        }
      }}
    >
      <TooltipTrigger asChild>
        <span
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center',
            highlighted ? 'text-foreground/60' : 'text-muted-foreground/50'
          )}
          data-fork-command-guard={line.guarded ? 'guarded' : 'unguarded'}
        >
          <Icon className="size-2.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-72">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
