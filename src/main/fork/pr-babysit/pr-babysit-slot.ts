// PR babysitter (FORK.md, SLRM-2386): the two hooks upstream's PR watcher calls (its runtime and
// its CI-line delivery). This file imports
// nothing at run time, so the watcher (and its tests) load no fork code through it; the service
// sets the line handler when it is installed, and until then a line is ignored.
import type { PRWatchServiceDeps } from '../../github/pr-watch/pr-watch-types'
import { forkPrNudgeAttach } from '../pr-nudge/pr-nudge-slot'

export type ForkPrBabysitDelivery = {
  prKey: string
  headSha: string
  occurrence: number
  verdict: 'failure' | 'success'
}

type LineHandler = (chatId: string, delivery: ForkPrBabysitDelivery) => void

let chatWorkspace: PRWatchServiceDeps['chatWorkspace'] | null = null
let lineHandler: LineHandler | null = null

/** Hook around the PR watcher's deps in `pr-watch-runtime.ts`: how a chat's checkout is found.
 *  Returns the deps unchanged. */
export function forkPrBabysitAttach<
  T extends Pick<PRWatchServiceDeps, 'chatWorkspace' | 'database'>
>(deps: T): T {
  chatWorkspace = deps.chatWorkspace
  return forkPrNudgeAttach(deps)
}

/** Hook in the CI-line delivery: the line was just appended to the chat. Never throws. */
export function forkPrBabysitLineDelivered(chatId: string, delivery: ForkPrBabysitDelivery): void {
  try {
    lineHandler?.(chatId, {
      prKey: delivery.prKey,
      headSha: delivery.headSha,
      occurrence: delivery.occurrence,
      verdict: delivery.verdict
    })
  } catch (error) {
    console.warn('[fork pr babysit] line handler failed', error)
  }
}

export function setForkPrBabysitLineHandler(handler: LineHandler | null): void {
  lineHandler = handler
}

/** The chat's checkout as the PR watcher resolves it; null before the watcher started. */
export async function forkPrBabysitChatWorkspace(
  chatId: string
): ReturnType<PRWatchServiceDeps['chatWorkspace']> {
  return chatWorkspace ? chatWorkspace(chatId) : null
}
