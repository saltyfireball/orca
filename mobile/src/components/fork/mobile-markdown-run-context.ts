import { createContext } from 'react'

/** Asks the session to confirm, then run, this exact one-line command. */
export type RequestMobileMarkdownRun = (command: string) => void

/** Null hides chat Run buttons. Kept free of UI imports so markdown rendering stays light. */
export const MobileMarkdownRunContext = createContext<RequestMobileMarkdownRun | null>(null)
