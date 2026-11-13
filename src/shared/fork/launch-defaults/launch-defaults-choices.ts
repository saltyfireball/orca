// Fork launch defaults: the agents, models and efforts offered, read from the app's own launch
// catalog so the fork never keeps a model list of its own.
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import { TUI_AGENT_CONFIG } from '../../agent-launch/catalog/tui-agent-config'
import {
  findCatalogModel,
  findCatalogOption,
  getAgentSessionOptionLaunchCatalog
} from '../../agent-session/options/agent-session-option-catalog'

export type ForkLaunchChoiceOption = { value: string; label: string }

/** Agents that take a model at launch the same way `--model` does. OpenCode is left out: it
 *  applies a model only in a fresh terminal on a supported host, which a default cannot know. */
export function forkLaunchDefaultAgents(): TuiAgent[] {
  return (Object.keys(TUI_AGENT_CONFIG) as TuiAgent[]).filter((agent) => {
    if (agent === 'opencode') {
      return false
    }
    const catalog = getAgentSessionOptionLaunchCatalog(agent)
    return Boolean(catalog?.supportsWorkerLaunchPreferences && catalog.modelApply.launchArgs)
  })
}

export function forkLaunchModelChoices(agent: TuiAgent): ForkLaunchChoiceOption[] {
  const catalog = getAgentSessionOptionLaunchCatalog(agent)
  return (catalog?.models ?? []).map((model) => ({ value: model.id, label: model.label }))
}

export function forkLaunchEffortChoices(
  agent: TuiAgent,
  model: string | undefined
): ForkLaunchChoiceOption[] {
  const catalog = getAgentSessionOptionLaunchCatalog(agent)
  if (!catalog || !model) {
    return []
  }
  const found = findCatalogModel(catalog, model)
  const option =
    findCatalogOption(found, 'effort') ??
    (!found
      ? catalog.unknownModelOptions?.find((candidate) => candidate.id === 'effort')
      : undefined)
  return option?.kind.type === 'select'
    ? option.kind.choices.map((choice) => ({ value: choice.value, label: choice.label }))
    : []
}
