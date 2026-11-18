// Blackfish (SLRM-2387): Settings > Notifications > Lock Screen. iOS only: Android has neither surface.
import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { BlackfishLiveActivity } from '../../../../modules/fork-live-activity/src/index'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { ListRow } from '../../list/ListGroup'
import { MobileSwitch } from '../../controls/MobileSwitch'
import { SettingsNote, SettingsSection } from '../../../settings/settings-screen-frame'
import {
  DEFAULT_LIVE_ACTIVITY_SETTINGS,
  LIVE_ACTIVITY_KEEP_FINISHED_CHOICES,
  loadLiveActivitySettings,
  saveLiveActivitySettings,
  type LiveActivitySettings
} from './live-activity-settings'

export function ForkLiveActivitySettings(): React.JSX.Element | null {
  const t = useMobileTranslation()
  const [settings, setSettings] = useState<LiveActivitySettings>(DEFAULT_LIVE_ACTIVITY_SETTINGS)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    void loadLiveActivitySettings().then((loaded) => {
      if (alive) {
        setSettings(loaded)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const change = useCallback(
    (patch: Partial<LiveActivitySettings>) => {
      const next = { ...settings, ...patch }
      setSettings(next)
      setError(false)
      void saveLiveActivitySettings(next).catch(() => setError(true))
    },
    [settings]
  )

  if (Platform.OS !== 'ios' || !BlackfishLiveActivity) {
    return null
  }
  const systemOff = settings.liveActivity && !BlackfishLiveActivity.areActivitiesEnabled()
  const liveActivityLabel = t(
    'fork.liveActivity.settings.liveActivity',
    'Running agents on the Lock Screen'
  )
  const widgetLabel = t('fork.liveActivity.settings.widget', 'Agents widget')

  return (
    <>
      <SettingsSection
        title={t('fork.liveActivity.settings.heading', 'LOCK SCREEN')}
        footer={
          systemOff
            ? t(
                'fork.liveActivity.settings.systemOff',
                'Live Activities are turned off for this app in iOS Settings.'
              )
            : t(
                'fork.liveActivity.settings.description',
                'Agents running on every paired server show as a Live Activity on the Lock Screen and in the Dynamic Island, and in the agents widget. It updates while this app is open.'
              )
        }
      >
        <ListRow
          title={liveActivityLabel}
          accessory={
            <MobileSwitch
              value={settings.liveActivity}
              accessibilityLabel={liveActivityLabel}
              testID="fork-live-activity-enabled"
              onValueChange={(value) => change({ liveActivity: value })}
            />
          }
        />
        <ListRow
          title={widgetLabel}
          accessory={
            <MobileSwitch
              value={settings.widget}
              accessibilityLabel={widgetLabel}
              testID="fork-live-activity-widget"
              onValueChange={(value) => change({ widget: value })}
            />
          }
        />
      </SettingsSection>
      <SettingsSection
        radioGroup
        title={t('fork.liveActivity.settings.keepHeading', 'KEEP FINISHED AGENTS')}
      >
        {LIVE_ACTIVITY_KEEP_FINISHED_CHOICES.map((minutes) => (
          <ListRow
            key={minutes}
            title={t('fork.liveActivity.settings.keepMinutes', '{{minutes}} minutes', {
              minutes
            })}
            selected={settings.keepFinishedMinutes === minutes}
            onPress={() => change({ keepFinishedMinutes: minutes })}
          />
        ))}
      </SettingsSection>
      {error ? (
        <SettingsNote error>
          {t('fork.liveActivity.settings.saveFailed', 'Could not save this setting. Try again.')}
        </SettingsNote>
      ) : null}
    </>
  )
}
