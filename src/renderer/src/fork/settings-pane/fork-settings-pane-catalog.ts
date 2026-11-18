// The fork's own Settings pane: its id, its sections and what the Settings search knows about
// each one. No pane UI is imported here, because the navigation metadata is shared with the jump
// palette. Each title is the text its card renders, which is how a search result finds its card:
// keep the key and the default text the same as the component's (the pane test checks it).
import { Anchor } from 'lucide-react'
import type { SettingsNavSection } from '@/components/settings/navigation/settings-navigation-types'
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import { getForkChatsSearchEntries } from './fork-settings-pane-catalog-chats'
import { forkAutoPlacementSearchEntry } from '../auto-placement/auto-placement-search-entry'
import { forkBatchStartSearchEntry } from '../batch-start/batch-start-search-entry'
import { bestOfSearchEntry } from '../best-of/best-of-search-entry'
import type { ForkSettingsSection, ForkSettingsSectionId } from './fork-settings-pane-types'
import { getForkRemoteSettingsSectionParts } from '../endpoint-failover/endpoint-failover-search'
import { worktreeMoveSearchEntry } from '../worktree-move/worktree-move-search-entry'
import { apfsCloneSearchEntry } from '../apfs-clone/apfs-clone-search-entry'
import { snoozeSearchEntry } from '../snooze/snooze-search-entry'
import { serverSetupSearchEntry } from '../server-setup/server-setup-search-entry'
import { branchClashesSearchEntry } from '../branch-clashes/branch-clashes-search-entry'
import { reviewGuideSearchEntry } from '../review-guide/review-guide-search-entry'
import { serverUpdateSearchEntry } from '../server-update/server-update-search-entry'
import { prBabysitSearchEntry } from '../pr-babysit/pr-babysit-search-entry'
import { rowStatusSearchEntry } from '../row-status/row-status-search-entry'
import { mainSyncSearchEntry } from '../main-sync/main-sync-search-entry'

export const FORK_SETTINGS_PANE_ID = 'fork'

export type { ForkSettingsSection, ForkSettingsSectionId } from './fork-settings-pane-types'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function getForkSettingsPaneTitle(t: Translate = translate): string {
  return t('fork.settingsPane.title', 'Blackfish')
}

export function getForkSettingsPaneDescription(t: Translate = translate): string {
  return t(
    'fork.settingsPane.description',
    'Settings for what this fork adds to Orca: chats, agents, idle recovery, usage, projects, remote servers and sync.'
  )
}

/** Remote servers, with the Server updates card (SLRM-2310) after the section's own entries. */
function remoteSection(
  section: (
    id: ForkSettingsSectionId,
    title: string,
    description: string,
    entries: SettingsSearchEntry[]
  ) => ForkSettingsSection,
  t: Translate
): ForkSettingsSection {
  const [title, description, entries] = getForkRemoteSettingsSectionParts(t)
  return section('remote', title, description, [...entries, serverUpdateSearchEntry(t)])
}

export function getForkSettingsSections(t: Translate = translate): ForkSettingsSection[] {
  const section = (
    id: ForkSettingsSectionId,
    title: string,
    description: string,
    entries: SettingsSearchEntry[]
  ): ForkSettingsSection => ({
    id,
    anchorId: `${FORK_SETTINGS_PANE_ID}-settings-${id}`,
    title,
    description,
    entries
  })
  return [
    section(
      'chats',
      t('fork.settingsPane.chats.title', 'Chats'),
      t(
        'fork.settingsPane.chats.description',
        'How chats survive a restart, sleep, stall, compact and choose their MCP servers.'
      ),
      getForkChatsSearchEntries(t)
    ),
    section(
      'agents',
      t('fork.settingsPane.agents.title', 'Agents and workers'),
      t(
        'fork.settingsPane.agents.description',
        'How agents show in the sidebar, get cleaned up, wait to launch, start, back off when memory runs short, and which machine takes new work.'
      ),
      [
        {
          title: t('fork.childTally.settingTitle', 'Agent child count'),
          description: t(
            'fork.childTally.settingDescription',
            'Show how many workers, sub-agents and background tasks each sidebar agent is responsible for.'
          ),
          keywords: words('badge', 'children', 'sub-agents', 'tally', 'forkShowChildTally')
        },
        rowStatusSearchEntry(t),
        {
          title: t('fork.agentStateColors.title', 'Agent state colors'),
          description: t(
            'fork.settingsPane.search.agentStateColors',
            'Color a tab and its sidebar agent row by what the agent is doing.'
          ),
          keywords: words('color', 'tint', 'tab', 'working', 'waiting', 'forkAgentStateColors')
        },
        {
          title: t('fork.workerCleanup.title', 'Finished worker cleanup (experimental)'),
          description: t(
            'fork.settingsPane.search.workerCleanup',
            'Stop orchestration workers once their work is done.'
          ),
          keywords: words('orchestration', 'workers', 'done', 'merged', 'forkWorkerCleanup')
        },
        {
          title: t('fork.agentQueue.setting.title', 'Agent limit'),
          description: t(
            'fork.settingsPane.search.agentQueue',
            'Cap how many agents run at once. Launches past the cap wait in a queue.'
          ),
          keywords: words('queue', 'limit', 'cap', 'launch', 'forkAgentQueueEnabled')
        },
        {
          title: t('fork.launchDefaults.title', 'Launch defaults'),
          description: t(
            'fork.settingsPane.search.launchDefaults',
            'The model and effort each kind of launch starts on.'
          ),
          keywords: words('model', 'effort', 'worker', 'forkLaunchDefaults')
        },
        {
          title: t('fork.memory.settings.title', 'Memory'),
          description: t(
            'fork.settingsPane.search.memory',
            'Warn when the system runs short of memory, and pause new agents.'
          ),
          keywords: words('pressure', 'swap', 'pause new agents', 'ram', 'forkMemoryWarnPressure')
        },
        forkAutoPlacementSearchEntry(t),
        forkBatchStartSearchEntry(t)
        {
          title: t('fork.agentGuards.title', 'Agent guards'),
          description: t(
            'fork.settingsPane.search.agentGuards',
            'Warn and pause agents stuck repeating a failing tool call, or past a spend cap.'
          ),
          keywords: words('loop', 'failure', 'spend', 'cap', 'budget', 'forkAgentGuardLoop')
        }
        bestOfSearchEntry(t)
      ]
    ),
    section(
      'idle-recovery',
      t('fork.settingsPane.idleRecovery.title', 'Idle recovery'),
      t(
        'fork.settingsPane.idleRecovery.description',
        'Judge how an idle chat ended its turn, list the ones waiting on you, and babysit pull requests.'
      ),
      [
        {
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
            'forkIdleSweepMode'
          )
        },
        prBabysitSearchEntry(t)
      ]
    ),
    section(
      'usage',
      t('fork.settingsPane.usage.title', 'Usage and accounts'),
      t(
        'fork.settingsPane.usage.description',
        'Which Claude account a chat runs on, and what your chats have used.'
      ),
      [
        {
          title: t('fork.accountChip.settingTitle', 'Claude account chip'),
          description: t(
            'fork.accountChip.settingDescription',
            'Mark tabs, agents and worktrees with the Claude account they run on.'
          ),
          keywords: words('account', 'chip', 'claude', 'forkShowAccountChip')
        },
        {
          title: t('fork.usageReport.setting.title', 'Usage report'),
          description: t(
            'fork.settingsPane.search.usageReport',
            'Tokens and estimated cost of native Claude chats.'
          ),
          keywords: words('tokens', 'cost', 'prices', 'card pattern', 'forkUsagePrices')
        },
        {
          title: t('fork.pooledLimits.settingTitle', 'Pooled usage limits'),
          description: t(
            'fork.pooledLimits.settingDescription',
            'One bar per Claude and Codex limit window across every account on this machine and its paired servers.'
          ),
          keywords: words(
            'limits',
            'usage limits',
            'pooled',
            'servers',
            '5-hour',
            'weekly',
            'forkPooledLimits'
          )
        }
      ]
    ),
    section(
      'projects',
      t('fork.settingsPane.projects.title', 'Projects'),
      t(
        'fork.settingsPane.projects.description',
        'The Lost work scan, moving a workspace to another host, fast new worktrees, setting a project up on a server, and what the fork sets for one project.'
        'The Lost work scan, branch clashes, moving a workspace to another host, fast new worktrees, and what the fork sets for one project.'
        'The Lost work scan, branch clashes, moving a workspace to another host, fast new worktrees, setting a project up on a server, review guides, and what the fork sets for one project.'
      ),
      [
        {
          title: t('fork.lostWork.settingTitle', 'Lost work'),
          description: t(
            'fork.settingsPane.search.lostWork',
            'What the Lost work scan looks for, its archive folder and its limits.'
          ),
          keywords: words('scan', 'worktrees', 'stashes', 'branches', 'archive', 'forkLostWork')
        },
        worktreeMoveSearchEntry(t),
        apfsCloneSearchEntry(t),
        mainSyncSearchEntry(t),
        snoozeSearchEntry(t),
        serverSetupSearchEntry(t),
        branchClashesSearchEntry(t),
        reviewGuideSearchEntry(t),
        {
          title: t('fork.settingsPane.projectList.title', 'Per project'),
          description: t(
            'fork.settingsPane.search.projectList',
            'The MCP profile and the Lost work default branch of each project.'
          ),
          keywords: words(
            'repository',
            'repositories',
            'repo',
            'mcp profile',
            'default branch',
            'forkMcpProjectProfiles'
          )
        }
      ]
    ),
    remoteSection(section, t),
    section(
      'sync',
      t('fork.settingsPane.sync.title', 'Sync and updates'),
      t(
        'fork.settingsPane.sync.description',
        'What the update check says about the fork and its upstream.'
      ),
      [
        {
          title: t('fork.syncStatus.title', 'Fork sync status'),
          description: t(
            'fork.settingsPane.search.syncStatus',
            'Say when the fork is behind upstream or its last sync failed.'
          ),
          keywords: words('upstream', 'behind', 'update', 'notice', 'forkSyncNotice')
        }
      ]
    )
  ]
}

/** Every search entry of the pane: each section's title, then its cards. */
export function getForkSettingsPaneSearchEntries(t: Translate = translate): SettingsSearchEntry[] {
  return getForkSettingsSections(t).flatMap((section) => [
    { title: section.title, description: section.description, keywords: words('fork') },
    ...section.entries
  ])
}

/** The pane's row in the Settings navigation. Desktop only, as its settings are. */
export function buildForkSettingsNavSections(
  { isWebClient }: { isWebClient: boolean },
  t: Translate = translate
): SettingsNavSection[] {
  if (isWebClient) {
    return []
  }
  return [
    {
      id: FORK_SETTINGS_PANE_ID,
      title: getForkSettingsPaneTitle(t),
      description: getForkSettingsPaneDescription(t),
      icon: Anchor,
      searchEntries: getForkSettingsPaneSearchEntries(t),
      // The stock Advanced group, so no group is added to the upstream list.
      group: 'advanced'
    }
  ]
}
