// Chat stall (FORK.md): decides, on each idle sweep tick, whether a chat that owes work has
// stalled. The sweep calls `check` for every chat it holds busy (an open turn, an owed send, a
// prompt, child work) with the chat's journal cursor and the pid its lease records, and `check`
// with null for every other chat. A cursor that has not moved for the window marks the chat
// stalled; only then is the process table read. The answer is `hold` (the sweep keeps the chat
// busy, as stock) unless the user asked to release it, or auto release is on, the chat has been
// stalled for twice the window and its provider is stopped or gone.
import type {
  ForkChatStallAction,
  ForkChatStallEntry,
  ForkChatStallLiveness
} from '../../../shared/fork/chat-stall'
import type { ForkProviderTreeVerdict } from './chat-stall-probe'

export type ForkChatStallSettingsRead = () => { stallMs: number | null; autoRelease: boolean }

export type ForkChatStallCheckInput = {
  /** Anything that changes when the chat records provider output (the journal cursor). */
  progress: string
  /** The provider root the chat's lease records; null when it records none. */
  ownerPid: number | null
}

export type ForkChatStallMonitorDeps = {
  now: () => number
  settings: ForkChatStallSettingsRead
  /** Null when the process table cannot be read. */
  probe: (rootPid: number) => Promise<ForkProviderTreeVerdict | null>
  /** Sends SIGCONT; a failure for one pid must not stop the rest. */
  resume: (pid: number) => void
  onChange: (entries: ForkChatStallEntry[]) => void
}

export type ForkChatStallDecision = 'hold' | 'release'

type Tracked = {
  progress: string
  progressAt: number
  checkedAt: number
  ownerPid: number | null
  liveness: ForkChatStallLiveness | null
  releaseRequested: boolean
}

/** A chat the sweep has not asked about for this long left the sweep (closed, host gone). */
const FORGET_AFTER_MS = 20 * 60_000

export class ForkChatStallMonitor {
  private readonly tracked = new Map<string, Tracked>()
  private published = '[]'
  private kick: (() => Promise<void>) | null = null

  constructor(private readonly deps: ForkChatStallMonitorDeps) {}

  /** The sweep's tick, so a Release click does not wait for the next one. */
  attachSweep(tick: () => Promise<void>): void {
    this.kick = tick
  }

  async check(
    sessionId: string,
    input: ForkChatStallCheckInput | null
  ): Promise<ForkChatStallDecision> {
    const { stallMs, autoRelease } = this.deps.settings()
    if (!input || stallMs === null) {
      this.forget(sessionId)
      return 'hold'
    }
    const now = this.deps.now()
    let entry = this.tracked.get(sessionId)
    if (!entry || entry.progress !== input.progress) {
      entry = {
        progress: input.progress,
        progressAt: now,
        checkedAt: now,
        ownerPid: input.ownerPid,
        liveness: null,
        releaseRequested: entry?.releaseRequested ?? false
      }
      this.tracked.set(sessionId, entry)
    }
    entry.checkedAt = now
    entry.ownerPid = input.ownerPid
    const quiet = now - entry.progressAt
    if (!entry.releaseRequested && quiet < stallMs) {
      entry.liveness = null
      this.publish()
      return 'hold'
    }
    const verdict = input.ownerPid === null ? null : await this.deps.probe(input.ownerPid)
    entry.liveness = verdict?.liveness ?? 'unknown'
    const release =
      entry.releaseRequested ||
      (autoRelease &&
        quiet >= 2 * stallMs &&
        (entry.liveness === 'stopped' || entry.liveness === 'gone'))
    if (release) {
      // A stopped provider cannot handle the stop it is about to get; let it run first.
      this.resumeAll(verdict)
      this.tracked.delete(sessionId)
    }
    this.publish()
    return release ? 'release' : 'hold'
  }

  /** The chats marked stalled now. */
  entries(): ForkChatStallEntry[] {
    const now = this.deps.now()
    const entries: ForkChatStallEntry[] = []
    for (const [sessionId, entry] of this.tracked) {
      if (now - entry.checkedAt > FORGET_AFTER_MS) {
        this.tracked.delete(sessionId)
      } else if (entry.liveness !== null) {
        entries.push({ sessionId, quietSince: entry.progressAt, liveness: entry.liveness })
      }
    }
    return entries
  }

  /** One user action on a stalled chat. Interrupt is the caller's (it needs the chat host). */
  async act(sessionId: string, action: Exclude<ForkChatStallAction, 'interrupt'>) {
    const entry = this.tracked.get(sessionId)
    if (!entry || entry.liveness === null) {
      return false
    }
    if (action === 'wake') {
      const verdict = entry.ownerPid === null ? null : await this.deps.probe(entry.ownerPid)
      if (!verdict || verdict.stoppedPids.length === 0) {
        return false
      }
      this.resumeAll(verdict)
      entry.liveness = verdict.liveness === 'stopped' ? 'alive' : verdict.liveness
      this.publish()
      return true
    }
    entry.releaseRequested = true
    // A tick already running serves it on the next one.
    void this.kick?.().catch(() => {})
    return true
  }

  private resumeAll(verdict: ForkProviderTreeVerdict | null): void {
    for (const pid of verdict?.stoppedPids ?? []) {
      try {
        this.deps.resume(pid)
      } catch {
        // Gone meanwhile; the stop that follows does not need it.
      }
    }
  }

  private forget(sessionId: string): void {
    if (this.tracked.delete(sessionId)) {
      this.publish()
    }
  }

  private publish(): void {
    const entries = this.entries()
    const next = JSON.stringify(entries)
    if (next !== this.published) {
      this.published = next
      this.deps.onChange(entries)
    }
  }
}
