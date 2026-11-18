// Workspace tags and archive on merge (FORK.md, SLRM-2397) settings: tags on, archive off.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { readForkWorkspaceTagSettings, tagCounts } from '../../../../shared/fork/workspace-tags'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkWorkspaceTagsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const current = readForkWorkspaceTagSettings(settings)
  const inUse = tagCounts(current.tags)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.workspaceTags.settingsTitle', 'Workspace tags')}
        description={t(
          'fork.workspaceTags.settingsDescription',
          'Tags... in the workspace menu sets short words on a workspace. Click a tag on a card to show only those workspaces, again to hide them, again to show everything.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.workspaceTags.enabledLabel', 'Workspace tags')}
        description={
          inUse.length > 0
            ? t('fork.workspaceTags.inUse', 'In use: {{tags}}', {
                tags: inUse.map(({ tag, count }) => `${tag} (${count})`).join(', ')
              })
            : t('fork.workspaceTags.noneYet', 'No workspace has a tag yet.')
        }
        checked={current.enabled}
        onChange={() => updateSettings({ forkWorkspaceTagsEnabled: !current.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.archiveOnMerge.label', 'Archive on merge')}
        description={t(
          'fork.archiveOnMerge.help',
          'Archive a workspace once its pull request merges: its folder is removed and its branch and card are kept, in an Archived row at the bottom of the sidebar with Restore. A workspace with uncommitted or unpushed work, a busy agent, the open one and one snoozed until merge are left alone.'
        )}
        checked={current.archiveOnMerge}
        onChange={() => updateSettings({ forkArchiveOnMerge: !current.archiveOnMerge })}
      />
    </section>
  )
}
