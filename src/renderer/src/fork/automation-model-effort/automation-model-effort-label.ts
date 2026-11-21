import type { Translate } from '@/i18n/use-translate'
import { launchModelLabel } from '@/components/agent/AgentLaunchPicker'
import {
  automationModelEffort,
  type AutomationModelEffort
} from '../../../../shared/automations/launch/automation-model-effort-summary'
import type { Automation } from '../../../../shared/automations/automation-definition'

/** The model by name, and the effort as saved; empty where the agent picks them. */
export function automationModelEffortLabels(
  automation: Parameters<typeof automationModelEffort>[0] & Pick<Automation, 'agentId'>
): AutomationModelEffort {
  const { model, effort } = automationModelEffort(automation)
  return {
    ...(model ? { model: launchModelLabel(automation.agentId, model) ?? model } : {}),
    ...(effort ? { effort } : {})
  }
}

/** "Opus 5.5 · xhigh" for a tooltip; undefined when neither is set. */
export function automationModelEffortSummary(
  automation: Parameters<typeof automationModelEffortLabels>[0]
): string | undefined {
  const { model, effort } = automationModelEffortLabels(automation)
  return [model, effort].filter(Boolean).join(' · ') || undefined
}

/** The detail card's Model and Effort rows; none where the agent picks them. */
export function automationModelEffortProperties(
  automation: Parameters<typeof automationModelEffortLabels>[0],
  t: Translate
): { key: string; label: string; value: string }[] {
  const { model, effort } = automationModelEffortLabels(automation)
  return [
    ...(model
      ? [{ key: 'model', label: t('fork.automationModelEffort.model', 'Model'), value: model }]
      : []),
    ...(effort
      ? [{ key: 'effort', label: t('fork.automationModelEffort.effort', 'Effort'), value: effort }]
      : [])
  ]
}
