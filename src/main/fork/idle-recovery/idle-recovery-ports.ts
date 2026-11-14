// Idle recovery (FORK.md), item D: how the wake rules read and reach this host's chats. The rules
// in `idle-recovery-wake.ts` see only these two ports, so they are tested without a chat host or
// a runtime. Every send goes through `sendAgentTurn`, the app's normal send.
import { randomUUID } from 'node:crypto'
import { isTuiAgent } from '../../../shared/agent-launch/catalog/tui-agent-config'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { AgentSessionPreDispatchError } from '../../native-chat/agent-session-wire/operations/structured-agent-session-operation-settlement'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { chatStatusInTurn } from '../../runtime/orchestration/terminal-authority/release/worker-auto-release-activity'
import { sendAgentTurn } from '../../runtime/orchestration/turn-delivery/send-agent-turn'
import type { AgentPromptExpectedBinding } from '../../runtime/terminal/input/agent-prompt-write-options'
import {
  createLaunchedAgentWriteGuard,
  type LaunchedAgentWriteGuardRuntime
} from '../../runtime/terminal/wait/launched-agent-write-guard'

const CALLER_KEY = 'trusted-local:fork-idle-recovery'
/** How long a chat send waits for the agent to take the message before it reads as pending. */
const CHAT_SEND_BUDGET_MS = 20_000
/** Rows of the rendered screen read to look for typed text in the composer. */
const SCREEN_ROWS = 80

/**
 * - sent: the chat took the message.
 * - queued: the chat was in a turn and holds the message as a card.
 * - refused: nothing was sent.
 * - unknown: the send failed after it may have reached the chat.
 */
export type IdleRecoverySendOutcome = 'sent' | 'queued' | 'refused' | 'unknown'

export type IdleRecoveryChatFacts = {
  fence: number
  /** False for a sleeping or hibernated chat: its agent process is not running here. */
  loaded: boolean
  /** Working, waiting on a prompt, or still starting. */
  inTurn: boolean
}

export type IdleRecoveryChatPort = {
  /** Null when this host has no such chat. */
  read: (sessionId: string) => IdleRecoveryChatFacts | null
  /** `stillIdle` runs inside the host's send, right before the message goes: false refuses it. */
  send: (
    sessionId: string,
    text: string,
    fence: number,
    stillIdle?: () => boolean
  ) => Promise<IdleRecoverySendOutcome>
}

export type IdleRecoveryTerminalBinding = { handle: string; binding: AgentPromptExpectedBinding }

export type IdleRecoveryTerminalPort = {
  /** Null when the pane has no live terminal (closed, or asleep). */
  bind: (paneKey: string) => IdleRecoveryTerminalBinding | null
  /**
   * Why nothing may be typed into the terminal now, or null when it rests at an empty prompt.
   * With `untouchedSince` (epoch ms), keys the user typed there after that time refuse it too.
   */
  refusal: (paneKey: string, handle: string, untouchedSince?: number) => Promise<string | null>
  /** `stillClear` runs right before the first write: false refuses it. */
  send: (
    bound: IdleRecoveryTerminalBinding,
    agent: string,
    text: string,
    stillClear: () => Promise<boolean>
  ) => Promise<IdleRecoverySendOutcome>
}

export type IdleRecoveryPorts = { chat: IdleRecoveryChatPort; terminal: IdleRecoveryTerminalPort }

export type IdleRecoveryChatHost = Pick<
  StructuredAgentSessionHost,
  'send' | 'waitForSendSettlement' | 'readStatusSummary' | 'loadedSessionIds' | 'deps'
>

export function idleRecoveryChatPort(
  getHost: () => IdleRecoveryChatHost | null = getStructuredAgentSessionHost
): IdleRecoveryChatPort {
  return {
    read: (sessionId) => {
      const host = getHost()
      const record = host?.deps.store.getRecord(sessionId)
      if (!host || !record) {
        return null
      }
      const summary = host.readStatusSummary(sessionId)
      return {
        fence: record.lease.runtimeFence,
        loaded: host.loadedSessionIds().includes(sessionId),
        inTurn: chatStatusInTurn(summary?.status) || summary?.hostExecutionPhase === 'starting'
      }
    },
    send: async (sessionId, text, fence, stillIdle) => {
      const host = getHost()
      if (!host) {
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
            expectedRuntimeFence: fence,
            // Never steers a running turn: a chat that got busy holds the message as a card.
            delivery: 'queue',
            ...(stillIdle
              ? {
                  beforeRun: () => {
                    if (!stillIdle()) {
                      throw new AgentSessionPreDispatchError('idle_recovery_chat_not_idle')
                    }
                  }
                }
              : {})
          }
        })
        return outcome.kind
      } catch (error) {
        // Only a pre-dispatch error proves the message never left.
        return error instanceof AgentSessionPreDispatchError ? 'refused' : 'unknown'
      }
    }
  }
}

export type IdleRecoveryTerminalRuntime = Pick<
  OrcaRuntimeService,
  | 'getTerminalHandleForPaneKey'
  | 'getTerminalPromptRequestBinding'
  | 'sendTerminalAgentPrompt'
  | 'readTerminalMailHold'
  | 'readTerminal'
  | 'isWorkerAgentInTurn'
  | 'terminalRunFacts'
> &
  LaunchedAgentWriteGuardRuntime

let terminalRuntime: () => IdleRecoveryTerminalRuntime | null = () => null

/** Hands the terminal port this process's runtime; the service does it at start-up. */
export function setIdleRecoveryTerminalRuntime(
  read: () => IdleRecoveryTerminalRuntime | null | undefined
): void {
  terminalRuntime = () => read() ?? null
}

export function idleRecoveryTerminalPort(
  getRuntime: () => IdleRecoveryTerminalRuntime | null = () => terminalRuntime()
): IdleRecoveryTerminalPort {
  return {
    bind: (paneKey) => {
      const runtime = getRuntime()
      try {
        const handle = runtime?.getTerminalHandleForPaneKey(paneKey)
        if (!runtime || !handle) {
          return null
        }
        const { ptyId, processIncarnation } = runtime.getTerminalPromptRequestBinding(handle)
        return { handle, binding: { ptyId, processIncarnation } }
      } catch {
        return null
      }
    },
    refusal: async (paneKey, handle, untouchedSince) => {
      const runtime = getRuntime()
      if (!runtime) {
        return 'no-runtime'
      }
      try {
        if (runtime.isWorkerAgentInTurn({ pane_key: paneKey, terminal_handle: handle })) {
          return 'in-turn'
        }
        if (untouchedSince !== undefined) {
          // Typed keys may sit in a composer the screen reader does not know: leave it to the user.
          const { ptyId } = runtime.getTerminalPromptRequestBinding(handle)
          const typedAt = runtime.terminalRunFacts.readLastDrivingInputAt(ptyId)
          if (typedAt !== null && typedAt > untouchedSince) {
            return 'typed-since-idle'
          }
        }
        // The gate orchestration mail uses: a dialog, a draft, a restoring or unsettled screen.
        const hold = runtime.readTerminalMailHold(handle)
        if (hold) {
          return hold.kind
        }
        // That gate forgets a draft after ten minutes; the screen itself never does.
        const screen = await runtime.readTerminal(handle, { screen: true, limit: SCREEN_ROWS })
        if (screen.source !== 'screen') {
          return 'screen-unreadable'
        }
        return screen.draft?.trim() ? 'draft' : null
      } catch {
        return 'unreadable'
      }
    },
    send: async (bound, agent, text, stillClear) => {
      const runtime = getRuntime()
      if (!runtime || !isTuiAgent(agent)) {
        return 'refused'
      }
      // Writes only on proof that the agent, not a shell, reads the terminal.
      const guard = createLaunchedAgentWriteGuard(runtime, agent, { unprovableHost: 'refuse' })
      let writes = 0
      try {
        const receipt = await sendAgentTurn({
          kind: 'terminal',
          runtime,
          handle: bound.handle,
          turn: { purpose: 'external-message', body: text, operationId: randomUUID() },
          expectedBinding: bound.binding,
          beforeWrite: async (ptyId) => {
            await guard.beforeWrite(ptyId)
            // The second write is Enter: by then the composer holds this message, not a draft.
            if (writes === 0 && !(await stillClear())) {
              throw new Error('idle_recovery_terminal_not_clear')
            }
            writes += 1
          }
        })
        return receipt.accepted ? 'sent' : 'refused'
      } catch {
        // Once the first write was admitted the text may be in the terminal: never send it twice.
        return writes === 0 ? 'refused' : 'unknown'
      } finally {
        guard.dispose()
      }
    }
  }
}

let installed: IdleRecoveryPorts | null = null

export function idleRecoveryPorts(): IdleRecoveryPorts {
  installed ??= { chat: idleRecoveryChatPort(), terminal: idleRecoveryTerminalPort() }
  return installed
}
