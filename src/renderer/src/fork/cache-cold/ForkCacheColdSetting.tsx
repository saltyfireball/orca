// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the cue's settings. On by default; it
// only ever shows a hint and never holds a message back.
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_CACHE_COLD_DEFAULT_THRESHOLD,
  FORK_CACHE_WINDOW_DEFAULT_MINUTES,
  FORK_CACHE_WINDOW_MAX_MINUTES,
  forkCacheColdConfig
} from '../../../../shared/fork/usage-ledger'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { ForkNumberInput } from './ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkCacheColdSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const config = forkCacheColdConfig(settings)
  const windowLabel = translate('fork.cacheCold.setting.window', 'Cache lifetime (minutes)')
  const thresholdLabel = translate('fork.cacheCold.setting.threshold', 'Smallest context (tokens)')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.cacheCold.setting.title', 'Cache-cold cue')}
        description={translate(
          'fork.cacheCold.setting.description',
          'A prompt cache expires when a chat sits idle. The next message then re-reads the whole context at full price. The cue says so on the composer and the chat row, and offers to compact first. Claude chats only.'
        )}
      />
      <SettingsSwitchRow
        label={translate('fork.cacheCold.setting.enabled', 'Show the cache-cold cue')}
        checked={config.enabled}
        onChange={() => updateSettings({ forkCacheColdCue: !config.enabled })}
      />
      <SettingsRow
        label={windowLabel}
        description={translate(
          'fork.cacheCold.setting.windowHelp',
          'Default {{count}}. Used when the provider does not say; a lifetime the usage reports (5 minutes or 1 hour) wins.',
          { count: FORK_CACHE_WINDOW_DEFAULT_MINUTES }
        )}
        control={
          <ForkNumberInput
            value={config.windowMinutes}
            label={windowLabel}
            min={1}
            max={FORK_CACHE_WINDOW_MAX_MINUTES}
            disabled={!config.enabled}
            onCommit={(next) => updateSettings({ forkCacheWindowMinutes: next })}
          />
        }
      />
      <SettingsRow
        label={thresholdLabel}
        description={translate(
          'fork.cacheCold.setting.thresholdHelp',
          'Default {{count}}. Smaller contexts are cheap to re-read, so they get no cue.',
          { count: FORK_CACHE_COLD_DEFAULT_THRESHOLD }
        )}
        control={
          <ForkNumberInput
            value={config.threshold}
            label={thresholdLabel}
            min={0}
            max={10_000_000}
            className="w-28"
            disabled={!config.enabled}
            onCommit={(next) => updateSettings({ forkCacheColdThresholdTokens: next })}
          />
        }
      />
    </section>
  )
}
