// Limit resume (FORK.md, SLRM-2309, BAD-707): the stock account holds, plus the fork's hold on a
// chat whose message box has a draft. `structured-agent-session-usage-limit-continue.ts` makes this
// class in place of the stock one, so both of its readiness checks (the pass that picks the due
// cuts and the check just before the send) see the hold without carrying fork lines.
import { UsageLimitAccountHolds } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-usage-limit-account-hold'
import { forkUsageLimitHeld } from './limit-resume-native'

export class ForkUsageLimitAccountHolds extends UsageLimitAccountHolds {
  /** A draft holds the send only for a while past the reset the cut waits for; it is asked again each pass. */
  override ready(
    id: string,
    cut: Parameters<UsageLimitAccountHolds['ready']>[1],
    now: number,
    notBefore = 0
  ): boolean {
    return (
      !forkUsageLimitHeld(id, now - this.verdict(id, cut, now).resetsAt) &&
      super.ready(id, cut, now, notBefore)
    )
  }
}
