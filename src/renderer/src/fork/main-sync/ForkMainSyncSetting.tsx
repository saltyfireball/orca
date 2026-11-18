// Keep main current (SLRM-2384, FORK.md): the settings card. Each host keeps its own projects'
// default branches current; this card sets this host's. For a server, use
// `orca settings set forkMainSync true --environment <name>`. Main reads the settings before every
// pass, so a change applies at the next one with no restart.
import React, { useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_MAIN_SYNC_MINUTE_CHOICES,
  readForkMainSyncConfig
} from '../../../../shared/fork/main-sync'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Input } from '@/components/ui/input'
import { useTranslate, type Translate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function everyLabel(minutes: number, t: Translate): string {
  return minutes % 60 === 0
    ? t('fork.mainSync.hours', '{{count}} h', { count: minutes / 60 })
    : t('fork.mainSync.minutes', '{{count}} min', { count: minutes })
}

function ProjectListInput({
  value,
  labelId,
  disabled,
  onCommit
}: {
  value: string
  labelId: string
  disabled: boolean
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  return (
    <Input
      value={draft}
      disabled={disabled}
      aria-labelledby={labelId}
      className="min-w-56"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function ForkMainSyncSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const everyId = useId()
  const projectsId = useId()
  const config = readForkMainSyncConfig(settings)
  const minutes = config.intervalMs / 60_000
  const choices = FORK_MAIN_SYNC_MINUTE_CHOICES.includes(minutes)
    ? FORK_MAIN_SYNC_MINUTE_CHOICES
    : [...FORK_MAIN_SYNC_MINUTE_CHOICES, minutes].sort((a, b) => a - b)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.mainSync.title', 'Keep main current')}
        description={t(
          'fork.mainSync.description',
          "Fetch each local project's default branch on a timer and fast-forward it, so new worktrees start from current main. A branch that has diverged, has local changes, has a merge or rebase under way, or is checked out in another worktree is never touched. For a server, run `orca settings set forkMainSync true --environment <name>`; `orca main-sync` shows what it did."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.mainSync.enabledLabel', 'Keep default branches current')}
        description={t(
          'fork.mainSync.enabledHelp',
          'Off by default. Fetches use the credentials git already has.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkMainSync: !config.enabled })}
      />
      <SettingsRow
        label={t('fork.mainSync.everyLabel', 'Check every')}
        labelId={everyId}
        control={
          <Select
            value={String(minutes)}
            disabled={!config.enabled}
            onValueChange={(value) => updateSettings({ forkMainSyncMinutes: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={everyId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {everyLabel(choice, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={t('fork.mainSync.projectsLabel', 'Projects')}
        description={t(
          'fork.mainSync.projectsHelp',
          'Project names, ids or paths, separated by commas. Empty: every local git project.'
        )}
        labelId={projectsId}
        control={
          <ProjectListInput
            value={config.projects.join(', ')}
            labelId={projectsId}
            disabled={!config.enabled}
            onCommit={(text) =>
              updateSettings({
                forkMainSyncProjects: text
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean)
              })
            }
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.mainSync.skipInUseLabel', 'Wait while a checkout is in use')}
        description={t(
          'fork.mainSync.skipInUseHelp',
          'On by default. Leave a default branch alone while its checkout has live terminals or a working agent.'
        )}
        checked={config.skipInUse}
        onChange={() => updateSettings({ forkMainSyncSkipInUse: !config.skipInUse })}
      />
    </section>
  )
}
