// Feedback address (BAD-895, FORK.md "Feedback and crash reports stay local"): where Send Feedback
// and crash reports are posted. Empty is off.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { forkFeedbackEndpoint } from '../../../../shared/fork/feedback-endpoint'
import { SettingsSubsectionHeader } from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkTextSetting } from '../idle-recovery/ForkTextSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkFeedbackEndpointSetting({
  settings,
  updateSettings
}: Props): React.JSX.Element {
  const t = useTranslate()
  const saved = settings.forkFeedbackEndpointUrl?.trim() ?? ''
  const invalid = saved !== '' && forkFeedbackEndpoint(settings) === null
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.feedbackEndpoint.title', 'Feedback address')}
        description={t(
          'fork.feedbackEndpoint.description',
          'Where Send Feedback and crash reports are posted. Empty: feedback is off, Send Feedback is hidden and crash reports stay on this machine. For a server, run `orca settings set forkFeedbackEndpointUrl <url> --environment <name>`.'
        )}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkFeedbackEndpointUrl"
        label={t('fork.feedbackEndpoint.urlLabel', 'Address to post to')}
        description={
          invalid
            ? t(
                'fork.feedbackEndpoint.invalid',
                'Not an http or https address (or it has a user or password in it): feedback is off.'
              )
            : t('fork.feedbackEndpoint.urlHelp', 'An http or https address. Empty: off.')
        }
        disabled={false}
      />
    </section>
  )
}
