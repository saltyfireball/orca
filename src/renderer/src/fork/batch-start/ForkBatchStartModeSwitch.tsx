// Batch start (FORK.md, SLRM-2395): the composer header's Batch switch. On, the composer shows the
// batch box instead of the single-workspace form; the choice is kept for the rest of the session.
import React, { useCallback, useState } from 'react'
import { SwitchIndicator } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { readForkBatchStartSettings } from '../../../../shared/fork/batch-start'
import type { NewWorkspaceComposerCardProps } from '@/components/new-workspace/composer/new-workspace-composer-card-props'
import type { ForkBatchStartBoxProps } from './ForkBatchStartBox'

let rememberedOn = false

export type ForkBatchStartMode = { available: boolean; on: boolean; setOn: (on: boolean) => void }

/** Hook (NewWorkspaceComposerModal): whether the batch box replaces the form. */
export function useForkBatchStartMode(): ForkBatchStartMode {
  const available = useAppStore((state) => readForkBatchStartSettings(state.settings).enabled)
  const [on, setOnState] = useState(rememberedOn)
  const setOn = useCallback((next: boolean): void => {
    rememberedOn = next
    setOnState(next)
  }, [])
  return { available, on: available && on, setOn }
}

export function ForkBatchStartModeSwitch({
  mode
}: {
  mode: ForkBatchStartMode
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!mode.available) {
    return null
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mode.on}
      onClick={() => mode.setOn(!mode.on)}
      className="group flex w-fit cursor-pointer items-center gap-2 rounded-md text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <SwitchIndicator checked={mode.on} />
      <span className="text-muted-foreground transition-colors group-hover:text-foreground">
        {t('fork.batchStart.mode', 'Batch: a worktree and agent per prompt and model')}
      </span>
    </button>
  )
}

/** The batch box's props from the composer's own state. */
export function forkBatchStartBoxProps(
  cardProps: Pick<
    NewWorkspaceComposerCardProps,
    | 'projectOptions'
    | 'selectedProjectId'
    | 'onProjectChange'
    | 'repoId'
    | 'selectedRepoExecutionHostId'
    | 'selectedRepoIsGit'
    | 'detectedAgentIds'
  >,
  quickAgent: TuiAgent | null,
  onClose: () => void
): ForkBatchStartBoxProps {
  return {
    projectOptions: cardProps.projectOptions ?? [],
    selectedProjectId: cardProps.selectedProjectId ?? null,
    onProjectChange: cardProps.onProjectChange,
    repoId: cardProps.repoId,
    hostId: cardProps.selectedRepoExecutionHostId ?? null,
    selectedRepoIsGit: cardProps.selectedRepoIsGit,
    detectedAgentIds: cardProps.detectedAgentIds,
    initialAgent: quickAgent,
    onClose
  }
}
