// Set up on a server (FORK.md, SLRM-2312): one "Set up on SERVER..." row of the new-workspace
// host picker, in the picker's own row style. It shows the clone's progress and its last error.
import type React from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { RunTargetRow } from '@/components/new-workspace/run-target/RunTargetComboboxRow'
import type { ForkServerSetupState } from './use-fork-server-setup'
import type { ForkServerSetupRowModel } from './server-setup-rows'

export function ForkServerSetupRow({
  row,
  setup,
  armed,
  optionId,
  onArm
}: {
  row: ForkServerSetupRowModel
  setup: ForkServerSetupState
  armed: boolean
  optionId: string | undefined
  onArm: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const hostId = row.option.hostId
  const progress = setup.progress.get(hostId)
  const error = setup.errors.get(hostId)
  const folder = progress?.folder ?? `${setup.parent}/...`
  const detail = progress
    ? progress.stage === 'planning'
      ? t('fork.serverSetup.planning', 'Choosing a folder...')
      : progress.stage === 'cloning'
        ? t('fork.serverSetup.cloning', 'Cloning into {{folder}}...', { folder })
        : t('fork.serverSetup.checking', 'Checking what the project needs...')
    : (error ??
      t('fork.serverSetup.detail', "Clone from the project's git remote into {{folder}}", {
        folder
      }))
  return (
    <RunTargetRow
      icon={
        progress ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Download className="size-3.5 shrink-0 text-muted-foreground" />
        )
      }
      label={t('fork.serverSetup.rowLabel', 'Set up on {{host}}...', { host: row.option.label })}
      detail={detail}
      armed={armed}
      current={false}
      optionId={optionId}
      onArm={onArm}
      // Keeps the picker open, so the row's progress stays in view until the server is picked.
      onCommit={() => setup.start(row.option)}
    />
  )
}
