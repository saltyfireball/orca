// Holds a quit, restart or update install while native chats are busy, then lets it through.
// Every failure here fails open: a broken guard must never trap the user in the app.
import type { BusyChat } from './busy-chats'

export type RestartGuardKind = 'quit' | 'restart' | 'update'
export type RestartGuardChoice = 'wait' | 'now' | 'cancel'
export type RestartGuardWaitingChoice = 'keep' | 'now' | 'stop'
export type RestartGuardRequestResult = 'proceed' | 'waiting' | 'cancelled'
/** How a wait ended: its intent ran ('proceeded') or the user stopped it ('stopped'). */
export type RestartGuardWaitEnd = 'proceeded' | 'stopped'

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
  /** Reveals the window the dialog sits on; called before asking and on a repeated quit. */
  bringForward: () => void
  quitApp: () => void
  schedule: (run: () => void, ms: number) => () => void
  onProgress: (progress: RestartGuardProgress | null) => void
  /** Called once per wait, after onProgress(null), with the wait's kind (SLRM-1569). */
  onWaitEnded?: (kind: RestartGuardKind, end: RestartGuardWaitEnd) => void
  now: () => number
  onError: (error: unknown) => void
}

export const RESTART_GUARD_POLL_MS = 2000
// Long enough for a relaunch's cleanup to reach before-quit, short enough not to bypass a later quit.
export const RESTART_GUARD_APPROVAL_MS = 2 * 60 * 1000

type Proceed = () => unknown
type Intent = { kind: RestartGuardKind; proceed: Proceed }

type Waiting = Intent & {
  seen: Set<string>
  remaining: BusyChat[]
  cancelTimer: () => void
}

/** A chat waiting on the user's answer is listed but never holds a "when idle" wait. */
function holdsWait(chat: BusyChat): boolean {
  return chat.activity.kind !== 'question'
}

export class RestartGuard {
  private prompting = false
  private waiting: Waiting | null = null
  private approvedAt: number | null = null

  constructor(private readonly deps: RestartGuardDeps) {}

  getProgress(): RestartGuardProgress | null {
    return this.waiting ? this.progressOf(this.waiting, this.waiting.kind) : null
  }

  /** Synchronous before-quit verdict; on 'hold' the caller must preventDefault. */
  onBeforeQuit(signals: BeforeQuitSignals): 'pass' | 'hold' {
    try {
      if (signals.defaultPrevented || signals.systemShutdown || signals.committedElsewhere) {
        return 'pass'
      }
      if (this.isApproved()) {
        return 'pass'
      }
      if (this.prompting) {
        this.bringForward()
        return 'hold'
      }
      if (!this.waiting && this.readBusy().length === 0) {
        return 'pass'
      }
      const quit = this.deps.quitApp
      void this.request('quit', quit)
        .then((result) => {
          if (result === 'proceed') {
            quit()
          }
        })
        .catch((error: unknown) => {
          this.deps.onError(error)
          this.approve()
          quit()
        })
      return 'hold'
    } catch (error) {
      this.deps.onError(error)
      return 'pass'
    }
  }

  /**
   * 'proceed' means the caller goes ahead now. 'waiting' means the guard runs `proceed` itself
   * once every busy chat is idle. 'cancelled' means nothing happens.
   */
  async request(kind: RestartGuardKind, proceed: Proceed): Promise<RestartGuardRequestResult> {
    if (this.prompting) {
      this.bringForward()
      return 'cancelled'
    }
    if (this.waiting) {
      return this.askAboutWaiting({ kind, proceed })
    }
    if (this.isApproved()) {
      return 'proceed'
    }
    const busy = this.readBusy()
    if (busy.length === 0) {
      this.approve()
      return 'proceed'
    }
    const choice = await this.ask(() => this.deps.askBeforeRestart(kind, busy), 'now')
    if (choice === 'now') {
      this.approve()
      return 'proceed'
    }
    if (choice === 'wait') {
      return this.startWaiting({ kind, proceed }, busy)
    }
    return 'cancelled'
  }

  /** For "restart when idle" picked up front (the update menu item): no first dialog. */
  whenIdle(kind: RestartGuardKind, proceed: Proceed): RestartGuardRequestResult {
    if (this.prompting || this.waiting) {
      return 'cancelled'
    }
    const result = this.startWaiting({ kind, proceed }, this.readBusy())
    if (result === 'proceed') {
      this.run(proceed)
    }
    return result
  }

  /**
   * Shows the waiting status: keep waiting, go now or stop waiting. `intent` is the request that
   * opened it; Now carries out that latest intent (Cmd-Q during a restart wait quits).
   */
  async askAboutWaiting(intent?: Intent): Promise<RestartGuardRequestResult> {
    const waiting = this.waiting
    if (!waiting || this.prompting) {
      return 'cancelled'
    }
    const kind = intent?.kind ?? waiting.kind
    const choice = await this.ask(
      () => this.deps.askWhileWaiting(this.progressOf(waiting, kind)),
      'now'
    )
    // The wait may have finished while the dialog was open.
    if (this.waiting !== waiting) {
      return 'cancelled'
    }
    if (choice === 'now') {
      this.goNow(waiting, (intent ?? waiting).proceed)
    } else if (choice === 'stop') {
      this.endWaiting(waiting, 'stopped')
    }
    return 'cancelled'
  }

  /**
   * The waiting dialog's Now and Stop Waiting without the dialog, for the update card
   * (SLRM-1569). Ignored while a guard dialog is open, which is brought forward instead.
   */
  resolveWaiting(choice: 'now' | 'stop'): void {
    const waiting = this.waiting
    if (!waiting) {
      return
    }
    if (this.prompting) {
      this.bringForward()
      return
    }
    if (choice === 'now') {
      this.goNow(waiting, waiting.proceed)
    } else {
      this.endWaiting(waiting, 'stopped')
    }
  }

  stopWaiting(): void {
    if (this.waiting) {
      this.endWaiting(this.waiting, 'stopped')
    }
  }

  private goNow(waiting: Waiting, proceed: Proceed): void {
    this.endWaiting(waiting, 'proceeded')
    this.approve()
    this.run(proceed)
  }

  private endWaiting(waiting: Waiting, end: RestartGuardWaitEnd): void {
    if (this.waiting !== waiting) {
      return
    }
    waiting.cancelTimer()
    this.waiting = null
    this.deps.onProgress(null)
    try {
      this.deps.onWaitEnded?.(waiting.kind, end)
    } catch (error) {
      this.deps.onError(error)
    }
  }

  private async ask<T>(show: () => Promise<T>, onFailure: T): Promise<T> {
    this.prompting = true
    try {
      this.bringForward()
      return await show()
    } catch (error) {
      this.deps.onError(error)
      return onFailure
    } finally {
      this.prompting = false
    }
  }

  private startWaiting(intent: Intent, busy: BusyChat[]): RestartGuardRequestResult {
    const blocking = busy.filter(holdsWait)
    // Nothing to wait for: the caller goes ahead, as with no busy chats at all.
    if (blocking.length === 0) {
      this.approve()
      return 'proceed'
    }
    const waiting: Waiting = {
      ...intent,
      seen: new Set(blocking.map((chat) => chat.sessionId)),
      remaining: blocking,
      cancelTimer: () => {}
    }
    this.waiting = waiting
    this.deps.onProgress(this.progressOf(waiting, waiting.kind))
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
    const blocking = this.readBusy().filter(holdsWait)
    if (blocking.length === 0) {
      this.goNow(waiting, waiting.proceed)
      return
    }
    // A chat that starts working mid-wait joins the list; the restart waits for it too.
    for (const chat of blocking) {
      waiting.seen.add(chat.sessionId)
    }
    waiting.remaining = blocking
    this.deps.onProgress(this.progressOf(waiting, waiting.kind))
    this.scheduleCheck(waiting)
  }

  private readBusy(): BusyChat[] {
    try {
      return this.deps.readBusyChats()
    } catch (error) {
      this.deps.onError(error)
      return []
    }
  }

  private bringForward(): void {
    try {
      this.deps.bringForward()
    } catch (error) {
      this.deps.onError(error)
    }
  }

  private run(proceed: Proceed): void {
    void Promise.resolve()
      .then(proceed)
      .catch((error: unknown) => this.deps.onError(error))
  }

  private approve(): void {
    this.approvedAt = this.deps.now()
  }

  private isApproved(): boolean {
    return this.approvedAt !== null && this.deps.now() - this.approvedAt < RESTART_GUARD_APPROVAL_MS
  }

  private progressOf(waiting: Waiting, kind: RestartGuardKind): RestartGuardProgress {
    return { kind, total: waiting.seen.size, remaining: waiting.remaining }
  }
}
