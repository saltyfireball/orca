// Chat handoff (FORK.md, SLRM-2391): its settings card. On by default. Main reads the settings
// live, in the desktop app and in the headless server alike (set those with `orca settings
// --environment`).
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS,
  CHAT_HANDOFF_MAX_BUDGET_TOKENS,
  CHAT_HANDOFF_MIN_BUDGET_TOKENS,
  readChatHandoffSettings
} from '../../../../shared/fork/chat-handoff'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkChatHandoffSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readChatHandoffSettings(settings)
  const off = !config.enabled
  const budgetLabel = t('fork.chatHandoff.budget', 'History budget (tokens)')
  const onLimitLabel = t('fork.chatHandoff.onLimit', 'When a chat stops on a usage limit')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.chatHandoff.title', 'Chat handoff')}
        description={t(
          'fork.chatHandoff.description',
          'Hand a chat from Claude to Codex or back, with its recent history.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.chatHandoff.label', 'Hand off chats between Claude and Codex')}
        description={t(
          'fork.chatHandoff.help',
          "A chat tab's menu and `orca chat handoff` start a chat of the other agent in the same workspace. Its first message holds the original request and the newest entries in full, never a summary, and it reads older ones with `orca chat history`."
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkChatHandoff: off })}
      />
      <SettingsSwitchRow
        label={t('fork.chatHandoff.reuse', 'Hand back to the earlier chat')}
        description={t(
          'fork.chatHandoff.reuseHelp',
          'Handing back to the agent the work came from sends that earlier chat only what is new, while its context has room. With no room left, a fresh chat starts.'
        )}
        checked={config.reuse}
        disabled={off}
        onChange={() => updateSettings({ forkChatHandoffReuse: !config.reuse })}
      />
      <SettingsRow
        label={budgetLabel}
        description={t(
          'fork.chatHandoff.budgetHelp',
          'Default {{count}}. Counted as one token per byte of text, so the real share of the context is smaller. Your request comes on top and is never shortened.',
          { count: CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS }
        )}
        control={
          <ForkNumberInput
            value={config.budgetTokens}
            label={budgetLabel}
            min={CHAT_HANDOFF_MIN_BUDGET_TOKENS}
            max={CHAT_HANDOFF_MAX_BUDGET_TOKENS}
            disabled={off}
            onCommit={(next) => updateSettings({ forkChatHandoffBudgetTokens: next })}
          />
        }
      />
      <SettingsRow
        label={onLimitLabel}
        description={t(
          'fork.chatHandoff.onLimitHelp',
          'Offer shows a toast to hand the chat to the other agent. Automatic hands it off at once and cancels its resume at the reset. Needs Limit resume on.'
        )}
        control={
          <SettingsSegmentedControl
            value={config.onLimit}
            ariaLabel={onLimitLabel}
            size="sm"
            onChange={(next) => updateSettings({ forkChatHandoffOnLimit: next })}
            options={[
              { value: 'off', label: t('fork.chatHandoff.onLimitOff', 'Nothing') },
              { value: 'offer', label: t('fork.chatHandoff.onLimitOffer', 'Offer') },
              { value: 'auto', label: t('fork.chatHandoff.onLimitAuto', 'Automatic') }
            ]}
          />
        }
      />
    </section>
  )
}
