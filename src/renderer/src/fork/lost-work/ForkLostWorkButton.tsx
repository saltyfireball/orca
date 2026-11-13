// SLRM-2096 (FORK.md "Lost work"): the workspace cleanup dialog's way into the Lost work list.
// Hidden when this build's preload has no lost work bridge (a web or remote client).
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { ForkLostWorkDialog } from './ForkLostWorkDialog'

export function ForkLostWorkButton(): React.JSX.Element | null {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  if (!window.api?.forkLostWork) {
    return null
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t('fork.lostWork.button', 'Lost work')}
      </Button>
      <ForkLostWorkDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
