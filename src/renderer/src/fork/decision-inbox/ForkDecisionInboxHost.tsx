// Decision inbox (FORK.md "Idle recovery"), item E2: the always-mounted host of the dialog
// that lists chats waiting on the user, with answer and pause.
// Contract: renders nothing, reads nothing and subscribes to nothing while `forkIdleSweepMode`
// is 'off'; the dialog reads `window.api.forkIdleRecovery` only once it is opened.
import type React from 'react'

export function ForkDecisionInboxHost(): React.JSX.Element | null {
  return null
}
