import { useCallback, useRef, useState } from 'react'
import type { TerminalQuickCommand } from '../../../../src/shared/terminal/quick-commands/terminal-quick-command-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { BottomDrawer } from '../bottom-drawer/BottomDrawer'
import {
  MobileMarkdownRunContext,
  type RequestMobileMarkdownRun
} from './mobile-markdown-run-context'
import { MobileMarkdownRunSheet } from './MobileMarkdownRunSheet'

type LaunchQuickCommand = (command: TerminalQuickCommand) => boolean

type PendingRun = Readonly<{ command: string; launch: LaunchQuickCommand }>

const LABEL_PREVIEW_LENGTH = 40

/** Gives chat Run buttons this session's launcher, behind an in-page confirm. */
export function MobileMarkdownRunProvider({
  launch,
  children
}: {
  launch: LaunchQuickCommand
  children: React.ReactNode
}): React.JSX.Element {
  const t = useMobileTranslation()
  // The session hands a new launcher every render; a stable request keeps streaming code blocks from rerendering.
  const latest = useRef(launch)
  latest.current = launch
  const [pending, setPending] = useState<PendingRun | null>(null)
  // Frozen at press: the drawer shows, and the session runs, exactly this string with this launcher,
  // which is bound to the route's host and workspace.
  const requestRun = useCallback<RequestMobileMarkdownRun>((command) => {
    setPending(Object.freeze({ command, launch: latest.current }))
  }, [])
  // Runs the text the user confirmed (checked by the sheet) with the launcher captured at press.
  const run = (captured: PendingRun, command: string) => {
    setPending(null)
    captured.launch({
      id: 'fork-chat-run',
      label: t('components.markdownBlocks.runCode.tabLabel', 'Chat: {{command}}', {
        command: command.slice(0, LABEL_PREVIEW_LENGTH)
      }),
      action: 'terminal-command',
      command,
      appendEnter: true
    })
  }
  return (
    <MobileMarkdownRunContext.Provider value={requestRun}>
      {children}
      {/* In-page confirm: Alert.alert is a no-op on web, and the iOS session is the web page. */}
      {pending ? (
        <BottomDrawer visible onClose={() => setPending(null)}>
          <MobileMarkdownRunSheet
            original={pending.command}
            onRun={(command) => run(pending, command)}
            onCancel={() => setPending(null)}
          />
        </BottomDrawer>
      ) : null}
    </MobileMarkdownRunContext.Provider>
  )
}
