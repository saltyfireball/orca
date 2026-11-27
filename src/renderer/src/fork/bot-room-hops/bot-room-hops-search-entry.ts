// Bot room hop limit (BAD-801): the Settings search entry of its card, apart from the card so the
// pane catalog does not import a component. The title matches ForkBotRoomHopsSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function botRoomHopsSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.botRoomHops.settings.title', 'Bot room hop limit'),
    description: t(
      'fork.settingsPane.search.botRoomHops',
      'Stop bots in a group room from waking each other without end after one post.'
    ),
    keywords: words(
      'bot',
      'group',
      'room',
      'hand-off',
      'loop',
      'hops',
      'turns',
      'cap',
      'fan-out',
      'forkBotRoomHopLimit',
      'forkBotRoomTurnCap'
    )
  }
}

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}
