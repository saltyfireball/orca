// PR nudges (BAD-680): the Settings search entry of its card. The title matches ForkPrNudgeSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function prNudgeSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.prNudge.settings.title', 'PR nudges'),
    description: t(
      'fork.settingsPane.search.prNudge',
      'Tell a pull request chat about new review comments and merge conflicts.'
    ),
    keywords: [
      'pull request',
      'review',
      'comment',
      'conflict',
      'rebase',
      'nudge',
      'forkPrNudgeEnabled',
      'forkPrNudgeCommenters'
    ]
  }
}
