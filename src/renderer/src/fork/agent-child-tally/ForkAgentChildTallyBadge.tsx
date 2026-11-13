// SLRM-2095: a running/total count of what an agent row (or a whole card) is responsible for.
// Hover lists each child by name and state. CompactAgentRow and the collapsed strip hook it in.
import React, { useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { STATE_INDICATOR_TOOLTIP_DELAY_MS } from '@/components/StateIndicatorTooltip'
import { cn } from '@/lib/class-names'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import type { ChildTally, ChildTallyItem, ChildTallyKind } from './agent-child-tally'
import { childTallyOptions, childTallyRootKey, useAgentChildTally } from './use-agent-child-tally'

function kindLabel(kind: ChildTallyKind, t: Translate = translate): string {
  switch (kind) {
    case 'worker':
      return t('fork.childTally.kindWorker', 'worker')
    case 'subagent':
      return t('fork.childTally.kindSubagent', 'sub-agent')
    case 'task':
      return t('fork.childTally.kindTask', 'background task')
  }
}

/** The badge text: running/total, or just running when finished children are not counted. */
export function childTallyText(tally: ChildTally, countFinished: boolean): string {
  return countFinished ? `${tally.running}/${tally.total}` : `${tally.running}`
}

function tallyHeading(tally: ChildTally, countFinished: boolean, t: Translate = translate): string {
  const counts = countFinished
    ? t('fork.childTally.headingTotal', '{{running}} running of {{total}}', {
        running: tally.running,
        total: tally.total
      })
    : t('fork.childTally.headingRunning', '{{running}} running', {
        running: tally.running
      })
  const direct =
    tally.direct === tally.total
      ? ''
      : ` ${t('fork.childTally.headingDirect', '({{direct}} direct)', {
          direct: tally.direct
        })}`
  return `${counts}${direct}`
}

function TallyLine({ item }: { item: ChildTallyItem }): React.JSX.Element {
  const t = useTranslate()
  return (
    <li
      className="flex min-w-0 items-center gap-1.5"
      // Nesting shows lineage: each level past the first steps in.
      style={{ paddingLeft: `${(item.depth - 1) * 10}px` }}
    >
      <AgentStateDot state={item.state} size="sm" title={null} />
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      <span className="shrink-0 opacity-60">
        {kindLabel(item.kind, t)} - {agentStateLabel(item.state)}
      </span>
    </li>
  )
}

type Props = {
  /** `childTallyRootKey` of the rows to count. */
  rootKey: string
  highlighted?: boolean
  className?: string
}

/** Renders nothing when the setting is off or the rows have no children. */
export function ForkAgentChildTallyBadge({
  rootKey,
  highlighted = false,
  className
}: Props): React.JSX.Element | null {
  const t = useTranslate()
  const tally = useAgentChildTally(rootKey)
  const countFinished = useAppStore((s) => childTallyOptions(s).countFinished)
  const heading = useMemo(() => tallyHeading(tally, countFinished, t), [tally, countFinished, t])
  if (tally.total === 0) {
    return null
  }
  const text = childTallyText(tally, countFinished)
  return (
    <Tooltip delayDuration={STATE_INDICATOR_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>
        <span
          data-fork-child-tally={text}
          aria-label={t('fork.childTally.ariaLabel', 'Children: {{heading}}', {
            heading
          })}
          className={cn(
            'inline-flex shrink-0 items-center rounded-sm border px-0.5 text-[10px] leading-[12px] tabular-nums',
            highlighted
              ? 'border-foreground/25 text-foreground/70'
              : 'border-worktree-sidebar-border/70 text-muted-foreground/70',
            className
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="max-w-80">
        <div className="mb-1 font-medium">{heading}</div>
        <ul className="flex max-h-72 flex-col gap-0.5 scrollbar-sleek overflow-y-auto">
          {tally.items.map((item) => (
            <TallyLine key={item.key} item={item} />
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

/** The collapsed strip hook: one total for the card's top-level agents, each child counted once. */
export function ForkAgentStripChildTally({
  agents
}: {
  agents: readonly { paneKey: string; rowSource?: string }[]
}): React.JSX.Element | null {
  const rootKey = childTallyRootKey(
    agents.filter((agent) => agent.rowSource !== 'subagent').map((agent) => agent.paneKey)
  )
  return <ForkAgentChildTallyBadge rootKey={rootKey} />
}

/** The row hook: sub-agent rows borrow their parent's pane, so only real rows get a badge. */
export function ForkAgentRowChildTally({
  agent,
  highlighted
}: {
  agent: { paneKey: string; rowSource?: string }
  highlighted?: boolean
}): React.JSX.Element | null {
  if (agent.rowSource === 'subagent') {
    return null
  }
  return (
    <ForkAgentChildTallyBadge
      rootKey={childTallyRootKey([agent.paneKey])}
      highlighted={highlighted}
    />
  )
}
