import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { agentLaunchSetupModelRows } from '@/components/agent/agent-launch-setup-option-rows'
import { agentLaunchSetupState } from '@/components/agent/agent-launch-setup-state'
import type { AgentPickerEdit } from '../../../../shared/agent-launch/picker/agent-launch-picker-edits'
import type {
  AgentPickerDraft,
  AgentPickerEntry
} from '../../../../shared/agent-launch/picker/agent-launch-picker'

const AGENT_DEFAULT = '__agent-default__'

function ChoiceRow({
  label,
  value,
  current,
  choices,
  disabled,
  placeholder,
  onChange
}: {
  label: string
  value: string | undefined
  current: string
  choices: readonly { value: string; label: string }[]
  disabled?: boolean
  placeholder: string
  onChange: (value: string | undefined) => void
}) {
  const shown = choices.find((choice) => choice.value === value)?.label ?? value ?? placeholder
  return (
    <div className="flex min-h-7 min-w-0 items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label={label}
            className="min-w-0 max-w-full"
          >
            <span className="min-w-0 truncate text-xs">{shown}</span>
            <ChevronDown className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8} className="max-h-80 w-64">
          <DropdownMenuRadioGroup
            value={current}
            onValueChange={(next) => onChange(next === AGENT_DEFAULT ? undefined : next)}
          >
            <DropdownMenuRadioItem value={AGENT_DEFAULT}>{placeholder}</DropdownMenuRadioItem>
            {choices.map((choice) => (
              <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Model and Effort for a kept launch (an automation's): the lists the chat composer's model menu
 * offers this agent, with "Agent default" leaving each to the agent. `onEdit` applies one change.
 */
export function AgentLaunchModelEffortFields({
  entry,
  draft,
  disabled,
  onEdit
}: {
  entry: AgentPickerEntry
  draft: AgentPickerDraft
  disabled?: boolean
  onEdit: (edit: AgentPickerEdit) => void
}) {
  const t = useTranslate()
  const state = agentLaunchSetupState(entry, draft, disabled)
  const modelRows = agentLaunchSetupModelRows(
    state.models,
    draft.choices.model,
    '',
    false,
    false
  ).rows
  const effortRow = state.optionRows.find((row) => row.id === 'effort')
  const effortKind = effortRow?.kind.type === 'select' ? effortRow.kind : undefined
  const effortChoices = effortKind?.choices.filter((choice) => choice.value !== 'arguments') ?? []
  const picked = draft.choices.options?.effort
  // A model or effort flag in the Arguments (the host default's too) loses to a pick made here.
  const argumentKeys = new Set(
    state.argumentsView.context.analysis.occurrences.map((occurrence) => occurrence.key)
  )
  const overridden = [
    ...(draft.choices.model && argumentKeys.has('model')
      ? [t('fork.automationModelEffort.model', 'Model')]
      : []),
    ...(picked && argumentKeys.has('effort')
      ? [effortRow?.label ?? t('fork.automationModelEffort.effort', 'Effort')]
      : [])
  ]
  const placeholder = t('fork.automationModelEffort.default', 'Agent default')
  return (
    <>
      <ChoiceRow
        label={t('fork.automationModelEffort.model', 'Model')}
        value={draft.choices.model}
        current={draft.choices.model ?? AGENT_DEFAULT}
        choices={modelRows.map((row) => ({ value: row.id, label: row.label }))}
        disabled={state.modelDisabled || Boolean(disabled)}
        placeholder={
          state.catalogPending
            ? t('fork.automationModelEffort.loading', 'Loading models…')
            : placeholder
        }
        onChange={(model) => onEdit({ kind: 'choice', patch: { model: model ?? null } })}
      />
      {effortRow && effortChoices.length > 0 ? (
        <ChoiceRow
          label={effortRow.label}
          value={picked}
          current={picked ?? AGENT_DEFAULT}
          choices={effortChoices.map((choice) => ({ value: choice.value, label: choice.label }))}
          disabled={disabled || !effortRow.settable}
          placeholder={placeholder}
          onChange={(effort) =>
            onEdit({ kind: 'choice', patch: { options: { effort: effort ?? null } } })
          }
        />
      ) : null}
      {entry.surfaces.includes('terminal') && overridden.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'fork.automationModelEffort.overridesArguments',
            'Runs use the {{choices}} chosen here, not the one in Arguments.',
            { choices: overridden.join(' / ').toLowerCase() }
          )}
        </p>
      ) : null}
    </>
  )
}
