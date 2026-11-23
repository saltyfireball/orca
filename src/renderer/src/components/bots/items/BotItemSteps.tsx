// Fork BAD-747: the steps an agent asks the owner to do, as one numbered checklist above the ask. The
// current step (the first not done) is open and prominent, later ones are dimmed but open on a click.
// Each has its title, a host badge, its command in a wrapping monospace block with Copy, a Done check,
// and "Did not work" with the error pasted, which tells the bot at once. "Open in terminal" types the
// command into a terminal on its computer and never runs it.
import { useState } from 'react'
import { Check, ChevronRight, SquareTerminal, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  botItemCurrentStepIndex,
  botItemStepsDoneCount,
  isBotItemManualStep,
  type BotItemStep,
  type BotItemStepState,
  type BotItemStepsView
} from '../../../../../shared/bots/bot-item-steps'
import type { BotStepTerminal } from '../../../fork/bot-owner-steps/use-bot-step-terminal'
import { BotItemCommandBlock } from './BotItemCommandBlock'

export type BotItemStepMark = (
  step: BotItemStep,
  state: BotItemStepState,
  error?: string
) => Promise<unknown>

function whyNoTerminal(why: Extract<BotStepTerminal, { canOpen: false }>['why'], t: Translate) {
  switch (why) {
    case 'multiline':
      return t(
        'bots.items.steps.terminalMultiline',
        'This command has several lines: copy it and paste it yourself.'
      )
    case 'unknown-host':
      return t(
        'bots.items.steps.terminalUnknownHost',
        "Orca doesn't know this computer: copy the command and run it there."
      )
    default:
      return t('bots.items.steps.terminalOff', 'Open in terminal is not available for this step.')
  }
}

function StepFailure({
  onSend,
  onCancel
}: {
  onSend: (error: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [error, setError] = useState('')
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Textarea
        variant="code"
        autoFocus
        rows={3}
        spellCheck={false}
        value={error}
        placeholder={t('bots.items.steps.errorPlaceholder', 'Paste the error you got')}
        aria-label={t('bots.items.steps.errorLabel', 'The error you got')}
        className="max-h-40 resize-none [overflow-wrap:anywhere]"
        onChange={(event) => setError(event.target.value)}
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          {t('bots.items.steps.cancel', 'Cancel')}
        </Button>
        <Button type="button" size="xs" disabled={!error.trim()} onClick={() => onSend(error)}>
          {t('bots.items.steps.sendError', 'Tell the bot')}
        </Button>
      </div>
    </div>
  )
}

function StepRow({
  step,
  current,
  terminal,
  onMark
}: {
  step: BotItemStep
  current: boolean
  terminal: BotStepTerminal | null
  onMark: BotItemStepMark
}): React.JSX.Element {
  const t = useTranslate()
  const [opened, setOpened] = useState(false)
  const [failing, setFailing] = useState(false)
  const [busy, setBusy] = useState(false)
  const done = step.state === 'done'
  const expanded = (current || opened) && !done
  const mark = (state: BotItemStepState, error?: string): void => {
    setBusy(true)
    void onMark(step, state, error)
      .then((ok) => {
        if (ok !== false) {
          setFailing(false)
        }
      })
      .finally(() => setBusy(false))
  }
  const number = step.index + 1
  return (
    <li
      data-bot-item-step={number}
      data-current={current ? '' : undefined}
      className={cn(
        'rounded-md border px-2 py-1.5',
        current ? 'border-border bg-background' : 'border-transparent',
        !current && !done && 'opacity-60 focus-within:opacity-100 hover:opacity-100'
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={t('bots.items.steps.done', 'Done: step {{n}}', { n: number })}
          disabled={busy}
          className={cn(
            'mt-px flex size-4 shrink-0 items-center justify-center rounded border outline-none focus-visible:ring-2 focus-visible:ring-ring',
            done
              ? 'border-status-success bg-status-success text-background'
              : 'border-muted-foreground/60 hover:border-foreground'
          )}
          onClick={() => mark(done ? 'open' : 'done')}
        >
          {done ? <Check className="size-3" /> : null}
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          disabled={current || done}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left text-[13px] leading-[18px] disabled:cursor-default"
          onClick={() => setOpened(!opened)}
        >
          {/* The number never leaves its title: the title and badges wrap together in the box beside it. */}
          <span className="shrink-0 text-muted-foreground">{number}.</span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className={cn(done && 'text-muted-foreground line-through')}>{step.title}</span>
            {step.host && step.command ? (
              <span className="ml-1.5 inline-block rounded bg-muted px-1.5 align-baseline text-2xs leading-4 text-muted-foreground">
                {t('bots.items.steps.host', 'on {{host}}', { host: step.host })}
              </span>
            ) : null}
            {isBotItemManualStep(step) ? (
              <span className="ml-1.5 text-2xs text-muted-foreground">
                {t('bots.items.steps.manual', 'do this yourself')}
              </span>
            ) : null}
            {step.state === 'failed' ? (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-2xs text-destructive">
                <TriangleAlert className="size-3" />
                {t('bots.items.steps.failed', 'Did not work')}
              </span>
            ) : null}
          </span>
        </button>
        {!current && !done ? (
          <ChevronRight
            aria-hidden
            className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground', opened && 'rotate-90')}
          />
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-6">
          {step.note ? (
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{step.note}</p>
          ) : null}
          {step.command ? <BotItemCommandBlock command={step.command} /> : null}
          {step.text ? <BotItemCommandBlock command={step.text} kind="text" /> : null}
          {step.state === 'failed' && step.error ? (
            <pre className="m-0 max-h-24 overflow-auto scrollbar-sleek whitespace-pre-wrap rounded bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive [overflow-wrap:anywhere]">
              {step.error}
            </pre>
          ) : null}
          {failing ? (
            <StepFailure
              onSend={(error) => mark('failed', error)}
              onCancel={() => setFailing(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {terminal && step.command ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!terminal.canOpen}
                  title={terminal.canOpen ? undefined : whyNoTerminal(terminal.why, t)}
                  onClick={terminal.canOpen ? terminal.open : undefined}
                >
                  <SquareTerminal className="size-3" />
                  {t('bots.items.steps.openTerminal', 'Open in terminal')}
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => setFailing(true)}
              >
                {t('bots.items.steps.didNotWork', 'Did not work')}
              </Button>
            </div>
          )}
          {terminal?.canOpen ? (
            <p className="text-2xs text-muted-foreground">
              {t(
                'bots.items.steps.terminalHint',
                'Opens a terminal with the command typed in. Press Enter to run it.'
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function BotItemSteps({
  view,
  onMark,
  terminalFor
}: {
  view: BotItemStepsView
  onMark: BotItemStepMark
  /** Desktop only: the phone has no Open in terminal. */
  terminalFor?: (step: BotItemStep) => BotStepTerminal
}): React.JSX.Element {
  const t = useTranslate()
  const current = botItemCurrentStepIndex(view)
  return (
    <section aria-label={t('bots.items.steps.title', 'Steps for you')} data-bot-item-steps>
      <h3 className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{t('bots.items.steps.title', 'Steps for you')}</span>
        <span aria-live="polite">
          {t('bots.items.steps.progress', '{{done}} of {{total}} done', {
            done: botItemStepsDoneCount(view),
            total: view.steps.length
          })}
        </span>
      </h3>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {view.steps.map((step) => (
          <StepRow
            key={`${view.eventId}:${step.index}`}
            step={step}
            current={step.index === current}
            terminal={terminalFor && step.command ? terminalFor(step) : null}
            onMark={onMark}
          />
        ))}
      </ol>
    </section>
  )
}
