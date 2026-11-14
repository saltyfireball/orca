// FORK.md "Lost work": one project's default branch for the Lost work scan, a row of the fork
// Settings pane's project list. Stored by repo id in `forkLostWork.defaultBranches`.
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  isSafeRefName,
  resolveLostWorkSettings,
  type LostWorkSettings
} from '../../../../shared/fork/lost-work'
import { SettingsRow } from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkLostWorkCommitInput } from './ForkLostWorkSettings'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  repo: Pick<Repo, 'id' | 'path' | 'displayName'>
}

/** The default branch set for a project, or '' when the scan finds it by itself. */
export function forkLostWorkBranchOf(settings: GlobalSettings, repoId: string): string {
  return resolveLostWorkSettings(settings.forkLostWork ?? {}).defaultBranches[repoId] ?? ''
}

export function ForkLostWorkBranchRow({
  settings,
  updateSettings,
  repo
}: Props): React.JSX.Element {
  const t = useTranslate()
  const stored: LostWorkSettings = settings.forkLostWork ?? {}
  const saveBranch = (text: string): void => {
    const branches = { ...stored.defaultBranches }
    const branch = text.trim()
    if (branch && isSafeRefName(branch)) {
      branches[repo.id] = branch
    } else {
      delete branches[repo.id]
    }
    updateSettings({ forkLostWork: { ...stored, defaultBranches: branches } })
  }
  return (
    <SettingsRow
      label={t('fork.lostWork.branchRowLabel', 'Lost work default branch')}
      description={t(
        'fork.lostWork.branchRowHelp',
        "The branch the Lost work scan compares this project against. Empty uses the remote's default, then main, master, trunk or develop."
      )}
      control={
        <ForkLostWorkCommitInput
          className="w-48"
          value={forkLostWorkBranchOf(settings, repo.id)}
          placeholder={t('fork.lostWork.branchPlaceholder', 'Automatic')}
          ariaLabel={t('fork.lostWork.branchLabel', 'Default branch for {{name}}', {
            name: repo.displayName || repo.path
          })}
          onCommit={saveBranch}
        />
      }
    />
  )
}
