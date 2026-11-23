// Fork BAD-747: the `steps` an agent sends with `bots.items.add` or `set`. Checked and normalized here;
// with the `forkBotOwnerSteps` setting off the host keeps none, and the steps go into the text as a
// numbered list with each command fenced, so nothing the agent wrote is lost.
import { parseBotItemSteps, type BotItemStepInput } from '../../../../shared/bots/bot-item-steps'
import { botItemStepsMarkdown } from '../../../../shared/bots/bot-item-steps-text'
import {
  readForkBotOwnerSteps,
  type ForkBotOwnerStepsSettings
} from '../../../../shared/fork/bot-owner-steps'
import { BotItemError } from '../../../bots/bot-item-error'
import type { OrcaRuntimeService } from '../../orca-runtime'

export type ResolvedItemSteps = { steps?: BotItemStepInput[]; markdown?: string }

export function resolveItemSteps(runtime: OrcaRuntimeService, value: unknown): ResolvedItemSteps {
  if (value === undefined) {
    return {}
  }
  const parsed = parseBotItemSteps(value)
  if (!parsed.ok) {
    throw new BotItemError('invalid_argument', `${parsed.error} Nothing was posted.`)
  }
  if (readForkBotOwnerSteps(runtime.requireStore().getSettings() as ForkBotOwnerStepsSettings)) {
    return { steps: parsed.steps }
  }
  return parsed.steps.length > 0 ? { markdown: botItemStepsMarkdown(parsed.steps) } : {}
}

/** `text` followed by the fallback list, when there is one. */
export function withStepsMarkdown(
  text: string | undefined,
  markdown: string | undefined
): string | undefined {
  return markdown ? [text?.trim(), markdown].filter(Boolean).join('\n\n') : text
}
