// Boundary compaction (FORK.md): its settings card. Off by default; with it off nothing runs.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  BOUNDARY_COMPACTION_DEFAULT_IDLE_SECONDS,
  BOUNDARY_COMPACTION_DEFAULT_MAX_WAIT_MINUTES,
  BOUNDARY_COMPACTION_DEFAULT_THRESHOLD_TOKENS,
  BOUNDARY_COMPACTION_MAX_IDLE_SECONDS,
  BOUNDARY_COMPACTION_MAX_THRESHOLD_TOKENS,
  BOUNDARY_COMPACTION_MAX_WAIT_MINUTES,
  BOUNDARY_COMPACTION_MIN_IDLE_SECONDS,
  BOUNDARY_COMPACTION_MIN_THRESHOLD_TOKENS,
  readBoundaryCompactionSettings
} from '../../../../shared/fork/boundary-compaction'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkBoundaryCompactionSetting({
  settings,
  updateSettings
}: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readBoundaryCompactionSettings(settings)
  const on = config.mode === 'on'
  const thresholdLabel = t('fork.boundaryCompaction.threshold', 'Context size (tokens)')
  const idleLabel = t('fork.boundaryCompaction.idle', 'Rest after a turn (seconds)')
  const maxWaitLabel = t('fork.boundaryCompaction.maxWait', 'Longest wait (minutes)')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.boundaryCompaction.title', 'Boundary compaction (experimental)')}
        description={t(
          'fork.boundaryCompaction.description',
          'An agent compacts on its own when its context fills, usually in the middle of a turn. With this on, a native chat that has finished its turn and sits idle with a large context is asked to compact then instead. A chat that is working, has background work, a queued message or text in its message box is left alone. The agent keeps its own compaction as the fallback.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.boundaryCompaction.enabled', 'Compact idle chats between turns')}
        checked={on}
        onChange={() => updateSettings({ forkBoundaryCompactMode: on ? 'off' : 'on' })}
      />
      <SettingsRow
        label={thresholdLabel}
        description={t(
          'fork.boundaryCompaction.thresholdHelp',
          'Default {{count}}. A chat with a smaller context is not compacted.',
          { count: BOUNDARY_COMPACTION_DEFAULT_THRESHOLD_TOKENS }
        )}
        control={
          <ForkNumberInput
            value={config.thresholdTokens}
            label={thresholdLabel}
            min={BOUNDARY_COMPACTION_MIN_THRESHOLD_TOKENS}
            max={BOUNDARY_COMPACTION_MAX_THRESHOLD_TOKENS}
            className="w-28"
            disabled={!on}
            onCommit={(next) => updateSettings({ forkBoundaryCompactThresholdTokens: next })}
          />
        }
      />
      <SettingsRow
        label={idleLabel}
        description={t(
          'fork.boundaryCompaction.idleHelp',
          'Default {{count}}. How long a chat must sit idle after its turn before it may be compacted.',
          { count: BOUNDARY_COMPACTION_DEFAULT_IDLE_SECONDS }
        )}
        control={
          <ForkNumberInput
            value={config.idleSeconds}
            label={idleLabel}
            min={BOUNDARY_COMPACTION_MIN_IDLE_SECONDS}
            max={BOUNDARY_COMPACTION_MAX_IDLE_SECONDS}
            disabled={!on}
            onCommit={(next) => updateSettings({ forkBoundaryCompactIdleSeconds: next })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.boundaryCompaction.preferCold', 'Wait for the prompt cache to expire')}
        description={t(
          'fork.boundaryCompaction.preferColdHelp',
          'While the cache is warm the next message is cheap, so the chat is left as it is. It is compacted once the cache has expired, or after the longest wait below, whichever comes first. The cache lifetime is the one set for the cache-cold cue.'
        )}
        checked={config.preferCold}
        disabled={!on}
        onChange={() => updateSettings({ forkBoundaryCompactPreferCold: !config.preferCold })}
      />
      <SettingsRow
        label={maxWaitLabel}
        description={t(
          'fork.boundaryCompaction.maxWaitHelp',
          'Default {{count}}. After this much rest a chat is compacted even on a warm cache.',
          { count: BOUNDARY_COMPACTION_DEFAULT_MAX_WAIT_MINUTES }
        )}
        control={
          <ForkNumberInput
            value={config.maxWaitMinutes}
            label={maxWaitLabel}
            min={1}
            max={BOUNDARY_COMPACTION_MAX_WAIT_MINUTES}
            disabled={!on || !config.preferCold}
            onCommit={(next) => updateSettings({ forkBoundaryCompactMaxWaitMinutes: next })}
          />
        }
      />
    </section>
  )
}
