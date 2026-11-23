// Needs you (FORK.md "Needs you list", BAD-759): the visible "Needs you N" control. It sits in the
// status bar, which shows whatever is open and whether or not the left sidebar is, and floats at the
// window's corner when the status bar is hidden. Hidden at zero; the shortcut still opens the list
// (with its empty state). It replaces the Decision inbox's sidebar icon, so there is one count.
import React from 'react'
import { BellRing } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { useOptionalShortcutLabel } from '@/lib/keyboard/useShortcutLabel'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from '@/components/status-bar/composition/status-bar-context-menu-policy'
import { decisionInboxBadgeText } from '../decision-inbox/decision-inbox-view'
import { toggleNeedsYou, useNeedsYouData, useNeedsYouEnabled } from './needs-you-store'

function Pill({ floating }: { floating: boolean }): React.JSX.Element | null {
  const t = useTranslate()
  const count = useNeedsYouData().entries.length
  const shortcut = useOptionalShortcutLabel('needsYou.open')
  if (count === 0) {
    return null
  }
  const label = t('fork.needsYou.control', 'Needs you {{count}}', { count })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-needs-you-control={floating ? 'floating' : 'status-bar'}
          aria-label={label}
          aria-haspopup="dialog"
          onClick={toggleNeedsYou}
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
          className={
            floating
              ? 'fixed right-3 bottom-3 z-40 inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-popover px-2.5 text-xs font-medium text-foreground shadow-md hover:bg-accent'
              : 'inline-flex h-5 shrink-0 items-center gap-1.5 rounded px-1.5 text-xs font-medium text-foreground hover:bg-accent'
          }
        >
          <BellRing className="size-3.5 text-amber-500" />
          <span>{t('fork.needsYou.controlLabel', 'Needs you')}</span>
          <span className="min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] leading-4 font-semibold text-black tabular-nums">
            {decisionInboxBadgeText(count)}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  )
}

/** The status bar's segment (one hook line in `StatusBarSurface.tsx`). */
export function ForkNeedsYouStatusSegment(): React.JSX.Element | null {
  const enabled = useNeedsYouEnabled()
  return enabled ? <Pill floating={false} /> : null
}

/** The same control at the corner while the status bar is hidden. */
export function ForkNeedsYouFloatingControl(): React.JSX.Element | null {
  const enabled = useNeedsYouEnabled()
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  return enabled && !statusBarVisible ? <Pill floating /> : null
}
