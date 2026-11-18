// PR babysitter (FORK.md, SLRM-2386) settings: off until a repo is listed; auto-merge off.
import React, { useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  normalizePrBabysitRepo,
  readPrBabysitSettings,
  type ForkPrBabysitMergeMethod
} from '../../../../shared/fork/pr-babysit'
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
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const METHODS: readonly ForkPrBabysitMergeMethod[] = ['repo', 'squash', 'merge', 'rebase']

function methodLabel(method: ForkPrBabysitMergeMethod, t: Translate): string {
  switch (method) {
    case 'repo':
      return t('fork.prBabysit.settings.methodRepo', 'Repository default')
    case 'squash':
      return t('fork.prBabysit.settings.methodSquash', 'Squash')
    case 'merge':
      return t('fork.prBabysit.settings.methodMerge', 'Merge commit')
    case 'rebase':
      return t('fork.prBabysit.settings.methodRebase', 'Rebase')
  }
}

/** Repos typed with commas, spaces or new lines; what is not a repo name is dropped. */
export function parsePrBabysitReposText(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/u)
        .map(normalizePrBabysitRepo)
        .filter((repo): repo is string => repo !== null)
    )
  ]
}

function ReposInput({
  t,
  saved,
  label,
  onCommit
}: {
  t: Translate
  saved: string[]
  label: string
  onCommit: (next: string[]) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft !== null) {
      const next = parsePrBabysitReposText(draft)
      if (next.join(' ') !== saved.join(' ')) {
        onCommit(next)
      }
    }
    setDraft(null)
  }
  return (
    <Input
      variant="code"
      className="w-56"
      aria-label={label}
      placeholder={t('fork.prBabysit.settings.reposPlaceholder', 'owner/repo, *')}
      value={draft ?? saved.join(', ')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}

export function ForkPrBabysitSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const methodId = useId()
  const current = readPrBabysitSettings(settings)
  const reposLabel = t('fork.prBabysit.settings.reposLabel', 'Repositories')
  const roundsLabel = t('fork.prBabysit.settings.roundsLabel', 'Fix requests before it asks you')
  const waitLabel = t('fork.prBabysit.settings.waitLabel', 'Minutes to wait for CI')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.prBabysit.settings.title', 'PR babysitter')}
        description={t(
          'fork.prBabysit.settings.description',
          'When CI fails on a pull request a chat opened or pushed to, send that chat one fix request with the failing log excerpts, wait for its push, and check again. When it cannot go on, the pull request joins the Decision inbox. orca babysit <pr> babysits one pull request in any repository.'
        )}
      />
      <SettingsRow
        label={reposLabel}
        description={t(
          'fork.prBabysit.settings.reposHelp',
          'owner/repo names whose pull requests are babysat, separated by commas, or * for every repository. Empty: only pull requests named with orca babysit.'
        )}
        control={
          <ReposInput
            t={t}
            saved={current.repos}
            label={reposLabel}
            onCommit={(next) => updateSettings({ forkPrBabysitRepos: next })}
          />
        }
      />
      <SettingsRow
        label={roundsLabel}
        description={t(
          'fork.prBabysit.settings.roundsHelp',
          'Fix requests sent in a row (1 to 10). A green run starts the count over.'
        )}
        control={
          <ForkNumberInput
            value={current.maxRounds}
            label={roundsLabel}
            min={1}
            max={10}
            onCommit={(next) => updateSettings({ forkPrBabysitMaxRounds: next })}
          />
        }
      />
      <SettingsRow
        label={waitLabel}
        description={t(
          'fork.prBabysit.settings.waitHelp',
          'With no new CI result this long after a fix request, it stops and asks you (10 to 1440).'
        )}
        control={
          <ForkNumberInput
            value={current.waitMinutes}
            label={waitLabel}
            min={10}
            max={1440}
            onCommit={(next) => updateSettings({ forkPrBabysitWaitMinutes: next })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.prBabysit.settings.autoMergeLabel', 'Merge when green')}
        description={t(
          'fork.prBabysit.settings.autoMergeHelp',
          'Merge a babysat pull request once every check is green, no change is requested, no review is still required and GitHub reports the merge clean. It uses gh pr merge pinned to the green commit, never admin rights, so branch protection still applies. Without a required review on the base branch, an agent push that goes green is merged unreviewed.'
        )}
        checked={current.autoMerge}
        onChange={() => updateSettings({ forkPrBabysitAutoMerge: !current.autoMerge })}
      />
      <SettingsRow
        label={t('fork.prBabysit.settings.methodLabel', 'Merge method')}
        labelId={methodId}
        description={t(
          'fork.prBabysit.settings.methodHelp',
          'Repository default uses the method the repository sets as its default.'
        )}
        control={
          <Select
            value={current.mergeMethod}
            disabled={!current.autoMerge}
            onValueChange={(value) =>
              updateSettings({
                forkPrBabysitMergeMethod: METHODS.includes(value as ForkPrBabysitMergeMethod)
                  ? (value as ForkPrBabysitMergeMethod)
                  : 'repo'
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={methodId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {methodLabel(choice, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
