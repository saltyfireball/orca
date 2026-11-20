// Bot row badges and colors (FORK.md "Bot row badges and colors") settings. On by default: the
// badges only add counts the row already knows. Colors are set per bot from its context menu.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { forkBotRowBadgesEnabled } from '../../../../shared/fork/bot-row-badges'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Button } from '../../components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkBotRowBadgesSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const enabled = forkBotRowBadgesEnabled(settings)
  const colored = Object.keys(settings.forkBotRowColors ?? {}).length
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.botRowBadges.title', 'Bot row badges and colors')}
        description={t(
          'fork.botRowBadges.description',
          'Show how many items need you and how many are working on each bot row in the sidebar, dim a bot that is idle, and total what needs you on the folded Bots header. Right-click a bot to give its row a color.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.botRowBadges.label', 'Bot status badges')}
        checked={enabled}
        onChange={() => updateSettings({ forkBotRowBadges: !enabled })}
      />
      <SettingsRow
        label={t('fork.botRowBadges.colorsLabel', 'Bot colors')}
        description={t('fork.botRowBadges.colorsHelp', '{{count}} set', { count: colored })}
        control={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={colored === 0}
            onClick={() => updateSettings({ forkBotRowColors: {} })}
          >
            {t('fork.botRowBadges.clearColors', 'Clear all')}
          </Button>
        }
      />
    </section>
  )
}
