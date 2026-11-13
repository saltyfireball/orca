// Sleepers (FORK.md): the sidebar's bottom toolbar button that opens the Sleepers dialog. The
// "Sleepers button" setting hides it (SLRM-2136); the command palette still opens the dialog.
import React from 'react'
import { Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { forkSleepersButtonShown } from '../../../../shared/fork/sleepers'
import { openForkSleepersDialog } from './ForkSleepersDialog'

export function ForkSleepersButton(): React.JSX.Element | null {
  const shown = useAppStore((s) => forkSleepersButtonShown(s.settings))
  if (!shown) {
    return null
  }
  const label = translate('fork.sleepers.button', 'Sleepers: chats and agents, awake or asleep')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={label}
          onClick={openForkSleepersDialog}
          className="text-muted-foreground"
        >
          <Moon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
