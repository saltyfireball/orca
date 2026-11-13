// SLRM-2098 (FORK.md "Agent launch queue"): how a chat's provider start goes through the gate.
// Generic over the start outcome so it is tested with fake launchers.
//
// Admitted: the start runs now, exactly as without the queue. Queued: the claim's outcome waits
// on the ticket and then claims again through the caller's own ordered lane, which picks up the
// verdict: admitted starts, cancelled runs the start with a refusal so the messages it was
// sent for fail visibly instead of sitting in the chat. Messages sent meanwhile stay queued in
// the chat's journal and go out once the provider runs.
import type { AgentLaunchGate, GateRequest } from './agent-launch-gate'

export type QueueClaimInput<O> = {
  key: string
  /** Built only when the launch has to ask the gate. */
  request: () => GateRequest
  /** Starts the provider; with a refusal, settles the start as refused instead. */
  start: (refusal?: O) => Promise<O>
  /** Claim again in the caller's lane once the ticket is settled. */
  reclaim: () => Promise<O>
  cancelled: () => O
}

/** The one start each settled ticket runs, keyed by the ticket's promise. */
const reclaims = new WeakMap<Promise<unknown>, Promise<unknown>>()

export function claimThroughGate<O>(gate: AgentLaunchGate, input: QueueClaimInput<O>): Promise<O> {
  const { key } = input
  const release = (): void => gate.release(key)
  const verdict = gate.consume(key)
  if (verdict === 'cancelled') {
    return input.start(input.cancelled())
  }
  if (verdict === 'admitted') {
    return settleThen(input.start(), release)
  }
  const decision = gate.request(input.request())
  if (decision.state === 'admitted') {
    return settleThen(input.start(), release)
  }
  // Every claim that joined this ticket shares one start, as upstream joins a start in flight.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a ticket is keyed by one chat, and every claim for that chat comes from the same start funnel with the same O.
  const joined = reclaims.get(decision.settled) as Promise<O> | undefined
  if (joined) {
    return joined
  }
  const outcome = settleThen(
    decision.settled.then(() => input.reclaim()),
    release
  )
  reclaims.set(decision.settled, outcome)
  return outcome
}

function settleThen<O>(outcome: Promise<O>, after: () => void): Promise<O> {
  return outcome.finally(after)
}
