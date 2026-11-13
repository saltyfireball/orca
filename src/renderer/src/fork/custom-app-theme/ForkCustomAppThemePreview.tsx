// SLRM-2097: a small mock of the app chrome in a theme's colors, so a theme can be judged before
// it is used. Every value here passed the color check; a token the theme leaves out shows the
// color the app has now.
import type React from 'react'
import { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import {
  resolveCustomAppThemeTokens,
  type CustomAppThemeDraft
} from '../../../../shared/fork/custom-app-theme/custom-app-theme-format'
import { TERMINAL_ANSI_COLOR_KEYS } from '../../../../shared/terminal-themes/terminal-custom-themes'

type Props = {
  theme: CustomAppThemeDraft
}

export function ForkCustomAppThemePreview({ theme }: Props): React.JSX.Element {
  const tokens = useMemo(() => resolveCustomAppThemeTokens(theme), [theme])
  const c = (name: string): string => tokens[`--${name}`] ?? `var(--${name})`
  const terminal = theme.terminal
  return (
    <div
      aria-label={translate('fork.customAppTheme.preview.label', 'Theme preview')}
      className="overflow-hidden border text-xs"
      style={{
        borderColor: c('border'),
        background: c('background'),
        color: c('foreground'),
        borderRadius: theme.radius ?? 'var(--radius)'
      }}
    >
      <div className="flex">
        <div
          className="w-28 shrink-0 space-y-1 p-2"
          style={{ background: c('sidebar'), color: c('sidebar-foreground') }}
        >
          <div className="font-semibold">
            {translate('fork.customAppTheme.preview.sidebar', 'Workspaces')}
          </div>
          <div className="px-1" style={{ background: c('accent'), color: c('accent-foreground') }}>
            {translate('fork.customAppTheme.preview.selected', 'Selected')}
          </div>
          <div style={{ color: c('muted-foreground') }}>
            {translate('fork.customAppTheme.preview.other', 'Another one')}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex" style={{ background: c('tab-bar') }}>
            <div
              className="border-b-2 px-2 py-1"
              style={{
                background: c('tab-active'),
                color: c('tab-active-foreground'),
                borderColor: c('tab-active-indicator')
              }}
            >
              {translate('fork.customAppTheme.preview.activeTab', 'Active tab')}
            </div>
            <div
              className="px-2 py-1"
              style={{ background: c('tab-inactive'), color: c('tab-inactive-foreground') }}
            >
              {translate('fork.customAppTheme.preview.tab', 'Tab')}
            </div>
          </div>
          <div className="space-y-2 p-2">
            <div
              className="ml-auto w-fit px-2 py-1"
              style={{ background: c('chat-user-message'), borderRadius: 'inherit' }}
            >
              {translate('fork.customAppTheme.preview.message', 'A chat message with')}{' '}
              <code
                className="px-1"
                style={{
                  background: c('chat-inline-code'),
                  color: c('chat-inline-code-foreground')
                }}
              >
                code
              </code>
            </div>
            <div style={{ color: c('muted-foreground') }}>
              {translate('fork.customAppTheme.preview.muted', 'Quiet text and a')}{' '}
              <span className="underline" style={{ color: c('text-link') }}>
                {translate('fork.customAppTheme.preview.link', 'link')}
              </span>
            </div>
            <div className="font-mono">
              <div style={{ color: c('diff-added') }}>+ added line</div>
              <div style={{ color: c('diff-removed') }}>- removed line</div>
            </div>
            <span
              className="inline-block px-2 py-0.5"
              style={{
                background: c('primary'),
                color: c('primary-foreground'),
                borderRadius: 'inherit'
              }}
            >
              {translate('fork.customAppTheme.preview.button', 'Button')}
            </span>
          </div>
        </div>
      </div>
      {terminal ? (
        <div
          className="flex flex-wrap items-center gap-1 px-2 py-1.5 font-mono"
          style={{ background: terminal.background, color: terminal.foreground }}
        >
          <span>$</span>
          {TERMINAL_ANSI_COLOR_KEYS.map((key) =>
            terminal[key] ? (
              <span
                key={key}
                title={key}
                className="inline-block size-3"
                style={{ background: terminal[key] }}
              />
            ) : null
          )}
        </div>
      ) : null}
    </div>
  )
}
