// Visual fallback (FORK.md, SLRM-2349): its settings card, and the window's hook that points the
// shared visual grammar at this window's settings. On by default. The host that runs a chat reads
// the image under its own copy of these settings; a paired server is set with `orca settings`.
import { useEffect } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_VISUAL_IMAGE_DEFAULT_MAX_MIB,
  FORK_VISUAL_IMAGE_MAX_MAX_MIB,
  FORK_VISUAL_IMAGE_MIN_MAX_MIB,
  readForkVisualFallbackSettings,
  setForkVisualFallbackSettingsReader
} from '../../../../shared/fork/visual-image-fallback'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** Mounted once in ForkRootHosts: chat replies in this window parse under its settings. */
export function ForkVisualFallbackReader(): null {
  useEffect(() => {
    setForkVisualFallbackSettingsReader(() => useAppStore.getState().settings)
  }, [])
  return null
}

const MIB = 1024 * 1024

export function ForkVisualFallbackSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readForkVisualFallbackSettings(settings)
  const sizeLabel = t('fork.visualFallback.maxSize', 'Largest image (MiB)')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.visualFallback.title', 'Inline images in chat')}
        description={t(
          'fork.visualFallback.description',
          'Let a chat visual show an image file, not only an HTML page.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.visualFallback.label', 'Show image files as chat visuals')}
        description={t(
          'fork.visualFallback.help',
          'A visual line may name a PNG, JPEG, GIF or WebP file from the chat scratch folder, and its values may go without quotes. The host checks the file really is one of those images.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkVisualFallback: !config.enabled })}
      />
      <SettingsRow
        label={sizeLabel}
        description={t(
          'fork.visualFallback.maxSizeHelp',
          'Default {{count}}, at most {{max}}. A larger image shows as unavailable.',
          { count: FORK_VISUAL_IMAGE_DEFAULT_MAX_MIB, max: FORK_VISUAL_IMAGE_MAX_MAX_MIB }
        )}
        control={
          <ForkNumberInput
            value={config.imageMaxBytes / MIB}
            label={sizeLabel}
            min={FORK_VISUAL_IMAGE_MIN_MAX_MIB}
            max={FORK_VISUAL_IMAGE_MAX_MAX_MIB}
            disabled={!config.enabled}
            onCommit={(next) => updateSettings({ forkVisualImageMaxMiB: next })}
          />
        }
      />
    </section>
  )
}
