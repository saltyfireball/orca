// A text setting for fork commands and addresses: edits freely, commits the trimmed text on blur
// or Enter. Used by idle recovery's notify targets and the server health cards (SLRM-2311).
import React, { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { SettingsRow } from '../../components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export type ForkTextSettingKey =
  | 'forkIdleSweepClassifierCommand'
  | 'forkInboxNotifyCommand'
  | 'forkInboxNotifyWebhookUrl'
  | 'forkServerHeartbeatUrl'
  | 'forkQuickTaskShortcut'
  | 'forkQuickTaskRouterBot'
  | 'forkQuickTaskRouterAgent'
  | 'forkQuickTaskRouterModel'
  | 'forkQuickTaskPlacementCommand'

export function ForkTextSetting({
  settings,
  updateSettings,
  settingKey,
  label,
  description,
  disabled,
  placeholder
}: Props & {
  settingKey: ForkTextSettingKey
  label: string
  description: string
  disabled: boolean
  /** Shown while empty: what an empty value means. */
  placeholder?: string
}): React.JSX.Element {
  const saved = settings[settingKey] ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft !== null && draft.trim() !== saved) {
      updateSettings({ [settingKey]: draft.trim() })
    }
    setDraft(null)
  }
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <Input
          variant="code"
          className="w-56"
          aria-label={label}
          disabled={disabled}
          placeholder={placeholder}
          value={draft ?? saved}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}
