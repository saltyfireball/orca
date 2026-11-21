import type { Automation } from '../automation-definition'
import { automationCanonicalLaunchSetup } from './automation-canonical-launch-setup'

export type AutomationModelEffort = { model?: string; effort?: string }

/** The model and effort an automation was told to use; empty where its agent picks them. */
export function automationModelEffort(
  automation: Pick<Automation, 'bot' | 'launchSetup' | 'launchPreferences' | 'agentArgs'> &
    Partial<Pick<Automation, 'surface' | 'extraAgentArgs'>>
): AutomationModelEffort {
  const bot = automation.bot
  if (bot) {
    const launch = bot.runsIn === 'new' ? bot.agentSetup?.launch : undefined
    return {
      ...(launch?.model ? { model: launch.model } : {}),
      ...(launch?.options?.effort ? { effort: launch.options.effort } : {})
    }
  }
  const preferences = automationCanonicalLaunchSetup(automation).launchPreferences
  const effort = preferences?.options?.effort
  return {
    ...(preferences?.model ? { model: preferences.model } : {}),
    ...(effort ? { effort } : {})
  }
}

/** "claude-opus-5-5 · effort xhigh"; undefined when neither is set. */
export function formatAutomationModelEffort(choice: AutomationModelEffort): string | undefined {
  const parts = [choice.model, choice.effort ? `effort ${choice.effort}` : undefined].filter(
    Boolean
  )
  return parts.length ? parts.join(' · ') : undefined
}
