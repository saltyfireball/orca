// Agent guards (FORK.md, SLRM-2385): how a guard reaches an agent, wired to this process. The
// service sees only `AgentGuardActPorts`, so its rules are tested without a chat host or terminal.
// - A chat's warning is steered into its running turn through the app's normal send.
// - A chat is paused through its host's own cancel, the Stop button's path, which also holds its
//   queued messages as the Stop button does.
// - A terminal agent's warning is typed like orchestration mail, only when no dialog or draft is
//   up; it is paused with Esc, only on proof that the agent (not a shell) reads the terminal.
// Keep electron out of this file: the headless server bundles it too.
import { randomUUID } from 'node:crypto'
import { isTuiAgent } from '../../../shared/agent-launch/catalog/tui-agent-config'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { AgentSessionPreDispatchError } from '../../native-chat/agent-session-wire/operations/structured-agent-session-operation-settlement'
import { chatStatusInTurn } from '../../runtime/orchestration/terminal-authority/release/worker-auto-release-activity'
import { sendAgentTurn } from '../../runtime/orchestration/turn-delivery/send-agent-turn'
import { createLaunchedAgentWriteGuard } from '../../runtime/terminal/wait/launched-agent-write-guard'
import { forkStopChatTurn } from '../chat-host-turn-stop'
import { readChatJournalTail } from '../chat-journal-tail'
import { idleRecoveryTerminalPort } from '../idle-recovery/idle-recovery-ports'
import type { LimitResumeRuntime } from '../limit-resume/limit-resume-host'

const CALLER_KEY = 'trusted-local:fork-agent-guards'
const CHAT_SEND_BUDGET_MS = 20_000

export type AgentGuardSendOutcome = 'sent' | 'refused' | 'unknown'

export type AgentGuardActPorts = {
  /** Null when this host has no such chat. */
  chatInTurn: (sessionId: string) => boolean | null
  chatTail: (sessionId: string) => Promise<readonly AgentJournalRenderItem[]>
  warnChat: (sessionId: string, text: string) => Promise<AgentGuardSendOutcome>
  /** True when the host took the cancel. */
  stopChat: (sessionId: string) => Promise<boolean>
  warnTerminal: (paneKey: string, agent: string, text: string) => Promise<AgentGuardSendOutcome>
  /** True when Esc went to the agent. */
  stopTerminal: (paneKey: string, agent: string) => Promise<boolean>
}

export function liveAgentGuardActPorts(
  runtime: () => LimitResumeRuntime | null
): AgentGuardActPorts {
  const terminal = idleRecoveryTerminalPort(runtime)
  return {
    chatInTurn: (sessionId) => {
      const host = getStructuredAgentSessionHost()
      if (!host?.deps.store.getRecord(sessionId)) {
        return null
      }
      const summary = host.readStatusSummary(sessionId)
      return chatStatusInTurn(summary?.status) || summary?.hostExecutionPhase === 'starting'
    },
    chatTail: async (sessionId) => {
      const host = getStructuredAgentSessionHost()
      return host ? (await readChatJournalTail(host, sessionId)).items : []
    },
    warnChat: async (sessionId, text) => {
      const host = getStructuredAgentSessionHost()
      const record = host?.deps.store.getRecord(sessionId)
      if (!host || !record) {
        return 'refused'
      }
      try {
        const outcome = await sendAgentTurn({
          kind: 'structured-session',
          host,
          sessionId,
          callerKey: CALLER_KEY,
          budgetMs: CHAT_SEND_BUDGET_MS,
          turn: {
            body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] },
            operationId: `${String(Date.now()).padStart(13, '0')}-${randomUUID().replaceAll('-', '')}`,
            expectedRuntimeFence: record.lease.runtimeFence,
            // Into the running turn, where the agent is retrying; a chat at rest takes it as a turn.
            delivery: 'now'
          }
        })
        return outcome.kind === 'refused' ? 'refused' : 'sent'
      } catch (error) {
        return error instanceof AgentSessionPreDispatchError ? 'refused' : 'unknown'
      }
    },
    stopChat: async (sessionId) => {
      const host = getStructuredAgentSessionHost()
      return host ? forkStopChatTurn(host, sessionId, CALLER_KEY) : false
    },
    warnTerminal: async (paneKey, agent, text) => {
      const live = runtime()
      const bound = terminal.bind(paneKey)
      if (!live || !bound) {
        return 'refused'
      }
      // The gate orchestration mail uses: never typed over a dialog or a draft.
      const clear = async (): Promise<boolean> => {
        try {
          return live.readTerminalMailHold(bound.handle) === null
        } catch {
          return false
        }
      }
      if (!(await clear())) {
        return 'refused'
      }
      const outcome = await terminal.send(bound, agent, text, clear)
      return outcome === 'queued' ? 'sent' : outcome
    },
    stopTerminal: async (paneKey, agent) => {
      const live = runtime()
      const bound = terminal.bind(paneKey)
      if (!live || !bound || !isTuiAgent(agent)) {
        return false
      }
      try {
        // Esc on a dialog would answer it: leave an agent that asks something to the person.
        const hold = live.readTerminalMailHold(bound.handle)?.kind
        if (hold === 'prompt' || hold === 'overlay') {
          return false
        }
      } catch {
        return false
      }
      const guard = createLaunchedAgentWriteGuard(live, agent, { unprovableHost: 'refuse' })
      try {
        const sent = await live.sendTerminal(
          bound.handle,
          { text: '\x1b', enter: false },
          { inputKind: 'orchestration', beforeWrite: (ptyId) => guard.beforeWrite(ptyId) }
        )
        return sent.accepted
      } catch {
        return false
      } finally {
        guard.dispose()
      }
    }
  }
}
