// SLRM-2097: words for what the custom app theme parser reports.
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { CustomAppThemeIssue } from '../../../../shared/fork/custom-app-theme/custom-app-theme-format'

function issueMessage(code: CustomAppThemeIssue['code'], t: Translate = translate): string {
  switch (code) {
    case 'too-large':
      return t('fork.customAppTheme.issue.tooLarge', 'The theme is larger than 64 KB.')
    case 'empty':
      return t('fork.customAppTheme.issue.empty', 'Paste a theme or import a file first.')
    case 'not-json':
      return t('fork.customAppTheme.issue.notJson', 'This looks like JSON but does not parse.')
    case 'not-object':
      return t('fork.customAppTheme.issue.notObject', 'The theme must be a JSON object.')
    case 'unknown-format':
      return t(
        'fork.customAppTheme.issue.unknownFormat',
        'Not a format Orca reads. Use an Orca theme, a Ghostty theme, a Warp theme or a base16/base24 scheme.'
      )
    case 'bad-base':
      return t('fork.customAppTheme.issue.badBase', 'base must be "dark" or "light".')
    case 'missing-base':
      return t(
        'fork.customAppTheme.issue.missingBase',
        'Set base to "dark" or "light", or give a background color so Orca can tell.'
      )
    case 'bad-color':
      return t('fork.customAppTheme.issue.badColor', 'Not a color.')
    case 'bad-terminal-color':
      return t(
        'fork.customAppTheme.issue.badTerminalColor',
        'Terminal colors must be hex, like #1e2124.'
      )
    case 'bad-font':
      return t(
        'fork.customAppTheme.issue.badFont',
        'Font must be one family name of letters, digits, spaces, dots, dashes or underscores.'
      )
    case 'bad-radius':
      return t(
        'fork.customAppTheme.issue.badRadius',
        'Radius must be up to 32px or 2rem; it was left out.'
      )
    case 'no-colors':
      return t('fork.customAppTheme.issue.noColors', 'The theme has no colors.')
    case 'unknown-token':
      return t('fork.customAppTheme.issue.unknownToken', 'Not an Orca color token; it was ignored.')
    case 'unknown-key':
      return t('fork.customAppTheme.issue.unknownKey', 'Unknown key; it was ignored.')
    case 'too-many-tokens':
      return t('fork.customAppTheme.issue.tooManyTokens', 'Too many tokens; the rest were ignored.')
    case 'incomplete-terminal':
      return t(
        'fork.customAppTheme.issue.incompleteTerminal',
        'Terminal colors need a background, a foreground and at least one ANSI color; they were left out.'
      )
  }
}

/** One line for an issue, led by where it is when the parser knows. */
export function customAppThemeIssueText(issue: CustomAppThemeIssue, t?: Translate): string {
  const message = issueMessage(issue.code, t)
  return issue.path ? `${issue.path}: ${message}` : message
}
