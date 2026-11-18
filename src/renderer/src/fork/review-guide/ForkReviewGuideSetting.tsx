// Review guides (SLRM-2396, FORK.md): the settings card. Guides are on and written on demand by
// default; automatic guides cost agent usage for every pull request opened, so they start off.
import React, { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_REVIEW_GUIDE_MAX_INSTRUCTIONS,
  readForkReviewGuideSettings
} from '../../../../shared/fork/review-guide'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function InstructionsInput({
  saved,
  label,
  disabled,
  onCommit
}: {
  saved: string
  label: string
  disabled: boolean
  onCommit: (next: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Textarea
      aria-label={label}
      className="min-h-20 w-72 text-xs"
      disabled={disabled}
      maxLength={FORK_REVIEW_GUIDE_MAX_INSTRUCTIONS}
      value={draft ?? saved}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== saved) {
          onCommit(draft.trim())
        }
        setDraft(null)
      }}
    />
  )
}

export function ForkReviewGuideSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const current = readForkReviewGuideSettings(settings)
  const off = !current.enabled
  const instructionsLabel = t('fork.reviewGuide.settings.instructionsLabel', 'Guide instructions')
  const patchLabel = t('fork.reviewGuide.settings.patchLabel', 'Patch budget (KiB)')
  const timeoutLabel = t('fork.reviewGuide.settings.timeoutLabel', 'Time limit (minutes)')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.reviewGuide.settings.title', 'Review guides')}
        description={t(
          'fork.reviewGuide.settings.description',
          'A Guide tab on pull requests: an agent writes a tour of the change, with stops in reading order, "look closely" marks and mechanical changes at the end. The writer is the source control pull request model.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.reviewGuide.settings.enabledLabel', 'Review guides')}
        description={t(
          'fork.reviewGuide.settings.enabledHelp',
          'The Guide tab on pull requests, its phone view and orca review-guide. A guide is written only when you ask for one.'
        )}
        checked={current.enabled}
        onChange={() => updateSettings({ forkReviewGuides: !current.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.reviewGuide.settings.autoLabel', 'Write guides automatically')}
        description={t(
          'fork.reviewGuide.settings.autoHelp',
          'Write a guide when you open the Guide tab of a pull request that has none. Each guide costs agent usage.'
        )}
        checked={current.autoWrite}
        disabled={off}
        onChange={() => updateSettings({ forkReviewGuideAutoWrite: !current.autoWrite })}
      />
      <SettingsRow
        label={instructionsLabel}
        description={t(
          'fork.reviewGuide.settings.instructionsHelp',
          'Your own preferences for the writer, such as what to show first or what to skip. They change emphasis and order, not the guide layout or which files it covers.'
        )}
        control={
          <InstructionsInput
            saved={current.instructions}
            label={instructionsLabel}
            disabled={off}
            onCommit={(next) => updateSettings({ forkReviewGuideInstructions: next })}
          />
        }
      />
      <SettingsRow
        label={patchLabel}
        description={t(
          'fork.reviewGuide.settings.patchHelp',
          'How much patch text the writer reads (16 to 1024). Files past it are listed by name and size. Agents that take the prompt on the command line may need a smaller budget on Linux.'
        )}
        control={
          <ForkNumberInput
            value={current.maxPatchBytes / 1024}
            label={patchLabel}
            min={16}
            max={1024}
            disabled={off}
            onCommit={(next) => updateSettings({ forkReviewGuideMaxPatchKiB: next })}
          />
        }
      />
      <SettingsRow
        label={timeoutLabel}
        description={t(
          'fork.reviewGuide.settings.timeoutHelp',
          'How long a Claude writer may take (1 to 15). Other agents stop at the usual 60 seconds of text tasks.'
        )}
        control={
          <ForkNumberInput
            value={current.timeoutMs / 60_000}
            label={timeoutLabel}
            min={1}
            max={15}
            disabled={off}
            onCommit={(next) => updateSettings({ forkReviewGuideTimeoutMinutes: next })}
          />
        }
      />
    </section>
  )
}
