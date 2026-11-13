// SLRM-2096 (FORK.md "Lost work"): Settings > Advanced > Lost work. Which checks the scan runs, a
// default branch per project, where saved bundles and patches go, and two scan limits. The scan
// itself only runs from the Lost work dialog.
import React, { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { isFolderRepo } from '../../../../shared/repo-kind'
import {
  isSafeRefName,
  resolveLostWorkSettings,
  type LostWorkCheck,
  type LostWorkSettings
} from '../../../../shared/fork/lost-work'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function checkLabel(
  check: LostWorkCheck,
  t: Translate = translate
): { label: string; help: string } {
  switch (check) {
    case 'unmergedWorktrees':
      return {
        label: t('fork.lostWork.check.unmerged', 'Worktrees with unmerged commits'),
        help: t(
          'fork.lostWork.check.unmergedHelp',
          'Commits that are not on the default branch, by commit, patch or squash merge.'
        )
      }
    case 'finishedWorktrees':
      return {
        label: t('fork.lostWork.check.finished', 'Finished worktrees'),
        help: t(
          'fork.lostWork.check.finishedHelp',
          'Merged, or with a merged or closed pull request, but still on disk.'
        )
      }
    case 'untrackedWorktrees':
      return {
        label: t('fork.lostWork.check.untracked', 'Worktrees Orca does not track'),
        help: t(
          'fork.lostWork.check.untrackedHelp',
          'Worktrees git knows about that are not Orca workspaces.'
        )
      }
    case 'missingFolders':
      return {
        label: t('fork.lostWork.check.missing', 'Missing folders'),
        help: t('fork.lostWork.check.missingHelp', 'Worktrees and workspaces whose folder is gone.')
      }
    case 'unmergedBranches':
      return {
        label: t('fork.lostWork.check.branches', 'Branches without a worktree'),
        help: t(
          'fork.lostWork.check.branchesHelp',
          'Local branches with unmerged commits that no worktree has checked out.'
        )
      }
    case 'stashes':
      return {
        label: t('fork.lostWork.check.stashes', 'Stashes'),
        help: t('fork.lostWork.check.stashesHelp', 'Every stash in each project.')
      }
    case 'pullRequests':
      return {
        label: t('fork.lostWork.check.pullRequests', 'Pull request state'),
        help: t(
          'fork.lostWork.check.pullRequestsHelp',
          'Read pull requests with the GitHub CLI when it is installed and signed in.'
        )
      }
  }
}

const CHECK_ORDER: LostWorkCheck[] = [
  'unmergedWorktrees',
  'finishedWorktrees',
  'untrackedWorktrees',
  'missingFolders',
  'unmergedBranches',
  'stashes',
  'pullRequests'
]

/** A text field that saves when it loses focus or Enter is pressed. */
function CommitInput({
  value,
  placeholder,
  ariaLabel,
  className,
  onCommit
}: {
  value: string
  placeholder?: string
  ariaLabel: string
  className?: string
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
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
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

export function ForkLostWorkSettings({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const stored: LostWorkSettings = settings.forkLostWork ?? {}
  const resolved = resolveLostWorkSettings(stored)
  const repos = useAppStore((s) => s.repos).filter((repo) => !isFolderRepo(repo))
  const save = (next: LostWorkSettings) => updateSettings({ forkLostWork: { ...stored, ...next } })
  const saveNumber = (key: 'squashLookback' | 'pullRequestLimit', text: string) => {
    const value = Number(text.trim())
    save({ [key]: text.trim() === '' || !Number.isInteger(value) ? undefined : value })
  }
  const saveBranch = (repoId: string, text: string) => {
    const branches = { ...stored.defaultBranches }
    const branch = text.trim()
    if (branch && isSafeRefName(branch)) {
      branches[repoId] = branch
    } else {
      delete branches[repoId]
    }
    save({ defaultBranches: branches })
  }
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.lostWork.settingTitle', 'Lost work')}
        description={t(
          'fork.lostWork.settingDescription',
          'What the Lost work scan looks for. It runs only when you open Lost work from Delete Inactive Workspaces and press Scan.'
        )}
      />
      {CHECK_ORDER.map((check) => {
        const { label, help } = checkLabel(check, t)
        return (
          <SettingsSwitchRow
            key={check}
            label={label}
            description={help}
            checked={resolved.checks[check]}
            onChange={() =>
              save({ checks: { ...stored.checks, [check]: !resolved.checks[check] } })
            }
          />
        )
      })}
      <SettingsRow
        label={t('fork.lostWork.archiveLabel', 'Archive folder')}
        description={t(
          'fork.lostWork.archiveHelp',
          'Where Save bundle and Save patch write. Empty asks each time.'
        )}
        control={
          <div className="flex items-center gap-2">
            <CommitInput
              className="w-64"
              value={resolved.archiveFolder}
              ariaLabel={t('fork.lostWork.archiveLabel', 'Archive folder')}
              onCommit={(value) => save({ archiveFolder: value.trim() })}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const picked = await window.api.shell.pickDirectory(
                  resolved.archiveFolder ? { defaultPath: resolved.archiveFolder } : {}
                )
                if (picked) {
                  save({ archiveFolder: picked })
                }
              }}
            >
              {t('fork.lostWork.archiveChoose', 'Choose...')}
            </Button>
          </div>
        }
      />
      <SettingsRow
        label={t('fork.lostWork.lookbackLabel', 'Squash merge search depth')}
        description={t(
          'fork.lostWork.lookbackHelp',
          'How many recent default-branch commits are compared to find a squash merge. Default 500.'
        )}
        control={
          <CommitInput
            className="w-24"
            value={String(resolved.squashLookback)}
            ariaLabel={t('fork.lostWork.lookbackLabel', 'Squash merge search depth')}
            onCommit={(value) => saveNumber('squashLookback', value)}
          />
        }
      />
      <SettingsRow
        label={t('fork.lostWork.prLimitLabel', 'Pull requests read per project')}
        description={t(
          'fork.lostWork.prLimitHelp',
          'How many recent pull requests are read for each project. Default 200.'
        )}
        control={
          <CommitInput
            className="w-24"
            value={String(resolved.pullRequestLimit)}
            ariaLabel={t('fork.lostWork.prLimitLabel', 'Pull requests read per project')}
            onCommit={(value) => saveNumber('pullRequestLimit', value)}
          />
        }
      />
      {repos.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t(
              'fork.lostWork.branchesHelp',
              "Default branch per project. Empty uses the remote's default, then main, master, trunk or develop."
            )}
          </p>
          {repos.map((repo) => (
            <SettingsRow
              key={repo.id}
              label={repo.displayName || repo.path}
              control={
                <CommitInput
                  className="w-48"
                  value={resolved.defaultBranches[repo.id] ?? ''}
                  placeholder={t('fork.lostWork.branchPlaceholder', 'Automatic')}
                  ariaLabel={t('fork.lostWork.branchLabel', 'Default branch for {{name}}', {
                    name: repo.displayName || repo.path
                  })}
                  onCommit={(value) => saveBranch(repo.id, value)}
                />
              }
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
