// Digest (SLRM-2388, FORK.md): what finished, failed, merged and cost, and what waits on you, on
// this desktop and every paired server. Mounted once at the app root; opened from the command
// palette and from Settings > Blackfish > Digest. Same layout and controls as the usage report.
import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { getIntlLocale } from '@/i18n/i18n'
import { formatForkTokens } from '../../../../shared/fork/usage-ledger'
import { formatForkUsd } from '../../../../shared/fork/usage-report'
import type { ForkDigestHost, ForkDigestSection } from '../../../../shared/fork/digest'
import {
  closeForkDigest,
  FORK_DIGEST_WINDOWS,
  useForkDigest,
  useForkDigestOpen,
  type ForkDigestWindow
} from './use-fork-digest'

function windowLabel(hours: ForkDigestWindow, t: Translate): string {
  if (hours === null) {
    return t('fork.digest.sinceLast', 'Since last digest')
  }
  return hours < 48
    ? t('fork.digest.hours', '{{count}} h', { count: hours })
    : t('fork.digest.days', '{{count}} d', { count: hours / 24 })
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(getIntlLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function note(text: string): React.JSX.Element {
  return <p className="py-2 text-sm text-muted-foreground">{text}</p>
}

function Group({
  title,
  count,
  children
}: {
  title: string
  count: number
  children: React.ReactNode
}): React.JSX.Element | null {
  if (count === 0) {
    return null
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">
        {title} ({count})
      </div>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  )
}

function Line({ main, detail }: { main: React.ReactNode; detail?: string }): React.JSX.Element {
  return (
    <li className="min-w-0">
      <div className="truncate">{main}</div>
      {detail ? <div className="truncate text-xs text-muted-foreground">{detail}</div> : null}
    </li>
  )
}

function costLine(section: ForkDigestSection, t: Translate): string | null {
  const cost = section.cost
  if (!cost) {
    return null
  }
  const money =
    cost.costUsd === null
      ? cost.subscriptionTokens > 0
        ? t('fork.usageReport.subscription', 'subscription')
        : '-'
      : `${formatForkUsd(cost.costUsd)}${cost.unpricedTokens > 0 ? ' +?' : ''}`
  return t(
    'fork.digest.cost',
    'Cost (estimate, {{days}} d): {{money}}, {{tokens}} tokens in {{chats}} chats',
    { days: cost.days, money, tokens: formatForkTokens(cost.totalTokens), chats: cost.chats }
  )
}

function HostSection({ host }: { host: ForkDigestHost }): React.JSX.Element {
  const t = useTranslate()
  const section = host.section
  const status =
    host.status === 'unreachable'
      ? t('fork.digest.unreachable', 'Not answering')
      : host.status === 'no-digest'
        ? t('fork.digest.noDigest', 'No digest here: stock Orca or an older Blackfish')
        : null
  const tasks = section?.tasks ?? []
  const prs = section?.pullRequests ?? []
  const failed = tasks.filter((task) => task.status === 'failed')
  const finished = tasks.filter((task) => task.status === 'completed')
  const merged = prs.filter((pr) => pr.state === 'merged')
  const open = prs.filter((pr) => pr.state === 'open')
  const link = (pr: (typeof prs)[number]): React.JSX.Element => (
    <a href={pr.url} target="_blank" rel="noreferrer" className="hover:underline">
      {pr.repo}#{pr.number} {pr.title}
    </a>
  )
  const cost = section ? costLine(section, t) : null
  const empty =
    section !== null && tasks.length + prs.length + section.waiting.length === 0 && !cost
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/50 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">{host.name}</h3>
        {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
      </div>
      {section ? (
        <>
          <Group title={t('fork.digest.waiting', 'Waiting on you')} count={section.waiting.length}>
            {section.waiting.map((row) => (
              <Line key={row.chatId} main={row.title || row.chatId} detail={row.question} />
            ))}
          </Group>
          <Group title={t('fork.digest.failed', 'Failed')} count={failed.length}>
            {failed.map((task) => (
              <Line
                key={task.id}
                main={task.title}
                detail={`${when(task.at)} ${task.result ?? ''}`}
              />
            ))}
          </Group>
          <Group title={t('fork.digest.finished', 'Finished')} count={finished.length}>
            {finished.map((task) => (
              <Line key={task.id} main={task.title} detail={when(task.at)} />
            ))}
          </Group>
          <Group title={t('fork.digest.merged', 'Merged')} count={merged.length}>
            {merged.map((pr) => (
              <Line key={pr.url} main={link(pr)} detail={when(pr.at)} />
            ))}
          </Group>
          <Group title={t('fork.digest.open', 'Open pull requests')} count={open.length}>
            {open.map((pr) => (
              <Line
                key={pr.url}
                main={link(pr)}
                detail={pr.draft ? t('fork.digest.draft', 'Draft') : undefined}
              />
            ))}
          </Group>
          {cost ? <p className="text-sm">{cost}</p> : null}
          {empty ? note(t('fork.digest.nothing', 'Nothing in this window.')) : null}
          {section.notes.map((text) => (
            <p key={text} className="text-xs text-muted-foreground">
              {text}
            </p>
          ))}
        </>
      ) : null}
    </section>
  )
}

function DialogBody(): React.JSX.Element {
  const t = useTranslate()
  const [hours, setHours] = useState<ForkDigestWindow>(null)
  const { digest, error, loading, reload } = useForkDigest(hours)
  const totals = digest?.totals
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('fork.digest.title', 'Digest')}</DialogTitle>
        <DialogDescription>
          {digest
            ? t('fork.digest.window', '{{since}} to {{until}}, this desktop and its servers', {
                since: when(digest.since),
                until: when(digest.until)
              })
            : t('fork.digest.loading', 'Asking this desktop and its servers...')}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-1">
        {FORK_DIGEST_WINDOWS.map((choice) => (
          <Button
            key={choice ?? 'last'}
            size="sm"
            variant={choice === hours ? 'secondary' : 'ghost'}
            onClick={() => setHours(choice)}
          >
            {windowLabel(choice, t)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={loading}
          onClick={() => void reload()}
        >
          {t('fork.digest.refresh', 'Refresh')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto">
        {error
          ? note(t('fork.digest.failedToRead', 'Could not read the digest: {{error}}', { error }))
          : null}
        {totals ? (
          <p className="text-sm font-medium">
            {t(
              'fork.digest.headline',
              '{{finished}} finished, {{failed}} failed, {{merged}} merged, {{open}} open, {{waiting}} waiting on you',
              totals
            )}
            {totals.costUsd !== null ? `, ${formatForkUsd(totals.costUsd)}` : ''}
          </p>
        ) : null}
        {digest?.serversDown.map((server) => (
          <p key={server.name} className="text-sm text-muted-foreground">
            {t('fork.digest.serverDown', '{{name}} is not answering since {{since}}', {
              name: server.name,
              since: when(server.downSince)
            })}
          </p>
        ))}
        {digest?.hosts.map((host) => (
          <HostSection key={host.hostKey} host={host} />
        ))}
      </div>
    </>
  )
}

export function ForkDigestHost(): React.JSX.Element | null {
  const open = useForkDigestOpen()
  if (!open || !window.api?.forkUsageLedger) {
    return null
  }
  return (
    <Dialog open onOpenChange={(next) => !next && closeForkDigest()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogBody />
      </DialogContent>
    </Dialog>
  )
}
