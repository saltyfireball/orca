// What the update card shows while the restart guard holds an update install until chats are
// idle (FORK.md "Restart guard", SLRM-1569). Main pushes it; the card's buttons answer it.
export type ForkUpdateInstallWait = {
  /** Chats the wait has held for so far (a chat that starts working mid-wait joins). */
  total: number
  /** Chats still busy. */
  remaining: number
}

export const FORK_UPDATE_INSTALL_WAIT_CHANNELS = {
  /** main -> renderer: the wait now, or null when no update install is waiting. */
  changed: 'fork:updateInstallWait:changed',
  /** main -> renderer: the guard dropped the install without running it (Cancel, Stop Waiting). */
  released: 'fork:updateInstallWait:released',
  get: 'fork:updateInstallWait:get',
  now: 'fork:updateInstallWait:now',
  stop: 'fork:updateInstallWait:stop'
} as const

export type ForkUpdateInstallWaitApi = {
  get: () => Promise<ForkUpdateInstallWait | null>
  /** Install now, ending the wait (the waiting dialog's Restart Now). */
  installNow: () => Promise<void>
  /** Stop waiting; the update stays downloaded (the waiting dialog's Stop Waiting). */
  stopWaiting: () => Promise<void>
  onChanged: (callback: (wait: ForkUpdateInstallWait | null) => void) => () => void
  onReleased: (callback: () => void) => () => void
}
