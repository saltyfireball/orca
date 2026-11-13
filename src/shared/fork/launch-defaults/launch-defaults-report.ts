// Fork launch defaults: what each kind of launch runs per agent, for `orca launch-defaults`.
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import type { AgentLaunchChoices } from '../../agent-launch/choices/agent-launch-choices'
import { forkLaunchDefaultAgents } from './launch-defaults-choices'
import { resolveForkLaunchChoice } from './launch-defaults-resolve'
import { FORK_LAUNCH_KINDS, type ForkLaunchReportKind } from './launch-defaults-settings'

export type ForkLaunchDefaultsRow = {
  kind: ForkLaunchReportKind
  agent: TuiAgent
  /** Absent: the agent runs the model from its own config. */
  model?: string
  effort?: string
  /** fork-default: Settings > Advanced > Launch defaults. stock: Settings > Agents, or the agent. */
  source: 'fork-default' | 'stock'
  note?: string
}

export type ForkLaunchDefaultsReport = { rows: ForkLaunchDefaultsRow[] }

function stock(
  kind: ForkLaunchReportKind,
  agent: TuiAgent,
  choices: AgentLaunchChoices | undefined,
  note?: string
): ForkLaunchDefaultsRow {
  const app = choices?.[agent]
  const effort = app?.options?.effort
  return {
    kind,
    agent,
    source: 'stock',
    ...(app?.model ? { model: app.model } : {}),
    ...(effort ? { effort } : {}),
    ...(note ? { note } : {})
  }
}

export function buildForkLaunchDefaultsReport(settings: {
  forkLaunchDefaults?: unknown
  agentLaunchChoices?: AgentLaunchChoices
}): ForkLaunchDefaultsReport {
  const rows: ForkLaunchDefaultsRow[] = []
  for (const agent of forkLaunchDefaultAgents()) {
    rows.push(stock('interactive', agent, settings.agentLaunchChoices))
    for (const kind of FORK_LAUNCH_KINDS) {
      const choice = resolveForkLaunchChoice({
        settings: settings.forkLaunchDefaults,
        kind,
        agent
      })
      rows.push(
        choice.source === 'fork-default'
          ? {
              kind,
              agent,
              source: 'fork-default',
              model: choice.model,
              ...(choice.effort ? { effort: choice.effort } : {})
            }
          : stock(kind, agent, settings.agentLaunchChoices, choice.note)
      )
    }
  }
  return { rows }
}
