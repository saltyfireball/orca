// Agent guards (FORK.md, SLRM-2385) settings: the failure-loop guard (on) and the spend cap (off).
// Main reads them on every sweep and hook post, so a change applies at once.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  AGENT_GUARD_DEFAULT_REPEATS,
  AGENT_GUARD_MAX_CAP_USD,
  AGENT_GUARD_MAX_REPEATS,
  AGENT_GUARD_MIN_REPEATS,
  readAgentGuardSettings
} from '../../../../shared/fork/agent-guards'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

const SETTING_KEYS = {
  runCapUsd: 'forkAgentGuardRunCapUsd',
  automationRunCapUsd: 'forkAutomationCapRunUsd',
  automationDayCapUsd: 'forkAutomationCapDayUsd',
  automationWeekCapUsd: 'forkAutomationCapWeekUsd'
} as const

// Fork (BAD-679): caps beyond one chat. All 0 (off) unless set.
const RUN_AND_AUTOMATION_CAPS = [
  {
    key: 'runCap',
    field: 'runCapUsd',
    label: 'Spend cap per Run (USD)',
    help: '0 is off. A coordinator and its workers together; at the cap every agent in the Run is paused. orca guards cap --run sets one Run its own.'
  },
  {
    key: 'automationRunCap',
    field: 'automationRunCapUsd',
    label: 'Automation spend cap per run (USD)',
    help: '0 is off. One run of an automation; its agent is paused at the end of the turn that passes it. orca guards automation-cap sets one automation its own.'
  },
  {
    key: 'automationDayCap',
    field: 'automationDayCapUsd',
    label: 'Automation spend cap per day (USD)',
    help: '0 is off. What an automation spent today (local time); past it further runs are skipped and run history says why.'
  },
  {
    key: 'automationWeekCap',
    field: 'automationWeekCapUsd',
    label: 'Automation spend cap per 7 days (USD)',
    help: '0 is off. What an automation spent over the last 7 days; past it further runs are skipped until older spend ages out.'
  }
] as const

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkAgentGuardsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readAgentGuardSettings(settings)
  const repeatsLabel = t('fork.agentGuards.repeats', 'Repeats before the warning')
  const capLabel = t('fork.agentGuards.cap', 'Spend cap per chat (USD)')
  const scopeLabel = t('fork.agentGuards.scope', 'Default cap covers')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.agentGuards.title', 'Agent guards')}
        description={t(
          'fork.agentGuards.description',
          'Guards for agents nobody is watching. A paused agent is listed in the Decision inbox, and its tab and sidebar row say why.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.agentGuards.loop', 'Failure-loop guard')}
        description={t(
          'fork.agentGuards.loopHelp',
          'When an agent runs the same tool call with the same input and gets the same error again and again, tell it once to change approach. Reads and waits between tries do not count; a call that works starts over.'
        )}
        checked={config.loop}
        onChange={() => updateSettings({ forkAgentGuardLoop: !config.loop })}
      />
      <SettingsRow
        label={repeatsLabel}
        description={t('fork.agentGuards.repeatsHelp', 'Default {{count}}.', {
          count: AGENT_GUARD_DEFAULT_REPEATS
        })}
        control={
          <ForkNumberInput
            value={config.repeats}
            label={repeatsLabel}
            min={AGENT_GUARD_MIN_REPEATS}
            max={AGENT_GUARD_MAX_REPEATS}
            disabled={!config.loop}
            onCommit={(next) => updateSettings({ forkAgentGuardLoopRepeats: next })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.agentGuards.pause', 'Pause if it fails again after the warning')}
        description={t(
          'fork.agentGuards.pauseHelp',
          'Stops the turn the way the Stop button does (Esc for a Claude Code or Codex terminal) and waits for you.'
        )}
        checked={config.pauseAfterWarning}
        disabled={!config.loop}
        onChange={() => updateSettings({ forkAgentGuardLoopPause: !config.pauseAfterWarning })}
      />
      <SettingsRow
        label={capLabel}
        description={t(
          'fork.agentGuards.capHelp',
          '0 is off. Estimated from the usage ledger at per-token prices; a chat past it is paused when its turn ends, and a Claude Code or Codex terminal agent is stopped after its next tool call. Claude and Codex chats and terminals are counted. orca guards cap sets one chat its own.'
        )}
        control={
          <ForkNumberInput
            value={config.capUsd}
            label={capLabel}
            min={0}
            max={AGENT_GUARD_MAX_CAP_USD}
            decimal
            onCommit={(next) => updateSettings({ forkAgentGuardSpendCapUsd: next })}
          />
        }
      />
      <SettingsRow
        label={scopeLabel}
        control={
          <SettingsSegmentedControl
            value={config.capScope}
            ariaLabel={scopeLabel}
            size="sm"
            onChange={(next) => updateSettings({ forkAgentGuardSpendCapScope: next })}
            options={[
              { value: 'workers', label: t('fork.agentGuards.scopeWorkers', 'Workers') },
              { value: 'all', label: t('fork.agentGuards.scopeAll', 'All chats') }
            ]}
          />
        }
      />
      {RUN_AND_AUTOMATION_CAPS.map(({ key, field, label, help }) => (
        <SettingsRow
          key={key}
          label={t(`fork.agentGuards.${key}`, label)}
          description={t(`fork.agentGuards.${key}Help`, help)}
          control={
            <ForkNumberInput
              value={config[field]}
              label={t(`fork.agentGuards.${key}`, label)}
              min={0}
              max={AGENT_GUARD_MAX_CAP_USD}
              decimal
              onCommit={(next) => updateSettings({ [SETTING_KEYS[field]]: next })}
            />
          }
        />
      ))}
      <SettingsSwitchRow
        label={t('fork.agentGuards.notify', 'Notify when a guard pauses an agent')}
        description={t(
          'fork.agentGuards.notifyHelp',
          'Uses the Decision inbox targets: desktop notification, webhook and command.'
        )}
        checked={config.notify}
        onChange={() => updateSettings({ forkAgentGuardNotify: !config.notify })}
      />
    </section>
  )
}
