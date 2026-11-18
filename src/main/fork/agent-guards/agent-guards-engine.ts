// Agent guards (FORK.md, SLRM-2385): the rules, with the clock, the chat host, the terminals, the
// ledger and the saved records all passed in. The service wires it to this process.
// - Loop: each finished tool call goes through `stepAgentGuardLoop`. `warn` sends the fixed note
//   once per episode (recorded only once delivered); `pause` interrupts the agent, records the
//   pause, lists it in the Decision inbox and tells the notify targets.
// - Spend: at each turn end of a chat with a cap, its estimated spend since the cap began (or
//   since its last resume) is read; at or past the cap the chat is paused there, between turns.
// - Held: a paused chat that starts a turn another agent asked for (mail) is stopped at once; a
//   turn a person started lifts the pause. A paused terminal agent is left as the interrupt left it.
import {
  AGENT_GUARD_LOOP_MESSAGE,
  agentGuardCapFor,
  agentGuardLabel,
  newAgentGuardLoopTrack,
  noteAgentGuardWarned,
  stepAgentGuardLoop,
  type AgentGuardEntry,
  type AgentGuardLoopTrack,
  type AgentGuardToolCall
} from '../../../shared/fork/agent-guards'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { newestUserMessageSource, takeChatToolCalls } from './agent-guards-chat-calls'
import {
  buildAgentGuardEntries,
  pausedAgentGuardEntry,
  roundUsd,
  type AgentGuardWarned
} from './agent-guards-entries'
import {
  AgentGuardLanes,
  type AgentGuardAgentMeta,
  type AgentGuardChatRow,
  type AgentGuardEngineDeps,
  type AgentGuardSpend
} from './agent-guards-types'
import {
  pruneAgentGuardRecords,
  type AgentGuardPause,
  type AgentGuardRecord
} from './agent-guards-state'

export type {
  AgentGuardAgentMeta,
  AgentGuardChatRow,
  AgentGuardEngineDeps,
  AgentGuardSpend
} from './agent-guards-types'

/** Spend since the last resume or cap change set a baseline. */
const spentSince = (record: AgentGuardRecord | undefined, spend: AgentGuardSpend): number =>
  Math.max(0, (spend.totalUsd ?? 0) - (record?.baselineUsd ?? 0))

const BARE_CHAT: AgentGuardAgentMeta = { kind: 'chat', agent: '', title: '', worktreeId: null }

export class AgentGuardEngine {
  private readonly tracks = new Map<string, AgentGuardLoopTrack>()
  private readonly warned = new Map<string, AgentGuardWarned>()
  private readonly seen = new Map<string, Set<string>>()
  private readonly meta = new Map<string, AgentGuardAgentMeta>()
  private readonly lanes = new AgentGuardLanes()

  constructor(private readonly deps: AgentGuardEngineDeps) {}

  /** The ids the fork's automatic senders leave alone. */
  heldIds(): string[] {
    return [...this.deps.records].filter(([, record]) => record.paused).map(([id]) => id)
  }

  /** True when some chat has a cap of its own, which applies with the default cap off. */
  hasOwnCaps(): boolean {
    return [...this.deps.records.values()].some((record) => record.capUsd !== undefined)
  }

  isPaused(id: string): boolean {
    return Boolean(this.deps.records.get(id)?.paused)
  }

  /** What is known of an agent, its names cleaned; a bare chat when nothing is. */
  private metaOf(id: string): AgentGuardAgentMeta {
    return this.meta.get(id) ?? BARE_CHAT
  }

  noteMeta(id: string, raw: AgentGuardAgentMeta): void {
    // Titles come from prompts and conversation names: no control characters reach a terminal.
    const meta = {
      ...raw,
      agent: agentGuardLabel(raw.agent, 40),
      title: agentGuardLabel(raw.title)
    }
    this.meta.set(id, meta)
    const record = this.deps.records.get(id)
    if (record) {
      Object.assign(record, { title: meta.title, worktreeId: meta.worktreeId })
    }
  }

  /** One agent at a time, in order: a burst of hook posts never races itself. */
  private lane(id: string, task: () => Promise<void>): Promise<void> {
    return this.lanes.run(id, task)
  }

  /** A finished tool call of one agent. */
  observe(id: string, meta: AgentGuardAgentMeta, call: AgentGuardToolCall): Promise<void> {
    this.noteMeta(id, meta)
    const clean = this.metaOf(id)
    return this.lane(id, () => this.step(id, clean, call))
  }

  private async step(
    id: string,
    meta: AgentGuardAgentMeta,
    call: AgentGuardToolCall
  ): Promise<void> {
    const settings = this.deps.settings()
    if (!settings.loop || this.isPaused(id)) {
      return
    }
    let track = this.tracks.get(id)
    if (!track) {
      track = newAgentGuardLoopTrack()
      this.tracks.set(id, track)
    }
    const hadWarning = track.warned !== null
    const action = stepAgentGuardLoop(track, call, settings)
    if (hadWarning && track.warned === null) {
      // Progress ended the episode.
      this.warned.delete(id)
      this.deps.changed()
    }
    if (action.kind === 'warn') {
      const sent =
        meta.kind === 'chat'
          ? await this.deps.ports.warnChat(id, AGENT_GUARD_LOOP_MESSAGE)
          : await this.deps.ports.warnTerminal(id, meta.agent, AGENT_GUARD_LOOP_MESSAGE)
      if (sent !== 'refused') {
        // A send that may have arrived counts as sent: the note never goes twice.
        noteAgentGuardWarned(track, action, this.deps.now())
        this.warned.set(id, {
          since: this.deps.now(),
          repeats: action.count,
          tool: agentGuardLabel(action.tool)
        })
        this.deps.changed()
      }
      return
    }
    if (action.kind === 'pause') {
      const interrupted =
        meta.kind === 'chat'
          ? (this.deps.ports.chatInTurn(id) ?? false) && (await this.deps.ports.stopChat(id))
          : await this.deps.ports.stopTerminal(id, meta.agent)
      this.tracks.delete(id)
      this.warned.delete(id)
      await this.pause(id, meta, {
        reason: 'loop',
        at: this.deps.now(),
        repeats: action.count,
        tool: agentGuardLabel(action.tool),
        ...(interrupted || meta.kind === 'chat' ? {} : { notInterrupted: true })
      })
      return
    }
    const shown = this.warned.get(id)
    if (shown && track.warned) {
      shown.repeats = Math.max(shown.repeats, track.runs[track.warned.signature] ?? 0)
    }
  }

  private record(id: string, meta: AgentGuardAgentMeta): AgentGuardRecord {
    let record = this.deps.records.get(id)
    if (!record) {
      record = { ...meta, at: this.deps.now() }
      this.deps.records.set(id, record)
    }
    return record
  }

  private async pause(
    id: string,
    meta: AgentGuardAgentMeta,
    pause: AgentGuardPause
  ): Promise<void> {
    const record = this.record(id, meta)
    record.paused = pause
    record.at = this.deps.now()
    await this.deps.save()
    this.deps.changed()
    const entry = pausedAgentGuardEntry(id, record)
    if (entry && this.deps.settings().notify) {
      this.deps.notify(entry)
    }
  }

  /** A native chat's newest rows: its new finished tool calls, and a held chat's new turn. */
  async sweepChat(row: AgentGuardChatRow): Promise<void> {
    this.noteMeta(row.sessionId, row)
    const id = row.sessionId
    const paused = this.isPaused(id)
    if (!row.working) {
      if (!paused) {
        await this.lane(id, () => this.checkSpend(id))
      }
      return
    }
    if (!this.deps.settings().loop && !paused) {
      return
    }
    await this.lane(id, async () => {
      const items = await this.deps.ports.chatTail(id)
      if (this.isPaused(id)) {
        await this.heldTurn(id, items)
        return
      }
      let seen = this.seen.get(id)
      if (!seen) {
        seen = new Set()
        this.seen.set(id, seen)
      }
      for (const call of takeChatToolCalls(items, seen, this.deps.startedAt)) {
        await this.step(id, this.metaOf(id), call)
        if (this.isPaused(id)) {
          return
        }
      }
    })
  }

  /** The ledger saw a turn start or end in a chat it counts. */
  onTurn(sessionId: string, phase: 'start' | 'end'): Promise<void> {
    return this.lane(sessionId, async () => {
      if (phase === 'end') {
        if (!this.isPaused(sessionId)) {
          await this.checkSpend(sessionId)
        }
        return
      }
      if (this.isPaused(sessionId)) {
        await this.heldTurn(sessionId, await this.deps.ports.chatTail(sessionId))
      }
    })
  }

  /** A paused chat in a turn: a person's turn lifts the pause, another agent's is stopped. */
  private async heldTurn(
    sessionId: string,
    items: readonly AgentJournalRenderItem[]
  ): Promise<void> {
    const source = this.deps.ports.chatInTurn(sessionId) ? newestUserMessageSource(items) : null
    if (source === 'person') {
      await this.resume(sessionId)
    } else if (source === 'agent') {
      await this.deps.ports.stopChat(sessionId)
    }
  }

  /** A chat's cap and its spend since the cap began, or null when no cap covers it or no spend. */
  private capState(
    id: string,
    spend: AgentGuardSpend
  ): { capUsd: number; spentUsd: number } | null {
    const record = this.deps.records.get(id)
    const cap = agentGuardCapFor(record?.capUsd, spend.isWorker, this.deps.settings())
    return cap === null || spend.totalUsd === null
      ? null
      : { capUsd: cap, spentUsd: roundUsd(spentSince(record, spend)) }
  }

  /** Between turns: pause a chat whose spend reached its cap. */
  private async checkSpend(sessionId: string): Promise<void> {
    const state = this.capState(sessionId, this.deps.spend(sessionId))
    if (!state || state.spentUsd < state.capUsd || this.deps.ports.chatInTurn(sessionId)) {
      return
    }
    await this.pause(sessionId, this.metaOf(sessionId), {
      reason: 'spend',
      at: this.deps.now(),
      ...state
    })
  }

  /** Lift a pause. A chat's spend counts again from now. */
  async resume(id: string): Promise<'resumed' | 'not-paused'> {
    const record = this.deps.records.get(id)
    if (!record?.paused) {
      return 'not-paused'
    }
    delete record.paused
    record.at = this.deps.now()
    if (record.kind === 'chat') {
      const total = this.deps.spend(id).totalUsd
      if (total !== null) {
        record.baselineUsd = roundUsd(total)
      }
    }
    this.tracks.delete(id)
    this.warned.delete(id)
    pruneAgentGuardRecords(this.deps.records, this.deps.now())
    await this.deps.save()
    this.deps.changed()
    return 'resumed'
  }

  /** A chat's own cap; 0 drops it so the default applies again. Its spend counts from now. */
  async setCap(
    sessionId: string,
    usd: number
  ): Promise<{ capUsd: number | null; spentUsd: number }> {
    const record = this.record(sessionId, this.metaOf(sessionId))
    const total = this.deps.spend(sessionId).totalUsd ?? 0
    if (usd > 0) {
      record.capUsd = roundUsd(usd)
      record.baselineUsd = roundUsd(total)
    } else {
      delete record.capUsd
    }
    record.at = this.deps.now()
    pruneAgentGuardRecords(this.deps.records, this.deps.now())
    await this.deps.save()
    this.deps.changed()
    return {
      capUsd: record.capUsd ?? null,
      spentUsd: roundUsd(spentSince(record, this.deps.spend(sessionId)))
    }
  }

  /** Paused and warned agents, then chats with a cap, oldest first within each. */
  entries(): AgentGuardEntry[] {
    return buildAgentGuardEntries({
      records: this.deps.records,
      warned: this.warned,
      meta: this.meta,
      cap: (id) => this.capState(id, this.deps.spend(id))
    })
  }

  /** Forget the loop watch of agents no longer listed (closed panes, ended chats). */
  forgetMissing(liveIds: ReadonlySet<string>): void {
    for (const id of [...this.tracks.keys(), ...this.seen.keys(), ...this.meta.keys()]) {
      if (!liveIds.has(id) && !this.deps.records.get(id)?.paused) {
        this.tracks.delete(id)
        this.seen.delete(id)
        this.meta.delete(id)
        if (this.warned.delete(id)) {
          this.deps.changed()
        }
      }
    }
  }
}
