// SLRM-2097: the saved custom app themes, with use, rename, export and delete.
import type React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  exportCustomAppTheme,
  type CustomAppTheme
} from '../../../../shared/fork/custom-app-theme/custom-app-theme-format'
import {
  deleteCustomAppThemeUpdate,
  renameCustomAppThemeUpdate,
  selectCustomAppThemeUpdate
} from '../../../../shared/fork/custom-app-theme/custom-app-theme-settings'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  themes: CustomAppTheme[]
  dark: boolean
  withTerminal: boolean
}

function fileName(theme: CustomAppTheme): string {
  return `${theme.id}.orca-theme.json`
}

function downloadTheme(theme: CustomAppTheme): void {
  const url = URL.createObjectURL(
    new Blob([exportCustomAppTheme(theme)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = fileName(theme)
  link.click()
  // Why later: revoking at once can cancel the download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function copyTheme(theme: CustomAppTheme): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(exportCustomAppTheme(theme))
    toast.success(translate('fork.customAppTheme.copied', 'Theme JSON copied.'))
  } catch {
    toast.error(translate('fork.customAppTheme.copyFailed', 'Could not copy the theme.'))
  }
}

export function ForkCustomAppThemeList({
  settings,
  updateSettings,
  themes,
  dark,
  withTerminal
}: Props): React.JSX.Element {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const commitRename = (): void => {
    if (!renaming) {
      return
    }
    const update = renameCustomAppThemeUpdate(settings, renaming.id, renaming.name)
    if (update) {
      updateSettings(update)
    }
    setRenaming(null)
  }

  if (themes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('fork.customAppTheme.none', 'No saved themes yet.')}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border/40 rounded-md border">
      {themes.map((theme) => {
        const inUse =
          settings.forkCustomAppThemeDark === theme.id ||
          settings.forkCustomAppThemeLight === theme.id
        return (
          <li key={theme.id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              {renaming?.id === theme.id ? (
                <Input
                  autoFocus
                  value={renaming.name}
                  maxLength={80}
                  aria-label={translate('fork.customAppTheme.renameLabel', 'Theme name')}
                  onChange={(event) => setRenaming({ id: theme.id, name: event.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitRename()
                    } else if (event.key === 'Escape') {
                      setRenaming(null)
                    }
                  }}
                />
              ) : (
                <div className="truncate text-sm">{theme.name}</div>
              )}
              <div className="text-xs text-muted-foreground">
                {theme.base === 'dark'
                  ? translate('fork.customAppTheme.baseDark', 'Dark')
                  : translate('fork.customAppTheme.baseLight', 'Light')}
                {theme.terminal
                  ? `, ${translate('fork.customAppTheme.hasTerminal', 'terminal colors')}`
                  : ''}
                {inUse ? `, ${translate('fork.customAppTheme.inUse', 'in use')}` : ''}
              </div>
            </div>
            <Button
              size="xs"
              variant={inUse ? 'secondary' : 'default'}
              disabled={inUse}
              onClick={() => {
                const update = selectCustomAppThemeUpdate(settings, theme.id, dark, withTerminal)
                if (update) {
                  updateSettings(update)
                }
              }}
            >
              {translate('fork.customAppTheme.use', 'Use')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setRenaming({ id: theme.id, name: theme.name })}
            >
              {translate('fork.customAppTheme.rename', 'Rename')}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void copyTheme(theme)}>
              {translate('fork.customAppTheme.copy', 'Copy JSON')}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => downloadTheme(theme)}>
              {translate('fork.customAppTheme.export', 'Export')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => updateSettings(deleteCustomAppThemeUpdate(settings, theme.id))}
            >
              {translate('fork.customAppTheme.delete', 'Delete')}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
