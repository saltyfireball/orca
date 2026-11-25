// Chat handoff (FORK.md, SLRM-2391) and limit resume (SLRM-2309): with `forkChatHandoffOnLimit`
// set to 'auto', a native Claude or Codex chat that limit resume parks on a usage limit is handed
// to the other agent at once, and its own resume at the reset is cancelled. Each stop is handed
// off once. 'offer' is the desktop's toast (ForkChatHandoffLimitOffer); 'off' does nothing.
import {
  chatHandoffLimitKey,
  chatHandoffLimitTarget,
  type ChatHandoffAgent,
  type ChatHandoffSettings
} from '../../../shared/fork/chat-handoff'
import type { LimitResumeEntry } from '../../../shared/fork/limit-resume'
import { onForkLimitResumeChanged } from '../limit-resume/limit-resume-service'
import { forkPauseAllHoldsLimitHandoff } from '../pause-all/pause-all-limit-handoff'
import { onForkPauseAllChanged } from '../pause-all/pause-all-state'
import {
  chatHandoffSettingsOf,
  forkChatHandoffService,
  type ChatHandoffRuntime
} from './chat-handoff-host'

/** Stops remembered as answered; older ones are forgotten past this many. */
const MAX_SEEN = 500

export type LimitHandoff = { sessionId: string; to: ChatHandoffAgent; key: string }

/** The parked native chats to hand off now, given the stops already answered. */
export function limitHandoffsDue(
  entries: readonly LimitResumeEntry[],
  seen: ReadonlySet<string>,
  settings: Pick<ChatHandoffSettings, 'enabled' | 'onLimit'>
): LimitHandoff[] {
  if (!settings.enabled || settings.onLimit !== 'auto') {
    return []
  }
  const due: LimitHandoff[] = []
  for (const entry of entries) {
    const to = chatHandoffLimitTarget(entry)
    const key = chatHandoffLimitKey(entry)
    if (to && entry.sessionId && !seen.has(key)) {
      due.push({ sessionId: entry.sessionId, to, key })
    }
  }
  return due
}

let started = false

/** Idempotent; called once the runtime settles, on the desktop and on a headless server. */
export function startForkChatHandoffOnLimit(runtime: ChatHandoffRuntime): void {
  if (started || process.env.VITEST) {
    return
  }
  started = true
  const handler = limitHandoffHandler({
    settings: () => chatHandoffSettingsOf(runtime),
    start: (due) =>
      void forkChatHandoffService(runtime)
        .then((service) => service.start({ sessionId: due.sessionId, to: due.to }))
        .then((result) => {
          if (result.status === 'refused') {
            console.warn(`[fork-chat-handoff] limit handoff refused: ${result.message}`)
          }
        })
        .catch((error: unknown) => {
          console.warn('[fork-chat-handoff] limit handoff failed', error)
        })
  })
  onForkLimitResumeChanged(handler.entriesChanged)
  onForkPauseAllChanged((state) => {
    if (!state.engaged) {
      handler.resumed()
    }
  })
}

/** Hands off each stop once. While Pause all is engaged (or unreadable) a due handoff is held, not
 *  marked answered, so resume-all hands off the stops still parked then (fork BAD-818). */
export function limitHandoffHandler(deps: {
  settings: () => Pick<ChatHandoffSettings, 'enabled' | 'onLimit'>
  start: (due: LimitHandoff) => void
}): { entriesChanged: (entries: readonly LimitResumeEntry[]) => void; resumed: () => void } {
  const seen = new Set<string>()
  let latest: readonly LimitResumeEntry[] = []
  const entriesChanged = (entries: readonly LimitResumeEntry[]) => {
    latest = entries
    const due = limitHandoffsDue(entries, seen, deps.settings())
    if (due.length === 0 || forkPauseAllHoldsLimitHandoff(due.length)) {
      return
    }
    for (const next of due) {
      seen.add(next.key)
      if (seen.size > MAX_SEEN) {
        seen.delete(seen.values().next().value ?? '')
      }
      deps.start(next)
    }
  }
  return { entriesChanged, resumed: () => entriesChanged(latest) }
}
