// SLRM-2097: load a whole app theme by pasting or importing it. Nothing changes until a saved
// theme is used; Reset puts the stock colors and the earlier terminal theme back.
import type React from 'react'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useSettingsDarkTheme } from '@/hooks/use-document-dark-theme'
import { useTranslate } from '@/i18n/use-translate'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SettingsSubsectionHeader } from '../../components/settings/form-controls/SettingsFormControls'
import { SearchableSetting } from '../../components/settings/section-layout/SearchableSetting'
import {
  MAX_CUSTOM_APP_THEME_TEXT,
  normalizeCustomAppThemes
} from '../../../../shared/fork/custom-app-theme/custom-app-theme-format'
import { importCustomAppTheme } from '../../../../shared/fork/custom-app-theme/custom-app-theme-import'
import {
  resetCustomAppThemeUpdate,
  saveCustomAppThemeUpdate
} from '../../../../shared/fork/custom-app-theme/custom-app-theme-settings'
import { CYBERDREAM_EXAMPLE_TEXT } from '../../../../shared/fork/custom-app-theme/cyberdream-example'
import { customAppThemeIssueText } from './custom-app-theme-issue-text'
import { ForkCustomAppThemeList } from './ForkCustomAppThemeList'
import { ForkCustomAppThemePreview } from './ForkCustomAppThemePreview'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisible?: boolean
}

function baseName(file: string): string {
  return file.replace(/\.[^.]*$/, '').slice(0, 80) || file
}

/** The settings row, found by search like the stock theme rows. */
export function ForkCustomAppThemeSetting({
  forceVisible = false,
  ...props
}: Props): React.JSX.Element {
  const t = useTranslate()
  return (
    <SearchableSetting
      title={t('fork.customAppTheme.title', 'Custom app themes')}
      description={t('fork.customAppTheme.searchDescription', 'Paste or import a whole app theme.')}
      keywords={[
        'theme',
        'custom',
        'import',
        'paste',
        'ghostty',
        'warp',
        'base16',
        'base24',
        'colors'
      ]}
      forceVisible={forceVisible}
    >
      <ForkCustomAppThemeEditor {...props} />
    </SearchableSetting>
  )
}

function ForkCustomAppThemeEditor({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const dark = useSettingsDarkTheme()
  const [text, setText] = useState('')
  const [sourceName, setSourceName] = useState<string | undefined>(undefined)
  const [withTerminal, setWithTerminal] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const deferredText = useDeferredValue(text)
  const result = useMemo(
    () => (deferredText.trim() ? importCustomAppTheme(deferredText, sourceName) : null),
    [deferredText, sourceName]
  )
  const themes = useMemo(
    () => normalizeCustomAppThemes(settings.forkCustomAppThemes),
    [settings.forkCustomAppThemes]
  )
  const anyInUse = Boolean(settings.forkCustomAppThemeDark || settings.forkCustomAppThemeLight)

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    if (file.size > MAX_CUSTOM_APP_THEME_TEXT) {
      toast.error(t('fork.customAppTheme.issue.tooLarge', 'The theme is larger than 64 KB.'))
      return
    }
    setSourceName(baseName(file.name))
    setText(await file.text())
  }

  const save = (): void => {
    if (!result?.ok) {
      return
    }
    const saved = saveCustomAppThemeUpdate(settings, result.theme)
    if (!saved.ok) {
      toast.error(
        t('fork.customAppTheme.full', 'You have 50 saved themes. Delete one to save another.')
      )
      return
    }
    updateSettings(saved.update)
    setText('')
    setSourceName(undefined)
  }

  // Why keyed by code and path: the list is shown as is, and a repeat says nothing new.
  const issues = [
    ...new Map(
      (result ? (result.ok ? result.warnings : result.errors) : []).map((issue) => [
        `${issue.code}:${issue.path ?? ''}`,
        issue
      ])
    )
  ]

  return (
    <section className="space-y-3 py-3">
      <SettingsSubsectionHeader
        title={t('fork.customAppTheme.title', 'Custom app themes')}
        description={t(
          'fork.customAppTheme.description',
          'Paste or import a theme: an Orca theme, a Ghostty or Warp theme, or a base16/base24 scheme. Saving does not change anything; Use does.'
        )}
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!anyInUse}
            onClick={() => updateSettings(resetCustomAppThemeUpdate(settings))}
          >
            {t('fork.customAppTheme.reset', 'Reset to default')}
          </Button>
        }
      />
      <Textarea
        variant="code"
        rows={6}
        value={text}
        maxLength={MAX_CUSTOM_APP_THEME_TEXT}
        spellCheck={false}
        aria-label={t('fork.customAppTheme.pasteLabel', 'Theme to load')}
        placeholder={t('fork.customAppTheme.pastePlaceholder', 'Paste a theme here')}
        onChange={(event) => {
          setText(event.target.value)
          setSourceName(undefined)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
          {t('fork.customAppTheme.import', 'Import file...')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept=".json,.yaml,.yml,.conf,.toml,.txt,text/plain,application/json"
          onChange={(event) => {
            void onFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setText(CYBERDREAM_EXAMPLE_TEXT)
            setSourceName(undefined)
          }}
        >
          {t('fork.customAppTheme.example', 'Load example (cyberdream)')}
        </Button>
        <Button size="sm" disabled={!result?.ok} onClick={save}>
          {t('fork.customAppTheme.save', 'Save theme')}
        </Button>
      </div>
      {issues.length > 0 ? (
        <ul
          role={result?.ok ? undefined : 'alert'}
          className={`space-y-0.5 text-xs ${result?.ok ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          {issues.map(([key, issue]) => (
            <li key={key}>{customAppThemeIssueText(issue, t)}</li>
          ))}
        </ul>
      ) : null}
      {result?.ok ? <ForkCustomAppThemePreview theme={result.theme} /> : null}
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={withTerminal}
          onCheckedChange={(checked) => setWithTerminal(checked === true)}
        />
        {t(
          'fork.customAppTheme.withTerminal',
          "Also use the theme's terminal colors when it has them"
        )}
      </label>
      <ForkCustomAppThemeList
        settings={settings}
        updateSettings={updateSettings}
        themes={themes}
        dark={dark}
        withTerminal={withTerminal}
      />
    </section>
  )
}
