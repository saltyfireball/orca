// Agent guards (FORK.md, SLRM-2385): sending a loop episode's one warning. Under Pause all (BAD-818,
// FORK.md "Pause all") the ports hold a warning that would start a turn; it waits here and goes once
// at resume-all, in its agent's lane, while its loop is still the newest the track saw and not yet
// warned.
import {
  AGENT_GUARD_LOOP_MESSAGE,
  agentGuardLabel,
  noteAgentGuardWarned,
  type AgentGuardLoopTrack
} from '../../../shared/fork/agent-guards'
import type { AgentGuardWarned } from './agent-guards-entries'
import type { AgentGuardAgentMeta, AgentGuardEngineDeps } from './agent-guards-types'

export type AgentGuardWarnAction = { signature: string; count: number; tool: string }

export type AgentGuardWarnings = {
  send: (
    id: string,
    meta: AgentGuardAgentMeta,
    track: AgentGuardLoopTrack,
    action: AgentGuardWarnAction
  ) => Promise<void>
}

/** Whether a held warning still applies: no progress or warning has ended its episode since. */
function stillApplies(
  track: AgentGuardLoopTrack | undefined,
  action: AgentGuardWarnAction
): track is AgentGuardLoopTrack {
  return Boolean(
    track && track.warned === null && (track.runs[action.signature] ?? 0) >= action.count
  )
}

/** The engine's warnings. `liveTrack` is the track a held warning may still go to: none once the
 *  loop guard is off or the agent is paused. */
export function agentGuardWarnings(
  deps: Pick<AgentGuardEngineDeps, 'ports' | 'now' | 'changed'>,
  warned: Map<string, AgentGuardWarned>,
  lane: (id: string, task: () => Promise<void>) => Promise<void>,
  liveTrack: (id: string) => AgentGuardLoopTrack | undefined
): AgentGuardWarnings {
  const held = new Map<string, { meta: AgentGuardAgentMeta; action: AgentGuardWarnAction }>()
  const send: AgentGuardWarnings['send'] = async (id, meta, track, action) => {
    const sent =
      meta.kind === 'chat'
        ? await deps.ports.warnChat(id, AGENT_GUARD_LOOP_MESSAGE)
        : await deps.ports.warnTerminal(id, meta.agent, AGENT_GUARD_LOOP_MESSAGE)
    if (sent === 'held') {
      held.set(id, { meta, action })
      return
    }
    held.delete(id)
    if (sent === 'refused') {
      return
    }
    // A send that may have arrived counts as sent: the note never goes twice.
    noteAgentGuardWarned(track, action, deps.now())
    warned.set(id, { since: deps.now(), repeats: action.count, tool: agentGuardLabel(action.tool) })
    deps.changed()
  }
  deps.ports.onPauseAllReleased?.(() => {
    for (const [id, { meta, action }] of held) {
      void lane(id, async () => {
        const track = liveTrack(id)
        if (!stillApplies(track, action)) {
          held.delete(id)
          return
        }
        await send(id, meta, track, action)
      })
    }
  })
  return { send }
}
