// SLRM-1503 (FORK.md): `orca account which` and `orca account move`, through the host's
// fork.claudeAccount.* RPC. --environment / --pairing-code pick the host; each host moves only its
// own chats onto its own accounts.
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getPresentStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector } from '../selectors'
import { readInjectedAgentSessionId } from '../../shared/agent-session/lifecycle/agent-session-caller-env'
import {
  FORK_CLAUDE_SYSTEM_DEFAULT,
  type ForkClaudeCantMoveReason,
  type ForkClaudeMoveResponse,
  type ForkClaudeMoveResult,
  type ForkClaudeSessionAccount,
  type ForkClaudeWhichResponse
} from '../../shared/fork/claude-account-move'
import type { RuntimeWorktreeRecord } from '../../shared/runtime-worktree-contracts'

type ClaudeAccountChoice = { id: string; email?: string | null }
type AccountsListResult = { claude: { accounts: ClaudeAccountChoice[] } }

const REASONS: Record<ForkClaudeCantMoveReason, string> = {
  'not-found': 'no chat with that session id on this host',
  'not-claude': 'not a Claude chat',
  'wsl-chat': 'runs in WSL, which follows its own account selection',
  'unknown-account': 'that account is not saved on this host',
  'history-not-shared':
    'the account folder does not share conversation history, so it could not resume',
  'account-setup-failed': 'the account folder could not be prepared',
  'stop-failed': 'the host refused to stop the running turn'
}

const BUSY: Record<string, string> = {
  turn: 'a turn is running',
  question: 'it is waiting on a question',
  children: 'its subagents are running'
}

function explainRefusal(error: unknown): unknown {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    return new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host cannot move chats between accounts. It needs a Blackfish build with SLRM-1503.'
    )
  }
  return error
}

async function call<T>(ctx: HandlerContext, method: string, params: unknown) {
  return await ctx.client.call<T>(method, params).catch((error: unknown) => {
    throw explainRefusal(error)
  })
}

/** The record id the host keys chats by; `worktree.show` resolves any selector to it. */
async function worktreeId(ctx: HandlerContext): Promise<string | undefined> {
  const selector = await getOptionalWorktreeSelector(ctx.flags, 'worktree', ctx.cwd, ctx.client)
  if (!selector) {
    return undefined
  }
  const shown = await ctx.client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
    worktree: selector
  })
  return shown.result.worktree.id
}

async function scope(ctx: HandlerContext, required: boolean) {
  const sessionFlag = getPresentStringFlag(ctx.flags, 'session')
  const worktree = await worktreeId(ctx)
  if (sessionFlag !== undefined && worktree !== undefined) {
    throw new RuntimeClientError('invalid_argument', 'Pass --session or --worktree, not both.')
  }
  // An empty --session never falls back to this chat; the injected id is local-only.
  const sessionId =
    sessionFlag ??
    (worktree === undefined && !ctx.client.isRemote ? readInjectedAgentSessionId() : undefined)
  if (required && !sessionId && worktree === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the chats to move with --session <id> or --worktree <selector>.'
    )
  }
  return { ...(sessionId ? { sessionId } : {}), ...(worktree ? { worktree } : {}) }
}

/** id, then email (any case), or `system` for System default. */
async function resolveAccount(ctx: HandlerContext, query: string): Promise<string | null> {
  if (query.toLowerCase() === FORK_CLAUDE_SYSTEM_DEFAULT) {
    return null
  }
  const list = await ctx.client.call<AccountsListResult>('accounts.list', { refreshUsage: false })
  const accounts = list.result.claude.accounts
  const byId = accounts.find((account) => account.id === query)
  if (byId) {
    return byId.id
  }
  const needle = query.toLowerCase()
  const byEmail = accounts.filter((account) => account.email?.toLowerCase() === needle)
  if (byEmail.length === 1) {
    return byEmail[0].id
  }
  const known = accounts.map((account) => `${account.id} (${account.email ?? 'no email'})`)
  throw new RuntimeClientError(
    'invalid_argument',
    byEmail.length > 1
      ? `Several Claude accounts on this host use ${query}; pass an id: ${byEmail.map((a) => a.id).join(', ')}.`
      : `No Claude account "${query}" on this host. Its accounts: ${known.join(', ') || 'none'}, or system.`
  )
}

function sessionState(session: ForkClaudeSessionAccount): string {
  const notes: string[] = []
  if (session.pending) {
    notes.push('move waiting for its turn to end')
  } else if (
    session.runningAccountId !== undefined &&
    session.runningAccountId !== session.accountId
  ) {
    notes.push('moves at its next message')
  }
  if (session.busy) {
    notes.push(BUSY[session.busy] ?? session.busy)
  }
  return notes.join('; ') || '-'
}

export function formatWhich(result: ForkClaudeWhichResponse): string {
  if (result.sessions.length === 0) {
    return `No Claude chats on ${result.host}.`
  }
  const rows = [
    ['HOST', 'SESSION', 'CHAT', 'ACCOUNT', 'STATE'],
    ...result.sessions.map((session) => [
      session.host,
      session.sessionId,
      session.name,
      `${session.accountLabel}${session.pinned ? ' (moved)' : ''}`,
      sessionState(session)
    ])
  ]
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)))
  return rows
    .map((row) =>
      row.map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths[col]))).join('  ')
    )
    .join('\n')
}

function resultLine(result: ForkClaudeMoveResult): string {
  const chat = `${result.name} (${result.sessionId})`
  switch (result.status) {
    case 'moved':
      return result.stopped
        ? `Moved ${chat}: stopped its turn; it resumes on the new account at its next message.`
        : `Moved ${chat}: it resumes on the new account at its next message.`
    case 'queued':
      return `Queued ${chat}: ${BUSY[result.busy ?? 'turn'] ?? 'it is busy'}, so it moves when that ends. Add --now to stop it instead.`
    case 'unchanged':
      return `Unchanged ${chat}: already on that account.`
    case 'cant-move':
      return `Can't move ${chat}: ${result.reason ? REASONS[result.reason] : 'refused'}.`
  }
}

export function formatMove(result: ForkClaudeMoveResponse): string {
  if (result.results.length === 0) {
    return `No Claude chats to move on ${result.host}.`
  }
  return [`On ${result.host}:`, ...result.results.map(resultLine)].join('\n')
}

export const FORK_ACCOUNT_MOVE_HANDLERS: Record<string, CommandHandler> = {
  'account which': async (ctx) => {
    const result = await call<ForkClaudeWhichResponse>(
      ctx,
      'fork.claudeAccount.which',
      await scope(ctx, false)
    )
    printResult(result, ctx.json, formatWhich)
  },
  'account move': async (ctx) => {
    const query = getOptionalStringFlag(ctx.flags, 'account')
    if (!query) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name the account to move to: an id or email of a Claude account on this host, or system.'
      )
    }
    const now = ctx.flags.get('now')
    if (now !== undefined && now !== true) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--now takes no value; put it last or before another flag.'
      )
    }
    const target = await scope(ctx, true)
    const accountId = await resolveAccount(ctx, query)
    const result = await call<ForkClaudeMoveResponse>(ctx, 'fork.claudeAccount.move', {
      accountId,
      ...target,
      ...(now === true ? { now: true } : {})
    })
    printResult(result, ctx.json, formatMove)
  }
}
