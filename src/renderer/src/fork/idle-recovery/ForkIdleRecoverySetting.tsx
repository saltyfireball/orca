// Idle recovery (FORK.md) settings. Ships off. The classifier command, the notification command
// and the webhook address can be set only here: `orca settings` refuses to write them.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  readIdleRecoverySettings,
  type IdleRecoveryMode
} from '../../../../shared/fork/idle-recovery-settings'
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
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'
import { ForkIdleRecoveryPausedList } from './ForkIdleRecoveryPausedList'
import { ForkTextSetting as TextSetting } from './ForkTextSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const MODES: readonly IdleRecoveryMode[] = ['off', 'inbox', 'wake']

function modeLabel(mode: IdleRecoveryMode, t: Translate): string {
  if (mode === 'inbox') {
    return t('fork.idleRecovery.modeInbox', 'List chats waiting on me')
  }
  if (mode === 'wake') {
    return t('fork.idleRecovery.modeWake', 'List them and wake stalled chats')
  }
  return t('fork.idleRecovery.modeOff', 'Off')
}

export function ForkIdleRecoverySetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const modeId = useId()
  const current = readIdleRecoverySettings(settings)
  const off = current.mode === 'off'
  const noWake = current.mode !== 'wake'
  const idleLabel = t('fork.idleRecovery.idleLabel', 'Idle time before a look (seconds)')
  const timeoutLabel = t('fork.idleRecovery.timeoutLabel', 'Classifier time limit (seconds)')
  const maxWakesLabel = t('fork.idleRecovery.maxWakesLabel', 'Most wakes per request')
  const recheckLabel = t(
    'fork.idleRecovery.recheckLabel',
    'Longest wait before another look (minutes)'
  )
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.idleRecovery.title', 'Idle recovery (experimental)')}
        description={t(
          'fork.idleRecovery.description',
          'After a turn ends and the chat sits idle, judge how it ended: finished, waiting on you, or stalled on work it could do now. Chats waiting on you are listed in the Decision inbox (also `orca inbox`).'
        )}
      />
      <SettingsRow
        label={t('fork.idleRecovery.modeLabel', 'Idle recovery')}
        description={t(
          'fork.idleRecovery.modeHelp',
          'Waking sends a message to a stalled chat, which starts a turn and uses tokens. Only turns you asked for are woken, and the built-in check never wakes a chat.'
        )}
        labelId={modeId}
        control={
          <Select
            value={current.mode}
            onValueChange={(value) =>
              updateSettings({
                forkIdleSweepMode: value === 'inbox' || value === 'wake' ? value : 'off'
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={modeId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {modeLabel(mode, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={idleLabel}
        control={
          <ForkNumberInput
            value={current.idleSeconds}
            label={idleLabel}
            min={10}
            max={86_400}
            disabled={off}
            onCommit={(next) => updateSettings({ forkIdleSweepIdleSeconds: next })}
          />
        }
      />
      <TextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkIdleSweepClassifierCommand"
        label={t('fork.idleRecovery.commandLabel', 'Classifier command')}
        description={t(
          'fork.idleRecovery.commandHelp',
          'Runs with your rights. It reads one JSON object describing the ending on standard input and prints a JSON verdict. Empty: the built-in check, which only notices an ending that closes on a question.'
        )}
        disabled={off}
      />
      <SettingsRow
        label={timeoutLabel}
        control={
          <ForkNumberInput
            value={current.classifierTimeoutSeconds}
            label={timeoutLabel}
            min={1}
            max={600}
            disabled={off || !current.classifierCommand}
            onCommit={(next) => updateSettings({ forkIdleSweepClassifierTimeoutSeconds: next })}
          />
        }
      />
      <SettingsRow
        label={maxWakesLabel}
        control={
          <ForkNumberInput
            value={current.maxWakes}
            label={maxWakesLabel}
            min={0}
            max={20}
            disabled={noWake}
            onCommit={(next) => updateSettings({ forkIdleSweepMaxWakes: next })}
          />
        }
      />
      <SettingsRow
        label={recheckLabel}
        control={
          <ForkNumberInput
            value={current.recheckMaxMinutes}
            label={recheckLabel}
            min={1}
            max={1440}
            disabled={off}
            onCommit={(next) => updateSettings({ forkIdleSweepRecheckMaxMinutes: next })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.idleRecovery.workersLabel', 'Include orchestration workers')}
        description={t(
          'fork.idleRecovery.workersHelp',
          'Off: workers are left to their coordinator.'
        )}
        checked={current.workers === 'include'}
        disabled={off}
        onChange={() =>
          updateSettings({
            forkIdleSweepWorkers: current.workers === 'include' ? 'skip' : 'include'
          })
        }
      />
      <SettingsSwitchRow
        label={t('fork.idleRecovery.notifyDesktopLabel', 'Notify when a chat waits on me')}
        description={t(
          'fork.idleRecovery.notifyDesktopHelp',
          'A desktop notification when a chat starts waiting on you.'
        )}
        checked={current.notifyDesktop}
        disabled={off}
        onChange={() => updateSettings({ forkInboxNotifyDesktop: !current.notifyDesktop })}
      />
      <TextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkInboxNotifyWebhookUrl"
        label={t('fork.idleRecovery.webhookLabel', 'Notification webhook')}
        description={t(
          'fork.idleRecovery.webhookHelp',
          'An http or https address that gets a POST with the waiting chats as JSON, questions included. Empty: none.'
        )}
        disabled={off}
      />
      <TextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkInboxNotifyCommand"
        label={t('fork.idleRecovery.notifyCommandLabel', 'Notification command')}
        description={t(
          'fork.idleRecovery.notifyCommandHelp',
          'Runs with your rights when a chat starts waiting on you, with the same JSON on standard input. Empty: none.'
        )}
        disabled={off}
      />
      <ForkIdleRecoveryPausedList settings={settings} updateSettings={updateSettings} />
    </section>
  )
}
