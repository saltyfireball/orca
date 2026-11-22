// PR nudges (FORK.md, BAD-680): how upstream's PR watcher reaches the nudge service without
// changing its service file (which sits at max-lines). This file loads no fork code at run time.
// - `forkPrNudgeAttach(deps)`, called from `forkPrBabysitAttach` in the watcher's runtime, wraps the
//   watcher's storage to learn which chat owns each watched pull request: the chat of its newest
//   PR action, from the actions saved while the app runs and those read back at startup.
// - The service listens to the stock PR read observer itself and asks `forkPrNudgeOwner` who owns
//   the pull request a read saw.
import { pullRequestKey } from '../../../shared/native-chat/transcript/notices/native-chat-pull-request-event'
import type { PRWatchStorage } from '../../github/pr-watch/pr-watch-storage'
import type { PRChatAction } from '../../github/pr-watch/pr-watch-tables'

/** The watcher's own window: a chat's PR action keeps its pull request watched this long. */
export const PR_NUDGE_OWNER_WINDOW_MS = 14 * 24 * 60 * 60_000
const MAX_OWNERS = 2000

const owners = new Map<string, { chatId: string; at: number }>()

function own(action: PRChatAction): void {
  const prKey = pullRequestKey(action)
  const owner = owners.get(prKey)
  if (!owner || action.observedAt >= owner.at) {
    owners.delete(prKey)
    owners.set(prKey, { chatId: action.chatId, at: action.observedAt })
  }
  if (owners.size > MAX_OWNERS) {
    owners.delete(owners.keys().next().value as string)
  }
}

function learn(operation: { kind: string }, result: unknown): void {
  try {
    if (operation.kind === 'settle') {
      const verified = (operation as { verified?: { action: PRChatAction }[] }).verified ?? []
      verified.forEach(({ action }) => own(action))
    } else if (operation.kind === 'active' && result instanceof Map) {
      for (const action of result.values()) {
        own(action as PRChatAction)
      }
    }
  } catch (error) {
    console.warn('[fork pr nudge] reading chat owners failed', error)
  }
}

/** Returns the deps with their storage watched for PR actions; behaviour is otherwise unchanged. */
export function forkPrNudgeAttach<T extends { database: PRWatchStorage }>(deps: T): T {
  const database = deps.database
  const wrapped: PRWatchStorage = {
    get readOnly() {
      return database.readOnly
    },
    get isClosed() {
      return database.isClosed
    },
    read: (operation) => database.read(operation),
    write: async (operation) => {
      const result = await database.write(operation)
      learn(operation, result)
      return result
    }
  }
  return { ...deps, database: wrapped }
}

/** The chat that owns a watched pull request now, or null (none known, or past the watch window). */
export function forkPrNudgeOwner(prKey: string, now: number): string | null {
  const owner = owners.get(prKey)
  return owner && owner.at + PR_NUDGE_OWNER_WINDOW_MS > now ? owner.chatId : null
}
