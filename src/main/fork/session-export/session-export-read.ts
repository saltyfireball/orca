// Session export (FORK.md, BAD-688): reads one chat or terminal agent's conversation as an export
// document. A chat is read from its journal through the page reader every client uses (its own
// requests and answers in full, tool calls and edits as one line each); a terminal agent through
// the same transcript reader `orca agent read` uses. Reading never starts or wakes an agent.
import { homedir } from 'node:os'
import { AGENT_CONVERSATION_REFUSAL_CODES as CODES } from '../../../shared/agent-conversations/agent-conversation-contracts'
import type { AgentReadEntry } from '../../../shared/agent-conversations/agent-conversation-contracts'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { chatHandoffName } from '../../../shared/fork/chat-handoff-select'
import {
  limitSessionExportEntries,
  readSessionExportSettings,
  type SessionExportDocument,
  type SessionExportEntry,
  type SessionExportSettingsSource
} from '../../../shared/fork/session-export/session-export'
import { tuiAgentDisplayName } from '../../../shared/agent-launch/catalog/tui-agent-display-names'
import { resolveAgentConversation } from '../../runtime/agent-conversations/agent-conversation-address'
import { AgentConversationRefusal } from '../../runtime/agent-conversations/agent-conversation-refusal'
import { readAgentConversation } from '../../runtime/agent-conversations/agent-conversation-read'
import { resolveLineageRunningSession } from '../../runtime/orchestration/addressing/session-lineage/structured-session-lineage'
import type { RpcContext } from '../../runtime/rpc/core'
import {
  ensureStructuredHostInstalled,
  requireStructuredAgentAudience
} from '../../runtime/rpc/methods/structured-sessions/creation/structured-agent-session-gate'
import { chatHandoffEntryOf, readChatHandoffRows } from '../chat-handoff/chat-handoff-entries'
import { requireChatHandoffHost } from '../chat-handoff/chat-handoff-host'

/** `orca agent read` returns at most this many entries of a terminal agent. */
const TERMINAL_READ_LIMIT = 100

/** Journal rows as entries, oldest first; rows an export leaves out (status frames) are dropped. */
export function chatExportEntries(items: readonly AgentJournalRenderItem[]): SessionExportEntry[] {
  const entries: SessionExportEntry[] = []
  for (const item of items) {
    const entry = chatHandoffEntryOf(item)
    if (entry) {
      entries.push({ role: entry.role === 'handoff' ? 'system' : entry.role, text: entry.text })
    }
  }
  return entries
}

/** `agent read` entries as export entries: tool calls fold into activity lines after their message. */
export function agentReadExportEntries(entries: readonly AgentReadEntry[]): SessionExportEntry[] {
  const out: SessionExportEntry[] = []
  const tool = (name: string, state?: string): SessionExportEntry => ({
    role: 'activity',
    text: state ? `${name} -> ${state}` : name
  })
  for (const entry of entries) {
    if (entry.kind === 'message') {
      if (entry.text) {
        out.push({
          role: entry.role === 'user' || entry.role === 'assistant' ? entry.role : 'system',
          text: entry.text
        })
      }
      out.push(...(entry.tools ?? []).map((call) => tool(call.name, call.state)))
    } else if (entry.kind === 'tool') {
      out.push(tool(entry.name, entry.state))
    } else if (entry.kind === 'error') {
      out.push({ role: 'system', text: `Error: ${entry.text}` })
    }
  }
  return out
}

export async function readSessionExport(
  ctx: RpcContext,
  id: string
): Promise<SessionExportDocument> {
  const settings = readSessionExportSettings(
    (() => {
      try {
        return ctx.runtime.requireStore().getSettings() as unknown as SessionExportSettingsSource
      } catch {
        return null
      }
    })()
  )
  const resolved = await resolveAgentConversation(ctx.runtime, id)
  const homeDirs = [homedir()]
  if (resolved.kind === 'terminal') {
    const read = await readAgentConversation(ctx, resolved, { limit: TERMINAL_READ_LIMIT })
    const limited = limitSessionExportEntries(agentReadExportEntries(read.entries), settings)
    return {
      id,
      kind: 'terminal',
      agent: read.agent,
      title: `${(read.agent && tuiAgentDisplayName(read.agent)) || read.agent || 'Agent'} session`,
      entries: limited.entries,
      truncated: read.limited || limited.cut,
      homeDirs
    }
  }
  const { record, store, orcaSessionId } = resolved
  requireStructuredAgentAudience(ctx, record.provider)
  const running = resolveLineageRunningSession(store, record.sessionId)
  if (running.kind !== 'here') {
    throw new AgentConversationRefusal(
      CODES.unavailable,
      `Agent ${orcaSessionId} runs on another host or its current conversation cannot be verified. Export it there, or add \`--environment <host>\`.`
    )
  }
  await ensureStructuredHostInstalled(ctx)
  const host = await requireChatHandoffHost(ctx.runtime)
  const rows = await readChatHandoffRows(host, running.sessionId)
  const limited = limitSessionExportEntries(chatExportEntries(rows.items), settings)
  const stored = host.deps.store.getRecord(running.sessionId)
  return {
    id,
    kind: 'chat',
    agent: record.provider,
    title: chatHandoffName(stored?.conversationName, record.provider),
    entries: limited.entries,
    truncated: !rows.complete || limited.cut,
    homeDirs
  }
}
