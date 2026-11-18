// Best of N (FORK.md, SLRM-2393): the compare-and-pick view. Mounted once at the app root and
// opened from the command palette. One column per attempt; keeping one archives (or removes, or
// leaves) the others' worktrees, each on the host that owns it.
import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { getIntlLocale } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  readForkBestOfSettings,
  type ForkBestOfLoserAction,
  type ForkBestOfRun
} from '../../../../shared/fork/best-of/best-of'
import { settleForkBestOf } from '../../../../shared/fork/best-of/best-of-compare'
import type { ForkBestOfShowResult } from '../../../../shared/fork/best-of/best-of-wire'
import { forgetForkBestOfRun, forkBestOfAvailable, forkBestOfCall } from './best-of-client'
import { ForkBestOfAttemptCard } from './ForkBestOfAttemptCard'
import { closeForkBestOf, useForkBestOf, useForkBestOfOpen } from './use-fork-best-of'

function runLabel(run: ForkBestOfRun, t: Translate): string {
  const when = new Date(run.createdAt).toLocaleString(getIntlLocale())
  const state =
    run.winner === undefined
      ? t('fork.bestOf.runOpen', 'open')
      : t('fork.bestOf.runPicked', 'picked {{index}}', { index: run.winner })
  return `${run.title} (${when}, ${state})`
}

function actionText(action: ForkBestOfLoserAction, count: number, t: Translate): string {
  switch (action) {
    case 'remove':
      return t('fork.bestOf.confirmRemove', 'and remove the worktrees of the other {{count}}?', {
        count
      })
    case 'keep':
      return t('fork.bestOf.confirmKeep', 'and leave the other {{count}} as they are?', { count })
    case 'archive':
      return t('fork.bestOf.confirmArchive', 'and archive the other {{count}}?', { count })
  }
}

/** The pick; kept out of the component so the compiler can compile it. Null when it went through. */
async function pickAttempt(
  shown: ForkBestOfShowResult,
  winner: number,
  loserAction: ForkBestOfLoserAction
): Promise<string | null> {
  try {
    await settleForkBestOf({ call: forkBestOfCall, shown, winner, loserAction })
    return null
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught)
  }
}

function PickConfirm(props: {
  shown: ForkBestOfShowResult
  index: number
  action: ForkBestOfLoserAction
  onDone: (error: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const pick = async () => {
    setBusy(true)
    const failure = await pickAttempt(props.shown, props.index, props.action)
    setBusy(false)
    props.onDone(failure)
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
      <span className="min-w-0 flex-1">
        {t('fork.bestOf.confirm', 'Keep attempt {{index}}', { index: props.index })}{' '}
        {actionText(props.action, props.shown.run.attempts.length - 1, t)}
      </span>
      <Button size="sm" disabled={busy} onClick={() => void pick()}>
        {busy ? t('fork.bestOf.picking', 'Working...') : t('fork.bestOf.confirmYes', 'Keep')}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={props.onCancel}>
        {t('fork.bestOf.cancel', 'Cancel')}
      </Button>
    </div>
  )
}

function DialogBody(): React.JSX.Element {
  const t = useTranslate()
  const action = useAppStore((state) => readForkBestOfSettings(state.settings).loserAction)
  const { runs, selected, setSelected, shown, diffs, error, loading, reload } = useForkBestOf()
  const [picking, setPicking] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const note = (text: string) => <p className="py-6 text-sm text-muted-foreground">{text}</p>
  const run = shown?.run
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('fork.bestOf.title', 'Best of N')}</DialogTitle>
        <DialogDescription>
          {t(
            'fork.bestOf.description',
            'Each attempt worked on the same task in its own worktree. Compare them and keep one. Start a run with orca best-of <n> --prompt <text>.'
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        {runs && runs.length > 0 ? (
          <Select value={selected ?? undefined} onValueChange={(id) => setSelected(id)}>
            <SelectTrigger size="sm" className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {runs.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {runLabel(entry, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="flex-1" />
        )}
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void reload()}>
          {t('fork.bestOf.refresh', 'Refresh')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto">
        {error
          ? note(t('fork.bestOf.failed', 'Could not read best-of runs: {{error}}', { error }))
          : null}
        {runs && runs.length === 0 && !error
          ? note(t('fork.bestOf.empty', 'No best-of runs yet.'))
          : null}
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {shown && picking !== null ? (
          <PickConfirm
            shown={shown}
            index={picking}
            action={action}
            onCancel={() => setPicking(null)}
            onDone={(failure) => {
              setPicking(null)
              setNotice(failure)
              void reload()
            }}
          />
        ) : null}
        {run ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${run.attempts.length}, minmax(0, 1fr))` }}
          >
            {run.attempts.map((attempt) => (
              <ForkBestOfAttemptCard
                key={attempt.index}
                attempt={attempt}
                facts={shown.facts.find((entry) => entry.index === attempt.index)}
                diff={diffs[attempt.index]}
                winner={run.winner}
                canPick={run.winner === undefined && picking === null}
                onPick={(index) => {
                  setNotice(null)
                  setPicking(index)
                }}
                onOpenFailed={() =>
                  setNotice(t('fork.bestOf.openFailed', 'This workspace is not in the sidebar.'))
                }
              />
            ))}
          </div>
        ) : null}
      </div>
      {run ? (
        <div className="flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate" title={run.prompt}>
            {run.prompt}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void forgetForkBestOfRun(run.id).then(reload)}
          >
            {t('fork.bestOf.forget', 'Forget this run')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function ForkBestOfHost(): React.JSX.Element | null {
  const open = useForkBestOfOpen()
  if (!open || !forkBestOfAvailable()) {
    return null
  }
  return (
    <Dialog open onOpenChange={(next) => !next && closeForkBestOf()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
        <DialogBody />
      </DialogContent>
    </Dialog>
  )
}
