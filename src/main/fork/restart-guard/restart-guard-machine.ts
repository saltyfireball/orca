// Holds a quit, restart or update install while native chats are busy, then lets it through.
import type { BusyChat } from './busy-chats'

export type RestartGuardKind = 'quit' | 'restart' | 'update'
export type RestartGuardChoice = 'wait' | 'now' | 'cancel'
export type RestartGuardWaitingChoice = 'keep' | 'now' | 'stop'
export type RestartGuardRequestResult = 'proceed' | 'waiting' | 'cancelled'

export type RestartGuardProgress = {
  kind: RestartGuardKind
  total: number
  remaining: BusyChat[]
}

export type BeforeQuitSignals = {
  defaultPrevented: boolean
  /** OS shutdown or logout: never block it, or macOS cancels the logout. */
  systemShutdown: boolean
  /** Another owner already committed this quit (signal, supervisor, update, teardown started). */
  committedElsewhere: boolean
}

export type RestartGuardDeps = {
  readBusyChats: () => BusyChat[]
  askBeforeRestart: (kind: RestartGuardKind, chats: BusyChat[]) => Promise<RestartGuardChoice>
  askWhileWaiting: (progress: RestartGuardProgress) => Promise<RestartGuardWaitingChoice>
  quitApp: () => void
  schedule: (run: () => void, ms: number) => () => void
  onProgress: (progress: RestartGuardProgress | null) => void
  now: () => number
  onProceedError?: (error: unknown) => void
}

export const RESTART_GUARD_POLL_MS = 2000
// Long enough for a relaunch's cleanup to reach before-quit, short enough not to bypass a later quit.
export const RESTART_GUARD_APPROVAL_MS = 2 * 60 * 1000

type Proceed = () => unknown

type Waiting = {
  kind: RestartGuardKind
  proceed: Proceed
  seen: Set<string>
  remaining: BusyChat[]
  cancelTimer: () => void
}

export class RestartGuard {
  private prompting = false
  private waiting: Waiting | null = null
  private approvedAt: number | null = null

  constructor(private readonly deps: RestartGuardDeps) {}

  getProgress(): RestartGuardProgress | null {
    return this.waiting ? this.progressOf(this.waiting) : null
  }

  /** Synchronous before-quit verdict; on 'hold' the caller must preventDefault. */
  onBeforeQuit(signals: BeforeQuitSignals): 'pass' | 'hold' {
    if (signals.defaultPrevented || signals.systemShutdown || signals.committedElsewhere) {
      return 'pass'
    }
    if (this.isApproved()) {
      return 'pass'
    }
    if (this.prompting) {
      return 'hold'
    }
    if (!this.waiting && this.deps.readBusyChats().length === 0) {
      return 'pass'
    }
    void this.request('quit', this.deps.quitApp).then((result) => {
      if (result === 'proceed') {
        this.deps.quitApp()
      }
    })
    return 'hold'
  }

  /**
   * 'proceed' means the caller goes ahead now. 'waiting' means the guard runs `proceed` itself
   * once every busy chat is idle. 'cancelled' means nothing happens.
   */
  async request(kind: RestartGuardKind, proceed: Proceed): Promise<RestartGuardRequestResult> {
    if (this.prompting) {
      return 'cancelled'
    }
    if (this.waiting) {
      return this.askAboutWaiting()
    }
    const busy = this.deps.readBusyChats()
    if (busy.length === 0) {
      this.approve()
      return 'proceed'
    }
    this.prompting = true
    let choice: RestartGuardChoice
    try {
      choice = await this.deps.askBeforeRestart(kind, busy)
    } finally {
      this.prompting = false
    }
    if (choice === 'now') {
      this.approve()
      return 'proceed'
    }
    if (choice === 'wait') {
      return this.startWaiting(kind, proceed, busy)
    }
    return 'cancelled'
  }

  /** For "restart when idle" picked up front (the update menu item): no first dialog. */
  whenIdle(kind: RestartGuardKind, proceed: Proceed): RestartGuardRequestResult {
    if (this.prompting || this.waiting) {
      return 'cancelled'
    }
    const busy = this.deps.readBusyChats()
    if (busy.length === 0) {
      this.approve()
      this.run(proceed)
      return 'proceed'
    }
    return this.startWaiting(kind, proceed, busy)
  }

  /** Shows the waiting status, where the user can keep waiting, go now or stop waiting. */
  async askAboutWaiting(): Promise<RestartGuardRequestResult> {
    const waiting = this.waiting
    if (!waiting || this.prompting) {
      return 'cancelled'
    }
    this.prompting = true
    let choice: RestartGuardWaitingChoice
    try {
      choice = await this.deps.askWhileWaiting(this.progressOf(waiting))
    } finally {
      this.prompting = false
    }
    // The wait may have finished while the dialog was open.
    if (this.waiting !== waiting) {
      return 'cancelled'
    }
    if (choice === 'now') {
      this.finish(waiting)
      return 'cancelled'
    }
    if (choice === 'stop') {
      this.stopWaiting()
    }
    return 'cancelled'
  }

  stopWaiting(): void {
    const waiting = this.waiting
    if (!waiting) {
      return
    }
    waiting.cancelTimer()
    this.waiting = null
    this.deps.onProgress(null)
  }

  private startWaiting(
    kind: RestartGuardKind,
    proceed: Proceed,
    busy: BusyChat[]
  ): RestartGuardRequestResult {
    const waiting: Waiting = {
      kind,
      proceed,
      seen: new Set(busy.map((chat) => chat.sessionId)),
      remaining: busy,
      cancelTimer: () => {}
    }
    this.waiting = waiting
    this.deps.onProgress(this.progressOf(waiting))
    this.scheduleCheck(waiting)
    return 'waiting'
  }

  private scheduleCheck(waiting: Waiting): void {
    waiting.cancelTimer = this.deps.schedule(() => this.check(waiting), RESTART_GUARD_POLL_MS)
  }

  private check(waiting: Waiting): void {
    if (this.waiting !== waiting) {
      return
    }
    const busy = this.deps.readBusyChats()
    if (busy.length === 0) {
      this.finish(waiting)
      return
    }
    // A chat that starts working mid-wait joins the list; the restart waits for it too.
    for (const chat of busy) {
      waiting.seen.add(chat.sessionId)
    }
    waiting.remaining = busy
    this.deps.onProgress(this.progressOf(waiting))
    this.scheduleCheck(waiting)
  }

  private finish(waiting: Waiting): void {
    waiting.cancelTimer()
    this.waiting = null
    this.deps.onProgress(null)
    this.approve()
    this.run(waiting.proceed)
  }

  private run(proceed: Proceed): void {
    void Promise.resolve()
      .then(proceed)
      .catch((error: unknown) => this.deps.onProceedError?.(error))
  }

  private approve(): void {
    this.approvedAt = this.deps.now()
  }

  private isApproved(): boolean {
    return this.approvedAt !== null && this.deps.now() - this.approvedAt < RESTART_GUARD_APPROVAL_MS
  }

  private progressOf(waiting: Waiting): RestartGuardProgress {
    return { kind: waiting.kind, total: waiting.seen.size, remaining: waiting.remaining }
  }
}
