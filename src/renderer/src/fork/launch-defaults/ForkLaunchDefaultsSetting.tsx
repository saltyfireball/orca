// Fork launch defaults (FORK.md "Launch defaults"): Settings > Advanced > Launch defaults. A model
// and effort per kind of launch for one agent at a time. Empty everywhere ships, which is stock.
import React, { useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { tuiAgentDisplayName } from '../../../../shared/agent-launch/catalog/tui-agent-display-names'
import {
  forkLaunchDefaultAgents,
  forkLaunchEffortChoices,
  forkLaunchModelChoices,
  type ForkLaunchChoiceOption
} from '../../../../shared/fork/launch-defaults/launch-defaults-choices'
import {
  FORK_LAUNCH_KINDS,
  normalizeForkLaunchDefaults,
  setForkLaunchDefault,
  type ForkLaunchKind
} from '../../../../shared/fork/launch-defaults/launch-defaults-settings'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { translate } from '@/i18n/i18n'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

// Radix Select cannot hold an empty value, so "no default" has its own token.
const NONE = '__stock__'

function kindText(kind: ForkLaunchKind): { label: string; help: string } {
  switch (kind) {
    case 'cli':
      return {
        label: translate('fork.launchDefaults.cli', 'CLI launches'),
        help: translate(
          'fork.launchDefaults.cliHelp',
          'orca agent launch and orca worktree create --agent.'
        )
      }
    case 'worker':
      return {
        label: translate('fork.launchDefaults.worker', 'Orchestration workers'),
        help: translate('fork.launchDefaults.workerHelp', 'orca orchestration worker-start.')
      }
    case 'automation':
      return {
        label: translate('fork.launchDefaults.automation', 'Automation runs'),
        help: translate(
          'fork.launchDefaults.automationHelp',
          'Scheduled and run-now automations that name no model.'
        )
      }
  }
}

function ChoiceSelect(props: {
  value: string | undefined
  choices: ForkLaunchChoiceOption[]
  noneLabel: string
  disabled?: boolean
  labelledBy: string
  onChange: (value: string | undefined) => void
}): React.JSX.Element {
  // Keep a hand-edited value selectable rather than showing a blank trigger.
  const choices =
    props.value && !props.choices.some((choice) => choice.value === props.value)
      ? [{ value: props.value, label: props.value }, ...props.choices]
      : props.choices
  return (
    <Select
      value={props.value ?? NONE}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(value === NONE ? undefined : value)}
    >
      <SelectTrigger size="sm" className="min-w-32" aria-labelledby={props.labelledBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{props.noneLabel}</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// A model change keeps the effort only when the new model offers it.
function keptEffort(
  agent: TuiAgent,
  model: string | undefined,
  effort: string | undefined
): string | undefined {
  return effort && forkLaunchEffortChoices(agent, model).some((choice) => choice.value === effort)
    ? effort
    : undefined
}

export function ForkLaunchDefaultsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const agentLabelId = useId()
  const rowId = useId()
  const agents = forkLaunchDefaultAgents()
  const saved = normalizeForkLaunchDefaults(settings.forkLaunchDefaults)
  const firstSet = agents.find((agent) => FORK_LAUNCH_KINDS.some((kind) => saved[kind]?.[agent]))
  const [agent, setAgent] = useState<TuiAgent>(firstSet ?? agents[0] ?? 'claude')
  const name = (id: TuiAgent): string => tuiAgentDisplayName(id) ?? id
  const models = forkLaunchModelChoices(agent)
  const set = (kind: ForkLaunchKind, model: string | undefined, effort: string | undefined) =>
    updateSettings({
      forkLaunchDefaults: setForkLaunchDefault(settings.forkLaunchDefaults, kind, agent, {
        model,
        effort
      })
    })
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.launchDefaults.title', 'Launch defaults')}
        description={translate(
          'fork.launchDefaults.description',
          'The model and effort each kind of launch starts on when the launch does not choose one. A --model or --effort flag, a picker choice, or a model in the agent arguments always wins. Left empty, a launch starts as it does today: on the default set in Settings > Agents, or the config of the agent itself. Desktop and mobile pickers use the Settings > Agents default.'
        )}
      />
      <SettingsRow
        label={translate('fork.launchDefaults.agent', 'Agent')}
        labelId={agentLabelId}
        control={
          <Select value={agent} onValueChange={(value) => setAgent(value as TuiAgent)}>
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={agentLabelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agents.map((id) => (
                <SelectItem key={id} value={id}>
                  {FORK_LAUNCH_KINDS.some((kind) => saved[kind]?.[id])
                    ? translate('fork.launchDefaults.agentSet', '{{name}} (set)', {
                        name: name(id)
                      })
                    : name(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {FORK_LAUNCH_KINDS.map((kind) => {
        const current = saved[kind]?.[agent]
        const text = kindText(kind)
        const labelId = `${rowId}-${kind}`
        return (
          <SettingsRow
            key={kind}
            label={text.label}
            description={text.help}
            labelId={labelId}
            control={
              <div className="flex gap-2">
                <ChoiceSelect
                  value={current?.model}
                  choices={models}
                  noneLabel={translate('fork.launchDefaults.modelNone', 'No default')}
                  labelledBy={labelId}
                  onChange={(model) => set(kind, model, keptEffort(agent, model, current?.effort))}
                />
                <ChoiceSelect
                  value={current?.effort}
                  choices={forkLaunchEffortChoices(agent, current?.model)}
                  noneLabel={translate('fork.launchDefaults.effortNone', 'Model default effort')}
                  disabled={!current?.model}
                  labelledBy={labelId}
                  onChange={(effort) => set(kind, current?.model, effort)}
                />
              </div>
            }
          />
        )
      })}
    </section>
  )
}
