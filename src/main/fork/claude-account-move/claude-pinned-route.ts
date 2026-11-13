// SLRM-1503: where a chat's account pin sends its launches on this host.
import type { ClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-router'
import type { ClaudeSessionPin } from './claude-session-account-pins'

export type PinnedClaudeRouter = Pick<
  ClaudeProfileRouter,
  'savedAccount' | 'coveredBySystemDefault' | 'accountHome' | 'systemDefaultHome' | 'pointerPath'
> &
  Partial<Pick<ClaudeProfileRouter, 'prepareAccount'>>

export type PinnedClaudeRoute =
  | { kind: 'system' }
  | { kind: 'account'; accountId: string; home: string }

/** Where a pin sends a launch; null when its account was removed, so the chat follows the selection. */
export function pinnedClaudeRoute(
  router: PinnedClaudeRouter,
  pin: ClaudeSessionPin
): PinnedClaudeRoute | null {
  if (pin === null) {
    return { kind: 'system' }
  }
  if (!router.savedAccount(pin)) {
    return null
  }
  // Stock launches of an account without its own login run on System default, signed in to it.
  return router.coveredBySystemDefault(pin)
    ? { kind: 'system' }
    : { kind: 'account', accountId: pin, home: router.accountHome(pin) }
}
