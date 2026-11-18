// Best of N (FORK.md, SLRM-2393) settings: on, claude attempts on auto placement, losers archived,
// 20 runs kept, the built-in attempt note. The note can be set only here: `orca settings` refuses
// to write it, as it becomes part of every attempt's prompt.
import React, { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_BEST_OF_DEFAULT_NOTE,
  FORK_BEST_OF_HISTORY_MAX,
  FORK_BEST_OF_NOTE_MAX,
  readForkBestOfSettings,
  type ForkBestOfLoserAction
} from '../../../../shared/fork/best-of/best-of'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '@/components/settings/form-controls/SettingsFormControls'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'
import { CommandSetting } from '../snooze/ForkSnoozeSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function NoteSetting({
  saved,
  disabled,
  onCommit
}: {
  saved: string
  disabled: boolean
  onCommit: (next: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [draft, setDraft] = useState<string | null>(null)
  const label = t('fork.bestOf.settings.noteLabel', 'Attempt note')
  return (
    <div className="space-y-1">
      <div className="text-sm">{label}</div>
      <p className="text-xs text-muted-foreground">
        {t(
          'fork.bestOf.settings.noteHelp',
          "Added under the task in every attempt's prompt. The words index and count in double curly braces become the attempt number and the number of attempts. The compare view reads the Tests: and Checks: lines it asks for. Empty: the built-in note."
        )}
      </p>
      <Textarea
        aria-label={label}
        rows={5}
        maxLength={FORK_BEST_OF_NOTE_MAX}
        disabled={disabled}
        value={draft ?? saved}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== saved) {
            onCommit(draft.trim() === FORK_BEST_OF_DEFAULT_NOTE ? '' : draft.trim())
          }
          setDraft(null)
        }}
      />
    </div>
  )
}

export function ForkBestOfSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const current = readForkBestOfSettings(settings)
  const off = !current.enabled
  const historyLabel = t('fork.bestOf.settings.historyLabel', 'Runs kept')
  const losersLabel = t('fork.bestOf.settings.losersLabel', 'After a pick, the other attempts')
  const options: { value: ForkBestOfLoserAction; label: string }[] = [
    { value: 'archive', label: t('fork.bestOf.settings.archive', 'Archive') },
    { value: 'remove', label: t('fork.bestOf.settings.remove', 'Remove') },
    { value: 'keep', label: t('fork.bestOf.settings.keep', 'Leave') }
  ]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.bestOf.settings.title', 'Best of N')}
        description={t(
          'fork.bestOf.settings.description',
          'orca best-of <n> --prompt <text> sends one task to 2 to 4 agents, each in its own new worktree. Best of N in the command palette compares their diffs, tests and checks, cost and reports, and keeps the one you pick.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.bestOf.settings.enabledLabel', 'Best of N')}
        description={t(
          'fork.bestOf.settings.enabledHelp',
          'orca best-of and the compare view. Off refuses new runs; runs already started keep running.'
        )}
        checked={current.enabled}
        onChange={() => updateSettings({ forkBestOf: !current.enabled })}
      />
      <CommandSetting
        saved={current.agents}
        label={t('fork.bestOf.settings.agentsLabel', 'Default agents')}
        description={t(
          'fork.bestOf.settings.agentsHelp',
          'Used when orca best-of has no --agents: agent[:model[:effort]], comma separated, cycled over the attempts. Example: claude:opus,codex.'
        )}
        disabled={off}
        onCommit={(next) => updateSettings({ forkBestOfAgents: next })}
      />
      <CommandSetting
        saved={current.placement}
        label={t('fork.bestOf.settings.placementLabel', 'Default machines')}
        description={t(
          'fork.bestOf.settings.placementHelp',
          'Used when orca best-of has no --on: auto (auto placement, needs --repo), here, or paired server names, comma separated and cycled.'
        )}
        disabled={off}
        onCommit={(next) => updateSettings({ forkBestOfPlacement: next })}
      />
      <SettingsRow
        label={losersLabel}
        description={t(
          'fork.bestOf.settings.losersHelp',
          'Archive deletes the checkout and keeps its branch and workspace row; Remove deletes the checkout and keeps the branch; Leave touches nothing. A worktree with uncommitted changes is never forced.'
        )}
        control={
          <SettingsSegmentedControl
            value={current.loserAction}
            options={options}
            ariaLabel={losersLabel}
            size="sm"
            onChange={(next) => updateSettings({ forkBestOfLoserAction: next })}
          />
        }
      />
      <SettingsRow
        label={historyLabel}
        description={t('fork.bestOf.settings.historyHelp', 'Older runs leave the compare view.')}
        control={
          <ForkNumberInput
            value={current.history}
            label={historyLabel}
            min={1}
            max={FORK_BEST_OF_HISTORY_MAX}
            disabled={off}
            onCommit={(next) => updateSettings({ forkBestOfHistory: next })}
          />
        }
      />
      <NoteSetting
        saved={current.attemptNote}
        disabled={off}
        onCommit={(next) => updateSettings({ forkBestOfAttemptNote: next })}
      />
    </section>
  )
}
