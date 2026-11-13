// Fork launch defaults (FORK.md "Launch defaults"): the settings shape, its kinds and the normalizer.
// Empty means stock: a launch kind or agent with no entry starts exactly as upstream Orca does.
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import { forkLaunchDefaultAgents } from './launch-defaults-choices'

/** Launch kinds the host can tell apart at its launch points. UI and mobile launches are
 *  "interactive": they already seed from the app-wide default in Settings > Agents. */
export const FORK_LAUNCH_KINDS = ['cli', 'worker', 'automation'] as const
export type ForkLaunchKind = (typeof FORK_LAUNCH_KINDS)[number]
/** The kinds the report lists; interactive is shown read-only from the stock default. */
export type ForkLaunchReportKind = 'interactive' | ForkLaunchKind

export type ForkLaunchDefault = { model?: string; effort?: string }
export type ForkLaunchDefaultsSettings = Partial<
  Record<ForkLaunchKind, Partial<Record<TuiAgent, ForkLaunchDefault>>>
>

export function isForkLaunchKind(value: unknown): value is ForkLaunchKind {
  return typeof value === 'string' && (FORK_LAUNCH_KINDS as readonly string[]).includes(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Keep only offered agents with a model; an effort needs a model, as on the CLI. */
export function normalizeForkLaunchDefaults(value: unknown): ForkLaunchDefaultsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const offered = new Set<string>(forkLaunchDefaultAgents())
  const out: ForkLaunchDefaultsSettings = {}
  for (const kind of FORK_LAUNCH_KINDS) {
    const byAgent = (value as Record<string, unknown>)[kind]
    if (!byAgent || typeof byAgent !== 'object' || Array.isArray(byAgent)) {
      continue
    }
    const kept: Partial<Record<TuiAgent, ForkLaunchDefault>> = {}
    for (const [agent, entry] of Object.entries(byAgent as Record<string, unknown>)) {
      if (!offered.has(agent) || !entry || typeof entry !== 'object') {
        continue
      }
      const model = text((entry as ForkLaunchDefault).model)
      const effort = text((entry as ForkLaunchDefault).effort)
      if (model) {
        kept[agent as TuiAgent] = { model, ...(effort ? { effort } : {}) }
      }
    }
    if (Object.keys(kept).length) {
      out[kind] = kept
    }
  }
  return out
}

/** A settings patch that sets or clears one cell; clearing the model clears the effort too. */
export function setForkLaunchDefault(
  current: unknown,
  kind: ForkLaunchKind,
  agent: TuiAgent,
  next: ForkLaunchDefault
): ForkLaunchDefaultsSettings {
  const settings = normalizeForkLaunchDefaults(current)
  const byAgent = { ...settings[kind] }
  const model = text(next.model)
  if (model) {
    const effort = text(next.effort)
    byAgent[agent] = { model, ...(effort ? { effort } : {}) }
  } else {
    delete byAgent[agent]
  }
  return normalizeForkLaunchDefaults({ ...settings, [kind]: byAgent })
}
