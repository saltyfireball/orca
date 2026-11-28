// The fork Settings pane's section types, apart from fork-settings-pane-catalog.ts (which
// re-exports them) to keep that file within its line budget.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'

export type ForkSettingsSectionId =
  | 'chats'
  | 'agents'
  | 'idle-recovery'
  | 'usage'
  | 'projects'
  | 'remote'
  | 'sync'
  | 'about'

export type ForkSettingsSection = {
  id: ForkSettingsSectionId
  /** DOM id of the section, the target of the pane's own section links. */
  anchorId: string
  title: string
  description: string
  /** One entry per card in the section, in the order the pane renders them. */
  entries: SettingsSearchEntry[]
}
