// SLRM-2265 (FORK.md "Worktree move"): the fork's Settings pane, Projects > Move to host. What a
// workspace move does; the move itself runs from the workspace menu or `orca worktree move`.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import {
  resolveWorktreeMoveSettings,
  type ForkWorktreeMoveSettings,
  type ResolvedWorktreeMoveSettings
} from '../../../../shared/fork/worktree-move/worktree-move-settings'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

type FlagKey = 'menu' | 'push' | 'chats' | 'rewriteHome' | 'markSource'

export function ForkWorktreeMoveSettings({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const stored: ForkWorktreeMoveSettings = settings.forkWorktreeMove ?? {}
  const resolved = resolveWorktreeMoveSettings(stored)
  const save = (patch: Partial<ResolvedWorktreeMoveSettings>) =>
    updateSettings({ forkWorktreeMove: { ...stored, ...patch } })
  const flags: { key: FlagKey; label: string; help: string }[] = [
    {
      key: 'menu',
      label: t('fork.worktreeMove.setting.menu', 'Show Move to Host on the workspace menu'),
      help: t('fork.worktreeMove.setting.menuHelp', 'The CLI command works either way.')
    },
    {
      key: 'push',
      label: t('fork.worktreeMove.setting.push', 'Push the branch first'),
      help: t(
        'fork.worktreeMove.setting.pushHelp',
        'Off: the target checks out what its remote already has.'
      )
    },
    {
      key: 'chats',
      label: t('fork.worktreeMove.setting.chats', 'Carry chats'),
      help: t(
        'fork.worktreeMove.setting.chatsHelp',
        'Copy each Claude and Codex chat transcript and reopen it on the target with its history.'
      )
    },
    {
      key: 'rewriteHome',
      label: t('fork.worktreeMove.setting.rewriteHome', 'Rewrite the home folder in chats'),
      help: t(
        'fork.worktreeMove.setting.rewriteHomeHelp',
        "The workspace path is always rewritten; this also swaps the source's home folder for the target's."
      )
    },
    {
      key: 'markSource',
      label: t('fork.worktreeMove.setting.markSource', 'Mark the source as moved'),
      help: t(
        'fork.worktreeMove.setting.markSourceHelp',
        'Adds a moved note to its comment. The source is never deleted.'
      )
    }
  ]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.worktreeMove.settingTitle', 'Move to host')}
        description={t(
          'fork.worktreeMove.settingDescription',
          'Move a workspace and its chats to another host from the workspace menu or `orca worktree move`. Nothing is committed for you.'
        )}
      />
      <SettingsRow
        label={t('fork.worktreeMove.setting.whenBusy', 'A chat mid-turn')}
        labelId="fork-worktree-move-when-busy"
        control={
          <SettingsSegmentedControl<ResolvedWorktreeMoveSettings['whenBusy']>
            size="sm"
            ariaLabelledBy="fork-worktree-move-when-busy"
            value={resolved.whenBusy}
            onChange={(value) => save({ whenBusy: value })}
            options={[
              { value: 'ask', label: t('fork.worktreeMove.setting.busyAsk', 'Ask to stop it') },
              { value: 'refuse', label: t('fork.worktreeMove.setting.busyRefuse', 'Refuse') }
            ]}
          />
        }
      />
      <SettingsRow
        label={t('fork.worktreeMove.setting.uncommitted', 'Uncommitted changes')}
        labelId="fork-worktree-move-uncommitted"
        control={
          <SettingsSegmentedControl<ResolvedWorktreeMoveSettings['uncommitted']>
            size="sm"
            ariaLabelledBy="fork-worktree-move-uncommitted"
            value={resolved.uncommitted}
            onChange={(value) => save({ uncommitted: value })}
            options={[
              { value: 'patch', label: t('fork.worktreeMove.setting.patch', 'Carry as patch') },
              { value: 'leave', label: t('fork.worktreeMove.setting.leave', 'Leave behind') },
              { value: 'refuse', label: t('fork.worktreeMove.setting.refuse', 'Refuse') }
            ]}
          />
        }
      />
      {flags.map(({ key, label, help }) => (
        <SettingsSwitchRow
          key={key}
          label={label}
          description={help}
          checked={resolved[key]}
          onChange={() => save({ [key]: !resolved[key] })}
        />
      ))}
    </section>
  )
}
