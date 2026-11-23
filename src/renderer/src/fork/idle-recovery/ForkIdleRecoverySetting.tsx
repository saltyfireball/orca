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
import { readForkInboxBotAsksSettings } from '../../../../shared/fork/inbox-bot-asks'
import { readForkBotRowClick, type ForkBotRowClick } from '../../../../shared/fork/bot-row-ask-jump'
import { readForkNeedsYouSettings } from '../../../../shared/fork/needs-you'
import {
  readForkBotOwnerSteps,
  readForkBotOwnerStepsAutoAnswer,
  readForkBotOwnerStepsOpenInTerminal
} from '../../../../shared/fork/bot-owner-steps'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const MODES: readonly IdleRecoveryMode[] = ['off', 'inbox', 'wake']
const BOT_ROW_CLICKS: readonly ForkBotRowClick[] = ['list', 'item', 'off']

function botRowClickLabel(click: ForkBotRowClick, t: Translate): string {
  if (click === 'item') {
    return t('fork.botRowAskJump.item', 'Its oldest waiting item')
  }
  if (click === 'off') {
    return t('fork.botRowAskJump.off', 'Only open the bot')
  }
  return t('fork.botRowAskJump.list', 'Its Home list, Needs you on top')
}

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
  // SLRM-2453: bot asks use the same notify targets, so they stay editable while bot asks are on.
  const botAsks = readForkInboxBotAsksSettings(settings)
  const targetsOff = off && !botAsks.enabled
  // SLRM-2472, BAD-759: what a bot row's click shows while the bot has asks waiting.
  const botRowClick = readForkBotRowClick(settings)
  const botRowClickId = useId()
  const needsYou = readForkNeedsYouSettings(settings)
  const ownerSteps = readForkBotOwnerSteps(settings)
  const ownerStepsTerminal = readForkBotOwnerStepsOpenInTerminal(settings)
  const ownerStepsAnswer = readForkBotOwnerStepsAutoAnswer(settings)
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
        label={t('fork.botAsks.settingLabel', 'Bot asks in the Decision inbox')}
        description={t(
          'fork.botAsks.settingHelp',
          'List the items bots set to Needs you, here and on paired servers, count them on the inbox button, and tell the notify targets below of each new one. Works with idle recovery off.'
        )}
        checked={botAsks.enabled}
        onChange={() => updateSettings({ forkInboxBotAsks: !botAsks.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.botAsks.phoneLabel', 'Push new bot asks to my phone')}
        description={t(
          'fork.botAsks.phoneHelp',
          'Phones paired with this computer get each new bot ask, while notifications are on.'
        )}
        checked={botAsks.phone}
        disabled={!botAsks.enabled}
        onChange={() => updateSettings({ forkInboxBotAsksPhone: !botAsks.phone })}
      />
      <SettingsRow
        label={t('fork.botRowAskJump.settingLabel', 'Clicking a bot that needs you shows')}
        description={t(
          'fork.botRowAskJump.settingHelp',
          'What a click on a bot row with items waiting on you opens. Its Home list puts Needs you at the top, and leaves an open item for the list. Its oldest waiting item opens that item, and a second click the next. Off: the click only opens the bot.'
        )}
        labelId={botRowClickId}
        control={
          <Select
            value={botRowClick}
            onValueChange={(value) =>
              updateSettings({
                forkBotRowAskJump: value === 'item' || value === 'off' ? value : 'list'
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={botRowClickId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOT_ROW_CLICKS.map((click) => (
                <SelectItem key={click} value={click}>
                  {botRowClickLabel(click, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.needsYou.settingLabel', 'Needs you list')}
        description={t(
          'fork.needsYou.settingHelp',
          'One list of everything that waits on you, opened from a shortcut (Settings > Shortcuts) or the Needs you control in the status bar, with a jump to each one. Off: the Decision inbox icon returns to the sidebar.'
        )}
        checked={needsYou.enabled}
        onChange={() => updateSettings({ forkNeedsYou: !needsYou.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.needsYou.quickAnswersLabel', 'Quick answers in the Needs you list')}
        description={t(
          'fork.needsYou.quickAnswersHelp',
          'An ask with options shows them as buttons in the list, and any ask takes a typed answer. Nothing is sent until you press an option or Send.'
        )}
        checked={needsYou.quickAnswers}
        disabled={!needsYou.enabled}
        onChange={() => updateSettings({ forkNeedsYouQuickAnswers: !needsYou.quickAnswers })}
      />
      <SettingsSwitchRow
        label={t('fork.botOwnerSteps.settingLabel', 'Bot steps as a checklist')}
        description={t(
          'fork.botOwnerSteps.settingHelp',
          'Commands and manual acts a bot asks you to do show as a numbered checklist on its item, with Copy and Done. Off: they are written into the comment as a list instead.'
        )}
        checked={ownerSteps}
        onChange={() => updateSettings({ forkBotOwnerSteps: !ownerSteps })}
      />
      <SettingsSwitchRow
        label={t('fork.botOwnerSteps.terminalLabel', 'Open a step in a terminal')}
        description={t(
          'fork.botOwnerSteps.terminalHelp',
          'A step with a command can open a terminal on its computer with the command typed in. It is never run: you press Enter.'
        )}
        checked={ownerStepsTerminal}
        disabled={!ownerSteps}
        onChange={() => updateSettings({ forkBotOwnerStepsOpenInTerminal: !ownerStepsTerminal })}
      />
      <SettingsSwitchRow
        label={t('fork.botOwnerSteps.answerLabel', 'Answer the ask when the last step is done')}
        description={t(
          'fork.botOwnerSteps.answerHelp',
          "Ticking the last step answers the bot's question as done when one of its options plainly says so. Otherwise the bot is only told."
        )}
        checked={ownerStepsAnswer}
        disabled={!ownerSteps}
        onChange={() => updateSettings({ forkBotOwnerStepsAutoAnswer: !ownerStepsAnswer })}
      />
      <SettingsSwitchRow
        label={t('fork.idleRecovery.notifyDesktopLabel', 'Notify when a chat waits on me')}
        description={t(
          'fork.idleRecovery.notifyDesktopHelp',
          'A desktop notification when a chat starts waiting on you.'
        )}
        checked={current.notifyDesktop}
        disabled={targetsOff}
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
        disabled={targetsOff}
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
        disabled={targetsOff}
      />
      <ForkIdleRecoveryPausedList settings={settings} updateSettings={updateSettings} />
    </section>
  )
}
