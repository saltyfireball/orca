// Fork sync status (FORK.md "Sync status") settings: the notice ships on, stale after 3 days.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_SYNC_NOTICE_STALE_DAY_CHOICES,
  forkSyncNoticeEnabled,
  forkSyncNoticeStaleDays
} from '../../../../shared/fork/fork-sync-status'
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
import { useTranslate } from '@/i18n/use-translate'

type ForkSyncNoticeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkSyncNoticeSetting({
  settings,
  updateSettings
}: ForkSyncNoticeSettingProps): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  const enabled = forkSyncNoticeEnabled(settings)
  const days = forkSyncNoticeStaleDays(settings)
  const choices = FORK_SYNC_NOTICE_STALE_DAY_CHOICES.includes(days)
    ? FORK_SYNC_NOTICE_STALE_DAY_CHOICES
    : [...FORK_SYNC_NOTICE_STALE_DAY_CHOICES, days]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.syncStatus.title', 'Fork sync status')}
        description={t(
          'fork.syncStatus.description',
          "The update check also reads the fork's sync status and says when the fork is behind upstream or its last sync failed. It never blocks an update."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.syncStatus.label', 'Show the fork sync notice')}
        description={t('fork.syncStatus.help', 'Shown under the update state in Settings, About.')}
        checked={enabled}
        onChange={() => updateSettings({ forkSyncNotice: !enabled })}
      />
      <SettingsRow
        label={t('fork.syncStatus.staleLabel', 'Warn when no sync is reported for')}
        description={t(
          'fork.syncStatus.staleHelp',
          'The sync workflow reports daily. A status older than this means it has stopped running.'
        )}
        labelId={labelId}
        control={
          <Select
            value={String(days)}
            disabled={!enabled}
            onValueChange={(value) => updateSettings({ forkSyncNoticeStaleDays: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {choice === 0
                    ? t('fork.syncStatus.staleOff', 'Never')
                    : t('fork.syncStatus.staleDays', '{{count}} days', { count: choice })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
