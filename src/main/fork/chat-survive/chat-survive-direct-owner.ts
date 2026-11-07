// SLRM-1394: the broker's first owner, the process that spawned it, speaking over the broker's
// own stdio. Its input goes to the provider; its end is a close request only while it lives.
import type { Writable } from 'node:stream'
import type { ChatSurviveDirectOwner } from './chat-survive-broker-types'

/** How often the broker checks that the process that spawned it is still there. */
const DIRECT_OWNER_POLL_MS = 100
/**
 * A dying app closes its pipes a moment before its children are reparented, so an input end is
 * a close request only if the owner is still there after this long.
 */
export const CHAT_SURVIVE_INPUT_END_CONFIRM_MS = 250
const INPUT_END_CONFIRM_POLL_MS = 25

export type DirectOwnerHooks = {
  /** The provider's stdin. */
  stdin: Writable
  /** False once this owner has been dropped. */
  current: () => boolean
  providerExited: () => boolean
  /** Drops the owner; the provider carries on. */
  lose: () => void
}

/** Wires the owner's input to the provider and returns the poll that watches for its death. */
export function wireDirectOwner(
  attached: ChatSurviveDirectOwner,
  hooks: DirectOwnerHooks
): NodeJS.Timeout {
  for (const stream of [attached.input, attached.output, attached.errOutput]) {
    stream.on('error', () => {})
  }
  attached.input.on('data', (chunk: Buffer) => {
    if (hooks.current() && !hooks.providerExited() && !hooks.stdin.write(chunk)) {
      attached.input.pause()
      hooks.stdin.once('drain', () => attached.input.resume())
    }
  })
  attached.input.once('end', () => {
    // An end from a live owner asks the provider to close; from a dying one it is just the death.
    let waited = 0
    const confirm = setInterval(() => {
      waited += INPUT_END_CONFIRM_POLL_MS
      if (!hooks.current() || attached.gone()) {
        clearInterval(confirm)
        hooks.lose()
      } else if (waited >= CHAT_SURVIVE_INPUT_END_CONFIRM_MS) {
        clearInterval(confirm)
        hooks.stdin.end()
      }
    }, INPUT_END_CONFIRM_POLL_MS)
  })
  const poll = setInterval(() => {
    if (attached.gone()) {
      hooks.lose()
    }
  }, DIRECT_OWNER_POLL_MS)
  poll.unref?.()
  return poll
}

/** Stops reading from a lost owner; its pipes are dead or about to be. */
export function unwireDirectOwner(lost: ChatSurviveDirectOwner): void {
  lost.input.removeAllListeners('data')
  lost.input.pause()
  for (const stream of [lost.output, lost.errOutput]) {
    stream.removeAllListeners('drain')
  }
}
