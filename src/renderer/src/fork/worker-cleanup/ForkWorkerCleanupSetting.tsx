// Worker cleanup (FORK.md) settings. Ships off; main reads them on every sweep.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_WORKER_CLEANUP_GRACE_CHOICES,
  forkWorkerCleanupAction,
  forkWorkerCleanupEnabled,
  forkWorkerCleanupGraceMinutes,
  forkWorkerCleanupOnDone,
  forkWorkerCleanupOnMerged,
  type ForkWorkerCleanupAction
} from '../../../../shared/fork/worker-cleanup'
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
import { translate } from '@/i18n/i18n'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import { formatMinutesDuration } from '@/i18n/ui-intl-formatters'

type ForkWorkerCleanupSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function actionLabel(action: ForkWorkerCleanupAction, t: Translate = translate): string {
  return action === 'release'
    ? t('fork.workerCleanup.actionRelease', 'Stop the agent, keep chat tabs')
    : t('fork.workerCleanup.actionClose', 'Stop the agent and close the tab')
}

export function ForkWorkerCleanupSetting({
  settings,
  updateSettings
}: ForkWorkerCleanupSettingProps): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const graceId = useId()
  const actionId = useId()
  const enabled = forkWorkerCleanupEnabled(settings)
  const minutes = forkWorkerCleanupGraceMinutes(settings)
  const action = forkWorkerCleanupAction(settings)
  const onDone = forkWorkerCleanupOnDone(settings)
  const onMerged = forkWorkerCleanupOnMerged(settings)
  const choices = FORK_WORKER_CLEANUP_GRACE_CHOICES.includes(minutes)
    ? FORK_WORKER_CLEANUP_GRACE_CHOICES
    : [minutes, ...FORK_WORKER_CLEANUP_GRACE_CHOICES]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.workerCleanup.title', 'Finished worker cleanup (experimental)')}
        description={t(
          'fork.workerCleanup.description',
          'Stop orchestration workers once their work is done, so finished agents stop holding memory. The worktree and branch are never touched, and a notice offers Undo.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.workerCleanup.label', 'Clean up finished workers')}
        description={t(
          'fork.workerCleanup.help',
          'Replaces the automatic close of finished workers while on. A worker is left open when you kept it open, used it after it reported, it has an open question, the coordinator has not read its report, or its worktree has uncommitted or unpushed work (it gets a mark instead). Only workers that finish while the app runs are cleaned up.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkWorkerCleanup: !enabled })}
      />
      <SettingsRow
        label={t('fork.workerCleanup.actionLabel', 'What to do')}
        description={t(
          'fork.workerCleanup.actionHelp',
          'A terminal worker always closes its pane, since the agent is the terminal; reopening it resumes the conversation. A chat can keep its tab, and the next message starts it again.'
        )}
        labelId={actionId}
        control={
          <Select
            value={action}
            disabled={!enabled}
            onValueChange={(value) =>
              updateSettings({
                forkWorkerCleanupAction: value === 'release' ? 'release' : 'close'
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={actionId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['close', 'release'] as const).map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {actionLabel(choice, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.workerCleanup.onDoneLabel', 'When the worker reports done')}
        description={t(
          'fork.workerCleanup.onDoneHelp',
          'Clean up a worker once its report has been in for the wait below.'
        )}
        checked={onDone}
        disabled={!enabled}
        onChange={() => updateSettings({ forkWorkerCleanupOnDone: !onDone })}
      />
      <SettingsRow
        label={t('fork.workerCleanup.graceLabel', 'Wait after the report')}
        description={t('fork.workerCleanup.graceHelp', 'Workers are checked every minute.')}
        labelId={graceId}
        control={
          <Select
            value={String(minutes)}
            disabled={!enabled || !onDone}
            onValueChange={(value) =>
              updateSettings({ forkWorkerCleanupGraceMinutes: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={graceId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.workerCleanup.onMergedLabel', 'When the worker branch is merged')}
        description={t(
          'fork.workerCleanup.onMergedHelp',
          'Clean up a finished worker as soon as its branch has a merged pull request (when the GitHub CLI is installed and signed in) or all of its commits are on the default branch.'
        )}
        checked={onMerged}
        disabled={!enabled}
        onChange={() => updateSettings({ forkWorkerCleanupOnMerged: !onMerged })}
      />
    </section>
  )
}
