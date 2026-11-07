import { createContext, useCallback, useRef } from 'react'
import type { TerminalQuickCommand } from '../../../../src/shared/terminal/quick-commands/terminal-quick-command-types'

type LaunchQuickCommand = (command: TerminalQuickCommand) => boolean

/** The session's terminal launcher for chat Run buttons; null hides them. */
export const MobileMarkdownRunContext = createContext<LaunchQuickCommand | null>(null)

export function MobileMarkdownRunProvider({
  launch,
  children
}: {
  launch: LaunchQuickCommand
  children: React.ReactNode
}): React.JSX.Element {
  // The session hands a new launcher every render; a stable value keeps streaming code blocks from rerendering.
  const latest = useRef(launch)
  latest.current = launch
  const stable = useCallback<LaunchQuickCommand>((command) => latest.current(command), [])
  return (
    <MobileMarkdownRunContext.Provider value={stable}>{children}</MobileMarkdownRunContext.Provider>
  )
}
