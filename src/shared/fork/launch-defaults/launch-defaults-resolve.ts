// Fork launch defaults: which model and effort a launch runs, and where that came from.
// Order: an explicit flag, UI pick or agent argument, then the fork default for the kind,
// then stock (the app-wide default in Settings > Agents, or the agent's own config).
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import { yieldAgentChoicesToArgs } from '../../agent-launch/choices/agent-choice-layers'
import { checkAgentLaunchModelPreferences } from '../../agent-launch/choices/agent-launch-model-preferences'
import {
  normalizeForkLaunchDefaults,
  type ForkLaunchKind,
  type ForkLaunchReportKind
} from './launch-defaults-settings'

export type ForkLaunchSource = 'explicit' | 'fork-default' | 'stock'

export type ForkLaunchChoice = {
  kind: ForkLaunchReportKind
  agent: TuiAgent
  model?: string
  effort?: string
  source: ForkLaunchSource
  /** Why a set default was not used. */
  note?: string
}

/** True when the agent's own arguments already name a model, so a default must not add one. */
function argsOwnModel(agent: TuiAgent, args: string | null | undefined): boolean {
  const tokens = (args ?? '').split(/\s+/).filter(Boolean)
  if (!tokens.length) {
    return false
  }
  return !yieldAgentChoicesToArgs(agent, { model: 'x' }, tokens).model
}

/** True when the agent's own arguments already name an effort. */
function argsOwnEffort(agent: TuiAgent, model: string, args: string | null | undefined): boolean {
  const tokens = (args ?? '').split(/\s+/).filter(Boolean)
  return tokens.length > 0 && !yieldAgentChoicesToArgs(agent, { model, effort: 'x' }, tokens).effort
}

export function resolveForkLaunchChoice(args: {
  settings: unknown
  kind: ForkLaunchKind
  agent: TuiAgent
  explicitModel?: string
  explicitEffort?: string
  /** Agent arguments that ride along with the launch (they can name a model themselves). */
  agentArgs?: string | null
  createsWorktree?: boolean
}): ForkLaunchChoice {
  const { kind, agent } = args
  if (args.explicitModel || args.explicitEffort) {
    return {
      kind,
      agent,
      source: 'explicit',
      ...(args.explicitModel ? { model: args.explicitModel } : {}),
      ...(args.explicitEffort ? { effort: args.explicitEffort } : {})
    }
  }
  if (argsOwnModel(agent, args.agentArgs)) {
    return { kind, agent, source: 'explicit', note: 'The agent arguments name the model.' }
  }
  const preset = normalizeForkLaunchDefaults(args.settings)[kind]?.[agent]
  if (!preset?.model) {
    return { kind, agent, source: 'stock' }
  }
  // An effort the agent arguments already set wins over the default's effort.
  const effort =
    preset.effort && !argsOwnEffort(agent, preset.model, args.agentArgs) ? preset.effort : undefined
  const checked = checkAgentLaunchModelPreferences({
    agent,
    model: preset.model,
    effort,
    createsWorktree: args.createsWorktree
  })
  if ('refusal' in checked) {
    return { kind, agent, source: 'stock', note: `Default not used: ${checked.refusal.message}` }
  }
  return {
    kind,
    agent,
    source: 'fork-default',
    model: preset.model,
    ...(effort ? { effort } : {})
  }
}

/** One line for CLI output and tooltips, e.g. "model opus, effort high (default for workers)". */
export function describeForkLaunchChoice(choice: {
  kind?: string
  model?: string | null
  effort?: string | null
  source?: string
}): string {
  const parts = [
    choice.model ? `model ${choice.model}` : 'model from the agent setup',
    ...(choice.effort ? [`effort ${choice.effort}`] : [])
  ]
  const from =
    choice.source === 'fork-default'
      ? ` (default for ${forkLaunchKindLabel(choice.kind)})`
      : choice.source === 'explicit'
        ? ' (chosen for this launch)'
        : ''
  return `${parts.join(', ')}${from}`
}

export function forkLaunchKindLabel(kind: string | undefined): string {
  switch (kind) {
    case 'cli':
      return 'CLI launches'
    case 'worker':
      return 'orchestration workers'
    case 'automation':
      return 'automation runs'
    case 'interactive':
      return 'interactive launches'
    case undefined:
    default:
      return 'this kind of launch'
  }
}
