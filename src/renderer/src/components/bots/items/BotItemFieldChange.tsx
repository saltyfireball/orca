// The small pieces of an item's Activity events that read a field or status out of an event's data:
// "changed done means" with its before and after (moved out of BotItemActivityList, BAD-834).
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { BOT_ITEM_STATUSES } from '../../../../../shared/bots/bot-items'
import { botItemStatusName } from './bot-item-status-name'

export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function statusWord(value: unknown, t: Translate): string {
  const status = BOT_ITEM_STATUSES.find((entry) => entry === value)
  return status ? botItemStatusName(status, t) : str(value)
}

function fieldName(field: string, t: Translate): string {
  return field === 'doneMeans'
    ? t('bots.items.field.doneMeansLower', 'done means')
    : field === 'description'
      ? t('bots.items.field.description', 'description')
      : t('bots.items.field.title', 'title')
}

function Diff({ from, to }: { from: string; to: string }): React.JSX.Element {
  return (
    <span className="mt-0.5 flex flex-col gap-px border-l-2 border-border pl-2">
      {from ? <del className="text-muted-foreground">{from}</del> : null}
      {to ? <span className="text-foreground">{to}</span> : null}
    </span>
  )
}

/** "changed done means ›": the before and after open on click. */
export function FieldChange({
  by,
  field,
  change
}: {
  by: React.ReactNode
  field: string
  change: unknown
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const diff: { from?: unknown; to?: unknown } =
    typeof change === 'object' && change !== null ? change : {}
  return (
    <span className="block">
      {by}{' '}
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-0.5 hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {t('bots.items.activity.changed', 'changed {{field}}', { field: fieldName(field, t) })}
        <ChevronRight className={open ? 'size-3 rotate-90' : 'size-3'} />
      </button>
      {open ? <Diff from={str(diff.from)} to={str(diff.to)} /> : null}
    </span>
  )
}
