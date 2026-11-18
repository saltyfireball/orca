// Review guides (SLRM-2396): the Settings search entry of the review guide card, kept out of the
// pane catalog so that shared file stays under its line budget. The title matches
// ForkReviewGuideSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function reviewGuideSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.reviewGuide.settings.title', 'Review guides'),
    description: t(
      'fork.settingsPane.search.reviewGuide',
      'An agent-written tour of a pull request in a Guide tab, with look-closely marks.'
    ),
    keywords: words(
      'review',
      'guide',
      'pull request',
      'tour',
      'viewed',
      'forkReviewGuides',
      'forkReviewGuideInstructions'
    )
  }
}
