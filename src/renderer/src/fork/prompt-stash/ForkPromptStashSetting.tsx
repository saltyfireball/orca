// Prompt stash (FORK.md, SLRM-2397) setting: on by default.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkPromptStashSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const on = settings.forkPromptStash !== false
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.promptStash.title', 'Prompt stash')}
        description={t(
          'fork.promptStash.description',
          'Cmd+S (Ctrl+S on Windows and Linux) in a chat message box sets the draft and its attachments aside and empties the box. In an empty box it brings the last one back. The saved prompts menu lists every stashed draft. Up to 20 are kept in this window.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.promptStash.enabledLabel', 'Stash drafts with Cmd+S')}
        checked={on}
        onChange={() => updateSettings({ forkPromptStash: !on })}
      />
    </section>
  )
}
