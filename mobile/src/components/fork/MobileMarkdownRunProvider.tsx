import { useCallback, useRef, useState } from 'react'
import type { TerminalQuickCommand } from '../../../../src/shared/terminal/quick-commands/terminal-quick-command-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { ConfirmModal } from '../ConfirmModal'
import {
  MobileMarkdownRunContext,
  type RequestMobileMarkdownRun
} from './mobile-markdown-run-context'

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
  const run = (captured: PendingRun) => {
    captured.launch({
      id: 'fork-chat-run',
      label: t('components.markdownBlocks.runCode.tabLabel', 'Chat: {{command}}', {
        command: captured.command.slice(0, LABEL_PREVIEW_LENGTH)
      }),
      action: 'terminal-command',
      command: captured.command,
      appendEnter: true
    })
  }
  return (
    <MobileMarkdownRunContext.Provider value={requestRun}>
      {children}
      {/* In-page confirm: Alert.alert is a no-op on web, and the iOS session is the web page. */}
      {pending ? (
        <ConfirmModal
          visible
          title={t('components.markdownBlocks.runCode.confirmTitle', 'Run in a new terminal?')}
          message={pending.command}
          confirmLabel={t('components.markdownBlocks.runCode.confirm', 'Run')}
          cancelLabel={t('components.markdownBlocks.runCode.cancel', 'Cancel')}
          onConfirm={() => run(pending)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </MobileMarkdownRunContext.Provider>
  )
}
