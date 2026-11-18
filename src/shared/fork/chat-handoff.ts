// Chat handoff (FORK.md, SLRM-2391): move a native chat from Claude to Codex or back. The new
// agent gets a budgeted selection of the chat's history (not a summary) and reads older entries
// with `orca chat history`. Handing back to a chat the work came from continues that chat when its
// context has room, else a fresh chat starts. Design from T3 Code's portable handoffs (MIT); only
// the ideas are ported. This file holds the settings and the budget arithmetic.
import type { ForkGlobalSettings } from './fork-global-settings'
import type { LimitResumeEntry } from './limit-resume'

export const CHAT_HANDOFF_AGENTS = ['claude', 'codex'] as const
export type ChatHandoffAgent = (typeof CHAT_HANDOFF_AGENTS)[number]

export const CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS = 16_000
export const CHAT_HANDOFF_MIN_BUDGET_TOKENS = 1_024
export const CHAT_HANDOFF_MAX_BUDGET_TOKENS = 64_000
/** The window assumed when the chat never reported one. */
export const CHAT_HANDOFF_FALLBACK_WINDOW_TOKENS = 128_000
/** Room kept for instructions, tools and the work that follows: this, or a quarter of the window. */
export const CHAT_HANDOFF_MIN_RESERVE_TOKENS = 16_000
/** The longest request a handoff carries beside the history; it is never shortened. */
export const CHAT_HANDOFF_MAX_REQUEST_CHARS = 20_000

/**
 * - off: a usage limit does nothing more than limit resume does.
 * - offer: a toast offers to hand the chat to the other agent.
 * - auto: the chat is handed off at once and its resume at the reset is cancelled.
 */
export type ChatHandoffOnLimit = 'off' | 'offer' | 'auto'

export type ChatHandoffSettings = {
  enabled: boolean
  budgetTokens: number
  reuse: boolean
  onLimit: ChatHandoffOnLimit
}

type SettingKey = keyof Pick<
  ForkGlobalSettings,
  | 'forkChatHandoff'
  | 'forkChatHandoffBudgetTokens'
  | 'forkChatHandoffReuse'
  | 'forkChatHandoffOnLimit'
>

/** Any settings object; values are checked here, so a hand-edited file cannot break a reader. */
export type ChatHandoffSettingsSource = Partial<Record<SettingKey, unknown>> | null | undefined

export function readChatHandoffSettings(settings: ChatHandoffSettingsSource): ChatHandoffSettings {
  const budget = settings?.forkChatHandoffBudgetTokens
  const onLimit = settings?.forkChatHandoffOnLimit
  return {
    enabled: settings?.forkChatHandoff !== false,
    budgetTokens:
      typeof budget === 'number' && Number.isInteger(budget)
        ? Math.min(CHAT_HANDOFF_MAX_BUDGET_TOKENS, Math.max(CHAT_HANDOFF_MIN_BUDGET_TOKENS, budget))
        : CHAT_HANDOFF_DEFAULT_BUDGET_TOKENS,
    reuse: settings?.forkChatHandoffReuse !== false,
    onLimit: onLimit === 'off' || onLimit === 'auto' ? onLimit : 'offer'
  }
}

export function isChatHandoffAgent(value: unknown): value is ChatHandoffAgent {
  return value === 'claude' || value === 'codex'
}

/** The agent a chat of `agent` hands off to by default; null for agents a handoff does not know. */
export function otherChatHandoffAgent(agent: string): ChatHandoffAgent | null {
  return agent === 'claude' ? 'codex' : agent === 'codex' ? 'claude' : null
}

export function chatHandoffAgentLabel(agent: string): string {
  return agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude' : agent
}

const encoder = new TextEncoder()

/** Tokens charged for text: one per UTF-8 byte, which never undercounts. */
export function chatHandoffTokens(text: string): number {
  return encoder.encode(text).length
}

export function chatHandoffReserveTokens(windowTokens: number): number {
  return Math.max(CHAT_HANDOFF_MIN_RESERVE_TOKENS, Math.floor(windowTokens / 4))
}

/**
 * Tokens of history a chat can still take: its window less what it holds and the reserve. A
 * window it never reported is taken as 128k; what it holds, when unknown, as `estimatedUsed`.
 */
export function chatHandoffRoom(input: {
  windowTokens: number | null
  usedTokens: number | null
  estimatedUsed: number
}): number {
  const window =
    input.windowTokens !== null && input.windowTokens > 0
      ? input.windowTokens
      : CHAT_HANDOFF_FALLBACK_WINDOW_TOKENS
  const used = input.usedTokens ?? input.estimatedUsed
  return Math.max(0, window - used - chatHandoffReserveTokens(window))
}

/** One key per usage limit stop: the same chat stopping again at a later reset is a new stop. */
export function chatHandoffLimitKey(entry: LimitResumeEntry): string {
  return `${entry.sessionId ?? entry.id}:${entry.resetsAt ?? entry.resumeAt}`
}

/** The agent a parked native chat can be handed to, or null when it is not one to offer. */
export function chatHandoffLimitTarget(entry: LimitResumeEntry): ChatHandoffAgent | null {
  return entry.kind === 'chat' && entry.state === 'parked' && entry.sessionId
    ? otherChatHandoffAgent(entry.agent)
    : null
}
