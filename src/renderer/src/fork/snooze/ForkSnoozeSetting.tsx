// Snooze (FORK.md, SLRM-2269) settings: on by default, every wake trigger on, no cleanup command.
// The cleanup command can be set only here: `orca settings` refuses to write it.
import React, { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { readForkSnoozeSettings } from '../../../../shared/fork/snooze'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function CommandSetting({
  saved,
  label,
  description,
  disabled,
  onCommit
}: {
  saved: string
  label: string
  description: string
  disabled: boolean
  onCommit: (next: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft !== null && draft.trim() !== saved) {
      onCommit(draft.trim())
    }
    setDraft(null)
  }
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <Input
          variant="code"
          className="w-56"
          aria-label={label}
          disabled={disabled}
          value={draft ?? saved}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}

export function ForkSnoozeSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const current = readForkSnoozeSettings(settings)
  const off = !current.enabled
  const morningLabel = t('fork.snooze.settings.morningLabel', 'Morning hour')
  const eveningLabel = t('fork.snooze.settings.eveningLabel', 'Evening hour')
  const idleLabel = t('fork.snooze.settings.idleDaysLabel', 'Idle days')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.snooze.settings.title', 'Snooze')}
        description={t(
          'fork.snooze.settings.description',
          'Hide a workspace or chat from the sidebar until a time, until its pull request merges, or until it has sat idle. Snoozed items wait in a Snoozed row at the bottom of the sidebar.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.snooze.settings.enabledLabel', 'Snooze')}
        description={t(
          'fork.snooze.settings.enabledHelp',
          'Snooze... in the workspace and agent row menus, and orca snooze. Off shows everything snoozed again.'
        )}
        checked={current.enabled}
        onChange={() => updateSettings({ forkSnooze: !current.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.snooze.settings.attentionLabel', 'Wake when it needs me')}
        description={t(
          'fork.snooze.settings.attentionHelp',
          'Bring it back early when one of its agents asks for an approval or a permission, or asks a question.'
        )}
        checked={current.wakeOnAttention}
        disabled={off}
        onChange={() => updateSettings({ forkSnoozeWakeOnAttention: !current.wakeOnAttention })}
      />
      <SettingsSwitchRow
        label={t('fork.snooze.settings.failureLabel', 'Wake when it fails')}
        description={t(
          'fork.snooze.settings.failureHelp',
          'Bring it back early when its agent run fails or errors.'
        )}
        checked={current.wakeOnFailure}
        disabled={off}
        onChange={() => updateSettings({ forkSnoozeWakeOnFailure: !current.wakeOnFailure })}
      />
      <SettingsSwitchRow
        label={t('fork.snooze.settings.openLabel', 'Wake when I open it')}
        description={t(
          'fork.snooze.settings.openHelp',
          'Opening a snoozed workspace or chat ends its snooze.'
        )}
        checked={current.wakeOnOpen}
        disabled={off}
        onChange={() => updateSettings({ forkSnoozeWakeOnOpen: !current.wakeOnOpen })}
      />
      <SettingsRow
        label={morningLabel}
        description={t(
          'fork.snooze.settings.morningHelp',
          'The hour (0 to 23) of Tomorrow morning and Next Monday morning.'
        )}
        control={
          <ForkNumberInput
            value={current.morningHour}
            label={morningLabel}
            min={0}
            max={23}
            disabled={off}
            onCommit={(next) => updateSettings({ forkSnoozeMorningHour: next })}
          />
        }
      />
      <SettingsRow
        label={eveningLabel}
        description={t('fork.snooze.settings.eveningHelp', 'The hour (0 to 23) of This evening.')}
        control={
          <ForkNumberInput
            value={current.eveningHour}
            label={eveningLabel}
            min={0}
            max={23}
            disabled={off}
            onCommit={(next) => updateSettings({ forkSnoozeEveningHour: next })}
          />
        }
      />
      <SettingsRow
        label={idleLabel}
        description={t(
          'fork.snooze.settings.idleDaysHelp',
          'The days of the menu choice Until idle.'
        )}
        control={
          <ForkNumberInput
            value={current.idleDays}
            label={idleLabel}
            min={1}
            max={365}
            disabled={off}
            onCommit={(next) => updateSettings({ forkSnoozeIdleDays: next })}
          />
        }
      />
      <CommandSetting
        saved={current.settleCommand}
        label={t('fork.snooze.settings.commandLabel', 'Cleanup command when it settles')}
        description={t(
          'fork.snooze.settings.commandHelp',
          'Runs once with your rights when a snooze set until merge or until idle settles, with ORCA_SNOOZE_* environment values and the snooze as JSON on standard input. Treat those values as untrusted text and quote them. A snooze set from a paired device never runs it. Empty: none.'
        )}
        disabled={off}
        onCommit={(next) => updateSettings({ forkSnoozeSettleCommand: next })}
      />
    </section>
  )
}
