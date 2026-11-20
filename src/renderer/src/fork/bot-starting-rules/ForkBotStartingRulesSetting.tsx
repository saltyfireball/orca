// Bot starting rules (SLRM-2459, FORK.md): the rules a new bot's SOUL.md starts with, in place of
// the default read-only "## Never" block. Empty keeps the default. Bots already made keep theirs.
import React, { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { FORK_BOT_STARTING_RULES_MAX } from '../../../../shared/fork/bot-starting-rules'
import { READ_ONLY_START } from '../../../../shared/bots/bot-proposal'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const DEFAULT_RULE = `## Never\n\n${READ_ONLY_START}`

export function ForkBotStartingRulesSetting({
  settings,
  updateSettings
}: Props): React.JSX.Element {
  const t = useTranslate()
  const saved = settings.forkBotStartingRules ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const label = t('fork.botStartingRules.settings.rulesLabel', 'Starting rules')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.botStartingRules.settings.title', 'Bot starting rules')}
        description={t(
          'fork.botStartingRules.settings.description',
          "Each new bot's SOUL.md ends with a Never section that keeps it read-only, asking before every change, until you tell it otherwise. Write your own rules here (Markdown, any sections) and new bots start with them instead: from New bot, a bot's suggestion card, a template or the quick task router. Bots already made keep their SOUL.md."
        )}
      />
      <SettingsRow
        label={label}
        description={t(
          'fork.botStartingRules.settings.rulesHelp',
          'Empty keeps the read-only default shown here.'
        )}
        control={
          <Textarea
            aria-label={label}
            className="min-h-32 w-96 font-mono text-xs"
            maxLength={FORK_BOT_STARTING_RULES_MAX}
            placeholder={DEFAULT_RULE}
            value={draft ?? saved}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft !== null && draft.trim() !== saved) {
                updateSettings({ forkBotStartingRules: draft.trim() })
              }
              setDraft(null)
            }}
          />
        }
      />
    </section>
  )
}
