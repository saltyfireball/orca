// Idle recovery and the Decision inbox (FORK.md): the Settings search entry of its card, bot asks
// (SLRM-2453) and the bot row's ask jump (SLRM-2472) included. The title matches
// ForkIdleRecoverySetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function idleRecoverySearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.idleRecovery.title', 'Idle recovery (experimental)'),
    description: t(
      'fork.settingsPane.search.idleRecovery',
      'Judge how an idle chat ended: finished, waiting on you, or stalled.'
    ),
    keywords: words(
      'decision inbox',
      'inbox',
      'classifier',
      'webhook',
      'notification',
      'bot asks',
      'needs you',
      'forkIdleSweepMode',
      'forkInboxBotAsks',
      'bot row',
      'forkBotRowAskJump',
      'forkBotOwnerSteps',
      'bot steps',
      'checklist'
    )
  }
}
