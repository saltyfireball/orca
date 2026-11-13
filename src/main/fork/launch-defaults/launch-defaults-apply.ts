// Fork launch defaults (FORK.md "Launch defaults"): fill the model and effort a launch runs when
// the caller chose none. Each upstream launch point calls one of these through a one-line hook.
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import type { Automation } from '../../../shared/automations/automation-definition'
import { automationCanonicalLaunchSetup } from '../../../shared/automations/launch/automation-canonical-launch-setup'
import { automationLaunchInputs } from '../../../shared/automations/launch/automation-launch-choices'
import {
  resolveForkLaunchChoice,
  type ForkLaunchChoice
} from '../../../shared/fork/launch-defaults/launch-defaults-resolve'
import type { ForkLaunchDefaultsSettings } from '../../../shared/fork/launch-defaults/launch-defaults-settings'

export type ForkLaunchSettingsHost = {
  requireStore(): { getSettings(): object }
}

/** The saved defaults, or none when the host has no settings store (then every launch is stock). */
export function readForkLaunchDefaults(runtime: ForkLaunchSettingsHost): unknown {
  try {
    const settings = runtime.requireStore().getSettings() as {
      forkLaunchDefaults?: ForkLaunchDefaultsSettings
    }
    return settings.forkLaunchDefaults
  } catch {
    return undefined
  }
}

type CliIntent = {
  agent: TuiAgent
  launchSource?: string
  reuseTerminal?: unknown
  sessionOptions?: Readonly<Record<string, string>>
  agentArgs?: string | null
  target: { kind: string }
}

/** `orca agent launch` and `orca worktree create --agent`: launches that say they came from the CLI.
 *  A reused terminal keeps the agent already running there, so it is left alone. */
export function applyForkCliLaunchDefault<T extends CliIntent>(
  runtime: ForkLaunchSettingsHost,
  intent: T
): { intent: T; forkLaunch?: ForkLaunchChoice } {
  if (intent.launchSource !== 'cli' || intent.reuseTerminal) {
    return { intent }
  }
  const forkLaunch = resolveForkLaunchChoice({
    settings: readForkLaunchDefaults(runtime),
    kind: 'cli',
    agent: intent.agent,
    explicitModel: intent.sessionOptions?.model,
    explicitEffort: intent.sessionOptions?.effort,
    agentArgs: intent.agentArgs,
    createsWorktree: intent.target.kind !== 'existing'
  })
  if (forkLaunch.source !== 'fork-default') {
    return { intent, forkLaunch }
  }
  const sessionOptions = {
    ...intent.sessionOptions,
    model: forkLaunch.model as string,
    ...(forkLaunch.effort ? { effort: forkLaunch.effort } : {})
  }
  return { intent: { ...intent, sessionOptions }, forkLaunch }
}

/** Attach the resolved choice to a CLI launch result so `orca agent launch` can print it. */
export function withForkLaunchChoice<R extends object>(
  result: R,
  forkLaunch: ForkLaunchChoice | undefined
): R {
  return forkLaunch ? { ...result, forkLaunch } : result
}

/** Scheduled and run-now automations: an automation that names no model gets the default. */
export function withForkAutomationLaunchDefault(
  runtime: ForkLaunchSettingsHost,
  automation: Automation
): Automation {
  const setup = automationCanonicalLaunchSetup(automation)
  const chosen = automationLaunchInputs(automation.agentId, setup).sessionOptions
  const choice = resolveForkLaunchChoice({
    settings: readForkLaunchDefaults(runtime),
    kind: 'automation',
    agent: automation.agentId,
    explicitModel: typeof chosen?.model === 'string' ? chosen.model : undefined,
    explicitEffort: typeof chosen?.effort === 'string' ? chosen.effort : undefined,
    agentArgs: [setup.agentArgs, setup.extraAgentArgs].filter(Boolean).join(' '),
    createsWorktree: automation.workspaceMode === 'new_per_run'
  })
  if (choice.source !== 'fork-default') {
    return automation
  }
  const preferences = setup.launchPreferences ?? {}
  return {
    ...automation,
    launchSetup: {
      ...setup,
      launchPreferences: {
        ...preferences,
        model: choice.model,
        ...(choice.effort
          ? { options: { ...preferences.options, effort: choice.effort } }
          : preferences.options
            ? { options: preferences.options }
            : {})
      }
    }
  }
}
