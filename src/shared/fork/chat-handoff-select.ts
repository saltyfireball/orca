// Chat handoff (FORK.md, SLRM-2391): which history a handoff carries and the message that carries
// it. A short chat goes whole. A longer one keeps its original request and as many of its newest
// entries as the budget holds, each with its full text, in order; what lies between is left for
// the new agent to read with `orca chat history`. The person's request is never shortened.
import { chatHandoffAgentLabel, chatHandoffTokens } from './chat-handoff'

/** activity: a tool call or a file edit, cut to one line. handoff: an earlier handoff message. */
export type ChatHandoffEntryRole = 'user' | 'assistant' | 'activity' | 'handoff'

export type ChatHandoffEntry = {
  /** The journal sequence: the entry's number, which `orca chat history --before` takes. */
  seq: number
  role: ChatHandoffEntryRole
  text: string
}

/** First words of every handoff message, so a later handoff shows it as one line. */
export const CHAT_HANDOFF_MARKER = '[Orca handoff]'
/** An activity line or an earlier handoff is cut to this many characters. */
export const CHAT_HANDOFF_ACTIVITY_CHARS = 240
const NAME_CHARS = 120

export function isChatHandoffMessage(text: string): boolean {
  return text.trimStart().startsWith(CHAT_HANDOFF_MARKER)
}

/** Every whitespace run as one space, at most `max` characters, a cut one ending in "...". */
export function compactChatHandoffText(text: string, max = CHAT_HANDOFF_ACTIVITY_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`
}

export function chatHandoffName(name: string | null | undefined, agent: string): string {
  const flat = compactChatHandoffText(name ?? '', NAME_CHARS)
  return flat || `${chatHandoffAgentLabel(agent)} chat`
}

export function historyCommand(sourceId: string, before: number, limit?: number): string {
  return `orca chat history ${sourceId} --before ${before}${limit ? ` --limit ${limit}` : ''}`
}

function formatEntry(entry: ChatHandoffEntry): string {
  const body =
    entry.role === 'activity'
      ? compactChatHandoffText(entry.text)
      : entry.role === 'handoff'
        ? `(an earlier handoff message) ${compactChatHandoffText(entry.text)}`
        : entry.text.trim()
  return `[#${entry.seq} ${entry.role}] ${body}`
}

/** The longest start of `text` within `maxTokens`, never splitting a character. */
function cutToTokens(text: string, maxTokens: number): string {
  let used = 0
  let end = 0
  for (const char of text) {
    const cost = chatHandoffTokens(char)
    if (used + cost > maxTokens) {
      break
    }
    used += cost
    end += char.length
  }
  return text.slice(0, end)
}

function cutLine(entry: ChatHandoffEntry, sourceId: string, maxTokens: number): string {
  const note = ` [cut here; read it whole with: ${historyCommand(sourceId, entry.seq + 1, 1)}]`
  return `${cutToTokens(formatEntry(entry), Math.max(0, maxTokens - chatHandoffTokens(note)))}${note}`
}

export type ChatHandoffSelection = {
  /** The history block: one entry per line group, oldest first. */
  text: string
  tokens: number
  /** How many of the read entries it holds. */
  count: number
  /** The number to pass `--before` to read what was left out, or null when nothing was. */
  omittedBefore: number | null
  /** True when an entry was cut to fit. */
  cut: boolean
}

/**
 * Picks history within `budgetTokens`. `entries` are oldest first; `complete` says they reach the
 * start of the conversation, so the first user entry is its original request and nothing older
 * exists to point at.
 */
export function selectChatHandoffHistory(
  entries: readonly ChatHandoffEntry[],
  budgetTokens: number,
  options: { sourceId: string; complete: boolean }
): ChatHandoffSelection {
  const lines = entries.map(formatEntry)
  const costs = lines.map((line) => chatHandoffTokens(line) + 1)
  const total = costs.reduce((sum, cost) => sum + cost, 0)
  const oldest = entries[0]?.seq ?? null
  if (total <= budgetTokens) {
    return {
      text: lines.join('\n'),
      tokens: total,
      count: entries.length,
      omittedBefore: options.complete ? null : oldest,
      cut: false
    }
  }
  let remaining = budgetTokens
  let cut = false
  const pinned = options.complete ? entries.findIndex((entry) => entry.role === 'user') : -1
  let pinnedLine: string | null = null
  if (pinned >= 0) {
    // The original request takes at most a quarter of the budget.
    const share = Math.floor(budgetTokens / 4)
    pinnedLine =
      costs[pinned] <= share ? lines[pinned] : cutLine(entries[pinned], options.sourceId, share)
    cut ||= pinnedLine !== lines[pinned]
    remaining -= chatHandoffTokens(pinnedLine) + 1
  }
  const recent: string[] = []
  let oldestTaken: number | null = null
  for (let index = entries.length - 1; index > pinned; index -= 1) {
    if (costs[index] <= remaining) {
      recent.unshift(lines[index])
      remaining -= costs[index]
      oldestTaken = index
      continue
    }
    if (recent.length === 0 && remaining > 0) {
      // The newest entry alone is over the budget: it goes cut rather than not at all.
      recent.unshift(cutLine(entries[index], options.sourceId, remaining - 1))
      cut = true
      oldestTaken = index
    }
    break
  }
  const gap = oldestTaken !== null && oldestTaken > pinned + 1
  const omittedBefore = gap || !options.complete ? entries[oldestTaken ?? 0].seq : null
  const parts = [
    ...(pinnedLine !== null ? [pinnedLine] : []),
    ...(gap && pinnedLine !== null ? ['[... older entries left out ...]'] : []),
    ...recent
  ]
  const text = parts.join('\n')
  return {
    text,
    tokens: chatHandoffTokens(text) + 1,
    count: recent.length + (pinnedLine !== null ? 1 : 0),
    omittedBefore,
    cut
  }
}

export type ChatHandoffMessageInput = {
  /** new: a fresh chat takes over. continue: an earlier chat of the work picks it up again. */
  mode: 'new' | 'continue'
  source: { id: string; name: string; agent: string }
  selection: ChatHandoffSelection
  /** The person's request; the default asks the agent to carry on. */
  request?: string
}

export const CHAT_HANDOFF_DEFAULT_REQUEST =
  'Carry on from where the other agent stopped. Check the state of the workspace first (for example git status), since it may have left changes in progress.'

/** The whole first message of a handoff: what it is, how to read more, the history, the request. */
export function buildChatHandoffMessage(input: ChatHandoffMessageInput): string {
  const { source, selection } = input
  const from = chatHandoffAgentLabel(source.agent)
  const intro =
    input.mode === 'new'
      ? `${CHAT_HANDOFF_MARKER} This chat takes over from "${source.name}" (Orca chat ${source.id}), which ran on ${from}. Below is a selection of that chat's history, oldest first.`
      : `${CHAT_HANDOFF_MARKER} The work went on in "${source.name}" (Orca chat ${source.id}) on ${from} after it left this chat. Below is what happened there since, oldest first.`
  const notes = [
    "It is a selection, not a summary: the other agent's reasoning, tool state and attachments did not come with it. Each entry starts with its number.",
    selection.omittedBefore !== null
      ? `Older entries were left out. Read them with \`${historyCommand(source.id, selection.omittedBefore)}\` (20 at a time, newest first); pass an entry's number to --before to read what came before it.`
      : `You can read any entry whole with \`orca chat history ${source.id}\`.`
  ]
  return [
    intro,
    notes.join(' '),
    '',
    `--- History of "${source.name}" ---`,
    selection.text || '(no entries)',
    '--- End of history ---',
    '',
    input.request?.trim() || CHAT_HANDOFF_DEFAULT_REQUEST
  ].join('\n')
}
