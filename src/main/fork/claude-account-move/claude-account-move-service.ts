// SLRM-1503: move native Claude chats on this host to another of this host's Claude accounts.
// A move pins the chat (claude-session-account-pins); the stock outgrown-child check then stops its
// provider at rest and the next send resumes the same conversation on the pinned account. Busy
// chats are never cut off: their move waits for the turn, unless the caller asks to stop it now.
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { agentSessionAccountHomePath } from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type {
  ForkClaudeBusyActivity,
  ForkClaudeMoveResponse,
  ForkClaudeMoveResult,
  ForkClaudeSessionAccount,
  ForkClaudeWhichResponse
} from '../../../shared/fork/claude-account-move'
import { readBusyChat } from '../restart-guard/busy-chats'
import type { ClaudeSessionAccountPins, ClaudeSessionPin } from './claude-session-account-pins'
import type { PinnedClaudeRoute } from './claude-pinned-route'

export type ClaudeAccountMoveDeps = {
  /** The machine these chats run on, shown as the host column. */
  hostName: string
  records(): readonly AgentSessionRecord[]
  record(sessionId: string): AgentSessionRecord | null
  /** Loaded in this host or shown in a tab: the chats a worktree move takes. */
  inView(sessionId: string): boolean
  summary(sessionId: string): AgentSessionStatusSummary | undefined
  /** The account folder the chat's live provider runs under; undefined when none runs. */
  runningHome(sessionId: string): string | undefined
  accountLabel(accountId: string): string | undefined
  /** Null when the account is not saved on this host. */
  route(pin: ClaudeSessionPin): PinnedClaudeRoute | null
  systemHome(): string
  /** The account a chat without a pin follows; null is System default. */
  selectedAccountId(): string | null
  /** Each account folder shares System default's conversation history (stock `projects` link). */
  sharesHistory(fromHome: string, toHome: string): boolean
  prepareAccount(accountId: string): Promise<void>
  pins: Pick<ClaudeSessionAccountPins, 'get' | 'set'>
  /** Stop the running turn; false when the host refused. */
  stopTurn(record: AgentSessionRecord): Promise<boolean>
}

const SYSTEM_LABEL = 'System default'

function busyActivity(
  summary: AgentSessionStatusSummary | undefined
): ForkClaudeBusyActivity | null {
  return summary ? (readBusyChat(summary)?.activity.kind ?? null) : null
}

function chatName(record: AgentSessionRecord, summary: AgentSessionStatusSummary | undefined) {
  return summary?.conversationName?.trim() || record.conversationName?.trim() || record.sessionId
}

export class ClaudeAccountMoveService {
  /** Moves waiting on a busy chat, with the pin to restore on Cancel. */
  private readonly pending = new Map<string, { previous: ClaudeSessionPin | undefined }>()

  constructor(private readonly deps: ClaudeAccountMoveDeps) {}

  private routeHome(route: PinnedClaudeRoute): string {
    return route.kind === 'system' ? this.deps.systemHome() : route.home
  }

  private accountOfHome(home: string | undefined): string | null | undefined {
    if (home === undefined) {
      return undefined
    }
    if (home === this.deps.systemHome()) {
      return null
    }
    const selected = this.deps.selectedAccountId()
    const pins = new Set(
      this.deps
        .records()
        .map((record) => this.deps.pins.get(record.sessionId))
        .filter((pin): pin is string => typeof pin === 'string')
    )
    if (selected) {
      pins.add(selected)
    }
    for (const id of pins) {
      const route = this.deps.route(id)
      if (route?.kind === 'account' && route.home === home) {
        return id
      }
    }
    return undefined
  }

  private label(accountId: string | null): string {
    return accountId === null ? SYSTEM_LABEL : (this.deps.accountLabel(accountId) ?? accountId)
  }

  /** A pending move ends once the live provider runs on the pin, or none runs. */
  private settlePending(sessionId: string): boolean {
    if (!this.pending.has(sessionId)) {
      return false
    }
    const pin = this.deps.pins.get(sessionId)
    const route = pin === undefined ? null : this.deps.route(pin)
    const running = this.deps.runningHome(sessionId)
    if (!route || running === undefined || running === this.routeHome(route)) {
      this.pending.delete(sessionId)
      return false
    }
    return true
  }

  describe(record: AgentSessionRecord): ForkClaudeSessionAccount {
    const summary = this.deps.summary(record.sessionId)
    const pin = this.deps.pins.get(record.sessionId)
    const pinned = pin !== undefined && this.deps.route(pin) !== null
    const accountId = pinned && pin !== undefined ? pin : this.deps.selectedAccountId()
    const runningAccountId = this.accountOfHome(this.deps.runningHome(record.sessionId))
    return {
      sessionId: record.sessionId,
      name: chatName(record, summary),
      workspaceId: record.location.workspaceId,
      host: this.deps.hostName,
      accountId,
      accountLabel: this.label(accountId),
      ...(runningAccountId === undefined ? {} : { runningAccountId }),
      pinned,
      pending: this.settlePending(record.sessionId),
      busy: busyActivity(summary)
    }
  }

  private worktreeRecords(worktree: string): AgentSessionRecord[] {
    return this.deps
      .records()
      .filter(
        (record) =>
          record.provider === 'claude' &&
          record.location.workspaceId === worktree &&
          this.deps.inView(record.sessionId)
      )
  }

  which(scope: { sessionId?: string; worktree?: string }): ForkClaudeWhichResponse {
    let records: AgentSessionRecord[]
    if (scope.sessionId) {
      const record = this.deps.record(scope.sessionId)
      records = record?.provider === 'claude' ? [record] : []
    } else if (scope.worktree) {
      records = this.worktreeRecords(scope.worktree)
    } else {
      records = this.deps
        .records()
        .filter((record) => record.provider === 'claude' && this.deps.inView(record.sessionId))
    }
    return { host: this.deps.hostName, sessions: records.map((record) => this.describe(record)) }
  }

  async move(input: {
    accountId: string | null
    sessionId?: string
    worktree?: string
    now?: boolean
  }): Promise<ForkClaudeMoveResponse> {
    const ids = input.sessionId
      ? [input.sessionId]
      : this.worktreeRecords(input.worktree ?? '').map((record) => record.sessionId)
    const results: ForkClaudeMoveResult[] = []
    for (const sessionId of ids) {
      results.push(await this.moveOne(sessionId, input.accountId, input.now === true))
    }
    return { host: this.deps.hostName, accountId: input.accountId, results }
  }

  private async moveOne(
    sessionId: string,
    accountId: string | null,
    now: boolean
  ): Promise<ForkClaudeMoveResult> {
    const record = this.deps.record(sessionId)
    const summary = this.deps.summary(sessionId)
    const name = record ? chatName(record, summary) : sessionId
    const cantMove = (reason: ForkClaudeMoveResult['reason']): ForkClaudeMoveResult => ({
      sessionId,
      name,
      status: 'cant-move',
      reason
    })
    if (!record) {
      return cantMove('not-found')
    }
    if (record.provider !== 'claude') {
      return cantMove('not-claude')
    }
    // A WSL chat launches under its distro's own account selection, which a host pin cannot reach.
    if (record.location.wslDistro) {
      return cantMove('wsl-chat')
    }
    const route = this.deps.route(accountId)
    if (!route) {
      return cantMove('unknown-account')
    }
    const toHome = this.routeHome(route)
    const running = this.deps.runningHome(sessionId)
    const previous = this.deps.pins.get(sessionId)
    const fromHome =
      running ?? agentSessionAccountHomePath(record.accountHome) ?? this.deps.systemHome()
    if (running === toHome || (running === undefined && previous === accountId)) {
      this.deps.pins.set(sessionId, accountId)
      this.pending.delete(sessionId)
      return { sessionId, name, status: 'unchanged' }
    }
    if (route.kind === 'account') {
      try {
        await this.deps.prepareAccount(route.accountId)
      } catch {
        return cantMove('account-setup-failed')
      }
    }
    if (!this.deps.sharesHistory(fromHome, toHome)) {
      return cantMove('history-not-shared')
    }
    this.deps.pins.set(sessionId, accountId)
    const busy = busyActivity(summary)
    if (!busy || running === undefined) {
      this.pending.delete(sessionId)
      return { sessionId, name, status: 'moved' }
    }
    if (!this.pending.has(sessionId)) {
      this.pending.set(sessionId, { previous })
    }
    if (!now) {
      return { sessionId, name, status: 'queued', busy }
    }
    if (!(await this.deps.stopTurn(record))) {
      return { ...cantMove('stop-failed'), busy }
    }
    return { sessionId, name, status: 'moved', stopped: true }
  }

  /** Drop a queued move: the chat goes back to the account it followed before. */
  cancel(sessionId: string): { cancelled: boolean } {
    const entry = this.pending.get(sessionId)
    if (!entry || !this.settlePending(sessionId)) {
      return { cancelled: false }
    }
    this.pending.delete(sessionId)
    this.deps.pins.set(sessionId, entry.previous)
    return { cancelled: true }
  }
}
