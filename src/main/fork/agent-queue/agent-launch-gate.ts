// SLRM-2098 (FORK.md "Agent launch queue"): the one gate every agent launch passes. Pure: what
// runs now and the settings come in through deps, so it is tested with fake launchers and clocks.
//
// A launch is admitted when its pool has a free slot, otherwise it waits as a ticket. Tickets
// start user-started (interactive) launches first, then workers, first come first served within
// each. An admitted launch holds a short reservation until its process shows as live, so a burst
// of launches cannot all slip through before the first one is counted.
import type {
  ForkAgentQueueConfig,
  ForkAgentQueueEntry,
  ForkAgentQueueKind
} from '../../../shared/fork/agent-queue'

export type GateVerdict = 'admitted' | 'cancelled'

export type GateRequest = {
  /** One launch target (a chat session id). Asking again for a waiting key joins its ticket. */
  key: string
  kind: ForkAgentQueueKind
  label: string
  /** Waking an existing chat rather than starting a new one. */
  resume?: boolean
  /** The live agent that launched this one and may be waiting on it (deadlock rule). */
  parentKey?: string
  dispatchId?: string
}

export type GateDecision =
  | { state: 'admitted' }
  | {
      state: 'queued'
      entry: ForkAgentQueueEntry
      settled: Promise<GateVerdict>
    }

export type GateHold = { hold: boolean; reason?: string }

export type AgentLaunchGateDeps = {
  readConfig: () => ForkAgentQueueConfig
  /** Every agent whose provider process runs now, by key, with its pool. */
  readLive: () => ReadonlyMap<string, ForkAgentQueueKind>
  shouldHold: () => GateHold
  now: () => number
  /** Runs `run` once after `ms`; returns a cancel. */
  schedule: (run: () => void, ms: number) => () => void
  newId: () => string
  pollMs?: number
  reservationMs?: number
}

type Ticket = GateRequest & {
  id: string
  queuedAt: number
  settled: Promise<GateVerdict>
  resolve: (verdict: GateVerdict) => void
}

const DEFAULT_POLL_MS = 2_000
const DEFAULT_RESERVATION_MS = 120_000

export class AgentLaunchGate {
  private readonly tickets: Ticket[] = []
  private readonly reservations = new Map<string, { kind: ForkAgentQueueKind; at: number }>()
  /** Verdicts the next claim for that key picks up: the queued launch then starts or refuses. */
  private readonly verdicts = new Map<string, { verdict: GateVerdict; at: number }>()
  private readonly listeners = new Set<() => void>()
  private cancelPoll: (() => void) | null = null
  /** The hold in force at the last check, shown on every waiting entry (SLRM-2136). */
  private heldReason: string | undefined

  constructor(private readonly deps: AgentLaunchGateDeps) {}

  request(request: GateRequest): GateDecision {
    const waiting = this.tickets.find((ticket) => ticket.key === request.key)
    if (waiting) {
      return this.queued(waiting)
    }
    const config = this.deps.readConfig()
    if (!config.enabled) {
      return { state: 'admitted' }
    }
    if (request.resume && config.resumeBypass) {
      this.reserve(request.key, request.kind)
      return { state: 'admitted' }
    }
    let resolve!: (verdict: GateVerdict) => void
    const settled = new Promise<GateVerdict>((done) => {
      resolve = done
    })
    const ticket: Ticket = {
      ...request,
      id: this.deps.newId(),
      queuedAt: this.deps.now(),
      settled,
      resolve
    }
    this.tickets.push(ticket)
    this.pump()
    if (!this.tickets.includes(ticket)) {
      // Admitted on the spot: the caller starts it now, so the verdict is not left to pick up.
      this.verdicts.delete(ticket.key)
      return { state: 'admitted' }
    }
    this.emit()
    return this.queued(ticket)
  }

  /** The verdict a waiting launch was given, taken once by the claim that acts on it. */
  consume(key: string): GateVerdict | null {
    const found = this.verdicts.get(key)
    this.verdicts.delete(key)
    return found?.verdict ?? null
  }

  /** The admitted launch is live, failed, or gone: its process now counts for itself. */
  release(key: string): void {
    if (this.reservations.delete(key)) {
      this.pump()
    }
  }

  /** Skip the queue: start this launch now, past the limit. */
  startNow(id: string): boolean {
    const ticket = this.tickets.find((entry) => entry.id === id)
    if (!ticket) {
      return false
    }
    this.settle(ticket, 'admitted')
    this.emit()
    return true
  }

  cancel(id: string): boolean {
    const ticket = this.tickets.find((entry) => entry.id === id)
    if (!ticket) {
      return false
    }
    this.settle(ticket, 'cancelled')
    this.pump()
    this.emit()
    return true
  }

  /** Something may have stopped running: admit what now fits. */
  notify(): void {
    this.pump()
  }

  entries(): ForkAgentQueueEntry[] {
    return this.ordered().map((ticket, index) => this.entryOf(ticket, index + 1))
  }

  liveCounts(): { interactive: number; worker: number } {
    const counts = { interactive: 0, worker: 0 }
    for (const kind of this.live().values()) {
      counts[kind]++
    }
    return counts
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private queued(ticket: Ticket): GateDecision {
    const index = this.ordered().indexOf(ticket)
    return {
      state: 'queued',
      entry: this.entryOf(ticket, index + 1),
      settled: ticket.settled
    }
  }

  private entryOf(ticket: Ticket, position: number): ForkAgentQueueEntry {
    return {
      id: ticket.id,
      sessionId: ticket.key,
      label: ticket.label,
      kind: ticket.kind,
      position,
      queuedAt: ticket.queuedAt,
      ...(ticket.dispatchId ? { dispatchId: ticket.dispatchId } : {}),
      ...(this.heldReason ? { heldReason: this.heldReason } : {})
    }
  }

  /** Interactive launches first, then workers; arrival order within each. */
  private ordered(): Ticket[] {
    return [
      ...this.tickets.filter((ticket) => ticket.kind === 'interactive'),
      ...this.tickets.filter((ticket) => ticket.kind === 'worker')
    ]
  }

  private reserve(key: string, kind: ForkAgentQueueKind): void {
    this.reservations.set(key, { kind, at: this.deps.now() })
  }

  /** Live processes plus admitted launches whose process does not show yet. */
  private live(): Map<string, ForkAgentQueueKind> {
    const live = new Map(this.deps.readLive())
    const expiry = this.deps.reservationMs ?? DEFAULT_RESERVATION_MS
    const now = this.deps.now()
    for (const [key, reservation] of this.reservations) {
      if (now - reservation.at > expiry) {
        this.reservations.delete(key)
      } else if (!live.has(key)) {
        live.set(key, reservation.kind)
      }
    }
    for (const [key, verdict] of this.verdicts) {
      if (now - verdict.at > expiry) {
        this.verdicts.delete(key)
      }
    }
    return live
  }

  private settle(ticket: Ticket, verdict: GateVerdict): void {
    this.tickets.splice(this.tickets.indexOf(ticket), 1)
    if (verdict === 'admitted') {
      this.reserve(ticket.key, ticket.kind)
    }
    this.verdicts.set(ticket.key, { verdict, at: this.deps.now() })
    ticket.resolve(verdict)
  }

  private pump(): void {
    if (this.tickets.length === 0) {
      this.heldReason = undefined
      this.stopPoll()
      return
    }
    const config = this.deps.readConfig()
    let changed = false
    if (!config.enabled) {
      // Switched off with launches waiting: they all start.
      for (const ticket of this.ordered()) {
        this.settle(ticket, 'admitted')
      }
      this.stopPoll()
      this.emit()
      return
    }
    const hold = this.deps.shouldHold()
    // A hold blocks even an empty pool, so every waiting entry says why (no silent wait).
    const reason = hold.hold ? (hold.reason ?? 'held') : undefined
    if (reason !== this.heldReason) {
      this.heldReason = reason
      changed = true
    }
    if (!hold.hold) {
      const live = this.live()
      for (const ticket of this.ordered()) {
        if (this.hasRoom(config, live, ticket.kind) || this.breaksDeadlock(config, live, ticket)) {
          this.settle(ticket, 'admitted')
          live.set(ticket.key, ticket.kind)
          changed = true
        }
      }
    }
    if (changed) {
      this.emit()
    }
    if (this.tickets.length === 0) {
      this.stopPoll()
    } else if (!this.cancelPoll) {
      // Exits and crashes free slots without telling the gate; a slow poll notices them.
      this.cancelPoll = this.deps.schedule(() => {
        this.cancelPoll = null
        this.pump()
      }, this.deps.pollMs ?? DEFAULT_POLL_MS)
    }
  }

  private poolOf(config: ForkAgentQueueConfig, kind: ForkAgentQueueKind): ForkAgentQueueKind[] {
    return config.separate ? [kind] : ['interactive', 'worker']
  }

  private limitOf(config: ForkAgentQueueConfig, kind: ForkAgentQueueKind): number {
    return config.separate && kind === 'worker' ? config.maxWorkers : config.maxLive
  }

  private inPool(
    config: ForkAgentQueueConfig,
    live: ReadonlyMap<string, ForkAgentQueueKind>,
    kind: ForkAgentQueueKind
  ): string[] {
    const pool = this.poolOf(config, kind)
    return [...live].filter(([, liveKind]) => pool.includes(liveKind)).map(([key]) => key)
  }

  private hasRoom(
    config: ForkAgentQueueConfig,
    live: ReadonlyMap<string, ForkAgentQueueKind>,
    kind: ForkAgentQueueKind
  ): boolean {
    return this.inPool(config, live, kind).length < this.limitOf(config, kind)
  }

  /**
   * A full pool where every running agent launched a launch that waits here would never free a
   * slot: each is waiting on its own queued child. Then the oldest such child starts anyway.
   */
  private breaksDeadlock(
    config: ForkAgentQueueConfig,
    live: ReadonlyMap<string, ForkAgentQueueKind>,
    ticket: Ticket
  ): boolean {
    if (!ticket.parentKey || !live.has(ticket.parentKey)) {
      return false
    }
    const waitingParents = new Set(
      this.tickets.flatMap((entry) => (entry.parentKey ? [entry.parentKey] : []))
    )
    const running = this.inPool(config, live, ticket.kind)
    if (!running.every((key) => waitingParents.has(key))) {
      return false
    }
    const oldest = this.ordered().find(
      (entry) =>
        entry.parentKey !== undefined &&
        live.has(entry.parentKey) &&
        this.poolOf(config, entry.kind).includes(ticket.kind)
    )
    return oldest === ticket
  }

  private stopPoll(): void {
    this.cancelPoll?.()
    this.cancelPoll = null
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // A listener failing never blocks a launch.
      }
    }
  }
}
