// Feedback address (BAD-895): the Settings search entry of its card, appended to the Remote servers
// section. The title matches ForkFeedbackEndpointSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function feedbackEndpointSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.feedbackEndpoint.title', 'Feedback address'),
    description: t(
      'fork.settingsPane.search.feedbackEndpoint',
      'Where Send Feedback and crash reports are posted; empty keeps them off and local.'
    ),
    keywords: ['feedback', 'crash', 'report', 'telemetry', 'privacy', 'forkFeedbackEndpointUrl']
  }
}
