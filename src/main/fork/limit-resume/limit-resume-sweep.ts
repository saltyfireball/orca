// Limit resume (FORK.md, SLRM-2309): the terminal agent sweep. Each pass reads the bottom of the
// screen of every Claude Code and Codex terminal agent on this host that is not busy, parks the
// ones stopped on a usage limit, and at the reset (plus a delay) or after a backoff wait types the
// resume message, through the same guarded send idle recovery uses. It sees the world only
// through `LimitResumePorts`, so tests run it without a runtime. Keep electron out of this file.
import {
  limitResumeAt,
  type LimitResumeEntry,
  type LimitResumeSettings
} from '../../../shared/fork/limit-resume'
import { readLimitScreen } from '../../../shared/fork/limit-resume-parse'
import type { ForkLimitsActionOutcome } from '../../../shared/fork/limit-resume-wire'
import type { LimitResumeMemo, LimitResumeMemos } from './limit-resume-memos'

/** A row reported working with no update for this long may be stuck on a limit message. */
export const LIMIT_RESUME_STALE_WORKING_MS = 2 * 60_000
/** A memo of a pane that is gone is dropped after this. */
const MEMO_KEEP_MS = 24 * 60 * 60_000

export type LimitResumeTerminalRow = {
  paneKey: string
  worktreeId: string | null
  agent: string
  title: string
  working: boolean
  updatedAt: number
}

export type LimitResumeSendOutcome = 'sent' | 'refused' | 'unknown'

export type LimitResumePorts = {
  rows: () => Promise<readonly LimitResumeTerminalRow[]>
  /** The screen top to bottom, or null when the pane has no live, readable terminal. */
  screen: (paneKey: string) => Promise<readonly string[] | null>
  /** Why nothing may be typed now (a draft, a dialog, a turn), or null. With `untouchedSince`,
   *  keys typed there after that time refuse it too. */
  refusal: (paneKey: string, untouchedSince?: number) => Promise<string | null>
  send: (
    paneKey: string,
    agent: string,
    text: string,
    untouchedSince?: number
  ) => Promise<LimitResumeSendOutcome>
  /** Esc to the Codex model-switch menu, which keeps the current model. */
  dismissSwitchPrompt: (paneKey: string, agent: string) => Promise<LimitResumeSendOutcome>
}

type Park = Omit<LimitResumeEntry, 'id' | 'kind' | 'maxTries'> & {
  occurrences: number
  detectedAt: number
}

export type LimitResumeSweepDeps = {
  ports: LimitResumePorts
  memos: LimitResumeMemos
  /** Called after a pass or an action changed a memo. */
  saveMemos: () => Promise<void>
  now: () => number
  timeZone?: string
}

const answered = (memo: LimitResumeMemo | undefined, line: string, occurrences: number): boolean =>
  memo?.answeredLine === line && occurrences <= (memo.answeredOccurrences ?? 0)

export class LimitResumeSweep {
  private readonly parks = new Map<string, Park>()
  /** Panes whose model-switch menu was dismissed, by the row's update time then. */
  private readonly dismissed = new Map<string, number>()
  /** Panes seen working since their last resume: the next limit-free ending ends the streak. */
  private readonly worked = new Set<string>()
  private dirty = false

  constructor(private readonly deps: LimitResumeSweepDeps) {}

  entries(settings: Pick<LimitResumeSettings, 'maxTries'>): LimitResumeEntry[] {
    return [...this.parks.values()].map((park) => ({
      id: park.paneKey,
      kind: 'terminal',
      maxTries: settings.maxTries,
      paneKey: park.paneKey,
      worktreeId: park.worktreeId,
      agent: park.agent,
      title: park.title,
      resetsAt: park.resetsAt,
      resumeAt: park.resumeAt,
      tries: park.tries,
      state: park.state,
      line: park.line
    }))
  }

  /** Forgets every park; nothing is sent while the feature is off. */
  clear(): void {
    this.parks.clear()
  }

  /** One pass. Resolves true when some agent is parked (the timer keeps its base cadence). */
  async pass(settings: LimitResumeSettings): Promise<boolean> {
    const now = this.deps.now()
    const rows = await this.deps.ports.rows()
    const present = new Set(rows.map((row) => row.paneKey))
    for (const paneKey of this.parks.keys()) {
      if (!present.has(paneKey)) {
        this.parks.delete(paneKey)
      }
    }
    for (const [paneKey, memo] of this.deps.memos) {
      if (!present.has(paneKey) && now - memo.at > MEMO_KEEP_MS) {
        this.deps.memos.delete(paneKey)
        this.dirty = true
      }
    }
    for (const row of rows) {
      if (row.working && now - row.updatedAt < LIMIT_RESUME_STALE_WORKING_MS) {
        if (this.deps.memos.get(row.paneKey)?.resumedAt !== undefined) {
          this.worked.add(row.paneKey)
        }
        continue
      }
      await this.look(row, settings, now)
    }
    await this.flush()
    return this.parks.size > 0
  }

  private async look(row: LimitResumeTerminalRow, settings: LimitResumeSettings, now: number) {
    const screen = await this.deps.ports.screen(row.paneKey)
    if (!screen) {
      return
    }
    const read = readLimitScreen(screen, now, this.deps.timeZone)
    const memo = this.deps.memos.get(row.paneKey)
    if (read.kind === 'codex-switch-prompt') {
      this.parks.delete(row.paneKey)
      if (
        settings.codexSwitchPrompt === 'dismiss' &&
        row.agent === 'codex' &&
        this.dismissed.get(row.paneKey) !== row.updatedAt
      ) {
        this.dismissed.set(row.paneKey, row.updatedAt)
        await this.deps.ports.dismissSwitchPrompt(row.paneKey, row.agent)
      }
      return
    }
    if (read.kind === 'none' || read.selfContinue) {
      this.parks.delete(row.paneKey)
      // A turn that ended after the last resume, without a limit: the streak is over.
      if (read.kind === 'none' && memo?.resumedAt !== undefined && this.worked.has(row.paneKey)) {
        this.endStreak(row.paneKey, null)
      }
      return
    }
    if (answered(memo, read.line, read.occurrences)) {
      // The answered stop is still on screen, but the agent worked since and stopped again
      // without a new limit: the streak is over, and that stop stays answered.
      if (memo && !memo.cancelled && this.worked.has(row.paneKey) && !row.working) {
        this.endStreak(row.paneKey, memo)
      }
      if (memo?.cancelled) {
        this.park(row, read, memo, settings, now, 'cancelled')
      } else {
        this.parks.delete(row.paneKey)
      }
      return
    }
    const park = this.park(row, read, memo, settings, now)
    if ((park.state === 'parked' || park.state === 'held') && now >= park.resumeAt) {
      await this.resume(park, settings, false)
    }
  }

  private endStreak(paneKey: string, memo: LimitResumeMemo | null): void {
    this.worked.delete(paneKey)
    if (memo) {
      const next: LimitResumeMemo = { ...memo, tries: 0, at: this.deps.now() }
      delete next.resumedAt
      this.deps.memos.set(paneKey, next)
    } else {
      this.deps.memos.delete(paneKey)
    }
    this.dirty = true
  }

  private park(
    row: LimitResumeTerminalRow,
    read: { line: string; occurrences: number; resetsAt: number | null },
    memo: LimitResumeMemo | undefined,
    settings: LimitResumeSettings,
    now: number,
    forced?: 'cancelled'
  ): Park {
    const tries = memo?.tries ?? 0
    const existing = this.parks.get(row.paneKey)
    const same = existing?.line === read.line && existing.occurrences === read.occurrences
    const detectedAt = same ? existing.detectedAt : now
    // "Try again in 2 hours" counts from when it was printed: keep the first reading.
    const resetsAt = same ? existing.resetsAt : read.resetsAt
    const park: Park = {
      paneKey: row.paneKey,
      worktreeId: row.worktreeId,
      agent: row.agent,
      title: row.title,
      line: read.line.slice(0, 1000),
      occurrences: read.occurrences,
      resetsAt,
      detectedAt,
      tries,
      resumeAt: limitResumeAt({ resetsAt, detectedAt, tries }, settings),
      state:
        forced ??
        (tries >= settings.maxTries
          ? 'exhausted'
          : same && existing.state === 'held'
            ? 'held'
            : 'parked')
    }
    this.parks.set(row.paneKey, park)
    return park
  }

  /** Types the message. The memo is written before the send, so a crash still counts the try. */
  private async resume(
    park: Park,
    settings: LimitResumeSettings,
    manual: boolean
  ): Promise<LimitResumeSendOutcome> {
    const untouchedSince = settings.holdWhileTyping ? park.detectedAt : undefined
    const refusal = await this.deps.ports.refusal(park.paneKey, untouchedSince)
    if (refusal) {
      park.state = 'held'
      return 'refused'
    }
    const before = this.deps.memos.get(park.paneKey)
    const now = this.deps.now()
    this.deps.memos.set(park.paneKey, {
      tries: (before?.tries ?? 0) + (manual ? 0 : 1),
      answeredLine: park.line,
      answeredOccurrences: park.occurrences,
      resumedAt: now,
      at: now
    })
    this.worked.delete(park.paneKey)
    this.dirty = true
    await this.flush()
    const outcome = await this.deps.ports.send(
      park.paneKey,
      park.agent,
      settings.message,
      untouchedSince
    )
    if (outcome === 'refused') {
      // Nothing left: give the try back and wait for the next pass.
      if (before) {
        this.deps.memos.set(park.paneKey, before)
      } else {
        this.deps.memos.delete(park.paneKey)
      }
      park.state = 'held'
    } else {
      this.parks.delete(park.paneKey)
    }
    this.dirty = true
    await this.flush()
    return outcome
  }

  /** `orca limits resume-now`: resume a parked agent before its time; not counted as a try. */
  async resumeNow(
    paneKey: string,
    settings: LimitResumeSettings
  ): Promise<ForkLimitsActionOutcome> {
    const park = this.parks.get(paneKey)
    return park ? this.resume(park, settings, true) : 'refused'
  }

  /** `orca limits cancel`: leave this stop to the user. */
  async cancel(paneKey: string): Promise<boolean> {
    const park = this.parks.get(paneKey)
    if (!park) {
      return false
    }
    park.state = 'cancelled'
    this.deps.memos.set(paneKey, {
      ...(this.deps.memos.get(paneKey) ?? { tries: 0 }),
      answeredLine: park.line,
      answeredOccurrences: park.occurrences,
      cancelled: true,
      at: this.deps.now()
    })
    this.dirty = true
    await this.flush()
    return true
  }

  private async flush(): Promise<void> {
    if (!this.dirty) {
      return
    }
    this.dirty = false
    await this.deps.saveMemos().catch((error: unknown) => {
      console.warn('[fork-limit-resume] could not save its state', error)
    })
  }
}
