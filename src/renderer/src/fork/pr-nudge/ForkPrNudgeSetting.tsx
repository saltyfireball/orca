// PR nudges (FORK.md, BAD-680) settings: off by default.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  readPrNudgeSettings,
  type ForkPrNudgeCommenters,
  type ForkPrNudgeConflictUpdate
} from '../../../../shared/fork/pr-nudge'
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
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkPrNudgeSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const commentersId = useId()
  const updateId = useId()
  const current = readPrNudgeSettings(settings)
  const attemptsLabel = t('fork.prNudge.settings.attemptsLabel', 'Attempts before it asks you')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.prNudge.settings.title', 'PR nudges')}
        description={t(
          'fork.prNudge.settings.description',
          'Tell the chat that opened or pushed to a pull request when someone comments on it or it starts to conflict with its base branch. Each comment is sent once and each conflicting commit gets one rebase request; comment text goes to the chat marked as untrusted data. When the chat cannot take a message, the pull request joins the Decision inbox.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.prNudge.settings.enabledLabel', 'Send PR nudges')}
        description={t(
          'fork.prNudge.settings.enabledHelp',
          'Uses the pull request watcher that already follows these pull requests for 14 days, so it adds one GitHub comment read about once a minute per watched pull request.'
        )}
        checked={current.enabled}
        onChange={() => updateSettings({ forkPrNudgeEnabled: !current.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.prNudge.settings.reviewsLabel', 'New review comments')}
        description={t(
          'fork.prNudge.settings.reviewsHelp',
          'Comments on diff lines, conversation comments and review summaries, other than the pull request author’s own. Comments already there when nudging first sees a pull request are not sent.'
        )}
        checked={current.reviews}
        onChange={() => updateSettings({ forkPrNudgeReviews: !current.reviews })}
      />
      <SettingsSwitchRow
        label={t('fork.prNudge.settings.conflictsLabel', 'Merge conflicts')}
        description={t(
          'fork.prNudge.settings.conflictsHelp',
          'When GitHub reports the pull request conflicts, ask the chat to rebase, once per commit.'
        )}
        checked={current.conflicts}
        onChange={() => updateSettings({ forkPrNudgeConflicts: !current.conflicts })}
      />
      <SettingsRow
        label={t('fork.prNudge.settings.commentersLabel', 'Whose comments count')}
        labelId={commentersId}
        description={t(
          'fork.prNudge.settings.commentersHelp',
          'Anyone can comment on a public repository, so the default is the owner, members and collaborators.'
        )}
        control={
          <Select
            value={current.commenters}
            onValueChange={(value) =>
              updateSettings({
                forkPrNudgeCommenters: (value === 'anyone'
                  ? 'anyone'
                  : 'collaborators') as ForkPrNudgeCommenters
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-40" aria-labelledby={commentersId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="collaborators">
                {t('fork.prNudge.settings.collaborators', 'Collaborators only')}
              </SelectItem>
              <SelectItem value="anyone">{t('fork.prNudge.settings.anyone', 'Anyone')}</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={t('fork.prNudge.settings.updateLabel', 'Conflict fix')}
        labelId={updateId}
        description={t(
          'fork.prNudge.settings.updateHelp',
          'How the chat is asked to bring a conflicting branch up to date. Merging the base branch in never needs a force push; rebasing does.'
        )}
        control={
          <Select
            value={current.conflictUpdate}
            onValueChange={(value) =>
              updateSettings({
                forkPrNudgeConflictUpdate: (value === 'rebase'
                  ? 'rebase'
                  : 'merge') as ForkPrNudgeConflictUpdate
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-40" aria-labelledby={updateId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="merge">
                {t('fork.prNudge.settings.updateMerge', 'Merge the base in')}
              </SelectItem>
              <SelectItem value="rebase">
                {t('fork.prNudge.settings.updateRebase', 'Rebase')}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={attemptsLabel}
        description={t(
          'fork.prNudge.settings.attemptsHelp',
          'Failed sends, and rebase requests since the pull request last merged cleanly (1 to 10).'
        )}
        control={
          <ForkNumberInput
            value={current.maxAttempts}
            label={attemptsLabel}
            min={1}
            max={10}
            onCommit={(next) => updateSettings({ forkPrNudgeMaxAttempts: next })}
          />
        }
      />
    </section>
  )
}
