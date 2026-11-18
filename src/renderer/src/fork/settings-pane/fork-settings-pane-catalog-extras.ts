// SLRM-2397 (FORK.md "Small extras"): the Settings search entries of the approval triage, prompt
// stash, saved prompts and workspace tags cards. Kept apart from the pane catalog for its line
// budget; each title is the text its card renders (the pane test checks it).
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function forkChatExtrasSearchEntries(t: Translate): SettingsSearchEntry[] {
  return [
    {
      title: t('fork.approvalTriage.title', 'Approval triage'),
      description: t(
        'fork.approvalTriage.searchDescription',
        'Grade tool approvals low, medium or high risk, and allow every low risk worker approval at once.'
      ),
      keywords: words(
        'approval',
        'permission',
        'risk',
        'allow',
        'forkApprovalRisk',
        'forkApprovalBulkAllowLow'
      )
    },
    {
      title: t('fork.promptStash.title', 'Prompt stash'),
      description: t(
        'fork.promptStash.searchDescription',
        'Cmd+S sets a chat draft and its attachments aside, and brings it back.'
      ),
      keywords: words('stash', 'draft', 'save', 'shortcut', 'forkPromptStash')
    },
    {
      title: t('fork.savedPrompts.title', 'Saved prompts'),
      description: t(
        'fork.savedPrompts.searchDescription',
        'Prompts you reuse, in a menu on the chat message box.'
      ),
      keywords: words('snippets', 'templates', 'prompts', 'forkSavedPrompts')
    }
  ]
}

export function forkWorkspaceTagsSearchEntry(t: Translate): SettingsSearchEntry {
  return {
    title: t('fork.workspaceTags.settingsTitle', 'Workspace tags'),
    description: t(
      'fork.workspaceTags.searchDescription',
      'Tag workspaces, filter the sidebar by a tag, and archive a workspace once its pull request merges.'
    ),
    keywords: words(
      'tags',
      'labels',
      'filter',
      'archive',
      'merged',
      'forkWorkspaceTagsEnabled',
      'forkArchiveOnMerge'
    )
  }
}
