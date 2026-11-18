// PR babysitter (FORK.md, SLRM-2386): one status line under a pull request row in the workspace
// card, in the row's own muted text. Nothing renders for a pull request that is not babysat on
// this host (or that was turned off for it).
import React from 'react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  parsePrBabysitTarget,
  prBabysitKey,
  type PrBabysitEntry
} from '../../../../shared/fork/pr-babysit'
import { useForkPrBabysitList } from './pr-babysit-store'

function reasonText(entry: PrBabysitEntry, t: Translate): string {
  const detail = entry.detail
  switch (entry.reason) {
    case 'cap':
      return t('fork.prBabysit.reason.cap', 'CI still failing after {{count}} fix requests', {
        count: entry.rounds
      })
    case 'no-ci':
      return t('fork.prBabysit.reason.noCi', 'no new CI result after the last fix request')
    case 'chat-unavailable':
      return t('fork.prBabysit.reason.chatUnavailable', 'its chat could not take a message')
    case 'no-chat':
      return t('fork.prBabysit.reason.noChat', 'no chat of it on this host')
    case 'merge-blocked':
      return t('fork.prBabysit.reason.mergeBlocked', 'not mergeable: {{detail}}', { detail })
    case 'merge-failed':
      return t('fork.prBabysit.reason.mergeFailed', 'merge failed: {{detail}}', { detail })
    case null:
      return detail
  }
}

export function prBabysitLineText(
  entry: PrBabysitEntry,
  maxRounds: number,
  t: Translate
): string | null {
  switch (entry.phase) {
    case 'watching':
      return t('fork.prBabysit.line.watching', 'Babysitter: watching CI')
    case 'fixing':
      return t(
        'fork.prBabysit.line.fixing',
        'Babysitter: fix {{round}} of {{max}} sent, waiting for CI',
        { round: entry.rounds, max: maxRounds }
      )
    case 'green':
      return entry.reason
        ? t('fork.prBabysit.line.greenHeld', 'Babysitter: checks green, {{reason}}', {
            reason: reasonText(entry, t)
          })
        : t('fork.prBabysit.line.green', 'Babysitter: checks green')
    case 'merged':
      return t('fork.prBabysit.line.merged', 'Babysitter: merged')
    case 'stuck':
      return t('fork.prBabysit.line.stuck', 'Babysitter stopped: {{reason}}', {
        reason: reasonText(entry, t)
      })
    case 'stopped':
      return null
  }
}

export function ForkPrBabysitLine({ url }: { url: string }): React.JSX.Element | null {
  const t = useTranslate()
  const list = useForkPrBabysitList()
  const pr = parsePrBabysitTarget(url)
  const entry = pr ? list?.entries.find((row) => row.prKey === prBabysitKey(pr)) : undefined
  const text = entry && list ? prBabysitLineText(entry, list.maxRounds, t) : null
  if (!entry || !text) {
    return null
  }
  return (
    <div
      data-fork-pr-babysit={entry.phase}
      title={text}
      className={cn(
        'mt-0.5 truncate text-2xs',
        entry.phase === 'stuck' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {text}
    </div>
  )
}
