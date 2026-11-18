// Set up on a server (FORK.md, SLRM-2312) settings card: whether the host picker offers "Set up on
// SERVER...", the folder on the server the project is cloned into, and the readiness check.
import React, { useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  checkForkSetupParent,
  FORK_SERVER_SETUP_DEFAULT_PARENT,
  forkServerSetupOffered,
  forkServerSetupReadinessOn
} from '../../../../shared/fork/server-setup'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '@/components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function ParentInput({
  value,
  labelId,
  onCommit
}: {
  value: string
  labelId: string
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
      aria-labelledby={labelId}
      className="min-w-56"
      placeholder={FORK_SERVER_SETUP_DEFAULT_PARENT}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        // An unusable path goes back to the saved one instead of being stored.
        if (draft.trim() === '') {
          onCommit('')
        } else if (checkForkSetupParent(draft) && draft !== value) {
          onCommit(draft.trim())
        } else {
          setDraft(value)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function ForkServerSetupSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  const offered = forkServerSetupOffered(settings)
  const readiness = forkServerSetupReadinessOn(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.serverSetup.title', 'Set up on a server')}
        description={t(
          'fork.serverSetup.description',
          "When a paired server lacks a project, clone it there from the project's git remote and register it, so new work can start on that server. The server clones with its own git credentials. From the CLI: worktree create --host auto --setup-missing."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.serverSetup.offerLabel', 'Offer "Set up on SERVER..." in the host picker')}
        description={t(
          'fork.serverSetup.offerHelp',
          'Shown for a paired server that is connected and lacks the project, when the project has a git remote.'
        )}
        checked={offered}
        onChange={() => updateSettings({ forkServerSetupOffer: !offered })}
      />
      <SettingsRow
        label={t('fork.serverSetup.parentLabel', 'Clone into')}
        description={t(
          'fork.serverSetup.parentHelp',
          "Folder on the server; the project goes in a folder named after its repository. ~ is the server's home. Leave empty for ~/development."
        )}
        labelId={labelId}
        control={
          <ParentInput
            value={settings.forkServerSetupParent ?? ''}
            labelId={labelId}
            onCommit={(text) => updateSettings({ forkServerSetupParent: text || undefined })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.serverSetup.readinessLabel', 'Check what the project needs')}
        description={t(
          'fork.serverSetup.readinessHelp',
          'After the clone, list the tools the project needs (from package.json and similar files) and the direnv functions its .envrc uses that the server lacks.'
        )}
        checked={readiness}
        onChange={() => updateSettings({ forkServerSetupReadiness: !readiness })}
      />
    </section>
  )
}
