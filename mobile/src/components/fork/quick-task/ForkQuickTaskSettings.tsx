// Quick task (SLRM-2428, FORK.md): Settings > Appearance > Quick task, the switch that hides the
// Feed's Quick task button.
import { useState } from 'react'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { ListRow } from '../../list/ListGroup'
import { MobileSwitch } from '../../controls/MobileSwitch'
import { SettingsNote, SettingsSection } from '../../../settings/settings-screen-frame'
import { saveQuickTaskSettings, useQuickTaskSettings } from './quick-task-settings'

export function ForkQuickTaskSettings(): React.JSX.Element {
  const t = useMobileTranslation()
  const settings = useQuickTaskSettings()
  const [error, setError] = useState(false)
  const label = t('fork.quickTask.settings.showEntry', 'Quick task button')
  return (
    <>
      <SettingsSection
        title={t('fork.quickTask.settings.heading', 'QUICK TASK')}
        footer={t(
          'fork.quickTask.settings.description',
          'A button in the Feed that sends a typed or spoken task to a paired computer, which hands it to the right bot.'
        )}
      >
        <ListRow
          title={label}
          accessory={
            <MobileSwitch
              value={settings.showEntry}
              accessibilityLabel={label}
              testID="fork-quick-task-show-entry"
              onValueChange={(value) => {
                setError(false)
                void saveQuickTaskSettings({ ...settings, showEntry: value }).catch(() =>
                  setError(true)
                )
              }}
            />
          }
        />
      </SettingsSection>
      {error ? (
        <SettingsNote error>
          {t('fork.quickTask.settings.saveFailed', 'Could not save this setting. Try again.')}
        </SettingsNote>
      ) : null}
    </>
  )
}
