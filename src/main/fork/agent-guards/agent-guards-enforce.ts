// Agent guards (FORK.md, BAD-679 "Spend caps for every agent"): pausing an agent at the first
// spend cap it reached, and a whole Run when the cap is the Run's. The engine passes in its lanes
// and its pause.
import type { AgentGuardLimit } from '../../../shared/fork/agent-guards'
import type { AgentGuardLimits } from './agent-guards-limits'
import type { AgentGuardPause } from './agent-guards-state'
import type { AgentGuardAgentMeta, AgentGuardEngineDeps, AgentGuardRun } from './agent-guards-types'

export type AgentGuardEnforceHost = {
  deps: AgentGuardEngineDeps
  caps: AgentGuardLimits
  isPaused: (id: string) => boolean
  metaOf: (id: string) => AgentGuardAgentMeta
  lane: (id: string, task: () => Promise<void>) => Promise<void>
  pause: (id: string, meta: AgentGuardAgentMeta, pause: AgentGuardPause) => Promise<void>
}

/**
 * Pauses the agent at the first cap that covers it and is reached. `interrupt` stops a terminal
 * agent first (the polite Esc); a chat is only checked between turns, so needs no stop.
 */
export async function enforceAgentGuardSpend(
  host: AgentGuardEnforceHost,
  id: string,
  interrupt: boolean
): Promise<void> {
  const { limits, run } = host.caps.of(id)
  const hit = limits.find((limit) => limit.spentUsd >= limit.capUsd)
  if (!hit) {
    return
  }
  const meta = host.metaOf(id)
  const stopped = interrupt ? await host.deps.ports.stopTerminal(id, meta.agent) : true
  await host.pause(id, meta, {
    reason: 'spend',
    at: host.deps.now(),
    capUsd: hit.capUsd,
    spentUsd: hit.spentUsd,
    scope: hit.scope,
    ...(stopped ? {} : { notInterrupted: true })
  })
  if (hit.scope === 'run' && run) {
    await pauseRunMembers(host, id, run, hit)
  }
}

/** A Run past its cap: every other member resting is paused now; one in a turn is at its turn's end. */
async function pauseRunMembers(
  host: AgentGuardEnforceHost,
  from: string,
  run: AgentGuardRun,
  hit: AgentGuardLimit
): Promise<void> {
  for (const member of run.memberIds) {
    if (member === from || host.isPaused(member)) {
      continue
    }
    await host.lane(member, async () => {
      const meta = host.metaOf(member)
      if (host.isPaused(member) || (meta.kind === 'chat' && host.deps.ports.chatInTurn(member))) {
        return
      }
      await host.pause(member, meta, {
        reason: 'spend',
        at: host.deps.now(),
        capUsd: hit.capUsd,
        spentUsd: hit.spentUsd,
        scope: 'run'
      })
    })
  }
}
