// Chat handoff (FORK.md, SLRM-2391): the service's ports wired to this process's chat host and
// runtime. A new chat goes through the same create agent launches use, with the handoff as its
// first message; a handoff back goes through the guarded send idle recovery uses, queued behind a
// busy turn. Keep electron out of this file: the headless server bundles it too.
import { randomUUID } from 'node:crypto'
import { createOrcaSessionId } from '../../../shared/agent-session/identity/orca-session-address'
import { createStructuredAgentSessionOperationId } from '../../../shared/agent-session/lifecycle/operations/structured-agent-session-mutation'
import { latestStructuredAgentContextFacts } from '../../../shared/agent-session/conversation-context/structured-agent-session-context-usage'
import { chatHandoffTokens, readChatHandoffSettings } from '../../../shared/fork/chat-handoff'
import type { ChatHandoffSettingsSource } from '../../../shared/fork/chat-handoff'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { chatStatusInTurn } from '../../runtime/orchestration/terminal-authority/release/worker-auto-release-activity'
import { createStructuredAgentSessionForWorktree } from '../../runtime/rpc/methods/structured-sessions/creation/structured-agent-session-create'
import { boundaryCompactionJournalFacts } from '../boundary-compaction/boundary-compaction-host'
import { readChatJournalTail } from '../chat-journal-tail'
import { forkStopChatTurn } from '../chat-host-turn-stop'
import { idleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import { cancelLimitResumeNative } from '../limit-resume/limit-resume-native'
import { assertForkAgentLaunchAllowed } from '../memory-truth/pressure-state'
import { chatHandoffEntriesOf, readChatHandoffRows } from './chat-handoff-entries'
import { ChatHandoffLinks } from './chat-handoff-links'
import { ChatHandoffService, type ChatHandoffPorts } from './chat-handoff-service'

const CALLER_KEY = 'trusted-local:fork-chat-handoff'

/** A new chat goes through the runtime's own create, so the whole runtime is needed. */
export type ChatHandoffRuntime = OrcaRuntimeService

function settingsOf(runtime: ChatHandoffRuntime) {
  try {
    return readChatHandoffSettings(
      runtime.requireStore().getSettings() as unknown as ChatHandoffSettingsSource
    )
  } catch {
    return readChatHandoffSettings(null)
  }
}

async function requireHost(runtime: ChatHandoffRuntime): Promise<StructuredAgentSessionHost> {
  await runtime.ensureStructuredAgentSessionHost()
  const host = getStructuredAgentSessionHost()
  if (!host) {
    throw new Error('This host runs no native chats.')
  }
  return host
}

function livePorts(runtime: ChatHandoffRuntime, links: ChatHandoffLinks): ChatHandoffPorts {
  const host = (): StructuredAgentSessionHost | null => getStructuredAgentSessionHost()
  const chatPort = idleRecoveryChatPort()
  return {
    settings: () => settingsOf(runtime),
    chat: (sessionId) => {
      const live = host()
      const record = live?.deps.store.getRecord(sessionId)
      if (!live || !record) {
        return null
      }
      const summary = live.readStatusSummary(sessionId)
      return {
        sessionId,
        agent: record.provider,
        workspaceId: record.location.workspaceId,
        name: record.conversationName ?? null,
        inTurn: chatStatusInTurn(summary?.status) || summary?.hostExecutionPhase === 'starting',
        limitResumeScheduled: summary?.usageLimitContinue?.state === 'scheduled'
      }
    },
    rows: async (sessionId, after) =>
      readChatHandoffRows(await requireHost(runtime), sessionId, { after }),
    context: async (sessionId) => {
      const tail = await readChatJournalTail(await requireHost(runtime), sessionId)
      const entries = chatHandoffEntriesOf(tail.items, sessionId)
      return {
        windowTokens: latestStructuredAgentContextFacts(tail.items).window?.tokens ?? null,
        usedTokens: boundaryCompactionJournalFacts(tail.items).contextTokens,
        estimatedTokens: entries.reduce((sum, entry) => sum + chatHandoffTokens(entry.text), 0)
      }
    },
    stopTurn: async (sessionId) => {
      const live = host()
      return live ? forkStopChatTurn(live, sessionId, CALLER_KEY) : false
    },
    create: async ({ workspaceId, agent, text, name, focus }) => {
      try {
        assertForkAgentLaunchAllowed()
        const created = await createStructuredAgentSessionForWorktree({
          runtime,
          ensureHost: () => requireHost(runtime),
          caller: { callerKey: CALLER_KEY },
          envelope: {
            sessionId: createOrcaSessionId(randomUUID),
            clientOperationId: createStructuredAgentSessionOperationId(randomUUID),
            expectedRuntimeFence: null,
            payloadFingerprint: ''
          },
          worktree: `id:${workspaceId}`,
          agent,
          atRest: true,
          firstMessage: {
            clientMessageId: randomUUID(),
            body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
          },
          activate: focus
        })
        if (!created.ok) {
          return { ok: false, message: created.refusal.message || created.refusal.code }
        }
        const sessionId = created.value.sessionId
        // The automatic name would come from the handoff text; name it after its source.
        await host()
          ?.setUserConversationName(sessionId, name, 'rename')
          .catch(() => null)
        return { ok: true, sessionId }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
    send: async (sessionId, text) => {
      const facts = chatPort.read(sessionId)
      return facts ? chatPort.send(sessionId, text, facts.fence) : 'refused'
    },
    cancelLimitResume: async (sessionId) => cancelLimitResumeNative(host(), sessionId),
    links,
    now: Date.now
  }
}

let links: Promise<ChatHandoffLinks> | null = null
let cached: { runtime: ChatHandoffRuntime; service: ChatHandoffService } | null = null

async function loadLinks(): Promise<ChatHandoffLinks> {
  if (process.env.VITEST) {
    return new ChatHandoffLinks(null)
  }
  const { getProfileUserDataPath } = await import('../../orca-profiles/profile-storage-paths')
  const loaded = ChatHandoffLinks.at(getProfileUserDataPath())
  await loaded.load()
  return loaded
}

/** The service for this process's chats; one per runtime, sharing the saved links. */
export async function forkChatHandoffService(
  runtime: ChatHandoffRuntime
): Promise<ChatHandoffService> {
  links ??= loadLinks()
  const loaded = await links
  if (cached?.runtime !== runtime) {
    cached = { runtime, service: new ChatHandoffService(livePorts(runtime, loaded)) }
  }
  return cached.service
}

export { requireHost as requireChatHandoffHost, settingsOf as chatHandoffSettingsOf }
