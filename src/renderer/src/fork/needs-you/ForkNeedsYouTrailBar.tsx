// Needs you (FORK.md "Needs you list", BAD-759): after a jump, Next goes to the following one that
// needs the owner without reopening the list, and Back returns to where they were. Shown from the
// first jump until Back or its close button; it also ends when nothing is left to answer.
import React from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { backFromNeedsYou, jumpToNextNeedsYou } from './needs-you-jump'
import {
  endNeedsYouTrail,
  useNeedsYouData,
  useNeedsYouEnabled,
  useNeedsYouTrail
} from './needs-you-store'
import { needsYouNextEntry } from './needs-you-view'

export function ForkNeedsYouTrailBar(): React.JSX.Element | null {
  const t = useTranslate()
  const enabled = useNeedsYouEnabled()
  const trail = useNeedsYouTrail()
  const { entries } = useNeedsYouData()
  if (!enabled || !trail.ret) {
    return null
  }
  const hasNext = needsYouNextEntry(entries, trail.last) !== null
  return (
    <div
      role="toolbar"
      aria-label={t('fork.needsYou.trail', 'Needs you')}
      data-needs-you-trail=""
      className="fixed bottom-9 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover px-2 py-1 text-xs shadow-md"
    >
      <Button type="button" size="xs" variant="ghost" onClick={() => backFromNeedsYou()}>
        <ArrowLeft />
        {t('fork.needsYou.back', 'Back')}
      </Button>
      <span className="text-muted-foreground tabular-nums">
        {t('fork.needsYou.left', '{{count}} waiting', { count: entries.length })}
      </span>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={!hasNext}
        onClick={() => void jumpToNextNeedsYou(entries)}
      >
        {t('fork.needsYou.next', 'Next')}
        <ArrowRight />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={t('fork.needsYou.dismiss', 'Dismiss')}
        onClick={endNeedsYouTrail}
      >
        <X />
      </Button>
    </div>
  )
}
