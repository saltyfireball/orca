// The search entries of the fork Settings pane's Chats section, one per card in the order the
// pane renders them. Kept apart from `fork-settings-pane-catalog.ts` for its line budget; the same
// rule holds: each title is the text its card renders (the pane test checks it).
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function getForkChatsSearchEntries(t: Translate): SettingsSearchEntry[] {
  return [
    {
      title: t('fork.chatSurvive.title', 'Chat survive (experimental)'),
      description: t(
        'fork.chatSurvive.description',
        'Keep Claude chats running in the background while Orca restarts.'
      ),
      keywords: words('restart', 'background', 'claude', 'forkChatSurvive')
    },
    {
      title: t('fork.unattendedResume.title', 'Unattended resume'),
      description: t(
        'fork.unattendedResume.description',
        'Continue interrupted workers and automation runs after a restart or update.'
      ),
      keywords: words('restart', 'update', 'worker', 'automation', 'tries', 'forkUnattendedResume')
    },
    {
      title: t('fork.chatSleep.title', 'Chat sleep (experimental)'),
      description: t(
        'fork.settingsPane.search.chatSleep',
        'Free the memory of chats you are not using.'
      ),
      keywords: words('idle', 'memory', 'sleep after', 'wake', 'forkChatSleep')
    },
    {
      title: t('fork.sleepers.settings.title', 'Sleepers'),
      description: t(
        'fork.settingsPane.search.sleepers',
        'One list of every chat and terminal agent, and its sidebar button.'
      ),
      keywords: words('asleep', 'list', 'button', 'sidebar', 'forkSleepersButton')
    },
    {
      title: t('fork.chatStall.title', 'Stalled chats'),
      description: t(
        'fork.settingsPane.search.chatStall',
        'Mark a chat whose turn is open but has had no output for a while.'
      ),
      keywords: words('stall', 'stuck', 'interrupt', 'release', 'forkChatStallMinutes')
    },
    {
      title: t('fork.cacheCold.setting.title', 'Cache-cold cue'),
      description: t(
        'fork.settingsPane.search.cacheCold',
        'Say when a chat has sat idle long enough for its prompt cache to expire.'
      ),
      keywords: words('cache', 'prompt cache', 'compact', 'cost', 'forkCacheColdCue')
    },
    {
      title: t('fork.boundaryCompaction.title', 'Boundary compaction (experimental)'),
      description: t(
        'fork.settingsPane.search.boundaryCompaction',
        'Ask an idle chat with a large context to compact between turns.'
      ),
      keywords: words('compact', 'context', 'idle', 'threshold', 'forkBoundaryCompactMode')
    },
    {
      title: t('fork.mcpProfiles.setting.title', 'MCP profiles'),
      description: t(
        'fork.settingsPane.search.mcpProfiles',
        'Choose which MCP servers a Claude chat loads.'
      ),
      keywords: words('mcp', 'servers', 'profile', 'workers', 'automation', 'forkMcpProfiles')
    }
  ]
}
