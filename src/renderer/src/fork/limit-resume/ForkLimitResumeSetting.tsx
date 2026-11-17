// Limit resume (FORK.md, SLRM-2309): its settings card. On by default. Main reads the settings
// live, in the desktop app and in the headless server alike (set those with `orca settings
// --environment`).
import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  LIMIT_RESUME_DEFAULT_BACKOFF_MINUTES,
  LIMIT_RESUME_DEFAULT_DELAY_SECONDS,
  LIMIT_RESUME_DEFAULT_MAX_TRIES,
  LIMIT_RESUME_DEFAULT_MESSAGE,
  LIMIT_RESUME_MAX_BACKOFF_MINUTES,
  LIMIT_RESUME_MAX_DELAY_SECONDS,
  LIMIT_RESUME_MAX_MAX_TRIES,
  LIMIT_RESUME_MAX_MESSAGE_LENGTH,
  LIMIT_RESUME_MIN_BACKOFF_MINUTES,
  LIMIT_RESUME_MIN_MAX_TRIES,
  readLimitResumeSettings
} from '../../../../shared/fork/limit-resume'
import {
  SettingsRow,
  SettingsSegmentedControl,
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

function MessageInput({
  saved,
  label,
  disabled,
  onCommit
}: {
  saved: string
  label: string
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
    <Input
      className="w-56"
      aria-label={label}
      disabled={disabled}
      maxLength={LIMIT_RESUME_MAX_MESSAGE_LENGTH}
      value={draft ?? saved}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}

export function ForkLimitResumeSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readLimitResumeSettings(settings)
  const off = !config.enabled
  const triesLabel = t('fork.limitResume.maxTries', 'Resumes in a row')
  const delayLabel = t('fork.limitResume.delay', 'Wait after the reset (seconds)')
  const backoffLabel = t('fork.limitResume.backoff', 'First wait with no reset time (minutes)')
  const messageLabel = t('fork.limitResume.message', 'Message to a terminal agent')
  const switchLabel = t('fork.limitResume.codexSwitch', 'Codex "Approaching rate limits" menu')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.limitResume.title', 'Limit resume')}
        description={t(
          'fork.limitResume.description',
          'Resume chats and terminal agents that stopped on a usage limit once it resets.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.limitResume.label', 'Resume after a usage limit resets')}
        description={t(
          'fork.limitResume.help',
          'A Claude or Codex chat or terminal agent that hits its usage limit waits, shows when it resumes, and is told to go on at the reset time the provider gave, or after a wait that doubles each time when it gave none. Native chats use the Chat setting of the same kind, which this turns on.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkLimitResume: off })}
      />
      <SettingsSwitchRow
        label={t('fork.limitResume.terminals', 'Also terminal agents')}
        description={t(
          'fork.limitResume.terminalsHelp',
          'Read the screen of Claude Code and Codex terminal agents for a limit message.'
        )}
        checked={config.terminals}
        disabled={off}
        onChange={() => updateSettings({ forkLimitResumeTerminals: !config.terminals })}
      />
      <SettingsSwitchRow
        label={t('fork.limitResume.holdTyping', 'Wait while you are typing there')}
        description={t(
          'fork.limitResume.holdTypingHelp',
          'A chat whose message box has text, or a terminal you typed into since it stopped, is not resumed until it is clear. A terminal with text in its prompt always waits.'
        )}
        checked={config.holdWhileTyping}
        disabled={off}
        onChange={() => updateSettings({ forkLimitResumeHoldWhileTyping: !config.holdWhileTyping })}
      />
      <SettingsRow
        label={triesLabel}
        description={t(
          'fork.limitResume.maxTriesHelp',
          'Default {{count}}. After this many automatic resumes in a row it waits for you. Native chats stop at 5 at most.',
          { count: LIMIT_RESUME_DEFAULT_MAX_TRIES }
        )}
        control={
          <ForkNumberInput
            value={config.maxTries}
            label={triesLabel}
            min={LIMIT_RESUME_MIN_MAX_TRIES}
            max={LIMIT_RESUME_MAX_MAX_TRIES}
            disabled={off}
            onCommit={(next) => updateSettings({ forkLimitResumeMaxTries: next })}
          />
        }
      />
      <SettingsRow
        label={delayLabel}
        description={t(
          'fork.limitResume.delayHelp',
          'Default {{count}}. Terminal agents only; native chats follow the account usage Orca reads.',
          { count: LIMIT_RESUME_DEFAULT_DELAY_SECONDS }
        )}
        control={
          <ForkNumberInput
            value={config.delaySeconds}
            label={delayLabel}
            min={0}
            max={LIMIT_RESUME_MAX_DELAY_SECONDS}
            disabled={off}
            onCommit={(next) => updateSettings({ forkLimitResumeDelaySeconds: next })}
          />
        }
      />
      <SettingsRow
        label={backoffLabel}
        description={t(
          'fork.limitResume.backoffHelp',
          'Default {{count}}. Doubles after each try, up to 6 hours.',
          { count: LIMIT_RESUME_DEFAULT_BACKOFF_MINUTES }
        )}
        control={
          <ForkNumberInput
            value={config.backoffMinutes}
            label={backoffLabel}
            min={LIMIT_RESUME_MIN_BACKOFF_MINUTES}
            max={LIMIT_RESUME_MAX_BACKOFF_MINUTES}
            disabled={off}
            onCommit={(next) => updateSettings({ forkLimitResumeBackoffMinutes: next })}
          />
        }
      />
      <SettingsRow
        label={messageLabel}
        description={t('fork.limitResume.messageHelp', 'Default "{{text}}". One line.', {
          text: LIMIT_RESUME_DEFAULT_MESSAGE
        })}
        control={
          <MessageInput
            saved={config.message}
            label={messageLabel}
            disabled={off}
            onCommit={(next) => updateSettings({ forkLimitResumeMessage: next })}
          />
        }
      />
      <SettingsRow
        label={switchLabel}
        description={t(
          'fork.limitResume.codexSwitchHelp',
          'Between turns Codex may hold its pane on a menu offering a cheaper model. Dismiss presses Esc, which keeps the current model, so the pane is not stuck overnight.'
        )}
        control={
          <SettingsSegmentedControl
            value={config.codexSwitchPrompt}
            ariaLabel={switchLabel}
            size="sm"
            onChange={(next) => updateSettings({ forkLimitResumeCodexSwitchPrompt: next })}
            options={[
              { value: 'dismiss', label: t('fork.limitResume.codexSwitchDismiss', 'Dismiss') },
              { value: 'leave', label: t('fork.limitResume.codexSwitchLeave', 'Leave it') }
            ]}
          />
        }
      />
    </section>
  )
}
