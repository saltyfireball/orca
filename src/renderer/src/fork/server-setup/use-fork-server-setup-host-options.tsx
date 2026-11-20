// Set up on a server (FORK.md, SLRM-2312): the new-workspace host picker's "Set up on SERVER..."
// rows, as host options of upstream's run-target picker. Each shows the clone's progress and its
// last error, and keeps the picker open so the progress stays in view until the server is picked.
import type React from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  NeedsSetupProjectHostOption,
  ProjectHostSetupOption
} from '@/lib/workspace/creation/project-host-setup-options'
import type { RunTargetHostOption } from '@/components/new-workspace/run-target/run-target-options'
import { useForkServerSetup, type ForkServerSetupState } from './use-fork-server-setup'
import { FORK_SERVER_SETUP_ROW_PREFIX, forkServerSetupCandidates } from './server-setup-rows'

function setupDetail(
  option: NeedsSetupProjectHostOption,
  setup: ForkServerSetupState,
  t: Translate
): string {
  const progress = setup.progress.get(option.hostId)
  const folder = progress?.folder ?? `${setup.parent}/...`
  if (progress) {
    return progress.stage === 'planning'
      ? t('fork.serverSetup.planning', 'Choosing a folder...')
      : progress.stage === 'cloning'
        ? t('fork.serverSetup.cloning', 'Cloning into {{folder}}...', {
            folder
          })
        : t('fork.serverSetup.checking', 'Checking what the project needs...')
  }
  return (
    setup.errors.get(option.hostId) ??
    t('fork.serverSetup.detail', "Clone from the project's git remote into {{folder}}", {
      folder
    })
  )
}

/** One host option per paired server that lacks the project; none when the offer is off. */
export function forkServerSetupHostOptions(
  hostOptions: readonly ProjectHostSetupOption[],
  setup: ForkServerSetupState,
  t: Translate
): RunTargetHostOption[] {
  if (!setup.offered) {
    return []
  }
  return forkServerSetupCandidates(hostOptions).map((option): RunTargetHostOption => {
    const busy = setup.progress.has(option.hostId)
    const icon: React.ReactNode = busy ? (
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    ) : (
      <Download className="size-3.5 shrink-0 text-muted-foreground" />
    )
    return {
      id: `${FORK_SERVER_SETUP_ROW_PREFIX}${option.hostId}`,
      hostId: option.hostId,
      label: t('fork.serverSetup.rowLabel', 'Set up on {{host}}...', {
        host: option.label
      }),
      detail: setupDetail(option, setup, t),
      searchText: `${option.label}\n${option.detail}`,
      // Listed with the ready hosts, so the host list's overflow bound never hides it.
      available: true,
      group: 'ready',
      icon,
      keepOpen: true,
      onSelect: () => setup.start(option)
    }
  })
}

/** The rows for `hostOptions`; `onReady` (null: no rows) picks the server once it is set up. */
export function useForkServerSetupHostOptions(
  hostOptions: readonly ProjectHostSetupOption[],
  onReady: ((selectionKey: string) => void) | null
): RunTargetHostOption[] {
  const t = useTranslate()
  const setup = useForkServerSetup(hostOptions, (key) => onReady?.(key))
  return onReady ? forkServerSetupHostOptions(hostOptions, setup, t) : []
}
