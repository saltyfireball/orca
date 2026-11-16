// SLRM-2270 (FORK.md): the APFS clone settings card. Main reads both settings on every worktree
// create, so a change applies to the next new worktree with no restart. macOS only.
import React, { useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  forkApfsCloneCheckoutEnabled,
  forkApfsCloneFolders,
  parseForkApfsCloneFolderText
} from '../../../../shared/fork/apfs-clone'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function FolderListInput({
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

export function ForkApfsCloneSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  const checkout = forkApfsCloneCheckoutEnabled(settings)
  const folders = forkApfsCloneFolders(settings).join(', ')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.apfsClone.title', 'Fast new worktrees (macOS)')}
        description={t(
          'fork.apfsClone.description',
          'On an APFS volume, new worktrees are made with copy-on-write clones, which take almost no time or disk space. Anything else (another volume, another system) creates worktrees as before.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.apfsClone.checkoutLabel', 'Clone the checkout')}
        description={t(
          'fork.apfsClone.checkoutHelp',
          'Off by default. Keep one cached checkout of each project inside its .git folder and clone it into new worktrees instead of writing every file: the worktree appears much sooner and shares disk with the cache, but the first git status takes longer while Git refreshes its index. Projects with a post-checkout hook, a sparse checkout or a Git filter (Git LFS installed counts) check out as before.'
        )}
        checked={checkout}
        onChange={() => updateSettings({ forkApfsCloneCheckout: !checkout })}
      />
      <SettingsRow
        label={t('fork.apfsClone.foldersLabel', 'Clone ignored folders')}
        description={t(
          'fork.apfsClone.foldersHelp',
          "Git-ignored folders, relative to the project, cloned from the project's own checkout into each new worktree before its setup script runs, separated by commas. A folder whose relative links lead outside it (pnpm's node_modules) is cloned only when the worktree sits at the same depth. Leave empty to clone none."
        )}
        labelId={labelId}
        control={
          <FolderListInput
            value={folders}
            labelId={labelId}
            onCommit={(text) =>
              updateSettings({ forkApfsCloneFolders: parseForkApfsCloneFolderText(text) })
            }
          />
        }
      />
    </section>
  )
}
