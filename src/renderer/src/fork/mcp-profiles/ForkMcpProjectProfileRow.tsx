// FORK.md "MCP profiles": one project's MCP profile, a row of the fork Settings pane's project
// list. Empty means the launch default. Stored by project path in `forkMcpProjectProfiles`.
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import { forkMcpProfileConfigOf } from '../../../../shared/fork/mcp-profiles'
import { SettingsRow } from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkMcpProfileSelect, forkMcpProfileNames } from './ForkMcpProfileSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  repo: Pick<Repo, 'path' | 'displayName'>
}

/** The profile set for a project, or '' when it follows the launch default. */
export function forkMcpProjectProfileOf(settings: GlobalSettings, path: string): string {
  return (
    forkMcpProfileConfigOf(settings).projects.find((entry) => entry.path === path)?.profile ?? ''
  )
}

export function ForkMcpProjectProfileRow({
  settings,
  updateSettings,
  repo
}: Props): React.JSX.Element {
  const t = useTranslate()
  const config = forkMcpProfileConfigOf(settings)
  return (
    <SettingsRow
      label={t('fork.mcpProfiles.setting.projectLabel', 'MCP profile')}
      description={t(
        'fork.mcpProfiles.setting.projectHelp',
        'Used for every launch in this project and its worktrees, ahead of the launch defaults in MCP profiles. A profile chosen on a chat still wins.'
      )}
      control={
        <ForkMcpProfileSelect
          value={forkMcpProjectProfileOf(settings, repo.path)}
          names={forkMcpProfileNames(config)}
          label={t('fork.mcpProfiles.setting.projectAria', 'MCP profile for {{name}}', {
            name: repo.displayName || repo.path
          })}
          inherit={t('fork.mcpProfiles.setting.inherit', 'Launch default')}
          onChange={(value) =>
            updateSettings({
              forkMcpProjectProfiles: [
                ...config.projects.filter((entry) => entry.path !== repo.path),
                ...(value ? [{ path: repo.path, profile: value }] : [])
              ]
            })
          }
        />
      }
    />
  )
}
