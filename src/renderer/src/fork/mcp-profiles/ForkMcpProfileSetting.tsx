// FORK.md "MCP profiles": Settings > Advanced > MCP profiles. Named profiles, the
// profile each kind of launch starts with, and per-project overrides. Everything is "all" until
// set, so chats load every server as stock does.
import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_MCP_PROFILE_ALL,
  FORK_MCP_PROFILE_NONE,
  forkMcpProfileConfigOf,
  type ForkMcpLaunchKind,
  type ForkMcpListing,
  type ForkMcpProfile,
  type ForkMcpProjectProfile
} from '../../../../shared/fork/mcp-profiles'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { ForkMcpProfileEditor } from './ForkMcpProfileEditor'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const KIND_KEYS: Record<ForkMcpLaunchKind, keyof GlobalSettings> = {
  interactive: 'forkMcpDefaultInteractive',
  worker: 'forkMcpDefaultWorker',
  background: 'forkMcpDefaultBackground'
}

function kindLabel(t: Translate, kind: ForkMcpLaunchKind): string {
  switch (kind) {
    case 'interactive':
      return t('fork.mcpProfiles.setting.interactive', 'Chats you start')
    case 'worker':
      return t('fork.mcpProfiles.setting.worker', 'Orchestration workers')
    case 'background':
      return t('fork.mcpProfiles.setting.background', 'Automation runs')
  }
}

function ProfileSelect(props: {
  value: string
  names: string[]
  label: string
  inherit?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <select
      aria-label={props.label}
      className="h-9 rounded-md border border-border bg-background px-2 text-sm"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.inherit !== undefined ? <option value="">{props.inherit}</option> : null}
      {props.names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

/** Renames carry over to the defaults and project entries that used the old name. */
function renamed(before: ForkMcpProfile[], after: ForkMcpProfile[]): Map<string, string> {
  const map = new Map<string, string>()
  if (before.length === after.length) {
    before.forEach((profile, index) => {
      if (profile.name !== after[index]!.name) {
        map.set(profile.name, after[index]!.name)
      }
    })
  }
  return map
}

export function ForkMcpProfileSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = forkMcpProfileConfigOf(settings)
  const repos = useAppStore((s) => s.repos).filter((repo) => !isFolderRepo(repo))
  const [listing, setListing] = useState<ForkMcpListing | null>(null)
  useEffect(() => {
    void window.api.forkMcpProfiles?.list().then(setListing, () => setListing(null))
  }, [])
  const names = [FORK_MCP_PROFILE_ALL, FORK_MCP_PROFILE_NONE, ...config.profiles.map((p) => p.name)]
  const known = Array.from(new Set((listing?.servers ?? []).map((server) => server.name)))
  const projectOf = (path: string): string =>
    config.projects.find((entry) => entry.path === path)?.profile ?? ''
  const setProjects = (next: ForkMcpProjectProfile[]): void =>
    updateSettings({ forkMcpProjectProfiles: next })
  const updateProfiles = (next: ForkMcpProfile[]): void => {
    const map = renamed(config.profiles, next)
    const rename = (name: string): string => map.get(name) ?? name
    updateSettings({
      forkMcpProfiles: next,
      ...(map.size
        ? {
            forkMcpDefaultInteractive: rename(config.defaults.interactive),
            forkMcpDefaultWorker: rename(config.defaults.worker),
            forkMcpDefaultBackground: rename(config.defaults.background),
            forkMcpProjectProfiles: config.projects.map((entry) => ({
              ...entry,
              profile: rename(entry.profile)
            }))
          }
        : {})
    })
  }
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.mcpProfiles.setting.title', 'MCP profiles')}
        description={t(
          'fork.mcpProfiles.setting.description',
          'Choose which MCP servers a Claude chat loads. "all" loads every server Claude would (the default); "none" loads none. A change applies when a chat next starts. Claude terminals, Codex and other agents are not affected.'
        )}
      />
      <div className="text-xs text-muted-foreground">
        {known.length
          ? t('fork.mcpProfiles.setting.found', 'User servers found: {{servers}}', {
              servers: known.join(', ')
            })
          : t(
              'fork.mcpProfiles.setting.noneFound',
              'No user MCP servers found in Claude config. Project servers are listed by `orca mcp-profile list --folder <path>`.'
            )}
      </div>
      <ForkMcpProfileEditor profiles={config.profiles} known={known} onChange={updateProfiles} />
      {(['interactive', 'worker', 'background'] as const).map((kind) => (
        <SettingsRow
          key={kind}
          label={kindLabel(t, kind)}
          control={
            <ProfileSelect
              value={config.defaults[kind]}
              names={names}
              label={kindLabel(t, kind)}
              onChange={(value) => updateSettings({ [KIND_KEYS[kind]]: value })}
            />
          }
        />
      ))}
      {repos.length ? (
        <SettingsSubsectionHeader
          title={t('fork.mcpProfiles.setting.projects', 'Per project')}
          description={t(
            'fork.mcpProfiles.setting.projectsHelp',
            "A project's profile is used for every launch in it and its worktrees, ahead of the defaults above. A profile chosen on a chat still wins."
          )}
        />
      ) : null}
      {repos.map((repo) => (
        <SettingsRow
          key={repo.id}
          label={repo.displayName}
          control={
            <ProfileSelect
              value={projectOf(repo.path)}
              names={names}
              label={repo.displayName}
              inherit={t('fork.mcpProfiles.setting.inherit', 'Launch default')}
              onChange={(value) =>
                setProjects([
                  ...config.projects.filter((entry) => entry.path !== repo.path),
                  ...(value ? [{ path: repo.path, profile: value }] : [])
                ])
              }
            />
          }
        />
      ))}
    </section>
  )
}
