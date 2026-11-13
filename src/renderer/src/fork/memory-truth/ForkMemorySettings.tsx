// SLRM-2099: Settings > Advanced > Memory. When to warn about system memory, whether to pause new
// agents while over that line, and how often the background check runs.
import { useEffect } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_MEMORY_POLL_SECONDS_MAX,
  FORK_MEMORY_POLL_SECONDS_MIN,
  FORK_MEMORY_SETTING_DEFAULTS,
  FORK_MEMORY_SWAP_GB_MAX,
  resolveForkMemorySettings,
  type ForkMemoryPressureThreshold
} from '../../../../shared/fork/memory-truth'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { refreshForkMemoryStatus } from './memory-status'

type ForkMemorySettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** The main process re-reads settings when asked; give the save a moment to land first. */
const REFRESH_AFTER_SAVE_MS = 300

export function ForkMemorySettings({
  settings,
  updateSettings
}: ForkMemorySettingsProps): React.JSX.Element {
  const t = useTranslate()
  const resolved = resolveForkMemorySettings(settings)
  const key = JSON.stringify(resolved)
  useEffect(() => {
    const timer = setTimeout(refreshForkMemoryStatus, REFRESH_AFTER_SAVE_MS)
    return () => clearTimeout(timer)
  }, [key])

  const pressureOptions: { value: ForkMemoryPressureThreshold; label: string }[] = [
    { value: 'off', label: t('fork.memory.settings.pressureOff', 'Off') },
    { value: 'warn', label: t('fork.memory.settings.pressureWarn', 'Warning') },
    { value: 'critical', label: t('fork.memory.settings.pressureCritical', 'Critical') }
  ]

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.memory.settings.title', 'Memory')}
        description={t(
          'fork.memory.settings.description',
          'Warn in the status bar, with one notification, when the system runs short of memory.'
        )}
      />
      <SettingsRow
        label={t('fork.memory.settings.pressureLabel', 'Warn at memory pressure')}
        description={t(
          'fork.memory.settings.pressureHelp',
          "The operating system's own pressure level. Off ignores it."
        )}
        control={
          <SettingsSegmentedControl
            size="sm"
            value={resolved.warnPressure}
            options={pressureOptions}
            ariaLabel={t('fork.memory.settings.pressureLabel', 'Warn at memory pressure')}
            onChange={(value) => updateSettings({ forkMemoryWarnPressure: value })}
          />
        }
      />
      <NumberField
        label={t('fork.memory.settings.swapLabel', 'Warn at swap in use')}
        description={t(
          'fork.memory.settings.swapHelp',
          'Warn once this much swap is in use. 0 ignores swap.'
        )}
        value={resolved.warnSwapGb}
        defaultValue={FORK_MEMORY_SETTING_DEFAULTS.warnSwapGb}
        min={0}
        max={FORK_MEMORY_SWAP_GB_MAX}
        step={0.5}
        suffix="GB"
        onChange={(value) => updateSettings({ forkMemoryWarnSwapGb: value })}
      />
      <SettingsSwitchRow
        label={t('fork.memory.settings.pauseLabel', 'Pause new agents while over')}
        description={t(
          'fork.memory.settings.pauseHelp',
          'Refuse to start new agents and chats while memory is past the warning line. With the launch queue on, new chats wait in the queue instead and start when memory recovers. Running sessions are not touched.'
        )}
        checked={resolved.pauseLaunches}
        onChange={() => updateSettings({ forkMemoryPauseLaunches: !resolved.pauseLaunches })}
      />
      <NumberField
        label={t('fork.memory.settings.pollLabel', 'Check every')}
        description={t(
          'fork.memory.settings.pollHelp',
          'How often the background check reads system memory. The resource popover samples on its own while open.'
        )}
        value={resolved.pollSeconds}
        defaultValue={FORK_MEMORY_SETTING_DEFAULTS.pollSeconds}
        min={FORK_MEMORY_POLL_SECONDS_MIN}
        max={FORK_MEMORY_POLL_SECONDS_MAX}
        integer
        suffix={t('fork.memory.settings.seconds', 'seconds')}
        onChange={(value) => updateSettings({ forkMemoryPollSeconds: value })}
      />
    </section>
  )
}
