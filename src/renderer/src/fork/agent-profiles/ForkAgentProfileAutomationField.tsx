// FORK.md "Agent profiles" (BAD-741): a profile picker under the automation dialog's agent. A pick
// sets the agent, model, effort and capped permission mode the way the agent picker does, and puts
// the preamble in front of the prompt. One with an MCP limit cannot be picked: the dialog has no
// way to keep it (BAD-800; `orca automations create --profile` does). Nothing shows until a
// profile exists.
import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { AutomationDraft } from '@/components/automations/authoring/AutomationEditorDialog'
import { pickAutomationLaunch } from '@/components/automations/authoring/automation-launch-draft'
import {
  forkAgentProfileAutomationPrompt,
  forkAgentProfileLaunchDraft,
  forkAgentProfilePicks,
  type ForkAgentProfilePick,
  type ForkAgentProfilePickSettings
} from './agent-profile-picks'
import { ForkAgentProfileLabel } from './ForkAgentProfileLabel'

/** The draft after picking `pick`; exported for its test. */
export function forkAgentProfileAutomationDraft(
  current: AutomationDraft,
  pick: ForkAgentProfilePick,
  modern: boolean,
  surface: 'chat' | 'terminal'
): AutomationDraft {
  const setup = forkAgentProfileLaunchDraft(pick, surface)
  if (!setup) {
    return current
  }
  return {
    ...pickAutomationLaunch(current, pick.profile.agent, setup, undefined, modern, surface),
    prompt: forkAgentProfileAutomationPrompt(current.prompt, pick)
  }
}

export function ForkAgentProfileAutomationField({
  settings,
  modern,
  surface,
  onDraftChange
}: {
  settings: ForkAgentProfilePickSettings | null
  modern: boolean
  surface: 'chat' | 'terminal'
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const [picked, setPicked] = useState<string>()
  const picks = forkAgentProfilePicks(settings).filter(() => modern)
  if (picks.length === 0) {
    return null
  }
  const label = t('fork.agentProfiles.automationLabel', 'Profile')
  return (
    <div className="mt-2 flex min-h-7 min-w-0 items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label={label}
            className="min-w-0 max-w-full"
          >
            <span className="min-w-0 truncate text-xs">
              {picked ?? t('fork.agentProfiles.none', 'None')}
            </span>
            <ChevronDown className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8} className="max-h-80 w-72">
          {picks.map((pick) => (
            <DropdownMenuItem
              key={pick.profile.name}
              disabled={pick.needsConfirm || pick.mcpLimit !== undefined}
              onSelect={() => {
                setPicked(pick.profile.name)
                onDraftChange((current) =>
                  forkAgentProfileAutomationDraft(current, pick, modern, surface)
                )
              }}
            >
              <ForkAgentProfileLabel pick={pick} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
