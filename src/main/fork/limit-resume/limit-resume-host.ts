// Limit resume (FORK.md, SLRM-2309): the sweep's ports wired to this process's runtime. Rows come
// from `worktree.ps`; screens, refusals and sends go through idle recovery's terminal port, which
// writes only after proving the agent (not a shell) reads the terminal and nothing is typed or
// asked there. Keep electron out of this file: the headless server bundles it too.
import { isForkAgentGuardHeld } from '../agent-guards/agent-guards-holds'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host/execution-host'
import { sleeperChatSessionId, sleeperTitle } from '../../../shared/fork/sleepers-ps-sources'
import { isTuiAgent } from '../../../shared/agent-launch/catalog/tui-agent-config'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { createLaunchedAgentWriteGuard } from '../../runtime/terminal/wait/launched-agent-write-guard'
import {
  idleRecoveryTerminalPort,
  type IdleRecoveryTerminalRuntime
} from '../idle-recovery/idle-recovery-ports'
import type { LimitResumeChatRow } from './limit-resume-native'
import type { LimitResumePorts, LimitResumeTerminalRow } from './limit-resume-sweep'

/** The agents whose limit messages the reader knows. */
export const LIMIT_RESUME_AGENTS: readonly string[] = ['claude', 'codex']
/** Rows of the rendered screen read; the reader looks at the bottom of them. */
const SCREEN_ROWS = 60

export type LimitResumeRuntime = IdleRecoveryTerminalRuntime &
  Pick<OrcaRuntimeService, 'getWorktreePs' | 'sendTerminal'>

export type LimitResumeRows = {
  terminals: LimitResumeTerminalRow[]
  /** Native chat rows by session id, for the names `orca limits list` shows. */
  chats: Map<string, LimitResumeChatRow>
}

export async function readLimitResumeRows(runtime: LimitResumeRuntime): Promise<LimitResumeRows> {
  const terminals: LimitResumeTerminalRow[] = []
  const chats = new Map<string, LimitResumeChatRow>()
  for (const worktree of (await runtime.getWorktreePs()).worktrees) {
    // Only this host's own terminals: a paired server runs its own sweep.
    if (worktree.hostId && worktree.hostId !== LOCAL_EXECUTION_HOST_ID) {
      continue
    }
    for (const row of worktree.agents ?? []) {
      const title = sleeperTitle(row)
      const sessionId = sleeperChatSessionId(row.paneKey)
      if (sessionId) {
        chats.set(sessionId, { paneKey: row.paneKey, worktreeId: worktree.worktreeId, title })
        continue
      }
      if (
        !row.agentType ||
        !LIMIT_RESUME_AGENTS.includes(row.agentType) ||
        row.hasLivePty !== true ||
        // SLRM-2385: an agent a guard paused waits for a person.
        isForkAgentGuardHeld(row.paneKey)
      ) {
        continue
      }
      terminals.push({
        paneKey: row.paneKey,
        worktreeId: worktree.worktreeId,
        agent: row.agentType,
        title,
        working: row.state === 'working',
        updatedAt: row.updatedAt
      })
    }
  }
  return { terminals, chats }
}

export function liveLimitResumePorts(
  runtime: () => LimitResumeRuntime | null,
  rows: () => Promise<readonly LimitResumeTerminalRow[]>
): LimitResumePorts {
  const port = idleRecoveryTerminalPort(runtime)
  return {
    rows,
    screen: async (paneKey) => {
      const bound = port.bind(paneKey)
      const live = runtime()
      if (!bound || !live) {
        return null
      }
      try {
        const read = await live.readTerminal(bound.handle, { screen: true, limit: SCREEN_ROWS })
        return read.source === 'screen' ? read.tail : null
      } catch {
        return null
      }
    },
    refusal: async (paneKey, untouchedSince) => {
      const bound = port.bind(paneKey)
      return bound ? port.refusal(paneKey, bound.handle, untouchedSince) : 'no-terminal'
    },
    send: async (paneKey, agent, text, untouchedSince) => {
      const bound = port.bind(paneKey)
      if (!bound) {
        return 'refused'
      }
      const outcome = await port.send(
        bound,
        agent,
        text,
        async () => (await port.refusal(paneKey, bound.handle, untouchedSince)) === null
      )
      return outcome === 'queued' ? 'sent' : outcome
    },
    dismissSwitchPrompt: async (paneKey, agent) => {
      const live = runtime()
      const bound = port.bind(paneKey)
      if (!live || !bound || !isTuiAgent(agent)) {
        return 'refused'
      }
      // Writes only on proof that the agent, not a shell, reads the terminal.
      const guard = createLaunchedAgentWriteGuard(live, agent, { unprovableHost: 'refuse' })
      let admitted = false
      try {
        const sent = await live.sendTerminal(
          bound.handle,
          { text: '\x1b', enter: false },
          {
            inputKind: 'orchestration',
            beforeWrite: async (ptyId) => {
              await guard.beforeWrite(ptyId)
              admitted = true
            }
          }
        )
        return sent.accepted ? 'sent' : 'refused'
      } catch {
        return admitted ? 'unknown' : 'refused'
      } finally {
        guard.dispose()
      }
    }
  }
}
