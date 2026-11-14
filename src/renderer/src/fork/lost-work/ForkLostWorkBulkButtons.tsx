// SLRM-2096 (FORK.md "Lost work"): the actions for the ticked rows.
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { LostWorkItem } from '../../../../shared/fork/lost-work'
import { canPushLostWork, canSaveLostWork } from './lost-work-row-actions'

export function ForkLostWorkBulkButtons({
  chosen,
  busy,
  onPush,
  onSave,
  onDelete
}: {
  chosen: readonly LostWorkItem[]
  busy: boolean
  onPush: (items: LostWorkItem[]) => void
  onSave: (items: LostWorkItem[], action: 'save-bundle' | 'save-patch') => void
  onDelete: (items: readonly LostWorkItem[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        disabled={busy || !chosen.some(canPushLostWork)}
        onClick={() => onPush(chosen.filter(canPushLostWork))}
      >
        {t('fork.lostWork.push', 'Push')}
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() =>
          onSave(
            chosen.filter((item) => item.kind !== 'stash' && canSaveLostWork(item)),
            'save-bundle'
          )
        }
      >
        {t('fork.lostWork.saveBundle', 'Save bundle')}
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => onSave(chosen.filter(canSaveLostWork), 'save-patch')}
      >
        {t('fork.lostWork.savePatch', 'Save patch')}
      </Button>
      <Button
        size="xs"
        variant="outline"
        className="text-destructive"
        disabled={busy}
        onClick={() => onDelete(chosen)}
      >
        {t('fork.lostWork.delete', 'Delete')}
      </Button>
    </>
  )
}
