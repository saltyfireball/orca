// Worker archive (FORK.md, BAD-669) settings: on/off, the archive delay and the terminal stop delay.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_WORKER_ARCHIVE_DELAY_CHOICES,
  FORK_WORKER_TERMINAL_STOP_CHOICES,
  forkWorkerArchiveDelayMinutes,
  forkWorkerArchiveEnabled,
  forkWorkerTerminalStopMinutes
} from '../../../../shared/fork/worker-archive'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { formatMinutesDuration } from '@/i18n/ui-intl-formatters'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function withCurrent(choices: readonly number[], current: number): readonly number[] {
  return choices.includes(current) ? choices : [current, ...choices].sort((a, b) => a - b)
}

export function ForkWorkerArchiveSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const delayId = useId()
  const stopId = useId()
  const enabled = forkWorkerArchiveEnabled(settings)
  const delay = forkWorkerArchiveDelayMinutes(settings)
  const stop = forkWorkerTerminalStopMinutes(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.workerArchive.title', 'Finished worker workspaces')}
        description={t(
          'fork.workerArchive.description',
          'Workers started in a workspace of their own leave it, with its terminals and build output, until it is removed. This removes it once the work is safe. The git branch is always kept.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.workerArchive.label', 'Archive finished workers’ workspaces')}
        description={t(
          'fork.workerArchive.help',
          'Removes the workspace (like worktree rm) once the worker finished, the delay below has passed, nothing is uncommitted or untracked and every commit is on a base branch. Kept open, pinned, in use or used after finishing, a workspace stays, and its row says why. Servers do the same for their own workspaces.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkWorkerArchive: !enabled })}
      />
      <SettingsRow
        label={t('fork.workerArchive.delayLabel', 'Archive after')}
        description={t('fork.workerArchive.delayHelp', 'Time since the worker finished.')}
        labelId={delayId}
        control={
          <Select
            value={String(delay)}
            disabled={!enabled}
            onValueChange={(value) =>
              updateSettings({ forkWorkerArchiveDelayMinutes: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={delayId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(FORK_WORKER_ARCHIVE_DELAY_CHOICES, delay).map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={t('fork.workerArchive.stopLabel', 'Stop idle terminals after')}
        description={t(
          'fork.workerArchive.stopHelp',
          'A finished worker’s agent and terminal stop this long after it reports, freeing memory, even when its workspace stays. Its chat still opens read-only, and sending it a message starts it again.'
        )}
        labelId={stopId}
        control={
          <Select
            value={String(stop)}
            disabled={!enabled}
            onValueChange={(value) =>
              updateSettings({ forkWorkerTerminalStopMinutes: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={stopId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(FORK_WORKER_TERMINAL_STOP_CHOICES, stop).map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
